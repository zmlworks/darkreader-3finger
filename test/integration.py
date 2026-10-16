"""結合テスト: ヘッドレス Firefox / Chromium（Playwright）で content script を実際に動かす。
実行: /workspace/android/.pwvenv/bin/python test/integration.py [firefox|chromium ...]
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
      ss: sessionStorage.getItem('dr3f:off'), loads: +sessionStorage.loads,
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
    parts += [rd(TEST / "drstub.js"), ours] if order == "dr-first" else [ours, rd(TEST / "drstub.js")]
    ctx.add_init_script(script="\n;\n".join(parts))
    ctx.route("http://site.test/**", route)
    ctx.route("http://other.test/**", route)
    page = ctx.new_page()
    tap = lambda **o: page.evaluate(TAP, {"n": 3, **o})
    M = lambda k: MSGS[locale][k]["message"]

    page.goto("http://site.test/a.html?dr=dynamic"); page.wait_for_timeout(100)
    s = state(page)
    check(tag + "DR stub active on load", s["dr"] and s["mode"] == "dynamic" and not s["lock"] and s["bg"] == "rgb(17, 17, 17)", s)
    check(tag + "head did not exist at document_start", "top:headAtStart=false" in s["drlog"], s["drlog"])

    for name, o in [("2 fingers", {"n": 2}), ("4 fingers", {"n": 4}), ("held 600ms", {"dur": 600}),
                    ("moved 40px", {"move": 40}), ("slow stagger 200ms each", {"stagger": 200})]:
        tap(**o); page.wait_for_timeout(50); s = state(page)
        check(tag + f"ignored: {name}", s["dr"] and not s["lock"] and toast(page) is None, s)

    tap(); page.wait_for_timeout(50); s = state(page)
    check(tag + "3-finger tap → DR removed instantly via lock", not s["dr"] and s["mode"] is None and s["lock"] and s["lockInHead"]
          and s["bg"] != "rgb(17, 17, 17)" and s["ss"] == "1" and "top:removed" in s["drlog"], s)
    check(tag + "toast 'off (this page)'", toast(page) == M("toastOff"), toast(page))
    check(tag + "remember off → nothing stored", not s["store"].get("sites"), s["store"])

    page.reload(); page.wait_for_timeout(100); s = state(page)
    check(tag + "after reload: lock inserted before DR (locked-at-load, never applied)", s["lock"] and not s["dr"]
          and "top:locked-at-load" in s["drlog"] and "top:applied" not in s["drlog"] and s["lockInHead"], s)
    page.goto("http://site.test/b.html?dr=dynamic"); page.wait_for_timeout(100); s = state(page)
    check(tag + "same-site navigation in tab: still off", s["lock"] and not s["dr"] and "top:applied" not in s["drlog"], s)

    with page.expect_event("load", timeout=5000):
        tap()
        page.wait_for_timeout(30)
        check(tag + "toast 'turning back on'", toast(page) == M("toastOn"), toast(page))
    page.wait_for_timeout(100); s = state(page)
    check(tag + "2nd tap → lock removed, reloaded, DR re-applied, lock not re-inserted",
          s["dr"] and not s["lock"] and s["ss"] is None and "top:applied" in s["drlog"], s)

    # Dark Reader なし / フィルターモード
    page.goto("http://site.test/c.html?dr=none"); page.wait_for_timeout(80); tap(); page.wait_for_timeout(30)
    check(tag + "no DR → toast 'not running'", toast(page) == M("toastNotRunning") and not state(page)["lock"], toast(page))
    page.goto("http://site.test/d.html?dr=filter"); page.wait_for_timeout(80); tap(); page.wait_for_timeout(30)
    check(tag + "filter mode → toast 'not dynamic', nothing changed", toast(page) == M("toastNotDynamic")
          and state(page)["mode"] == "filter" and not state(page)["lock"], [toast(page), state(page)])

    # iframe（同一オリジン）: サブフレームでのタップもトップに中継され、サブフレームの DR も外れる
    page.goto("http://site.test/withframe.html?dr=dynamic"); page.wait_for_timeout(200)
    fr = page.frames[1]
    fs = lambda: fr.evaluate("""() => ({dr: !!document.querySelector('meta[name="darkreader"]'), lock: !!document.querySelector('meta[name="darkreader-lock"]')})""")
    check(tag + "iframe: DR active in subframe", fs()["dr"], fs())
    fr.evaluate(TAP.replace("document.elementFromPoint(x0 || 100, 150)", "document.body"), {"n": 3, "x0": 20}); page.wait_for_timeout(100)
    s = state(page); f = fs()
    check(tag + "iframe tap → relayed to top; top + subframe off", s["lock"] and not s["dr"] and f["lock"] and not f["dr"], [s, f])
    page.reload(); page.wait_for_timeout(250); fr = page.frames[1]; f = fs()
    check(tag + "iframe after reload: subframe locked via top state", f["lock"] and not f["dr"], f)
    with page.expect_event("load", timeout=5000):
        tap()
    page.wait_for_timeout(250)
    # 再読み込み後 frame を取り直し
    fr = page.frames[1]; f = fs(); s = state(page)
    check(tag + "iframe: toggled back on (top + subframe)", s["dr"] and f["dr"] and not f["lock"], [s, f])

    # 記憶モード（storage.local）: 別タブ（sessionStorage なし）でもオフ
    page.goto("http://site.test/a.html?dr=dynamic"); page.wait_for_timeout(80)
    page.evaluate("() => browser.storage.local.set({ remember: true })"); page.wait_for_timeout(30)
    tap(); page.wait_for_timeout(80); s = state(page)
    check(tag + "remember on → host stored, toast 'site remembered'", s["store"].get("sites") == ["site.test"] and toast(page) == M("toastOffSite"), [s, toast(page)])
    page2 = ctx.new_page(); page2.goto("http://site.test/e.html?dr=dynamic"); page2.wait_for_timeout(150); s2 = state(page2)
    check(tag + "remembered site in new tab: off (async storage → lock → DR removes theme)", s2["lock"] and not s2["dr"] and s2["ss"] == "1", s2)
    page2.reload(); page2.wait_for_timeout(100); s2 = state(page2)
    check(tag + "remembered site, next load in that tab: locked before DR applies", s2["lock"] and "top:applied" not in s2["drlog"], s2)
    with page2.expect_event("load", timeout=5000):
        page2.evaluate(TAP, {"n": 3})
    page2.wait_for_timeout(120); s2 = state(page2)
    check(tag + "re-enable on remembered site → removed from list, DR back", s2["dr"] and not s2["lock"] and s2["store"].get("sites") == [], s2)
    page2.close()
    page.evaluate("() => browser.storage.local.set({ remember: false })")

    # 動作=ページ更新
    page.evaluate("() => sessionStorage.removeItem('dr3f:off')")  # 記憶テストで残ったこのタブのオフ状態を消す
    page.goto("http://site.test/f.html?dr=dynamic"); page.wait_for_timeout(80)
    page.evaluate("() => browser.storage.local.set({ action: 'reload' })"); page.wait_for_timeout(30)
    loads = state(page)["loads"]
    with page.expect_event("load", timeout=5000):
        tap(); page.wait_for_timeout(30)
        check(tag + "action=reload → toast 'reloading'", toast(page) == M("toastReload"), toast(page))
    page.wait_for_timeout(80); s = state(page)
    check(tag + "action=reload → page reloaded, DR untouched", s["loads"] == loads + 1 and s["dr"] and not s["lock"], s)
    page.evaluate("() => browser.storage.local.set({ action: 'toggle' })")
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
