// Teigbuch – lokale Speicherung (IndexedDB), Fotos, Export/Import
const DB_NAME = 'teigbuch';
const STORES = ['recipes', 'logs', 'sessions', 'photos', 'meta'];
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        STORES.forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    let out;
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
export const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
export const clear = (store) => tx(store, 'readwrite', (s) => s.clear());

export async function persist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
export async function isPersisted() {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : false; } catch { return false; }
}
export async function estimate() {
  try { return navigator.storage?.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}

// ---------- Fotos ----------
const urlCache = new Map();

export async function compressImage(file, max = 1600, quality = 0.82) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', quality));
}

export async function addPhoto(file) {
  const blob = await compressImage(file);
  const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await put('photos', { id, type: blob.type || 'image/jpeg', data: await blob.arrayBuffer(), createdAt: Date.now() });
  return id;
}

// Optional: lädt fehlende Fotos aus der Cloud (wird vom Sync gesetzt)
let photoFetcher = null;
const fetchFailed = new Set();
export const setPhotoFetcher = (fn) => { photoFetcher = fn; };
// Nach einem erfolgreichen Abgleich fehlende Fotos erneut versuchen (sie könnten inzwischen hochgeladen sein)
export const clearPhotoFetchFailures = () => fetchFailed.clear();

export async function photoURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  let rec = await get('photos', id);
  if (!rec && photoFetcher && !fetchFailed.has(id)) {
    try {
      const blob = await photoFetcher(id);
      if (blob) {
        rec = { id, type: blob.type || 'image/jpeg', data: await blob.arrayBuffer(), createdAt: Date.now() };
        await put('photos', rec);
      }
    } catch { fetchFailed.add(id); }
  }
  if (!rec) return null;
  const u = URL.createObjectURL(new Blob([rec.data], { type: rec.type }));
  urlCache.set(id, u);
  return u;
}

export async function deletePhoto(id) {
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  await del('photos', id);
}

// ---------- Export / Import ----------
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Dateiformat der Sicherung: 1 = bis App 1.4, 2 = ab App 1.5 (zusätzlich „schema“ und „appVersion“).
// Der Import akzeptiert ALLE Formate – ältere Einträge werden über migrate.js nachgezogen.
export async function buildExport({ recipeIds = null, withPhotos = true, meta = {} } = {}) {
  let recipes = await getAll('recipes');
  let logs = await getAll('logs');
  if (recipeIds) {
    recipes = recipes.filter((r) => recipeIds.includes(r.id));
    logs = logs.filter((l) => recipeIds.includes(l.recipeId));
  }
  const photos = [];
  if (withPhotos) {
    const ids = new Set([...recipes.flatMap((r) => r.photos || []), ...logs.flatMap((l) => l.photos || [])]);
    for (const id of ids) {
      const ph = await get('photos', id);
      if (ph) photos.push({ id, type: ph.type, data: bufToB64(ph.data) });
    }
  }
  return { app: 'Teigbuch', format: 2, ...meta, exportedAt: new Date().toISOString(), recipes, logs, photos };
}

export async function importData(obj, { cleanRecipe = (x) => x, cleanLog = (x) => x } = {}) {
  if (!obj || obj.app !== 'Teigbuch' || !Array.isArray(obj.recipes)) throw new Error('Das ist keine Teigbuch-Datei.');
  const out = { recipes: 0, logs: 0, photos: 0, skipped: 0 };
  for (const ph of obj.photos || []) {
    const id = String(ph.id || '').replace(/[^\w-]/g, '');
    if (!id || !/^image\/[\w.+-]+$/.test(ph.type || '') || typeof ph.data !== 'string') continue;
    await put('photos', { id, type: ph.type, data: b64ToBuf(ph.data), createdAt: Date.now() });
    out.photos++;
  }
  for (const raw of obj.recipes) {
    const rec = cleanRecipe(raw);
    const ex = await get('recipes', rec.id);
    // Übernommene Einträge gelten als „jetzt geändert“ – so setzt sich ein bewusster Import auch im Geräte-Sync durch
    if (!ex || (rec.updatedAt || 0) >= (ex.updatedAt || 0)) { await put('recipes', { ...rec, updatedAt: Date.now() }); out.recipes++; } else out.skipped++;
  }
  for (const rawLog of obj.logs || []) {
    const l = cleanLog(rawLog);
    const ex = await get('logs', l.id);
    if (!ex || (l.updatedAt || l.createdAt || 0) >= (ex.updatedAt || ex.createdAt || 0)) { await put('logs', { ...l, updatedAt: Date.now() }); out.logs++; } else out.skipped++;
  }
  return out;
}
