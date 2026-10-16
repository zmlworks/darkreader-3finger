/* ポップアップ兼オプション画面。表示言語は Firefox の UI 言語に従う（_locales/ja|en）。 */
const api = typeof browser !== "undefined" ? browser : chrome;
const DEFAULTS = { rememberDark: false, darkSites: [] };

document.documentElement.lang = /^ja/i.test(api.i18n.getUILanguage()) ? "ja" : "en";
document.querySelectorAll("[data-i18n]").forEach((el) => {
  const t = api.i18n.getMessage(el.getAttribute("data-i18n"));
  if (t) el.textContent = t;
});

const $ = (s) => document.querySelector(s);

function renderSites(sites) {
  const ul = $("#sites");
  ul.textContent = "";
  $("#empty").hidden = sites.length > 0;
  for (const host of [...sites].sort()) {
    const li = document.createElement("li");
    li.className = "card";
    const span = document.createElement("span");
    span.textContent = host;
    const btn = document.createElement("button");
    btn.textContent = api.i18n.getMessage("remove");
    btn.addEventListener("click", async () => {
      const { darkSites: cur } = await api.storage.local.get({ darkSites: [] });
      await api.storage.local.set({ darkSites: cur.filter((h) => h !== host) });
    });
    li.append(span, btn);
    ul.append(li);
  }
}

async function load() {
  const s = await api.storage.local.get(DEFAULTS);
  $("#remember").checked = !!s.rememberDark;
  renderSites(s.darkSites);
}

$("#remember").addEventListener("change", (e) => api.storage.local.set({ rememberDark: e.target.checked }));
api.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.darkSites) renderSites(ch.darkSites.newValue || []);
});
load();
