/* Coriman Yerbas: guarda la app en el celular para que abra sin señal y sube las ventas pendientes
 * cuando vuelve internet, aunque la app esté cerrada (sincronización en segundo plano de Android/Chrome). */
const CACHE = 'coriman-v1';
const INDEX = new URL('./index.html', self.location).href;
const APP = ['./', './index.html', './manifest.json', './icono-192.png', './icono-512.png', './apple-touch-icon.png', './favicon-32.png'];
const EXTERNOS = /(^|\.)fonts\.googleapis\.com$|(^|\.)fonts\.gstatic\.com$|(^|\.)cdn\.jsdelivr\.net$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(APP.map(u => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === self.location.origin) {
    if (r.mode === 'navigate' || /\/(index\.html)?$/i.test(u.pathname)) {
      // La pantalla: siempre la última versión si hay internet; si no, la guardada.
      e.respondWith(fetch(u.href, { cache: 'no-cache', credentials: 'same-origin' })
        .then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(INDEX, cp)); } return res; })
        .catch(() => caches.match(INDEX)));
      return;
    }
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
      return res;
    })));
    return;
  }
  if (EXTERNOS.test(u.hostname)) {
    // Letras e íconos: se usan los guardados y se actualizan de fondo.
    e.respondWith(caches.match(r).then(m => {
      const red = fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; }).catch(() => m);
      return m || red;
    }));
  }
});

self.addEventListener('sync', e => { if (e.tag === 'subir-ventas') e.waitUntil(subir()); });
self.addEventListener('message', e => { if (e.data === 'subir') e.waitUntil(subir().catch(() => {})); });

function bd() {
  return new Promise((ok, mal) => {
    const q = indexedDB.open('coriman', 1);
    q.onupgradeneeded = () => { q.result.createObjectStore('cola', { keyPath: 'id' }); q.result.createObjectStore('cfg'); };
    q.onsuccess = () => ok(q.result);
    q.onerror = () => mal(q.error);
  });
}
function leer(db, store, fn) {
  return new Promise((ok, mal) => { const q = fn(db.transaction(store, 'readonly').objectStore(store)); q.onsuccess = () => ok(q.result); q.onerror = () => mal(q.error); });
}
function borrar(db, id) {
  return new Promise((ok, mal) => { const tx = db.transaction('cola', 'readwrite'); tx.objectStore('cola').delete(id); tx.oncomplete = ok; tx.onerror = () => mal(tx.error); });
}

/** Sube las ventas en espera, en orden. Si no hay red, falla y el navegador vuelve a intentar más tarde.
 *  Si la planilla pide volver a entrar (llave vencida o PIN cambiado), se deja para cuando abran la app. */
async function subir() {
  const db = await bd();
  const cred = await leer(db, 'cfg', s => s.get('cred'));
  if (!cred || !cred.api) return;
  const cola = (await leer(db, 'cola', s => s.getAll())).sort((a, b) => a.t - b.t);
  let n = 0;
  for (const it of cola) {
    const res = await fetch(cred.api, {
      method: 'POST', credentials: 'omit', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: 'guardarVenta', args: [it.venta], pin: cred.pin, sesion: cred.sesion, token: '' })
    }).then(x => x.json());
    if (!res.ok) break;
    await borrar(db, it.id);
    n++;
  }
  if (n) (await self.clients.matchAll({ includeUncontrolled: true })).forEach(c => c.postMessage({ tipo: 'subidas', n }));
}
