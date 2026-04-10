const CACHE_NAME = 'timerangepro-v1';
const NOADS_TOKEN_KEY = 'trp_noads_token';

// Core assets always cached on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// noads page is cached only after first successful access
const NOADS_URL = '/noads/';
const NOADS_HTML = '/noads/index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isNoads = url.pathname === '/noads/' || url.pathname === '/noads/index.html';

  if (isNoads) {
    event.respondWith(handleNoads(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

async function handleNoads(request) {
  // Check if noads is already cached (has been accessed before)
  const cached = await caches.match(request);

  // Token check happens client-side (JS in noads/index.html)
  // SW just serves the file if cached, or fetches and caches on first access
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      // Cache the noads page for offline use after first successful fetch
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, clone);
    }
    return response;
  } catch {
    // Offline and not cached - return redirect to index
    return Response.redirect('/', 302);
  }
}

// Message handler: clear noads cache on demand
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_NOADS_CACHE') {
    caches.open(CACHE_NAME).then(cache => {
      cache.delete('/noads/');
      cache.delete('/noads/index.html');
    });
  }
});
