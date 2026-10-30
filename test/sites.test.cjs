// 1.1.1: 記憶したサイト（darkSites）の追加・削除をバックグラウンドで直列化していることの確認。
// storage.local.get/set が遅い（非同期）ときに同時に来ても、どの変更も消えない。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) pass++; else fail++; console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  " + JSON.stringify(info))); };
function makeBg() {
  const store = { darkSites: ["keep.test"] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let listener = null;
  const api = {
    runtime: { id: "me", onMessage: { addListener: (l) => (listener = l) } },
    tabs: { sendMessage: async () => {} },
    storage: {
      local: {
        get: async (d) => { await sleep(5); return JSON.parse(JSON.stringify(Object.assign({}, d, store))); },
        set: async (o) => { await sleep(5); Object.assign(store, JSON.parse(JSON.stringify(o))); },
      },
      onChanged: { addListener() {} },
    },
  };
  vm.runInNewContext(src, { browser: api, chrome: api, console, setTimeout, URL, Promise });
  return { store, send: (m, sender) => listener(m, sender) };
}
(async () => {
  const bg = makeBg();
  const tab = (id, url) => ({ tab: { id }, frameId: 0, url, id: "me" });
  const popup = { id: "me" };
  await Promise.all([
    bg.send({ type: "dr3f:saveSite", add: true }, tab(1, "https://a.test/x")),
    bg.send({ type: "dr3f:saveSite", add: true }, tab(2, "https://b.test/")),
    bg.send({ type: "dr3f:removeSite", host: "keep.test" }, popup),
    bg.send({ type: "dr3f:saveSite", add: true }, tab(3, "https://c.test/")),
  ]);
  ok("concurrent add/add/remove/add: nothing lost", JSON.stringify([...bg.store.darkSites].sort()) === JSON.stringify(["a.test", "b.test", "c.test"]), bg.store.darkSites);
  await bg.send({ type: "dr3f:saveSite", add: false }, tab(1, "https://a.test/y"));
  ok("remove via tab uses sender host", !bg.store.darkSites.includes("a.test"), bg.store.darkSites);
  const r = await bg.send({ type: "dr3f:saveSite", add: true }, { tab: { id: 4 }, frameId: 3, url: "https://sub.test/" });
  ok("subframe cannot save", r && r.ok === false && !bg.store.darkSites.includes("sub.test"), { r, s: bg.store.darkSites });
  const r2 = bg.send({ type: "dr3f:removeSite", host: "b.test" }, tab(5, "https://evil.test/"));
  await new Promise((res) => setTimeout(res, 30));
  ok("removeSite from a tab (content script) is ignored", r2 === undefined && bg.store.darkSites.includes("b.test"), bg.store.darkSites);
  const r3 = await bg.send({ type: "dr3f:saveSite", add: true }, { tab: { id: 6 }, frameId: 0 });
  ok("no sender url → ok:false (content falls back)", r3 && r3.ok === false, r3);
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
