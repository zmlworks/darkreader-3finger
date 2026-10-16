/* フレーム間の中継だけを行う（状態は持たない）。
   - サブフレームで検出した 3 本指タップ → トップフレームへ
   - トップフレームのオン/オフ → タブ内の全フレームへ
   - サブフレームの起動時 → トップフレームの状態を問い合わせ
   tabs.sendMessage は自前の content script 宛なので "tabs" 権限は不要。 */
const api = typeof browser !== "undefined" ? browser : chrome;

api.runtime.onMessage.addListener((m, sender) => {
  const tabId = sender && sender.tab && sender.tab.id;
  if (!m || tabId == null || tabId < 0) return;
  switch (m.type) {
    case "dr3f:tap":
      api.tabs.sendMessage(tabId, { type: "dr3f:tap" }, { frameId: 0 }).catch(() => {});
      return;
    case "dr3f:broadcast":
      api.tabs.sendMessage(tabId, { type: "dr3f:setLock", off: !!m.off }).catch(() => {});
      return;
    case "dr3f:getTopState":
      return api.tabs.sendMessage(tabId, { type: "dr3f:queryState" }, { frameId: 0 }).catch(() => ({ off: false }));
  }
});
