/* Black Diamond Targets — offline service worker
   App shell: network-first, cached fallback (so mid-lake reloads still work).
   Map tiles / CDN / fonts: cache-first with background refresh, capped. */
const SHELL = 'bd-shell-v1';
const TILES = 'bd-tiles-v1';
const TILE_HOSTS = ['tile.openstreetmap.org', 'tiles.openseamap.org', 'gis.charttools.noaa.gov'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const MAX_TILES = 1200;

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Map tiles + CDN assets: cache-first, refresh in background
  if (TILE_HOSTS.includes(url.host) || CDN_HOSTS.includes(url.host)) {
    const cacheName = TILE_HOSTS.includes(url.host) ? TILES : SHELL;
    e.respondWith((async () => {
      const c = await caches.open(cacheName);
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => {
        if (r && r.ok) { c.put(e.request, r.clone()); if (cacheName === TILES) trimCache(TILES, MAX_TILES); }
        return r;
      }).catch(() => null);
      return hit || (await net) || new Response('', { status: 504 });
    })());
    return;
  }

  // Weather API: network-first, fall back to last cached forecast
  if (url.host === 'api.open-meteo.com') {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      try {
        const r = await fetch(e.request);
        if (r.ok) c.put(e.request, r.clone());
        return r;
      } catch (err) {
        const hit = await c.match(e.request, { ignoreSearch: false });
        return hit || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // App shell (same-origin pages/files): network-first, cached fallback
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      try {
        const r = await fetch(e.request);
        if (r.ok) c.put(e.request, r.clone());
        return r;
      } catch (err) {
        const hit = await c.match(e.request) || (e.request.mode === 'navigate' ? await c.match('./') : null);
        return hit || new Response('Offline', { status: 503 });
      }
    })());
  }
});
