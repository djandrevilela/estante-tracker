// db.js — camada de armazenamento local (IndexedDB). Tudo o que é progresso
// de leitura e biblioteca fica SÓ neste dispositivo, nunca é enviado a lado nenhum.

const DB_NAME = "estante-db";
const DB_VERSION = 1;
const STORE_SERIES = "series";     // séries na biblioteca do utilizador
const STORE_READ = "readItems";    // capítulos/volumes marcados como lidos
const STORE_KV = "kv";             // definições diversas (idioma, worker url, deviceId...)

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SERIES)) {
        const s = db.createObjectStore(STORE_SERIES, { keyPath: "id" });
        s.createIndex("status", "status", { unique: false });
        s.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_READ)) {
        // key = `${seriesId}::${itemId}`
        db.createObjectStore(STORE_READ, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const DB = {
  // ---- KV genérico ----
  async getKV(key, fallback = null) {
    const store = await tx(STORE_KV);
    const res = await reqToPromise(store.get(key));
    return res ? res.value : fallback;
  },
  async setKV(key, value) {
    const store = await tx(STORE_KV, "readwrite");
    await reqToPromise(store.put({ key, value }));
  },

  // ---- Biblioteca ----
  async listSeries() {
    const store = await tx(STORE_SERIES);
    return reqToPromise(store.getAll());
  },
  async getSeries(id) {
    const store = await tx(STORE_SERIES);
    return reqToPromise(store.get(id));
  },
  async upsertSeries(series) {
    series.updatedAt = Date.now();
    const store = await tx(STORE_SERIES, "readwrite");
    await reqToPromise(store.put(series));
    return series;
  },
  async removeSeries(id) {
    const store = await tx(STORE_SERIES, "readwrite");
    await reqToPromise(store.delete(id));
    // limpa também os itens lidos associados
    const readStore = await tx(STORE_READ, "readwrite");
    const all = await reqToPromise(readStore.getAll());
    for (const item of all) {
      if (item.key.startsWith(id + "::")) readStore.delete(item.key);
    }
  },

  // ---- Progresso de leitura ----
  async markRead(seriesId, itemId, read = true) {
    const key = `${seriesId}::${itemId}`;
    const store = await tx(STORE_READ, "readwrite");
    if (read) {
      await reqToPromise(store.put({ key, seriesId, itemId, readAt: Date.now() }));
    } else {
      await reqToPromise(store.delete(key));
    }
  },
  async getReadItems(seriesId) {
    const store = await tx(STORE_READ);
    const all = await reqToPromise(store.getAll());
    return all.filter((i) => i.seriesId === seriesId).map((i) => i.itemId);
  },
  async isRead(seriesId, itemId) {
    const store = await tx(STORE_READ);
    const res = await reqToPromise(store.get(`${seriesId}::${itemId}`));
    return !!res;
  },
  async getAllReadItems() {
    const store = await tx(STORE_READ);
    return reqToPromise(store.getAll());
  },

  // ---- Exportar / Importar (backup manual, já que não há conta) ----
  async exportAll() {
    const series = await this.listSeries();
    const readStore = await tx(STORE_READ);
    const readItems = await reqToPromise(readStore.getAll());
    return {
      exportedAt: new Date().toISOString(),
      version: DB_VERSION,
      series,
      readItems,
    };
  },
  async importAll(data) {
    if (!data || !Array.isArray(data.series)) throw new Error("Ficheiro inválido");
    const sStore = await tx(STORE_SERIES, "readwrite");
    for (const s of data.series) sStore.put(s);
    if (Array.isArray(data.readItems)) {
      const rStore = await tx(STORE_READ, "readwrite");
      for (const r of data.readItems) rStore.put(r);
    }
  },
  async wipeAll() {
    const db = await openDB();
    await Promise.all(
      [STORE_SERIES, STORE_READ].map(
        (name) =>
          new Promise((resolve, reject) => {
            const req = db.transaction(name, "readwrite").objectStore(name).clear();
            req.onsuccess = resolve;
            req.onerror = () => reject(req.error);
          })
      )
    );
  },
};

// ID de dispositivo anónimo (UUID aleatório), usado só para associar a
// subscrição push e a lista de "a seguir" no Worker — sem qualquer dado pessoal.
export async function getDeviceId() {
  let id = await DB.getKV("deviceId");
  if (!id) {
    id = crypto.randomUUID();
    await DB.setKV("deviceId", id);
  }
  return id;
}
