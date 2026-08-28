/**
 * Estante — Cloudflare Worker
 *
 * Responsabilidades (o "mini-backend" mencionado na arquitetura):
 *  1. Proxy seguro para Marvel API e Comic Vine (as chaves nunca vão para o browser)
 *  2. Guardar a lista "a seguir" por dispositivo + subscrições Web Push
 *     (o mínimo de dados necessário para poder notificar — nada de contas/emails)
 *  3. Endpoint /cron/check, chamado pelo GitHub Actions agendado, que verifica
 *     lançamentos novos e envia Web Push a quem segue essa série
 *
 * Bindings esperados (ver wrangler.toml):
 *  - KV namespace: ESTANTE_KV
 *  - Secrets: MARVEL_PUBLIC_KEY, MARVEL_PRIVATE_KEY, COMICVINE_API_KEY,
 *             VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
 */

import { buildPushPayload } from "@block65/webcrypto-web-push";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(JSON_HEADERS) });
}

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*", // ajusta para o teu domínio do GitHub Pages em produção
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-cron-secret",
    ...extra,
  };
}

async function kvGetJSON(kv, key, fallback) {
  const v = await kv.get(key);
  return v ? JSON.parse(v) : fallback;
}

// ---------------- Marvel ----------------

async function md5Hex(str) {
  const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function searchMarvel(env, query) {
  if (!env.MARVEL_PUBLIC_KEY || !env.MARVEL_PRIVATE_KEY) return [];
  const ts = Date.now().toString();
  const hash = await md5Hex(ts + env.MARVEL_PRIVATE_KEY + env.MARVEL_PUBLIC_KEY);
  const url = new URL("https://gateway.marvel.com/v1/public/series");
  url.searchParams.set("titleStartsWith", query);
  url.searchParams.set("orderBy", "-modified");
  url.searchParams.set("limit", "12");
  url.searchParams.set("ts", ts);
  url.searchParams.set("apikey", env.MARVEL_PUBLIC_KEY);
  url.searchParams.set("hash", hash);

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data?.results || []).map((s) => ({
    id: `marvel:${s.id}`,
    source: "marvel",
    type: "comic",
    title: s.title,
    coverUrl: s.thumbnail ? `${s.thumbnail.path}/portrait_incredible.${s.thumbnail.extension}` : "",
    synopsis: s.description || "",
    publisher: "Marvel",
    status: "ongoing",
    totalChapters: null,
    totalVolumes: s.comics?.available || null,
  }));
}

async function marvelSeriesIssueCount(env, marvelSeriesId) {
  const ts = Date.now().toString();
  const hash = await md5Hex(ts + env.MARVEL_PRIVATE_KEY + env.MARVEL_PUBLIC_KEY);
  const url = new URL(`https://gateway.marvel.com/v1/public/series/${marvelSeriesId}`);
  url.searchParams.set("ts", ts);
  url.searchParams.set("apikey", env.MARVEL_PUBLIC_KEY);
  url.searchParams.set("hash", hash);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.results?.[0]?.comics?.available ?? null;
}

// ---------------- Comic Vine (Marvel/DC/Image/etc.) ----------------

async function searchComicVine(env, query) {
  if (!env.COMICVINE_API_KEY) return [];
  const url = new URL("https://comicvine.gamespot.com/api/search/");
  url.searchParams.set("api_key", env.COMICVINE_API_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("resources", "volume");
  url.searchParams.set("query", query);
  url.searchParams.set(
    "field_list",
    "id,name,image,deck,publisher,count_of_issues,start_year"
  );
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "EstanteApp/1.0 (github.com/SEU-UTILIZADOR/estante)" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((v) => ({
    id: `comicvine:${v.id}`,
    source: "comicvine",
    type: "comic",
    title: v.name,
    coverUrl: v.image?.medium_url || "",
    synopsis: v.deck || "",
    publisher: v.publisher?.name || "—",
    status: "ongoing",
    totalChapters: null,
    totalVolumes: v.count_of_issues || null,
  }));
}

async function comicVineIssueCount(env, volumeId) {
  const url = new URL(`https://comicvine.gamespot.com/api/volume/4050-${volumeId}/`);
  url.searchParams.set("api_key", env.COMICVINE_API_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("field_list", "count_of_issues");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "EstanteApp/1.0 (github.com/SEU-UTILIZADOR/estante)" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.count_of_issues ?? null;
}

// ---------------- AniList (manga — usado no lado servidor só para o cron) ----------------

async function anilistChapterCount(anilistId) {
  const query = `query($id:Int){ Media(id:$id, type: MANGA) { chapters volumes status } }`;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { id: Number(anilistId) } }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.Media?.chapters ?? data.data?.Media?.volumes ?? null;
}

// ---------------- Rotas HTTP ----------------

async function handleSearch(req, env) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return json({ results: [] });

  const cache = caches.default;
  const cacheKey = new Request(req.url, req);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [marvel, comicvine] = await Promise.all([
    searchMarvel(env, q).catch(() => []),
    searchComicVine(env, q).catch(() => []),
  ]);

  const response = json({ results: [...marvel, ...comicvine] });
  response.headers.append("cache-control", "public, max-age=300");
  await cache.put(cacheKey, response.clone());
  return response;
}

async function handleFollow(req, env) {
  const { deviceId, seriesId, seriesMeta } = await req.json();
  if (!deviceId || !seriesId) return json({ error: "deviceId e seriesId são obrigatórios" }, 400);

  const followsKey = `followsOf:${deviceId}`;
  const followersKey = `followers:${seriesId}`;

  const follows = await kvGetJSON(env.ESTANTE_KV, followsKey, []);
  if (!follows.includes(seriesId)) follows.push(seriesId);
  await env.ESTANTE_KV.put(followsKey, JSON.stringify(follows));

  const followers = await kvGetJSON(env.ESTANTE_KV, followersKey, []);
  if (!followers.includes(deviceId)) followers.push(deviceId);
  await env.ESTANTE_KV.put(followersKey, JSON.stringify(followers));

  if (seriesMeta) {
    await env.ESTANTE_KV.put(`meta:${seriesId}`, JSON.stringify(seriesMeta));
  }
  return json({ ok: true });
}

