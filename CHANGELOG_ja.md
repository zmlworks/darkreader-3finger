# 変更履歴

## 1.1.0 (2026-10-16)
- **動作を逆に**: Dark Reader を普段はすべてのページでオフにし（`document_start` で `meta[name="darkreader-lock"]` を挿入）、3本指タップで表示中のページだけオン（ロックを外して再読み込み）。オンのページでもう一度タップすると即オフ。
- オン状態はタブ×オリジン（sessionStorage）で保持。再読み込み・サイト内の移動でもダークのまま。
- 「オンにしたサイトを記憶する」（storage.local、ポップアップから削除可）。記憶したサイトには `sitemark.js` を `scripting.registerContentScripts` で動的登録し、最初の読み込みからダークに。1.0.0 の「オフにしたサイトの記憶」は意味が逆になるため、更新時に設定を破棄。
- 「ページ更新」動作（テスト用）を削除。
- トースト: 「Dark Reader オンにします…」「Dark Reader オフ」「Dark Readerが見つかりません」（オン後 約3秒以内に適用されないとき）「Dark Reader の動的モードのみ対応しています」「このサイトは Dark Reader を無効にしています」。
- システムがダークテーマのとき、Dark Reader の仮スタイル（darkreader--fallback）でオフのページが一瞬暗くなるのを防止。
- iframe もトップフレームの状態に合わせる（about:blank の iframe を含む）。
- 権限に `scripting` を追加。

## 1.0.0 (2026-10-16)
- 初版。3本指タップで Dark Reader（動的モード）をこのページだけオフ／再読み込みでオンに戻す。
- 動作の切替: 「Dark Reader切替」（既定）／「ページ更新」。
- オフ状態はタブ×サイト（sessionStorage）。オプションでサイトを永続的に記憶（storage.local、削除 UI あり）。
- iframe 内でのタップもトップフレームに中継し、iframe 内の Dark Reader もロック。
