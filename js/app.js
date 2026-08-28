import { DB, getDeviceId } from "./db.js";
import { initI18n, setLang, getLang, t } from "./i18n.js";
import {
  searchAll,
  getWorkerUrl,
  setWorkerUrl,
  registerFollow,
  unregisterFollow,
  getVapidPublicKey,
  savePushSubscription,
  fetchRecentReleases,
} from "./api.js";
import { getSuggestions } from "./suggestions.js";
import { READING_ORDERS } from "./readingOrders.js";

const app = document.getElementById("app");
const main = document.getElementById("main");
const nav = document.getElementById("bottom-nav");

let state = {
  route: "discover",
  searchQuery: "",
  searchFilter: "all",
  searchResults: [],
  searchLoading: false,
  searchError: null,
  library: [],
  news: [],
  activeSeries: null, // série aberta na sheet de detalhe
  deviceId: null,
  suggestions: [],
  suggestionsLoading: false,
};

const ICONS = {
  discover: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  library: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`,
  news: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H8l-4 4Z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>`,
};

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function debounce(fn, ms) {
  let h;
  return (...args) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  };
}

// ---------------- Router ----------------

function navigate(route) {
  state.route = route;
  location.hash = route;
  render();
}

window.addEventListener("hashchange", () => {
  const route = location.hash.replace("#", "") || "discover";
  state.route = route;
  render();
});

// ---------------- Bottom nav ----------------

function renderNav() {
  const items = [
    ["discover", t("nav.discover")],
    ["library", t("nav.library")],
    ["news", t("nav.news")],
    ["settings", t("nav.settings")],
  ];
  nav.innerHTML = items
    .map(
      ([id, label]) => `
      <button data-route="${id}" aria-current="${state.route === id ? "page" : "false"}">
        ${ICONS[id]}
        <span>${esc(label)}${id === "news" && state.news.length ? '<span class="badge-dot" aria-hidden="true"></span>' : ""}</span>
      </button>`
    )
    .join("");
  nav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.route));
  });
}

// ---------------- Screen: Discover ----------------

function seriesCard(series, opts = {}) {
  const inLibrary = state.library.some((s) => s.id === series.id);
  const total = series.totalChapters || series.totalVolumes;
  const readCount = opts.readCount ?? 0;
  const pct = total ? Math.min(100, Math.round((readCount / total) * 100)) : 0;
  return `
    <div class="card" tabindex="0" role="button" data-id="${esc(series.id)}" aria-label="${esc(series.title)}">
      <div class="cover-wrap">
        ${series.coverUrl ? `<img src="${esc(series.coverUrl)}" alt="" loading="lazy" />` : `<div class="skeleton" style="width:100%;height:100%"></div>`}
        <div class="halftone" aria-hidden="true"></div>
        ${inLibrary && total ? `<span class="badge-new">${readCount}/${total}</span>` : ""}
      </div>
      <div class="meta">
        <div class="title">${esc(series.title)}</div>
        ${
          inLibrary && total
            ? `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`
            : ""
        }
      </div>
    </div>`;
}

function renderDiscover() {
  main.innerHTML = `
    <div class="search-row">
      <input id="search-input" class="search-input" type="text" placeholder="${esc(t("discover.searchPlaceholder"))}" value="${esc(state.searchQuery)}" aria-label="${esc(t("discover.searchPlaceholder"))}" />
    </div>
    <div class="filter-row" role="group" aria-label="${esc(t("discover.title"))}">
      <button class="chip" data-filter="all" aria-pressed="${state.searchFilter === "all"}">${esc(t("discover.filterAll"))}</button>
      <button class="chip" data-filter="comics" aria-pressed="${state.searchFilter === "comics"}">${esc(t("discover.filterComics"))}</button>
      <button class="chip" data-filter="manga" aria-pressed="${state.searchFilter === "manga"}">${esc(t("discover.filterManga"))}</button>
    </div>
    <div id="discover-results" style="margin-top:18px;"></div>
  `;

  const resultsEl = document.getElementById("discover-results");
  renderDiscoverResults(resultsEl);

  const input = document.getElementById("search-input");
  input.focus({ preventScroll: true });
  input.addEventListener(
    "input",
    debounce((e) => {
      state.searchQuery = e.target.value;
      runSearch();
    }, 400)
  );

  main.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.searchFilter = chip.dataset.filter;
      renderDiscover();
      if (state.searchQuery.trim()) runSearch();
    });
  });
}

