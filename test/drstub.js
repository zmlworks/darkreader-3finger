// テスト用: Dark Reader（動的モード）の挙動を src/inject/dynamic-theme/index.ts に倣って再現するスタブ。
// - テーマはバックグラウンドとの往復後に来る → ここではマイクロタスク/タイマーで遅延（最悪ケースとして短く）
// - head が無ければ head ができるまで待って ready()
// - ready(): isDRLocked() なら何もしない／でなければ meta[name=darkreader] を作り、head を監視してロック出現で removeDynamicTheme()
// ?dr=filter ならフィルターモード（style#dark-reader-style と data-darkreader-mode=filter のみ、ロック無視）
// ?fb=1 なら fallback.js（システムがダークのとき document_start に入る暗い仮スタイル。ロックを見つけた ready() で消える）も再現し、
//        最初の描画フレームの時点で仮スタイルが残っていたかを __fbFirstFrame に記録する
// ?delay=ms ならテーマの到着（バックグラウンドとの往復）を遅らせる（既定はマイクロタスク = 最悪ケース）
(() => {
  const q = new URLSearchParams(location.search);
  const mode = q.get("dr") || "dynamic";
  const log = (s) => (window.__drlog = window.__drlog || []).push((window === window.top ? "top:" : "sub:") + s);
  if (mode === "none") return;
  if (q.get("fb") === "1" && document.documentElement instanceof HTMLHtmlElement) { // fallback.js と同じ条件（Chromium の init script 時点では documentElement が無い）
    const fb = document.createElement("style"); fb.className = "darkreader darkreader--fallback";
    fb.textContent = "html,body,body :not(iframe){background-color:#181a1b!important;color:#e8e6e3!important}";
    (document.head || document.documentElement).append(fb);
    requestAnimationFrame(() => { window.__fbFirstFrame = !!document.querySelector(".darkreader--fallback"); window.__bgFirstFrame = getComputedStyle(document.documentElement).backgroundColor; });
    log("fallback-inserted");
  }
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
    if (document.querySelector('meta[name="darkreader-lock"]')) { document.querySelector(".darkreader--fallback")?.remove(); log("locked-at-load"); return; }
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
  const delay = +q.get("delay") || 0;
  if (delay) setTimeout(start, delay); else Promise.resolve().then(start);
})();
