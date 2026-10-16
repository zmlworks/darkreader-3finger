# Dark Reader 3-Finger Toggle (darkreader.three.finger.toggle@kofu.com)

*Firefox add-on (Android and touch-screen desktops): three-finger tap turns [Dark Reader](https://github.com/darkreader/darkreader) off for the current page; tap again to turn it back on (page reloads).*

Android 版 Firefox（タッチ対応 PC の Firefox でも可）用の拡張機能です。3本指でタップすると、表示中のページの Dark Reader をオフにします。もう一度タップするとオンに戻します（再読み込み）。

## 仕組み
Dark Reader には外部から操作する API（`runtime.onMessageExternal` など）がありません。代わりに Dark Reader 自身がサイト向けに用意している
`<meta name="darkreader-lock">` を使います（darkreader/darkreader `src/inject/dynamic-theme/index.ts`）。
- 動的モードの Dark Reader は `document.head` を MutationObserver で監視し、ロックが現れると `removeDynamicTheme()` で即座にテーマを外す。
- 読み込み時は `isDRLocked()`（`document.querySelector`、head の外でも見つかる）が真なら適用しない。
- ロックを外しても再適用はされないため、オンに戻すときは再読み込みする。
- **フィルター／フィルター+／静的モードはロックを見ない**（`src/inject/index.ts` の `ADD_CSS_FILTER` / `ADD_SVG_FILTER` / `ADD_STATIC_THEME` は `style#dark-reader-style` を入れるだけ）。この場合はトースト「Dark Readerが動的モードではないため切替できません」。

## 動作
| 状態 | 3本指タップ |
|---|---|
| Dark Reader 動作中（`meta[name=darkreader]` あり・ロックなし） | ロック挿入 → 即オフ。「Dark Reader オフ（このページ）」 |
| 本拡張のロックあり | 記憶を消してロック削除 → 再読み込み。「オンに戻します…」 |
| Dark Reader なし | 「Dark Readerが動いていません」 |
| 動作＝「ページ更新」 | 単に再読み込み。「ページを更新します…」 |

- オフ状態は既定で **タブ×オリジン**（`sessionStorage`）。再読み込み・同じサイト内の移動でもオフのまま。`document_start` で同期的にロックを入れるので Dark Reader が適用される前に間に合う。
- 「オフにしたサイトを記憶する」をオンにすると、ホスト名を `storage.local` に保存して常にオフ（ポップアップから削除可）。新しいタブでは非同期読み込みのため一瞬適用されてから外れることがある。
- 3本指タップの判定（`src/detector.js`）: ちょうど 3 本（4 本目なし）、1 本目から 3 本揃うまで 250 ms 以内、3 本目の接地から 350 ms 以内に全指が離れる、各指の移動 20 px 未満（ピンチズーム中は `visualViewport.scale` で割って画面上の距離に換算）。リスナーは `document` のキャプチャ段階・passive、`preventDefault` しない。
- iframe: サブフレームで検出したタップは background.js 経由でトップフレームへ。オン/オフはタブ内の全フレームに配信。

Files: `src/` (manifest.json, detector.js, content.js, background.js, popup.*, _locales/ja|en). Tests: `test/`.

## テスト
```sh
npm install                 # web-ext
npm test                    # 検出ロジックのユニットテスト（node）
/workspace/android/.pwvenv/bin/python test/integration.py   # Playwright: Firefox + Chromium、Dark Reader スタブ
sh test/e2e/run.sh          # 実拡張を web-ext run でヘッドレス Firefox に一時読み込み
npx web-ext lint -s src
```

## ビルド
```sh
sh build.sh   # → ../out/darkreader-3finger-<version>.zip / .xpi
```
一時的に試すには `about:debugging` →「一時的なアドオンを読み込む」で `src/manifest.json` を選択。

## 制限
- about: ページ、addons.mozilla.org などアドオンが動かないページでは使えません（Dark Reader も動きません）。
- 端末によっては OS が 3 本指ジェスチャー（スクリーンショット等）を横取りします。
- POST 結果のページでオンに戻すと再送信の確認が出ることがあります。

## License

MIT © zmlworks — see [LICENSE](LICENSE).
