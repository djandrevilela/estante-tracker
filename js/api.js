// api.js — acesso a fontes de dados externas.
//
// Manga (AniList): chamado DIRETAMENTE do browser — API pública, sem chave,
// com CORS aberto, por isso é segura para um site 100% estático.
//
// Comics (Marvel / DC via Comic Vine): passam SEMPRE pelo Cloudflare Worker
// (WORKER_URL), porque precisam de chaves secretas que nunca podem viver
// no frontend público. Se o Worker não estiver configurado, estas fontes
// ficam simplesmente indisponíveis (a app não bloqueia por causa disso).

import { DB } from "./db.js";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export async function getWorkerUrl() {
  return (await DB.getKV("workerUrl")) || "";
}

export async function setWorkerUrl(url) {
  await DB.setKV("workerUrl", url.trim().replace(/\/$/, ""));
}

// ---------------- AniList (manga) ----------------

const ANILIST_MEDIA_FIELDS = `
      id
      title { romaji english native }
      coverImage { extraLarge large color }
      description(asHtml: false)
      status
      chapters
      volumes
      format
      genres
      staff(perPage: 1) { edges { role node { name { full } } } }
`;

const ANILIST_SEARCH_QUERY = `
query ($search: String, $page: Int) {
  Page(page: $page, perPage: 15) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) { ${ANILIST_MEDIA_FIELDS} }
  }
}`;

const ANILIST_BY_GENRE_QUERY = `
query ($genres: [String], $page: Int) {
  Page(page: $page, perPage: 10) {
    media(genre_in: $genres, type: MANGA, sort: POPULARITY_DESC) { ${ANILIST_MEDIA_FIELDS} }
  }
}`;

const ANILIST_TRENDING_QUERY = `
query ($page: Int) {
  Page(page: $page, perPage: 10) {
    media(type: MANGA, sort: TRENDING_DESC) { ${ANILIST_MEDIA_FIELDS} }
  }
}`;

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

function normalizeAniList(m) {
  const title = m.title.english || m.title.romaji || m.title.native;
  return {
    id: `anilist:${m.id}`,
    source: "anilist",
    type: "manga",
    title,
    coverUrl: m.coverImage?.extraLarge || m.coverImage?.large || "",
    synopsis: stripHtml(m.description),
    publisher: m.staff?.edges?.[0]?.node?.name?.full || "—",
    status: m.status === "FINISHED" || m.status === "CANCELLED" ? "finished" : "ongoing",
    totalChapters: m.chapters || null,
    totalVolumes: m.volumes || null,
    genres: m.genres || [],
  };
}

async function anilistQuery(query, variables) {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList error ${res.status}`);
  const json = await res.json();
  return (json.data?.Page?.media || []).map(normalizeAniList);
}

export async function searchManga(query) {
  return anilistQuery(ANILIST_SEARCH_QUERY, { search: query, page: 1 });
}

export async function getMangaByGenres(genres) {
  if (!genres?.length) return [];
  return anilistQuery(ANILIST_BY_GENRE_QUERY, { genres: genres.slice(0, 3), page: 1 });
}

export async function getTrendingManga() {
  return anilistQuery(ANILIST_TRENDING_QUERY, { page: 1 });
}

// ---------------- Marvel / DC (via Worker proxy) ----------------

export async function searchComics(query) {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) {
    const err = new Error("NO_WORKER");
    err.code = "NO_WORKER";
    throw err;
  }
  const res = await fetch(`${workerUrl}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Worker error ${res.status}`);
  const json = await res.json();
  // O Worker já devolve resultados normalizados no mesmo formato usado aqui.
  return json.results || [];
}

// ---------------- Pesquisa combinada ----------------

export async function searchAll(query, filter = "all") {
  const jobs = [];
  if (filter === "all" || filter === "manga") jobs.push(searchManga(query).catch(() => []));
  if (filter === "all" || filter === "comics") {
    jobs.push(
      searchComics(query).catch((e) => {
        if (e.code === "NO_WORKER") return [];
        return [];
      })
    );
  }
  const results = await Promise.all(jobs);
  return results.flat();
}

// ---------------- Notificações push (via Worker) ----------------

export async function registerFollow(deviceId, seriesId, seriesMeta) {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) return { ok: false, reason: "NO_WORKER" };
  const res = await fetch(`${workerUrl}/follow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, seriesId, seriesMeta }),
  });
  return { ok: res.ok };
}

export async function unregisterFollow(deviceId, seriesId) {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) return { ok: false, reason: "NO_WORKER" };
  const res = await fetch(`${workerUrl}/follow`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, seriesId }),
  });
  return { ok: res.ok };
}

export async function getVapidPublicKey() {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) return null;
  const res = await fetch(`${workerUrl}/vapid-public-key`);
  if (!res.ok) return null;
  const { key } = await res.json();
  return key;
}

export async function savePushSubscription(deviceId, subscription) {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) return { ok: false, reason: "NO_WORKER" };
  const res = await fetch(`${workerUrl}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, subscription }),
  });
  return { ok: res.ok };
}

export async function fetchRecentReleases(deviceId) {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) return [];
  try {
    const res = await fetch(`${workerUrl}/news?deviceId=${encodeURIComponent(deviceId)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.releases || [];
  } catch {
    return [];
  }
}
