"""結合テスト: ヘッドレス Firefox / Chromium（Playwright）で content script を実際に動かす。
実行: python3 test/integration.py [firefox|chromium ...]（Playwright の Python 版）
content script はページ world に add_init_script で注入（shim.js が browser.* API を代用、
background.js も実物をバス上で動かす）。drstub.js が Dark Reader の動的モードを再現する。"""
import json, pathlib, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, TEST = ROOT / "src", ROOT / "test"
rd = lambda p: p.read_text(encoding="utf-8")
MSGS = {l: json.loads(rd(SRC / "_locales" / l / "messages.json")) for l in ("ja", "en")}
BG = rd(SRC / "background.js").replace("const api = typeof browser", "const api = browser; const _unused = typeof browser")

PAGE = """<!DOCTYPE html><html><head><title>%s</title><script>
sessionStorage.loads = (+sessionStorage.loads || 0) + 1;</script></head>
<body style="margin:0;height:2000px"><h1>%s</h1><p>text</p>%s</body></html>"""

def route(r):
    url = r.request.url
    path = url.split("://", 1)[1].split("/", 1)[1]
    if path.startswith("frame") or "other.test" in url:
        body = PAGE % ("frame", "frame", "")
    elif path.startswith("sitelock"):
        body = (PAGE % ("sitelock", "sitelock", "")).replace("<title>", '<meta name="darkreader-lock"><title>')
    elif path.startswith("withframe"):
        body = PAGE % ("withframe", "with iframe", '<iframe src="http://other.test/frame.html?dr=dynamic" style="width:300px;height:200px"></iframe>')
    else:
        body = PAGE % (path, path, "")
    r.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)

TAP = """async ({n, dur, move, stagger, x0}) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = document.elementFromPoint(x0 || 100, 150) || document.body;
  const mk = (i, dx) => new Touch({ identifier: 100 + i, target: el, clientX: (x0 || 100) + i * 60 + (dx || 0), clientY: 150, radiusX: 10, radiusY: 10, force: 1 });
  const ev = (type, touches, changed) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: changed }));
  const down = [];
  for (let i = 0; i < n; i++) { const t = mk(i); down.push(t); ev("touchstart", [...down], [t]); if (stagger) await sleep(stagger); }
  if (move) { const t = mk(0, move); down[0] = t; ev("touchmove", [...down], [t]); }
  await sleep(dur || 60);
  ev("touchend", [], [...down]);
}"""

def toast(page):
    return page.evaluate("""() => { const h = document.querySelector('dr3f-toast'); const d = h && h.shadowRoot && h.shadowRoot.querySelector('div');
      return d ? d.getAttribute('data-text') : null; }""")

def state(page):
    return page.evaluate("""() => ({
      dr: !!document.querySelector('meta[name="darkreader"]'),
      mode: document.documentElement.getAttribute('data-darkreader-mode'),
      lock: !!document.querySelector('meta[name="darkreader-lock"][data-dr3f]'),
      lockInHead: !!document.head.querySelector('meta[name="darkreader-lock"][data-dr3f]'),
      bg: getComputedStyle(document.body).backgroundColor,
      ss: sessionStorage.getItem('dr3f:on'), loads: +sessionStorage.loads,
      store: JSON.parse(localStorage.getItem('__dr3f_store') || '{}'),
      drlog: (window.__drlog || []).slice() })""")

results = []
def check(name, cond, info=None):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "   " + json.dumps(info, ensure_ascii=False)[:600]))

