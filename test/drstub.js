// テスト用: Dark Reader（動的モード）の挙動を src/inject/dynamic-theme/index.ts に倣って再現するスタブ。
// - テーマはバックグラウンドとの往復後に来る → ここではマイクロタスク/タイマーで遅延（最悪ケースとして短く）
// - head が無ければ head ができるまで待って ready()
// - ready(): isDRLocked() なら何もしない／でなければ meta[name=darkreader] を作り、head を監視してロック出現で removeDynamicTheme()
// ?dr=filter ならフィルターモード（style#dark-reader-style と data-darkreader-mode=filter のみ、ロック無視）
(() => {
  const q = new URLSearchParams(location.search);
  const mode = q.get("dr") || "dynamic";
  const log = (s) => (window.__drlog = window.__drlog || []).push((window === window.top ? "top:" : "sub:") + s);
  if (mode === "none") return;
  let metaObserver;
  const css = "html,body{background:#111!important;color:#eee!important}";
  function removeDynamicTheme() {
    document.documentElement.removeAttribute("data-darkreader-mode");
    if (document.head) {
      for (const s of [".darkreader--text", 'meta[name="darkreader"]']) document.head.querySelector(s)?.remove();
    }
    document.querySelectorAll(".darkreader").forEach((n) => n.remove());
    metaObserver && metaObserver.disconnect();
    log("removed");
  }
  function ready() {
    if (mode === "filter") {
      document.documentElement.setAttribute("data-darkreader-mode", "filter");
      const st = document.createElement("style"); st.id = "dark-reader-style"; st.className = "darkreader"; st.textContent = css;
      document.head.appendChild(st); log("filter-applied"); return;
    }
    if (document.querySelector('meta[name="darkreader-lock"]')) { log("locked-at-load"); return; }
    const m = document.createElement("meta"); m.name = "darkreader"; m.content = "stub-" + Math.random(); document.head.appendChild(m);
    metaObserver = new MutationObserver(() => {
      if (document.querySelector('meta[name="darkreader-lock"]')) { metaObserver.disconnect(); removeDynamicTheme(); }
    });
    metaObserver.observe(document.head, { childList: true, subtree: true });
    document.documentElement.setAttribute("data-darkreader-mode", "dynamic");
    const st = document.createElement("style"); st.className = "darkreader darkreader--text"; st.textContent = css;
    document.head.appendChild(st);
    log("applied");
  }
  const start = () => {
    if (document.head) ready();
    else {
      const ho = new MutationObserver(() => { if (document.head) { ho.disconnect(); ready(); } });
      ho.observe(document, { childList: true, subtree: true });
    }
  };
  log("headAtStart=" + !!document.head);
  Promise.resolve().then(start);
})();
