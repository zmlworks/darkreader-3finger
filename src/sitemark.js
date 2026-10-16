/* 「オンにしたサイトを記憶する」で保存したサイトのトップフレームにだけ、background.js が
   scripting.registerContentScripts で動的に登録する（document_start）。
   content.js と同じ実行環境（拡張ごとのサンドボックス）を共有するので、ここで印を付ければ
   content.js はロックを入れずに済む（同期なので Dark Reader より先）。実行順はどちらでもよい。 */
var DR3F_SITE_DARK = true;
if (typeof DR3F !== "undefined" && DR3F._siteDark) DR3F._siteDark();
