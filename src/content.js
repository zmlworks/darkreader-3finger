/* Dark Reader 3本指トグル: content script（全フレーム、document_start）
   Dark Reader には外部メッセージ API がないため、Dark Reader 自身が尊重する
   <meta name="darkreader-lock"> を挿入/削除して切り替える。
   - 動的モードの Dark Reader は document.head を MutationObserver で監視しており、ロックが現れると即座にテーマを外す。
   - ページ読み込み時にロックがあれば適用しない（document.querySelector で探すので head の外でも有効）。
   - ロックを外しても再適用はされないので、オンに戻すときはページを再読み込みする。 */
(() => {
  // 二重注入防止は document 単位（初期 about:blank から同一オリジンへ遷移すると Window が再利用されるため）
  if (document.__dr3fLoaded) return;
  document.__dr3fLoaded = true;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const TOP = window === window.top;
  const HOST = location.hostname;
  const SS_KEY = "dr3f:off"; // sessionStorage（このタブ × このオリジン）
  const LOCK_SEL = 'meta[name="darkreader-lock"]';
  const OUR_LOCK_SEL = 'meta[name="darkreader-lock"][data-dr3f]';
  const DEFAULTS = { action: "toggle", remember: false, sites: [] };
  let settings = Object.assign({}, DEFAULTS);
  let busy = false; // 再読み込み待ちの間は無視

  const msg = (k) => {
    try {
      return api.i18n.getMessage(k) || k;
    } catch (e) {
      return k;
    }
  };

  // ---- sessionStorage（サンドボックス iframe などでは例外になるので握りつぶす）----
  const ss = {
    get() {
      try {
        return sessionStorage.getItem(SS_KEY) === "1";
      } catch (e) {
        return false;
      }
    },
    set(on) {
      try {
        if (on) sessionStorage.setItem(SS_KEY, "1");
        else sessionStorage.removeItem(SS_KEY);
      } catch (e) {}
    },
  };

  // ---- ロック ----
  const ourLock = () => document.querySelector(OUR_LOCK_SEL);
  const anyLock = () => document.querySelector(LOCK_SEL);

  function insertLock() {
    if (ourLock()) return;
    const m = document.createElement("meta");
    m.setAttribute("name", "darkreader-lock");
    m.setAttribute("data-dr3f", "");
    placeLock(m);
  }

  // head がまだ無い（document_start）ときは documentElement に置き、head ができたら head へ移す。
  // Dark Reader の isDRLocked() は document.querySelector なので head の外でも効く。
  // ライブ解除の MutationObserver は document.head を監視しているので、最終的には head に入れておく。
  function placeLock(m) {
    if (document.head) {
      document.head.appendChild(m);
      return;
    }
    const root = document.documentElement;
    if (root) root.appendChild(m);
    const mo = new MutationObserver(() => {
      if (!m.isConnected && !document.documentElement) return;
      if (!m.isConnected) document.documentElement.appendChild(m);
      if (document.head) {
        mo.disconnect();
        if (m.parentNode !== document.head) document.head.appendChild(m);
      }
    });
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => {
      mo.disconnect();
      if (!m.isConnected) (document.head || document.documentElement).appendChild(m);
      else if (document.head && m.parentNode !== document.head) document.head.appendChild(m);
    }, { once: true });
  }

  function removeLock() {
    document.querySelectorAll(OUR_LOCK_SEL).forEach((n) => n.remove());
  }

  // ---- 起動時: 記憶されたロックを Dark Reader より先に入れる ----
  if (ss.get()) insertLock(); // 同期。Dark Reader のテーマはバックグラウンドとの往復後に来るので間に合う

  const settingsReady = api.storage.local.get(DEFAULTS).then((s) => {
    settings = Object.assign({}, DEFAULTS, s);
    if (settings.sites.includes(HOST) && !ourLock()) {
      // 非同期なので Dark Reader が先に適用済みのこともあるが、その場合もロックの出現で即座に外れる
      insertLock();
      ss.set(true); // 同じタブの次の読み込みでは同期で間に合わせる
    }
  }, () => {});
  api.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    for (const k of Object.keys(ch)) if (k in DEFAULTS) settings[k] = ch[k].newValue === undefined ? DEFAULTS[k] : ch[k].newValue;
  });

  // サブフレーム: トップフレームの状態に合わせる
  if (!TOP) {
    api.runtime.sendMessage({ type: "dr3f:getTopState" }).then((r) => {
      if (r && r.off) insertLock();
    }, () => {});
  }

  api.runtime.onMessage.addListener((m) => {
    if (!m || typeof m.type !== "string") return;
    if (TOP && m.type === "dr3f:tap") {
      onTap();
      return;
    }
    if (TOP && m.type === "dr3f:queryState") return Promise.resolve({ off: !!ourLock() });
    if (!TOP && m.type === "dr3f:setLock") {
      if (m.off) insertLock();
      else removeLock();
    }
  });

  const broadcast = (off) => api.runtime.sendMessage({ type: "dr3f:broadcast", off }).catch(() => {});

  async function saveSite(add) {
    const { sites } = await api.storage.local.get({ sites: [] });
    const next = sites.filter((h) => h !== HOST);
    if (add) next.push(HOST);
    if (next.length !== sites.length || add) await api.storage.local.set({ sites: next });
  }

  // ---- 3本指タップ時の動作（トップフレーム）----
  async function onTap() {
    if (busy) return;
    await settingsReady;
    if (settings.action === "reload") {
      busy = true;
      toast(msg("toastReload"));
      setTimeout(() => location.reload(), 300);
      return;
    }
    if (ourLock()) {
      // オンに戻す: ロックを外して再読み込み（再読み込み後にロックが戻らないよう、先に記憶を消す）
      busy = true;
      ss.set(false);
      toast(msg("toastOn"));
      try {
        await saveSite(false);
      } catch (e) {}
      removeLock();
      broadcast(false);
      setTimeout(() => location.reload(), 500);
      return;
    }
    const active = document.querySelector('meta[name="darkreader"]');
    if (active && !anyLock()) {
      insertLock(); // Dark Reader の MutationObserver が即座にテーマを外す
      ss.set(true);
      broadcast(true);
      if (settings.remember) {
        toast(msg("toastOffSite"));
        saveSite(true).catch(() => {});
      } else toast(msg("toastOff"));
      return;
    }
    const mode = document.documentElement && document.documentElement.getAttribute("data-darkreader-mode");
    if (mode && mode !== "dynamic") toast(msg("toastNotDynamic"));
    else toast(msg("toastNotRunning"));
  }

  // ---- トースト（Shadow DOM で隔離、ピンチズーム中も見える位置に）----
  let toastHost = null;
  let toastTimer = 0;
  function toast(text) {
    if (!TOP) return;
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement("dr3f-toast");
      toastHost.style.cssText =
        "all:initial!important;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;" +
        "display:block!important;left:0;top:0;width:0;height:0;";
      const root = toastHost.attachShadow({ mode: "closed" });
      root.innerHTML =
        '<style>div{position:absolute;transform:translate(-50%,-100%);max-width:80vw;box-sizing:border-box;' +
        "padding:.6em 1.1em;border-radius:1.4em;background:rgba(32,32,32,.92);color:#fff;font:500 15px/1.4 system-ui,sans-serif;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 10px rgba(0,0,0,.4);" +
        "opacity:0;transition:opacity .15s}div.on{opacity:1}</style><div></div>";
      toastHost._box = root.querySelector("div");
      document.documentElement.appendChild(toastHost); // body は transform 等で fixed が崩れることがあるので避ける
    }
    const box = toastHost._box;
    const vv = window.visualViewport;
    const s = vv ? vv.scale || 1 : 1;
    const w = vv ? vv.width : innerWidth;
    const h = vv ? vv.height : innerHeight;
    box.style.left = (vv ? vv.offsetLeft : 0) + w / 2 + "px";
    box.style.top = (vv ? vv.offsetTop : 0) + h * 0.88 + "px";
    box.style.fontSize = 15 / s + "px";
    box.style.maxWidth = w * 0.9 + "px";
    box.textContent = text;
    box.setAttribute("data-text", text);
    void box.offsetWidth;
    box.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.remove("on");
      toastTimer = setTimeout(() => toastHost && toastHost.remove(), 200);
    }, 1600);
  }

  // ---- タッチ入力 → 検出器 ----
  const det = DR3F.createTapDetector({
    getScale: () => (window.visualViewport && window.visualViewport.scale) || 1,
    onTap: () => {
      if (TOP) onTap();
      else api.runtime.sendMessage({ type: "dr3f:tap" }).catch(() => {});
    },
  });
  const pts = (list) => Array.from(list, (t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  const opt = { capture: true, passive: true };
  const on = (type, kind) =>
    document.addEventListener(type, (e) => det.feed(kind, e.timeStamp || performance.now(), pts(e.changedTouches), e.touches.length), opt);
  on("touchstart", "start");
  on("touchmove", "move");
  on("touchend", "end");
  on("touchcancel", "cancel");

  // テスト用フック（ページからは見えない isolated world 内の変数）
  DR3F._content = { onTap, toast, insertLock, removeLock, ourLock };
})();