async function handleUnfollow(req, env) {
  const { deviceId, seriesId } = await req.json();
  if (!deviceId || !seriesId) return json({ error: "deviceId e seriesId são obrigatórios" }, 400);

  const followsKey = `followsOf:${deviceId}`;
  const followersKey = `followers:${seriesId}`;

  const follows = (await kvGetJSON(env.ESTANTE_KV, followsKey, [])).filter((id) => id !== seriesId);
  await env.ESTANTE_KV.put(followsKey, JSON.stringify(follows));

  const followers = (await kvGetJSON(env.ESTANTE_KV, followersKey, [])).filter((id) => id !== deviceId);
  await env.ESTANTE_KV.put(followersKey, JSON.stringify(followers));

  return json({ ok: true });
}

async function handleSubscribe(req, env) {
  const { deviceId, subscription } = await req.json();
  if (!deviceId || !subscription) return json({ error: "deviceId e subscription são obrigatórios" }, 400);
  await env.ESTANTE_KV.put(`sub:${deviceId}`, JSON.stringify(subscription));
  return json({ ok: true });
}

async function handleNews(req, env) {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  if (!deviceId) return json({ releases: [] });
  const follows = await kvGetJSON(env.ESTANTE_KV, `followsOf:${deviceId}`, []);

  const releases = [];
  for (const seriesId of follows) {
    const meta = await kvGetJSON(env.ESTANTE_KV, `meta:${seriesId}`, {});
    const items = await kvGetJSON(env.ESTANTE_KV, `news:${seriesId}`, []);
    for (const item of items) {
      releases.push({ seriesId, title: meta.title, coverUrl: meta.coverUrl, ...item });
    }
  }
  releases.sort((a, b) => b.ts - a.ts);
  return json({ releases: releases.slice(0, 40) });
}

// ---------------- Cron: verificar lançamentos e notificar ----------------

async function checkCurrentCount(env, seriesId) {
  const [source, id] = seriesId.split(":");
  try {
    if (source === "marvel") return await marvelSeriesIssueCount(env, id);
    if (source === "comicvine") return await comicVineIssueCount(env, id);
    if (source === "anilist") return await anilistChapterCount(id);
  } catch {
    return null;
  }
  return null;
}

async function sendPushToDevice(env, deviceId, payloadObj) {
  const sub = await kvGetJSON(env.ESTANTE_KV, `sub:${deviceId}`, null);
  if (!sub) return;
  try {
    const message = await buildPushPayload(
      { data: JSON.stringify(payloadObj) },
      sub,
      {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      }
    );
    const res = await fetch(sub.endpoint, message);
    if (res.status === 404 || res.status === 410) {
      // subscrição expirada — remove
      await env.ESTANTE_KV.delete(`sub:${deviceId}`);
    }
  } catch (e) {
    console.error("push failed", deviceId, e);
  }
}

async function runCronCheck(env) {
  const list = await env.ESTANTE_KV.list({ prefix: "meta:" });
  let checked = 0;
  let notified = 0;

  for (const { name } of list.keys) {
    const seriesId = name.replace("meta:", "");
    const meta = await kvGetJSON(env.ESTANTE_KV, name, {});
    const lastSeen = await env.ESTANTE_KV.get(`lastseen:${seriesId}`);
    const current = await checkCurrentCount(env, seriesId);
    checked++;
    if (current == null) continue;

    if (lastSeen !== null && Number(lastSeen) < current) {
      const releaseLabel = `#${current}`;
      const newsItem = { releaseLabel, ts: Date.now() };
      const news = await kvGetJSON(env.ESTANTE_KV, `news:${seriesId}`, []);
      news.unshift(newsItem);
      await env.ESTANTE_KV.put(`news:${seriesId}`, JSON.stringify(news.slice(0, 20)));

      const followers = await kvGetJSON(env.ESTANTE_KV, `followers:${seriesId}`, []);
      for (const deviceId of followers) {
        await sendPushToDevice(env, deviceId, {
          title: meta.title || "Novo lançamento",
          body: `Saiu ${releaseLabel}`,
          url: "./#news",
          tag: seriesId,
        });
        notified++;
      }
    }
    await env.ESTANTE_KV.put(`lastseen:${seriesId}`, String(current));
  }
  return { checked, notified };
}

// ---------------- Entry point ----------------

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    const url = new URL(req.url);
    try {
      if (url.pathname === "/search" && req.method === "GET") return handleSearch(req, env);
      if (url.pathname === "/follow" && req.method === "POST") return handleFollow(req, env);
      if (url.pathname === "/follow" && req.method === "DELETE") return handleUnfollow(req, env);
      if (url.pathname === "/subscribe" && req.method === "POST") return handleSubscribe(req, env);
      if (url.pathname === "/vapid-public-key" && req.method === "GET")
        return json({ key: env.VAPID_PUBLIC_KEY });
      if (url.pathname === "/news" && req.method === "GET") return handleNews(req, env);

      if (url.pathname === "/cron/check" && req.method === "POST") {
        if (req.headers.get("x-cron-secret") !== env.CRON_SECRET) return json({ error: "unauthorized" }, 401);
        const result = await runCronCheck(env);
        return json({ ok: true, ...result });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e.message || "internal error" }, 500);
    }
  },
};
