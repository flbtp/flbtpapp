/* Garde l'application sur le téléphone pour qu'elle s'ouvre sans réseau.
 * À chaque mise à jour des fichiers, augmenter VERSION : les téléphones récupèrent la nouvelle version
 * à la prochaine ouverture avec du réseau. */
const VERSION = 'flbtp-v2';
const FICHIERS = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icone-192.png', 'icone-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;                       // les envois au serveur ne sont jamais mis en cache
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('googleusercontent.com')) return;

  // Polices Google : mises en cache au premier passage.
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.open(VERSION + '-polices').then(async c => {
      const r = await c.match(e.request);
      if (r) return r;
      const n = await fetch(e.request);
      c.put(e.request, n.clone());
      return n;
    }));
    return;
  }
  // Fichiers de l'application : réseau d'abord (pour les mises à jour), cache si pas de réseau.
  e.respondWith(fetch(e.request)
    .then(r => { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
