/* Sürücü Akademisi SW - V9 (Offline-first auth + admin panel) */
const CACHE_NAME = 'surucu-v9';
const ASSETS = [
    './',
    './index.html',
    './admin.html',
    './auth.js',
    './manifest.json',
    './sw.js',

    // Logo
    './resimler/logo.png',

    // Resimler (offline)
    './resimler/d1_s16.jpg',
    './resimler/d1_s17.jpg',
    './resimler/d1_s18.jpg',
    './resimler/d1_s19.jpg',
    './resimler/d1_s20.jpg',
    './resimler/d1_s23.jpg',
    './resimler/d1_s24.jpg',
    './resimler/d1_s26.jpg',
    './resimler/d1_s27.jpg',
    './resimler/d1_s29.jpg',
    './resimler/d1_s30.jpg',
    './resimler/d1_s31.jpg',
    './resimler/d1_s37.jpg',
    './resimler/d1_s39.jpg',
    './resimler/d1_s40.jpg',
    './resimler/d1_s42.jpg',
    './resimler/d1_s43.jpg',
    './resimler/disel.arac.jpg',
    './resimler/havakosullari.jpg',
    './resimler/lamba.jpg',
    './resimler/mekanik.jpg',
    './resimler/motor.gosterge.jpg',
    './resimler/surusemniyeti.jpg',
    './resimler/yakit.yaglama.jpg',

    // Notlar (offline)
    './notlar/ilkyardim.pdf',
    './notlar/ismakineleri.pdf',
    './notlar/motor.pdf',
    './notlar/trafik.pdf',
    './notlar/trafikvecevre.pdf'
];

self.addEventListener('install', e => {
    // Yeni versiyonu yükle ve hemen aktif ol
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting(); 
});

self.addEventListener('activate', e => {
    // Eski (bozuk resimli) önbelleği tamamen sil
    e.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )));
    // Tüm açık sekmeleri anında kontrol altına al
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Cross-origin (CDN vb.): normal fetch, offline ise cache fallback.
    if (url.origin !== self.location.origin) {
        e.respondWith(fetch(req).catch(() => caches.match(req)));
        return;
    }

    // Same-origin: Cache-first (offline-first) + arka planda güncelle.
    e.respondWith(
        caches.match(req).then(cached => {
            const fetchAndUpdate = fetch(req)
                .then(res => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
                    return res;
                })
                .catch(() => cached);

            return cached || fetchAndUpdate;
        })
    );
});