function renderDiscoverResults(resultsEl) {
  if (state.searchLoading) {
    resultsEl.innerHTML = `<div class="grid">${Array.from({ length: 6 })
      .map(() => `<div class="card"><div class="cover-wrap skeleton"></div></div>`)
      .join("")}</div>`;
    return;
  }
  if (state.searchError) {
    resultsEl.innerHTML = `<div class="empty-state"><h3>${esc(t("discover.error"))}</h3><button class="btn btn-primary" id="retry-btn" style="margin-top:12px">${esc(t("common.retry"))}</button></div>`;
    document.getElementById("retry-btn")?.addEventListener("click", runSearch);
    return;
  }
  if (!state.searchQuery.trim()) {
    renderDiscoverDefault(resultsEl);
    return;
  }
  if (state.searchResults.length === 0) {
    resultsEl.innerHTML = `<div class="empty-state"><h3>${esc(t("discover.noResults", { query: state.searchQuery }))}</h3></div>`;
    return;
  }
  resultsEl.innerHTML = `<div class="grid">${state.searchResults.map((s) => seriesCard(s)).join("")}</div>`;
  bindCardClicks(resultsEl, state.searchResults);
}

// ---- Descobrir: conteúdo por omissão (sem pesquisa ativa) ----
// Em vez de um ecrã vazio, mostra sugestões baseadas na biblioteca e
// guias de leitura curados — ajuda quem não sabe bem o que ler a seguir.

function renderReadingOrders() {
  const lang = getLang();
  return `
    <div class="section-head"><h2>${esc(t("discover.readingOrders.title"))}</h2></div>
    ${READING_ORDERS.map(
      (order) => `
      <div class="order-card">
        <h3>${esc(order.title[lang] || order.title.en)}</h3>
        <div class="desc">${esc(order.description[lang] || order.description.en)}</div>
        ${order.steps
          .map(
            (step, i) => `
          <div class="order-step">
            <span class="step-num">${i + 1}</span>
            <span class="step-title">${esc(step)}</span>
            <button data-search-step="${esc(step)}">${esc(t("discover.readingOrders.searchStep"))}</button>
          </div>`
          )
          .join("")}
      </div>`
    ).join("")}
  `;
}

async function renderDiscoverDefault(resultsEl) {
  resultsEl.innerHTML = `
    <div id="suggestions-slot">
      <div class="section-head"><h2>${esc(t("discover.suggestions.title"))}</h2></div>
      <div class="grid">${Array.from({ length: 4 })
        .map(() => `<div class="card"><div class="cover-wrap skeleton"></div></div>`)
        .join("")}</div>
    </div>
    <div id="reading-orders-slot">${renderReadingOrders()}</div>
  `;
  bindReadingOrderButtons(resultsEl);

  state.suggestionsLoading = true;
  try {
    state.suggestions = await getSuggestions(state.library);
  } catch {
    state.suggestions = [];
  } finally {
    state.suggestionsLoading = false;
  }
  const slot = document.getElementById("suggestions-slot");
  if (!slot) return; // o utilizador já navegou para outro sítio
  if (state.suggestions.length === 0) {
    slot.innerHTML = "";
    return;
  }
  slot.innerHTML = `
    <div class="section-head"><h2>${esc(t("discover.suggestions.title"))}</h2></div>
    <div class="grid">${state.suggestions.map((s) => seriesCard(s)).join("")}</div>
  `;
  bindCardClicks(slot, state.suggestions);
}

function bindReadingOrderButtons(container) {
  container.querySelectorAll("[data-search-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.searchQuery = btn.dataset.searchStep;
      state.searchFilter = "all";
      renderDiscover();
      runSearch();
    });
  });
}

