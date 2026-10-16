/* 状態はほぼ持たない中継役。
   - サブフレームで検出した 3 本指タップ → トップフレームへ
   - トップフレームのオン/オフ → タブ内の全フレームへ（タブごとのトップの状態をメモリに控える）
   - サブフレームの起動時 → トップフレームの状態を返す
   - 記憶したサイト（storage.local の darkSites）に sitemark.js を動的登録
   tabs.sendMessage は自前の content script 宛なので "tabs" 権限は不要。 */
const api = typeof browser !== "undefined" ? browser : chrome;
const topDark = new Map(); // tabId → boolean（バックグラウンドが休止すると消えるが、そのときはトップに問い合わせる）

api.runtime.onMessage.addListener((m, sender) => {
  const tabId = sender && sender.tab && sender.tab.id;
  if (!m || tabId == null || tabId < 0) return;
  const isTop = sender.frameId === 0;
  switch (m.type) {
    case "dr3f:tap":
      api.tabs.sendMessage(tabId, { type: "dr3f:tap" }, { frameId: 0 }).catch(() => {});
      return;
    case "dr3f:topState":
      if (isTop) topDark.set(tabId, !!m.dark);
      return;
    case "dr3f:broadcast":
      if (!isTop) return;
      topDark.set(tabId, !!m.dark);
      api.tabs.sendMessage(tabId, { type: "dr3f:setDark", dark: !!m.dark }).catch(() => {});
      return;
    case "dr3f:getTopState":
      if (topDark.has(tabId)) return Promise.resolve({ dark: topDark.get(tabId) });
      return api.tabs.sendMessage(tabId, { type: "dr3f:queryState" }, { frameId: 0 }).catch(() => ({ dark: false }));
  }
});
if (api.tabs && api.tabs.onRemoved) api.tabs.onRemoved.addListener((id) => topDark.delete(id));

// ---- 記憶したサイト → sitemark.js の動的登録 ----
const SCRIPT_ID = "dr3f-sitemark";
// ホスト名として安全なものだけ match pattern にする（不正なパターンがあると登録全体が失敗するため）
const toPattern = (h) => (/^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(h) || /^\[[0-9a-f:.]+\]$/i.test(h) ? `*://${h}/*` : null);

let syncing = Promise.resolve();
function syncSites() {
  syncing = syncing.then(doSync, doSync);
  return syncing;
}
async function doSync() {
  if (!api.scripting || !api.scripting.registerContentScripts) return;
  const { darkSites } = await api.storage.local.get({ darkSites: [] });
  const matches = [...new Set((darkSites || []).map(toPattern).filter(Boolean))];
  const existing = await api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
  try {
    if (!matches.length) {
      if (existing.length) await api.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    } else if (existing.length) {
      await api.scripting.updateContentScripts([{ id: SCRIPT_ID, matches }]);
    } else {
      await api.scripting.registerContentScripts([
        { id: SCRIPT_ID, js: ["sitemark.js"], matches, runAt: "document_start", allFrames: false, persistAcrossSessions: true },
      ]);
    }
  } catch (e) {
    console.warn("dr3f: sitemark registration failed", e);
  }
}

api.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.darkSites) syncSites();
});
if (api.runtime.onInstalled) {
  api.runtime.onInstalled.addListener(async (d) => {
    // 1.0.0 の設定（「ページ更新」動作、オフにしたサイトの記憶）は意味が逆になったので捨てる
    if (d && d.reason === "update") await api.storage.local.remove(["action", "remember", "sites"]).catch(() => {});
    syncSites();
  });
}
if (api.runtime.onStartup) api.runtime.onStartup.addListener(syncSites);
