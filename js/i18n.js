// i18n.js — carregamento e troca de idioma PT/EN

import { DB } from "./db.js";

let strings = {};
let currentLang = "pt";

function detectDefaultLang() {
  const nav = (navigator.language || "en").toLowerCase();
  return nav.startsWith("pt") ? "pt" : "en";
}

export async function initI18n() {
  const saved = await DB.getKV("lang");
  currentLang = saved || detectDefaultLang();
  await loadLang(currentLang);
  document.documentElement.lang = currentLang;
  return currentLang;
}

export async function loadLang(lang) {
  const res = await fetch(`locales/${lang}.json`);
  strings = await res.json();
  currentLang = lang;
}

export async function setLang(lang) {
  await loadLang(lang);
  await DB.setKV("lang", lang);
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

export function getLang() {
  return currentLang;
}

// t("key", { placeholders })
export function t(key, vars) {
  let str = strings[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return str;
}