async function runSearch() {
  const resultsEl = document.getElementById("discover-results");
  if (!state.searchQuery.trim()) {
    state.searchResults = [];
    state.searchError = null;
    if (resultsEl) renderDiscoverResults(resultsEl);
    return;
  }
  state.searchLoading = true;
  state.searchError = null;
  if (resultsEl) renderDiscoverResults(resultsEl);
  try {
    state.searchResults = await searchAll(state.searchQuery, state.searchFilter);
  } catch (e) {
    state.searchError = e;
  } finally {
    state.searchLoading = false;
    const el = document.getElementById("discover-results");
    if (el) renderDiscoverResults(el);
  }
}

// ---------------- Screen: Library ----------------

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function computeStreak(allRead) {
  if (allRead.length === 0) return 0;
  const days = new Set(allRead.map((r) => dateKey(r.readAt)));
  let streak = 0;
  const cursor = new Date();
  // permite que o streak "continue" se ainda não leste nada hoje mas leste ontem
  if (!days.has(dateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dateKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function renderStatsStrip() {
  const allRead = await DB.getAllReadItems();
  const completed = state.library.filter((s) => s.status === "completed").length;
  const streak = computeStreak(allRead);
  const pubCounts = {};
  for (const s of state.library) {
    if (!s.publisher || s.publisher === "—") continue;
    pubCounts[s.publisher] = (pubCounts[s.publisher] || 0) + 1;
  }
  const topPublisher = Object.entries(pubCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  return `
    <div class="stats-strip">
      <div class="stat-tile"><div class="value">${allRead.length}</div><div class="label">${esc(t("library.stats.read"))}</div></div>
      <div class="stat-tile"><div class="value">${state.library.length}</div><div class="label">${esc(t("library.stats.series"))}</div></div>
      <div class="stat-tile"><div class="value">${completed}</div><div class="label">${esc(t("library.stats.completed"))}</div></div>
      <div class="stat-tile"><div class="value">${streak}</div><div class="label">${esc(t("library.stats.streak"))} (${esc(t("library.stats.streakUnit"))})</div></div>
      <div class="stat-tile wide"><div class="value small">${esc(topPublisher)}</div><div class="label">${esc(t("library.stats.topPublisher"))}</div></div>
    </div>
  `;
}

async function renderLibrary() {
  const statsHtml = state.library.length ? await renderStatsStrip() : "";
  if (state.library.length === 0) {
    main.innerHTML = `<div class="empty-state"><h3>${esc(t("library.empty.title"))}</h3><p>${esc(t("library.empty.body"))}</p></div>`;
    return;
  }
  const groups = [
    ["reading", t("series.status.reading")],
    ["following", t("series.status.following")],
    ["toRead", t("series.status.toRead")],
    ["completed", t("series.status.completed")],
    ["dropped", t("series.status.dropped")],
  ];
  let html = statsHtml;
  for (const [key, label] of groups) {
    const items = state.library.filter((s) => (s.status || "toRead") === key);
    if (items.length === 0) continue;
    html += `
      <div class="section-head"><h2>${esc(label)}</h2><span class="count">${items.length}</span></div>
      <div class="grid">${items.map((s) => seriesCard(s, { readCount: s._readCount || 0 })).join("")}</div>
    `;
  }
  main.innerHTML = html;
  bindCardClicks(main, state.library);
}

// ---------------- Screen: News ----------------

function renderNews() {
  if (state.news.length === 0) {
    main.innerHTML = `<div class="empty-state"><h3>${esc(t("news.empty.title"))}</h3><p>${esc(t("news.empty.body"))}</p></div>`;
    return;
  }
  main.innerHTML = `
    <div class="grid">
      ${state.news
        .map(
          (n) => `
        <div class="card" data-id="${esc(n.seriesId)}" tabindex="0" role="button">
          <div class="cover-wrap">
            ${n.coverUrl ? `<img src="${esc(n.coverUrl)}" alt="" loading="lazy"/>` : ""}
            <div class="halftone" aria-hidden="true"></div>
            <span class="badge-new">${esc(t("news.newBadge"))}</span>
          </div>
          <div class="meta"><div class="title">${esc(n.title)} — ${esc(n.releaseLabel || "")}</div></div>
        </div>`
        )
        .join("")}
    </div>
  `;
  main.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => openSeriesById(card.dataset.id));
  });
}

// ---------------- Screen: Settings ----------------

async function renderSettings() {
  const lang = getLang();
  const workerUrl = await getWorkerUrl();
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const permStatusKey =
    permission === "granted" ? "settings.notifications.status.granted" : permission === "denied" ? "settings.notifications.status.denied" : "settings.notifications.status.default";
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

  const currentTheme = (await DB.getKV("theme")) || "auto";

  main.innerHTML = `
    <div class="settings-group">
      <h3>${esc(t("settings.language"))}</h3>
      <div class="settings-card" style="padding:10px 12px;">
        <select id="lang-select">
          <option value="pt" ${lang === "pt" ? "selected" : ""}>Português</option>
          <option value="en" ${lang === "en" ? "selected" : ""}>English</option>
        </select>
      </div>
    </div>

    <div class="settings-group">
      <h3>${esc(t("settings.theme"))}</h3>
      <div class="settings-card" style="padding:10px 12px;">
        <select id="theme-select">
          <option value="auto" ${currentTheme === "auto" ? "selected" : ""}>${esc(t("settings.theme.auto"))}</option>
          <option value="light" ${currentTheme === "light" ? "selected" : ""}>${esc(t("settings.theme.light"))}</option>
          <option value="dark" ${currentTheme === "dark" ? "selected" : ""}>${esc(t("settings.theme.dark"))}</option>
        </select>
      </div>
    </div>

    <div class="settings-group">
      <h3>${esc(t("settings.share"))}</h3>
      <button class="btn btn-ghost btn-block" id="share-btn">${esc(t("settings.share.button"))}</button>
    </div>

    <div class="settings-group">
      <h3>${esc(t("settings.notifications"))}</h3>
      <div class="toggle-row">
        <span>${esc(t(permStatusKey))}</span>
        ${
          permission !== "granted"
            ? `<button class="btn btn-primary" id="enable-notif-btn">${esc(t("settings.notifications.enable"))}</button>`
            : ""
        }
      </div>
      ${isIos && !isStandalone ? `<p class="field-hint">${esc(t("settings.notifications.iosHint"))}</p>` : ""}
    </div>

    <div class="settings-group" id="install-group" hidden>
      <h3>${esc(t("settings.install"))}</h3>
      <button class="btn btn-primary btn-block" id="install-btn">${esc(t("settings.install.button"))}</button>
    </div>

    <div class="settings-group">
      <h3>${esc(t("settings.workerUrl"))}</h3>
      <input type="url" id="worker-url-input" placeholder="https://estante-proxy.SEU-UTILIZADOR.workers.dev" value="${esc(workerUrl)}" />
      <p class="field-hint">${esc(t("settings.workerUrl.hint"))}</p>
      <button class="btn btn-ghost" id="save-worker-btn" style="margin-top:8px;">${esc(t("common.save"))}</button>
    </div>

    <div class="settings-group">
      <h3>${esc(t("settings.data"))}</h3>
      <p class="field-hint">${esc(t("settings.data.body"))}</p>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-ghost" id="export-btn">${esc(t("settings.export"))}</button>
        <label class="btn btn-ghost" style="cursor:pointer;">
          ${esc(t("settings.import"))}
          <input type="file" id="import-input" accept="application/json" class="visually-hidden" />
        </label>
      </div>
      <button class="btn" id="reset-btn" style="margin-top:10px; color:var(--cover-red); border-color:var(--cover-red);">${esc(t("settings.reset"))}</button>
    </div>

    <div class="settings-group">
      <h3>${esc(t("settings.about"))}</h3>
      <p class="field-hint">${esc(t("settings.about.body"))}</p>
    </div>
  `;

  document.getElementById("lang-select").addEventListener("change", async (e) => {
    await setLang(e.target.value);
    render();
  });

  document.getElementById("theme-select").addEventListener("change", async (e) => {
    await DB.setKV("theme", e.target.value);
    applyTheme(e.target.value);
  });

  document.getElementById("share-btn").addEventListener("click", async () => {
    const allRead = await DB.getAllReadItems();
    const text = t("settings.share.text", { series: state.library.length, read: allRead.length });
    if (navigator.share) {
      try {
        await navigator.share({ text, title: t("app.name") });
      } catch {
        /* utilizador cancelou — nada a fazer */
      }
    } else {
      await navigator.clipboard.writeText(text);
      showToast(t("settings.share.copied"));
    }
  });

  document.getElementById("save-worker-btn").addEventListener("click", async () => {
    await setWorkerUrl(document.getElementById("worker-url-input").value);
    showToast(t("common.save") + " ✓");
  });

  document.getElementById("enable-notif-btn")?.addEventListener("click", enableNotifications);

  document.getElementById("export-btn").addEventListener("click", async () => {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estante-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("import-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await DB.importAll(JSON.parse(text));
      await loadLibrary();
      showToast("✓");
      render();
    } catch {
      showToast(t("discover.error"));
    }
  });

  document.getElementById("reset-btn").addEventListener("click", async () => {
    if (confirm(t("settings.reset.confirm"))) {
      await DB.wipeAll();
      await loadLibrary();
      render();
    }
  });

  const installGroup = document.getElementById("install-group");
  if (window.deferredInstallPrompt) {
    installGroup.hidden = false;
    document.getElementById("install-btn").addEventListener("click", async () => {
      window.deferredInstallPrompt.prompt();
      await window.deferredInstallPrompt.userChoice;
      window.deferredInstallPrompt = null;
      installGroup.hidden = true;
    });
  }
}

// ---------------- Series detail sheet ----------------

function bindCardClicks(container, list) {
  container.querySelectorAll(".card[data-id]").forEach((card) => {
    const open = () => {
      const series = list.find((s) => s.id === card.dataset.id);
      if (series) openSeriesDetail(series);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

async function openSeriesById(id) {
  const fromLib = state.library.find((s) => s.id === id);
  const fromNews = state.news.find((n) => n.seriesId === id);
  if (fromLib) return openSeriesDetail(fromLib);
  if (fromNews) return openSeriesDetail(fromNews.series || { id, title: fromNews.title, coverUrl: fromNews.coverUrl });
}

async function openSeriesDetail(series) {
  const libEntry = state.library.find((s) => s.id === series.id);
  const merged = { ...series, ...(libEntry || {}) };
  const readIds = libEntry ? await DB.getReadItems(series.id) : [];
  const total = merged.totalChapters || merged.totalVolumes || 0;
  const unitLabel = merged.totalChapters ? t("series.chapters") : t("series.volumes");

  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(merged.title)}">
      <div class="hero">
        ${merged.coverUrl ? `<img src="${esc(merged.coverUrl)}" alt=""/>` : ""}
        <div>
          <h2>${esc(merged.title)}</h2>
          ${merged.publisher ? `<span class="publisher-tag">${esc(merged.publisher)}</span>` : ""}
          <div class="status-row">
            <button class="btn ${libEntry ? "btn-ghost" : "btn-primary"}" id="add-btn">
              ${libEntry ? esc(t("series.added")) + " ✓" : esc(t("series.add"))}
            </button>
          </div>
        </div>
      </div>
      ${merged.synopsis ? `<p class="synopsis">${esc(merged.synopsis).slice(0, 400)}</p>` : ""}

      ${
        libEntry
          ? `
        <div class="toggle-row">
          <span>${esc(t("series.notify"))}</span>
          <span class="switch">
            <input type="checkbox" id="notify-toggle" ${merged.notify ? "checked" : ""}/>
            <span class="track"></span><span class="thumb"></span>
          </span>
        </div>
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <select id="status-select" style="flex:1;min-width:140px;">
            ${["toRead", "reading", "following", "completed", "dropped"]
              .map((s) => `<option value="${s}" ${merged.status === s ? "selected" : ""}>${esc(t("series.status." + s))}</option>`)
              .join("")}
          </select>
          <button class="btn btn-ghost" id="remove-btn">${esc(t("series.remove"))}</button>
        </div>
        ${
          total
            ? `
          <div class="chapters-list">
            <div class="section-head" style="margin-top:14px;">
              <h2 style="font-size:16px;">${esc(unitLabel)}</h2>
              <button class="btn btn-ghost" id="mark-all-btn" style="padding:4px 10px;font-size:11px;">${esc(t("series.markAllRead"))}</button>
            </div>
            ${Array.from({ length: total })
              .map((_, i) => {
                const num = i + 1;
                const checked = readIds.includes(num);
                return `
                <div class="chapter-row">
                  <label>
                    <input type="checkbox" data-num="${num}" class="chapter-check" ${checked ? "checked" : ""}/>
                    ${esc(unitLabel)} ${num}
                  </label>
                </div>`;
              })
              .join("")}
          </div>`
            : ""
        }
      `
          : ""
      }
      <button class="btn btn-ghost btn-block" id="close-sheet-btn" style="margin-top:16px;">${esc(t("common.close"))}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";

  const closeSheet = () => {
    backdrop.remove();
    document.body.style.overflow = "";
  };
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeSheet();
  });
  backdrop.querySelector("#close-sheet-btn").addEventListener("click", closeSheet);

  backdrop.querySelector("#add-btn").addEventListener("click", async () => {
    if (libEntry) return;
    const newEntry = { ...series, status: "toRead", notify: true };
    await DB.upsertSeries(newEntry);
    await loadLibrary();
    const deviceId = await getDeviceId();
    registerFollow(deviceId, series.id, { title: series.title, coverUrl: series.coverUrl });
    closeSheet();
    openSeriesDetail(newEntry);
    showToast(t("series.added"));
  });

  backdrop.querySelector("#remove-btn")?.addEventListener("click", async () => {
    await DB.removeSeries(series.id);
    await loadLibrary();
    const deviceId = await getDeviceId();
    unregisterFollow(deviceId, series.id);
    closeSheet();
    render();
  });

  backdrop.querySelector("#status-select")?.addEventListener("change", async (e) => {
    merged.status = e.target.value;
    await DB.upsertSeries(merged);
    await loadLibrary();
  });

  backdrop.querySelector("#notify-toggle")?.addEventListener("change", async (e) => {
    merged.notify = e.target.checked;
    await DB.upsertSeries(merged);
    const deviceId = await getDeviceId();
    if (e.target.checked) registerFollow(deviceId, series.id, { title: series.title, coverUrl: series.coverUrl });
    else unregisterFollow(deviceId, series.id);
  });

  backdrop.querySelectorAll(".chapter-check").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      await DB.markRead(series.id, Number(e.target.dataset.num), e.target.checked);
      await loadLibrary();
    });
  });

  backdrop.querySelector("#mark-all-btn")?.addEventListener("click", async () => {
    for (let i = 1; i <= total; i++) await DB.markRead(series.id, i, true);
    await loadLibrary();
    closeSheet();
    openSeriesDetail(merged);
  });
}

