/* EcoInforme — Service Worker
   ----------------------------------------------------------------------------
   IMPORTANTE: bumpeá VERSION en CADA release, junto con el build string de
   index.html. Cambiar VERSION invalida la caché vieja y fuerza la actualización.

   Estrategia:
   - Navegación / HTML  -> network-first: la versión nueva se toma apenas hay
     conexión (no se queda pegado en caché). Si no hay red, usa la copia cacheada.
   - Assets y librerías CDN -> cache-first: carga instantánea y funciona offline.
   ---------------------------------------------------------------------------- */
const VERSION = 'v69';
const CACHE = 'ecoinforme-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).catch(() => {})) // si algún asset falta, no aborta la instalación
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');

  if (isHTML) {
    // network-first: siempre intenta la versión más nueva
    e.respondWith(
      fetch(req)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
          return resp;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // cache-first para el resto (íconos, logo, librerías CDN)
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      });
    })
  );
});
