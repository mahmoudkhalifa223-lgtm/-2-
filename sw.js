/* ========================================
   رفيق الحفظ - Service Worker v10.0
   ======================================== */

const CACHE_NAME = 'hifz-companion-v10-static';
const DYNAMIC_CACHE = 'hifz-companion-v10-dynamic';
const MUSHAF_CACHE = 'hifz-companion-v10-mushaf';

const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;700;900&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => {
                if (![CACHE_NAME, DYNAMIC_CACHE, MUSHAF_CACHE].includes(key)) {
                    console.log('[SW] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    // Cache First for Mushaf images from archive.quran.com
    if (requestUrl.hostname === 'archive.quran.com') {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse.ok) {
                        return caches.open(MUSHAF_CACHE).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                            return networkResponse;
                        });
                    }
                    return networkResponse;
                }).catch(() => cachedResponse);
            })
        );
    }
    // Network First for API
    else if (requestUrl.hostname === 'api.alquran.cloud') {
        event.respondWith(
            fetch(event.request).then((networkResponse) => {
                return caches.open(DYNAMIC_CACHE).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            }).catch(() => caches.match(event.request))
        );
    }
    // Cache First for static assets
    else {
        event.respondWith(
            caches.match(event.request).then((response) => {
                return response || fetch(event.request).then((networkResponse) => {
                    if (networkResponse.ok && event.request.method === 'GET') {
                        return caches.open(DYNAMIC_CACHE).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                            return networkResponse;
                        });
                    }
                    return networkResponse;
                });
            })
        );
    }
});