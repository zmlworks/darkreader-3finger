"""ポップアップのスクリーンショット（docs/popup-ja.png / popup-en.png）"""
import json, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
with sync_playwright() as pw:
    b = pw.firefox.launch(headless=True)
    for loc in ("ja", "en"):
        msgs = json.loads((ROOT / f"src/_locales/{loc}/messages.json").read_text())
        p = b.new_page(viewport={"width": 380, "height": 700})
        p.add_init_script(script="""window.browser={i18n:{getMessage:k=>(%s[k]||{}).message||'',getUILanguage:()=>'%s'},
          storage:{local:{get:async d=>Object.assign({},d,{sites:['example.com','news.example.jp']}),set:async()=>{}},onChanged:{addListener(){}}}};""" % (json.dumps(msgs), loc))
        p.goto((ROOT / "src/popup.html").as_uri()); p.wait_for_timeout(300)
        p.screenshot(path=str(ROOT / f"docs/popup-{loc}.png"), full_page=True)
    b.close()
