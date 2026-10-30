/* Dark Reader 3本指トグル: content script（全フレーム、document_start）
   既定では Dark Reader をオフにしておき、3本指タップでオンにする。
   Dark Reader には外部から操作する API がないため、Dark Reader 自身がサイト向けに用意している
   <meta name="darkreader-lock"> を使う（Dark Reader は MIT ライセンス、src/inject/dynamic-theme/index.ts）。
   - 読み込み時: Dark Reader の ready() は isDRLocked()（document.querySelector）が真なら何もしない。
     テーマはバックグラウンドとの往復後に届くので、document_start で同期的に入れたロックが必ず先に効く。
   - 適用中にロックが現れると、document.head を監視する MutationObserver が即座に removeDynamicTheme()。
   - ロックを外しても再適用はされない（再適用のきっかけは Dark Reader 側の設定変更などだけ）→ オンは再読み込み。
   - フィルター／静的モードはロックを見ない（動的モードのみ対応）。 */
(() => {
  // 二重注入防止は document 単位（初期 about:blank から同一オリジンへ遷移すると Window が再利用されるため）
  if (document.__dr3fLoaded) return;
  document.__dr3fLoaded = true;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const TOP = window === window.top;
  const HOST = location.hostname;
  const SS_ON = "dr3f:on"; // sessionStorage（このタブ × このオリジン）: "1" ならダーク
  const SS_CHECK = "dr3f:check"; // オンにして再読み込みした直後: Dark Reader が適用されたか確かめる
  const SS_WARNED = "dr3f:warned"; // フィルター/静的モードの警告を出した
  const LOCK_SEL = 'meta[name="darkreader-lock"]';
  const OUR_LOCK_SEL = 'meta[name="darkreader-lock"][data-dr3f]';
  const DEFAULTS = { rememberDark: false, darkSites: [] };
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
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) sessionStorage.removeItem(k);
        else sessionStorage.setItem(k, v);
      } catch (e) {}
    },
  };
  ss.set("dr3f:off", null); // 1.0.0 の名残

  // ---- ロック ----
  let lockEl = null; // こちらが入れたロック（documentElement がまだ無いときは DOM の外で待機中のこともある）
  const ourLock = () => (lockEl ? lockEl : document.querySelector(OUR_LOCK_SEL));
  const foreignLock = () => document.querySelector(LOCK_SEL + ":not([data-dr3f])");

  function insertLock() {
    if (lockEl) return;
    const m = document.createElement("meta");
    m.setAttribute("name", "darkreader-lock");
    m.setAttribute("data-dr3f", "");
    lockEl = m;
    placeLock(m);
    startGuard();
  }

  // head がまだ無い（document_start）ときは documentElement に置き、head ができたら head へ移す。
  // Dark Reader の isDRLocked() は document.querySelector なので head の外でも効く。
  // 適用中の解除は document.head を監視する MutationObserver なので、最終的には head に入れておく。
  function placeLock(m) {
    const parent = document.head || document.documentElement;
    if (parent && m.parentNode !== parent) parent.appendChild(m);
  }

  // 1.1.1: オフの間はロックを守る。ページ（SPA など）が head を書き換えたり作り直したりしてロックが外れると、
  // その後に届いた Dark Reader のテーマが適用されてしまうので、外れたら入れ直す。
  // 監視するのは document / documentElement / head の直下だけ（subtree は見ない）。
  let guard = null;
  let guardFixes = 0;
  const GUARD_MAX = 200; // ページがロックを消し続ける場合の無限の取り合いを避ける
  function guardTargets() {
    guard.disconnect();
    guard.observe(document, { childList: true });
    if (document.documentElement) guard.observe(document.documentElement, { childList: true });
    if (document.head) guard.observe(document.head, { childList: true });
  }
  function guardCheck() {
    if (!guard) return;
    const m = lockEl;
    if (!m) return stopGuard();
    const want = document.head || document.documentElement;
    if (want && m.parentNode !== want) {
      if (++guardFixes > GUARD_MAX) {
        console.warn("dr3f: the page keeps removing the darkreader-lock meta; giving up");
        return stopGuard();
      }
      placeLock(m);
    }
    guardTargets();
  }
  function startGuard() {
    if (guard) return;
    guard = new MutationObserver(guardCheck);
    guardTargets();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", guardCheck, { once: true });
  }
  function stopGuard() {
    if (guard) guard.disconnect();
    guard = null;
  }

  function removeLock() {
    stopGuard();
    if (lockEl) lockEl.remove();
    lockEl = null;
    document.querySelectorAll(OUR_LOCK_SEL).forEach((n) => n.remove());
  }

  // Dark Reader の fallback.js は、システムがダークテーマのとき document_start で暗い仮スタイル
  // style.darkreader--fallback を入れ、テーマが届いてロックを見つけた時点で自分で消す（ready()）。
  // その間（バックグラウンドとの往復）一瞬暗くなるのを防ぐため、こちらのロックがある間は先に外しておく。
  let fbObserver = null;
  function suppressFallback(on) {
    if (!on) {
      if (fbObserver) fbObserver.disconnect();
      fbObserver = null;
      return;
    }
    const sweep = () => {
      if (!lockEl) return suppressFallback(false);
      document.querySelectorAll("style.darkreader--fallback").forEach((n) => n.remove());
    };
    sweep();
    if (fbObserver) return;
    fbObserver = new MutationObserver(sweep);
    fbObserver.observe(document, { childList: true, subtree: true });
    const stop = () => setTimeout(() => suppressFallback(false), 3000);
    if (document.readyState === "complete") stop();
    else addEventListener("load", stop, { once: true });
  }

  // ---- 状態 ----
  // dark=false（既定）: ロックを入れて Dark Reader を止めておく。dark=true: ロックなし（Dark Reader が普段どおり動く）
  let dark = ss.get(SS_ON) === "1";
  if (!dark && TOP && typeof DR3F_SITE_DARK !== "undefined" && DR3F_SITE_DARK === true) {
    dark = true; // sitemark.js（記憶したサイトだけに動的登録）が先に動いた
    ss.set(SS_ON, "1");
  }
  if (!dark) {
    insertLock(); // 同期。Dark Reader のテーマはバックグラウンドとの往復後に来るので間に合う
    suppressFallback(true);
  }
  // sitemark.js がこの後で動いた場合（スクリプトの実行順は保証されない）
  DR3F._siteDark = () => {
    if (TOP && !dark) setDarkAtLoad(true);
  };

  function setDarkAtLoad(on) {
    dark = on;
    ss.set(SS_ON, on ? "1" : null);
    if (on) {
      suppressFallback(false);
      removeLock();
    } else {
      insertLock();
    }
    if (TOP) reportTop();
  }

  const reportTop = () => api.runtime.sendMessage({ type: "dr3f:topState", dark }).catch(() => {});
  if (TOP) reportTop();

  const settingsReady = api.storage.local.get(DEFAULTS).then((s) => {
    settings = Object.assign({}, DEFAULTS, s);
    // 予備: 動的登録がまだ無い等で sitemark.js が動かなかったとき（非同期なので今回は間に合わないことがある。
    // その場合も ss に記録するので、このタブの次の読み込みからはダーク）
    if (TOP && !dark && settings.darkSites.includes(HOST)) setDarkAtLoad(true);
  }, () => {});
  api.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    for (const k of Object.keys(ch)) if (k in DEFAULTS) settings[k] = ch[k].newValue === undefined ? DEFAULTS[k] : ch[k].newValue;
  });

  // サブフレーム: トップフレームの状態に合わせる（自分の ss は同期で読めるので、たいていは最初から一致している）
  if (!TOP) {
    api.runtime.sendMessage({ type: "dr3f:getTopState" }).then((r) => {
      if (r && typeof r.dark === "boolean" && r.dark !== dark) setDarkAtLoad(r.dark);
    }, () => {});
  }

  api.runtime.onMessage.addListener((m) => {
    if (!m || typeof m.type !== "string") return;
    if (TOP && m.type === "dr3f:tap") {
      onTap();
      return;
    }
    if (TOP && m.type === "dr3f:queryState") return Promise.resolve({ dark });
    if (!TOP && m.type === "dr3f:setDark" && typeof m.dark === "boolean") setDarkAtLoad(m.dark);
  });

  const broadcast = () => api.runtime.sendMessage({ type: "dr3f:broadcast", dark }).catch(() => {});

  // 1.1.1: 記憶したサイトの追加・削除はバックグラウンドで順番に行う（複数のタブやポップアップから同時に
  // 読み書きすると、片方の変更が消えるため）。バックグラウンドに届かないときだけ、ここで直接書く。
  async function saveSite(add) {
    if (!HOST) return;
    try {
      const r = await api.runtime.sendMessage({ type: "dr3f:saveSite", add: !!add });
      if (r && r.ok) return;
    } catch (e) {}
    const { darkSites } = await api.storage.local.get({ darkSites: [] });
    if (add === darkSites.includes(HOST)) return;
    const next = darkSites.filter((h) => h !== HOST);
    if (add) next.push(HOST);
    await api.storage.local.set({ darkSites: next });
  }

  const drMode = () => document.documentElement && document.documentElement.getAttribute("data-darkreader-mode");
  const notDynamic = () => {
    const m = drMode();
    return (m && m !== "dynamic") || !!document.getElementById("dark-reader-style");
  };
  const drActive = () => !!document.querySelector('meta[name="darkreader"]') || drMode() === "dynamic";

  // ---- 3本指タップ（トップフレーム）----
  async function onTap() {
    if (busy) return;
    await settingsReady;
    if (notDynamic()) {
      toast(msg("toastNotDynamic")); // フィルター/静的モードはロックが効かないので切り替えられない
      return;
    }
    if (dark) {
      // オフ: ロック挿入 → Dark Reader の MutationObserver が即座にテーマを外す
      dark = false;
      ss.set(SS_ON, null);
      insertLock();
      reportTop();
      broadcast();
      toast(msg("toastOff"));
      saveSite(false).catch(() => {});
      return;
    }
    if (foreignLock()) {
      toast(msg("toastSiteLocked")); // サイト自身が Dark Reader を断っている
      return;
    }
    // オン: ロックを外して再読み込み（Dark Reader はロックが外れても自分からは再適用しない）
    busy = true;
    dark = true;
    ss.set(SS_ON, "1");
    ss.set(SS_CHECK, "1");
    toast(msg("toastOn"));
    try {
      if (settings.rememberDark) await saveSite(true);
    } catch (e) {}
    removeLock();
    reportTop();
    broadcast(); // サブフレームも ss にダークを記録 → 再読み込みで最初からロックなし
    setTimeout(() => location.reload(), 500);
  }

  // ---- 読み込み後の確認（トップフレーム）----
  // ・オンにして再読み込みした直後: 約3秒以内に Dark Reader が動かなければ「見つかりません」
  // ・フィルター/静的モード: ロックが効かず常にダークになるので、このタブ×サイトで一度だけ知らせる
  if (TOP) {
    const checking = ss.get(SS_CHECK) === "1";
    ss.set(SS_CHECK, null);
    const t0 = Date.now();
    const finish = () => {
      if (notDynamic()) {
        if (checking || ss.get(SS_WARNED) !== "1") {
          ss.set(SS_WARNED, "1");
          toast(msg("toastNotDynamic"));
        }
      } else if (checking && dark && !drActive()) toast(msg("toastNotFound"));
    };
    const poll = () => {
      if (checking && dark && drActive() && !notDynamic()) return; // 適用された
      const waited = Date.now() - t0;
      if (waited >= 3000 && document.readyState !== "loading") return finish();
      setTimeout(poll, 250);
    };
    setTimeout(poll, 250);
  }

  // ---- トースト（Shadow DOM で隔離、ピンチズーム中も見える位置に）----
  let toastHost = null;
  let toastTimer = 0;
  function toast(text) {
    if (!TOP || !document.documentElement) return;
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
    }, 2000);
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
  DR3F._content = { onTap, toast, insertLock, removeLock, ourLock, isDark: () => dark, saveSite, guarding: () => !!guard };
})();
