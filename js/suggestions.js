// suggestions.js — "O que ler a seguir", com base no que já está na biblioteca.
// Manga: sugestões por género mais comum na biblioteca (AniList).
// Comics: sugestões pela mesma editora (via Worker, se estiver configurado).

import { getMangaByGenres, getTrendingManga, searchComics } from "./api.js";

function topGenres(library) {
  const counts = {};
  for (const s of library) {
    if (s.source !== "anilist" || !s.genres) continue;
    for (const g of s.genres) counts[g] = (counts[g] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);
}

function topComicPublishers(library) {
  const counts = {};
  for (const s of library) {
    if (s.source !== "marvel" && s.source !== "comicvine") continue;
    if (!s.publisher || s.publisher === "—") continue;
    counts[s.publisher] = (counts[s.publisher] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
}

export async function getSuggestions(library) {
  const libraryIds = new Set(library.map((s) => s.id));
  let mangaSuggestions = [];

  const genres = topGenres(library);
  try {
    mangaSuggestions = genres.length ? await getMangaByGenres(genres) : await getTrendingManga();
  } catch {
    mangaSuggestions = [];
  }

  let comicSuggestions = [];
  const publishers = topComicPublishers(library);
  if (publishers.length) {
    try {
      comicSuggestions = await searchComics(publishers[0]);
    } catch {
      comicSuggestions = [];
    }
  }

  const combined = [...mangaSuggestions, ...comicSuggestions].filter((s) => !libraryIds.has(s.id));
  // dedupe por id
  const seen = new Set();
  return combined.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).slice(0, 8);
}
