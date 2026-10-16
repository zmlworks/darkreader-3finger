// テスト用: WebExtension API の最小スタブ（ページの world で content script を動かすため）。
// storage.local は localStorage に保存（再読み込みをまたいで残る）。runtime/tabs のメッセージは
// トップフレームに置いた「バス」で中継し、そこで実物の background.js を動かす。
(() => {
  const LOCALE = window.__DR3F_LOCALE || "en";
  const MSGS = window.__DR3F_MSGS[LOCALE];
  // フレーム間はクロスオリジンでも動くよう postMessage でつなぐ（トップ = 疑似バックグラウンド）
  const IS_TOP = window === window.top;
  const fid = IS_TOP ? 0 : "f" + Math.random().toString(36).slice(2);
  const listeners = [];
  const pending = new Map();
  let seq = 0;
  const frames = new Map(); // top のみ: fid → window
  if (IS_TOP) frames.set(0, window);
  const callListeners = async (m) => {
    let res;
    for (const l of listeners) { const r = l(m, { id: "x" }); if (r !== undefined && res === undefined) res = r; }
    return res;
  };
  const rpc = (win, payload) => new Promise((resolve) => {
    const id = fid + ":" + ++seq;
    pending.set(id, resolve);
    win.postMessage(Object.assign({ __dr3fbus: 1, id, from: fid }, payload), "*");
  });
  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (!d || d.__dr3fbus !== 1) return;
    if (d.kind === "reply") { const r = pending.get(d.id); pending.delete(d.id); r && r(d.res); return; }
    let res;
    if (d.kind === "hello" && IS_TOP) frames.set(d.from, e.source);
    if (d.kind === "toBg" && IS_TOP) res = await bgDispatch(d.m, d.from);
    if (d.kind === "toCS") res = await callListeners(d.m);
    e.source.postMessage({ __dr3fbus: 1, kind: "reply", id: d.id, res }, "*");
  });
  if (!IS_TOP) window.top.postMessage({ __dr3fbus: 1, kind: "hello", from: fid }, "*");
  let bgListener = null;
  async function bgDispatch(m, from) {
    window.__log.push("bg<-" + from + ":" + m.type);
    return bgListener ? bgListener(m, { tab: { id: 1 }, frameId: from }) : undefined;
  }
  async function deliver(target, m) {
    const wins = target == null ? [...frames.entries()] : [[target, frames.get(target)]];
    let res;
    for (const [k, w] of wins) {
      if (!w) continue;
      const r = k === 0 ? await callListeners(m) : await rpc(w, { kind: "toCS", m });
      if (r !== undefined && res === undefined) res = r;
    }
    return res;
  }
  const KEY = "__dr3f_store";
  const read = () => JSON.parse(localStorage.getItem(KEY) || "{}");
  const changeL = [];
  window.browser = {
    i18n: { getMessage: (k) => (MSGS[k] ? MSGS[k].message : ""), getUILanguage: () => LOCALE },
    storage: {
      local: {
        get: async (d) => Object.assign({}, d, read()),
        set: async (o) => {
          const cur = read();
          const ch = {};
          for (const k in o) ch[k] = { oldValue: cur[k], newValue: o[k] };
          localStorage.setItem(KEY, JSON.stringify(Object.assign(cur, o)));
          changeL.forEach((l) => l(ch, "local"));
        },
      },
      onChanged: { addListener: (l) => changeL.push(l) },
    },
    runtime: {
      sendMessage: async (m) => (IS_TOP ? bgDispatch(m, 0) : rpc(window.top, { kind: "toBg", m })),
      onMessage: { addListener: (l) => listeners.push(l) },
    },
  };
  if (IS_TOP) {
    window.__log = [];
    const bgApi = {
      runtime: { onMessage: { addListener: (l) => (bgListener = l) } },
      tabs: { sendMessage: (tabId, m, o) => deliver(o && o.frameId != null ? o.frameId : null, m) },
      storage: window.browser.storage, // scripting は無い → sitemark.js の動的登録は integration.py 側で再現
    };
    new Function("browser", window.__DR3F_BG)(bgApi);
  }
  // closed shadow root をテストから覗けるように open にする
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return orig.call(this, Object.assign({}, o, { mode: "open" })); };
})();