// ---------------- Notificações push ----------------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function enableNotifications() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    showToast(t("discover.error"));
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    render();
    return;
  }
  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) {
    showToast(t("settings.workerUrl.hint"));
    render();
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
  const deviceId = await getDeviceId();
  await savePushSubscription(deviceId, sub.toJSON());
  render();
}

// ---------------- Toast ----------------

let toastTimer;
function showToast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 2200);
}

// ---------------- Data loading ----------------

async function loadLibrary() {
  const series = await DB.listSeries();
  for (const s of series) {
    const readIds = await DB.getReadItems(s.id);
    s._readCount = readIds.length;
  }
  state.library = series;
}

async function loadNews() {
  if (!state.deviceId) return;
  state.news = await fetchRecentReleases(state.deviceId);
}

// ---------------- Render dispatcher ----------------

function render() {
  document.getElementById("page-title").textContent = t(`${state.route}.title`) || t("app.name");
  renderNav();
  if (state.route === "discover") renderDiscover();
  else if (state.route === "library") renderLibrary();
  else if (state.route === "news") renderNews();
  else if (state.route === "settings") renderSettings();
}

// ---------------- Tema (claro / escuro / automático) ----------------

async function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

async function initTheme() {
  const saved = (await DB.getKV("theme")) || "auto";
  applyTheme(saved);
  return saved;
}

// ---------------- Init ----------------

async function init() {
  await initTheme();
  await initI18n();
  state.deviceId = await getDeviceId();
  await loadLibrary();
  await loadNews();
  state.route = location.hash.replace("#", "") || "discover";
  render();

  window.addEventListener("langchange", () => render());

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.deferredInstallPrompt = e;
    if (state.route === "settings") render();
  });
}

init();
