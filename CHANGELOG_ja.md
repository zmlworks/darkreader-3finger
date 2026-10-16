# 変更履歴

## 1.0.0 (2026-10-16)
- 初版。3本指タップで Dark Reader（動的モード）をこのページだけオフ／再読み込みでオンに戻す。
- 動作の切替: 「Dark Reader切替」（既定）／「ページ更新」。
- オフ状態はタブ×サイト（sessionStorage）。オプションでサイトを永続的に記憶（storage.local、削除 UI あり）。
- iframe 内でのタップもトップフレームに中継し、iframe 内の Dark Reader もロック。