def run(engine, pw, order, locale="en"):
    tag = f"[{engine}/{order}/{locale}] "
    kw = {"headless": True}
    if engine == "firefox":
        kw["firefox_user_prefs"] = {"dom.w3c_touch_events.enabled": 1}
    browser = getattr(pw, engine).launch(**kw)
    ctx = browser.new_context(has_touch=True, viewport={"width": 400, "height": 700})
    pre = f"window.__DR3F_LOCALE={json.dumps(locale)};window.__DR3F_MSGS={json.dumps(MSGS, ensure_ascii=False)};window.__DR3F_BG={json.dumps(BG)};"
    parts = [pre, rd(TEST / "shim.js")]
    ours = rd(SRC / "detector.js") + "\n" + rd(SRC / "content.js")
    # sitemark.js の動的登録（matches = 記憶したホスト、トップフレームのみ）を再現。?noreg=1 で登録漏れを再現
    mark = ("(() => { if (window !== window.top || /[?&]noreg=1/.test(location.search)) return;"
            " const st = JSON.parse(localStorage.getItem('__dr3f_store') || '{}');"
            " if ((st.darkSites || []).includes(location.hostname)) (0, eval)(%s); })();" % json.dumps(rd(SRC / "sitemark.js")))
    # 実行順はどちらもありうるので、順番を入れ替えて両方試す
    parts += [rd(TEST / "drstub.js"), mark, ours] if order == "dr-first" else [ours, mark, rd(TEST / "drstub.js")]
    ctx.add_init_script(script="\n;\n".join(parts))
    ctx.route("http://site.test/**", route)
    ctx.route("http://other.test/**", route)
    page = ctx.new_page()
    tap = lambda **o: page.evaluate(TAP, {"n": 3, **o})
    M = lambda k: MSGS[locale][k]["message"]
    DARK = "rgb(17, 17, 17)"

    # 既定: 毎ページ document_start でロック → Dark Reader は読み込み時から適用しない
    page.goto("http://site.test/a.html?dr=dynamic"); page.wait_for_timeout(100)
    s = state(page)
    check(tag + "default: lock at load, DR never applied (locked-at-load)", s["lock"] and s["lockInHead"] and not s["dr"]
          and "top:locked-at-load" in s["drlog"] and "top:applied" not in s["drlog"] and s["bg"] != DARK and s["mode"] is None, s)
    check(tag + "head did not exist at document_start", "top:headAtStart=false" in s["drlog"], s["drlog"])

    # 1.1.1: オフの間にページがロックを消しても入れ直す（head の作り直しも）
    page.evaluate("() => document.querySelector('meta[data-dr3f]').remove()"); page.wait_for_timeout(30); s = state(page)
    check(tag + "page removed our lock → re-inserted into head", s["lock"] and s["lockInHead"] and not s["dr"], s)
    page.evaluate("() => { const h = document.createElement('head'); document.documentElement.replaceChild(h, document.head); }"); page.wait_for_timeout(30); s = state(page)
    check(tag + "page replaced <head> → lock moved into the new head", s["lock"] and s["lockInHead"] and not s["dr"], s)
    page.evaluate("() => { document.head.innerHTML = ''; }"); page.wait_for_timeout(30); s = state(page)
    check(tag + "page cleared head.innerHTML → lock back", s["lock"] and s["lockInHead"], s)

    for name, o in [("2 fingers", {"n": 2}), ("4 fingers", {"n": 4}), ("held 600ms", {"dur": 600}),
                    ("moved 40px", {"move": 40}), ("slow stagger 200ms each", {"stagger": 200})]:
        tap(**o); page.wait_for_timeout(50); s = state(page)
        check(tag + f"ignored: {name}", s["lock"] and not s["dr"] and toast(page) is None, s)

    # 3本指タップ → ロック削除 → 再読み込み → Dark Reader 適用
    loads = state(page)["loads"]
    with page.expect_event("load", timeout=5000):
        tap(); page.wait_for_timeout(30)
        check(tag + "tap (off) → toast 'turning on'", toast(page) == M("toastOn"), toast(page))
    page.wait_for_timeout(100); s = state(page)
    check(tag + "after tap: reloaded, DR applied, no lock, ss on", s["loads"] == loads + 1 and s["dr"] and not s["lock"] and s["ss"] == "1"
          and s["bg"] == DARK and "top:applied" in s["drlog"] and "top:locked-at-load" not in s["drlog"], s)
    page.wait_for_timeout(3300)
    check(tag + "DR applied → no 'not found' toast after 3s", toast(page) is None, toast(page))
    page.reload(); page.wait_for_timeout(100); s = state(page)
    check(tag + "reload in tab: still dark", s["dr"] and not s["lock"] and "top:applied" in s["drlog"], s)
    page.goto("http://site.test/b.html?dr=dynamic"); page.wait_for_timeout(100); s = state(page)
    check(tag + "same-site navigation in tab: still dark", s["dr"] and not s["lock"], s)

    # もう一度 → ロック挿入で即オフ（再読み込みなし）
    loads = s["loads"]
    tap(); page.wait_for_timeout(60); s = state(page)
    check(tag + "tap (dark) → lock inserted, DR removed instantly, no reload", s["lock"] and s["lockInHead"] and not s["dr"]
          and s["mode"] is None and s["bg"] != DARK and "top:removed" in s["drlog"] and s["ss"] is None and s["loads"] == loads, s)
    check(tag + "toast 'off'", toast(page) == M("toastOff"), toast(page))
    check(tag + "remember off → nothing stored", not s["store"].get("darkSites"), s["store"])
    page.reload(); page.wait_for_timeout(100); s = state(page)
    check(tag + "after reload: off again (locked-at-load)", s["lock"] and not s["dr"] and "top:locked-at-load" in s["drlog"], s)

    # Dark Reader なし → オンにして再読み込み後 3 秒で「見つかりません」
    page.goto("http://site.test/c.html?dr=none"); page.wait_for_timeout(80)
    with page.expect_event("load", timeout=5000):
        tap()
    page.wait_for_timeout(1500)
    check(tag + "no DR: no toast yet at 1.5s", toast(page) is None, toast(page))
    page.wait_for_timeout(2200)
    check(tag + "no DR → toast 'not found' ~3s after reload", toast(page) == M("toastNotFound"), toast(page))
    tap(); page.wait_for_timeout(40)
    check(tag + "no DR: tap again → off", toast(page) == M("toastOff") and state(page)["lock"], [toast(page), state(page)])

    # フィルターモード: ロックが効かない → 一度だけ知らせる、タップも「動的モードのみ」
    page.goto("http://site.test/d.html?dr=filter"); page.wait_for_timeout(3500)
    check(tag + "filter mode → proactive toast 'dynamic only' (once per tab+site)", toast(page) == M("toastNotDynamic"), toast(page))
    page.reload(); page.wait_for_timeout(3500)
    check(tag + "filter mode: not repeated on reload", toast(page) is None, toast(page))
    loads = state(page)["loads"]; tap(); page.wait_for_timeout(300); s = state(page)
    check(tag + "filter mode tap → toast 'dynamic only', nothing changed", toast(page) == M("toastNotDynamic") and s["mode"] == "filter"
          and s["loads"] == loads and s["ss"] is None, [toast(page), s])

    # サイト自身のロック
    page.goto("http://site.test/sitelock.html?dr=dynamic"); page.wait_for_timeout(80); tap(); page.wait_for_timeout(300)
    check(tag + "site's own darkreader-lock → toast 'site disabled', no reload", toast(page) == M("toastSiteLocked"), toast(page))

    # fallback.js（システムがダーク）: こちらのロックがある間は最初の描画前に仮スタイルを外す → 暗くならない
    page.goto("http://site.test/fb.html?dr=dynamic&fb=1&delay=300"); page.wait_for_timeout(450)
    fb = page.evaluate("() => ({first: window.__fbFirstFrame, bg: window.__bgFirstFrame, now: !!document.querySelector('.darkreader--fallback'), log: window.__drlog})")
    check(tag + "fallback style removed before first frame (no dark flash)", fb["first"] is not True and "top:locked-at-load" in fb["log"] and not fb["now"]
          and (engine == "chromium" or ("top:fallback-inserted" in fb["log"] and fb["first"] is False)), fb)

    # iframe（別オリジン）: サブフレームでのタップもトップに中継
    page.goto("http://site.test/withframe.html?dr=dynamic"); page.wait_for_timeout(250)
    fr = page.frames[1]
    fs = lambda: fr.evaluate("""() => ({dr: !!document.querySelector('meta[name="darkreader"]'), lock: !!document.querySelector('meta[name="darkreader-lock"]'), log: window.__drlog})""")
    f = fs()
    check(tag + "iframe: subframe locked at load too", f["lock"] and not f["dr"] and "sub:locked-at-load" in f["log"], f)
    FTAP = TAP.replace("document.elementFromPoint(x0 || 100, 150)", "document.body")
    with page.expect_event("load", timeout=5000):
        fr.evaluate(FTAP, {"n": 3, "x0": 20})
    page.wait_for_timeout(300); fr = page.frames[1]; f = fs(); s = state(page)
    check(tag + "iframe tap → top reloaded dark; subframe dark from load (its ss set by broadcast)", s["dr"] and not s["lock"] and f["dr"]
          and not f["lock"] and "sub:locked-at-load" not in f["log"], [s, f])
    fr.evaluate(FTAP, {"n": 3, "x0": 20}); page.wait_for_timeout(150); s = state(page); f = fs()
    check(tag + "iframe tap again → top + subframe off instantly", s["lock"] and not s["dr"] and f["lock"] and not f["dr"], [s, f])
    page.reload(); page.wait_for_timeout(250); fr = page.frames[1]; f = fs()
    check(tag + "iframe after reload: subframe off", f["lock"] and not f["dr"] and "sub:locked-at-load" in f["log"], f)

    # 記憶モード（storage.local の darkSites + 動的登録 sitemark.js）
    page.goto("http://site.test/a.html?dr=dynamic"); page.wait_for_timeout(80)
    page.evaluate("() => browser.storage.local.set({ rememberDark: true })"); page.wait_for_timeout(30)
    with page.expect_event("load", timeout=5000):
        tap()
    page.wait_for_timeout(100); s = state(page)
    check(tag + "remember on → host stored, page dark", s["store"].get("darkSites") == ["site.test"] and s["dr"], s)
    page2 = ctx.new_page(); page2.goto("http://site.test/e.html?dr=dynamic"); page2.wait_for_timeout(150); s2 = state(page2)
    check(tag + "remembered site in new tab: dark from load (sitemark, no lock ever)", s2["dr"] and not s2["lock"] and "top:locked-at-load" not in s2["drlog"]
          and s2["ss"] == "1", s2)
    page3 = ctx.new_page(); page3.goto("http://site.test/g.html?dr=dynamic&delay=200&noreg=1"); page3.wait_for_timeout(400); s3 = state(page3)
    check(tag + "remembered, registration missing: async fallback removes lock in time (slow DR)", s3["dr"] and not s3["lock"] and s3["ss"] == "1", s3)
    page3.close()
    tap2 = lambda: page2.evaluate(TAP, {"n": 3})
    tap2(); page2.wait_for_timeout(100); s2 = state(page2)
    check(tag + "tap off on remembered site → removed from list, off instantly", not s2["dr"] and s2["lock"] and s2["store"].get("darkSites") == [], s2)
    page2.close()
    page.evaluate("() => browser.storage.local.set({ rememberDark: false })")
    browser.close()

engines = sys.argv[1:] or ["firefox", "chromium"]
with sync_playwright() as pw:
    for e in engines:
        for order in ("ours-first", "dr-first"):
            run(e, pw, order)
        run(e, pw, "ours-first", "ja")
fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
