const CACHE_NAME = 'coupon-sale-assets-v7';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // Skip caching internal APIs, Firebase endpoints, and external requests
  if (
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.startsWith('/api/') ||
    requestUrl.pathname === '/sw.js' ||
    event.request.url.includes('firestore.googleapis.com') ||
    event.request.url.includes('googleapis.com')
  ) {
    return;
  }

  // Network-First with cache fallback for offline resilience
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
  );
});

// OS-level Web Push handler (fires even when the app & browser are completely closed)
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_err) {
      try {
        payload = { body: event.data.text() };
      } catch (_e2) {
        payload = {};
      }
    }
  }

  const title = payload.title || 'SCC Trust Alert';
  const options = {
    body: payload.body || 'You have a new update.',
    icon: payload.icon || '/splash/mobile.jpg',
    badge: payload.badge || '/notification-badge.png',
    vibrate: [200, 100, 200],
    tag: payload.tag || `scc-push-${Date.now()}`,
    renotify: true,
    requireInteraction: false,
    timestamp: payload.timestamp || Date.now(),
    data: {
      url: payload.url || '/',
      dateOfArrival: Date.now(),
    },
    ...(payload.options || {}),
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification tap: focus open window or launch app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle automatic browser push subscription rotation in background
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      let applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) {
        const res = await fetch('/api/push/vapid-public-key', { cache: 'no-store' });
        if (res.ok) {
          const { publicKey } = await res.json();
          if (publicKey) {
            const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
            const base64 = (publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) {
              outputArray[i] = rawData.charCodeAt(i);
            }
            applicationServerKey = outputArray;
          }
        }
      }
      if (!applicationServerKey) return;

      const newSubscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        client.postMessage({
          type: 'PUSH_SUBSCRIPTION_CHANGED',
          subscription: newSubscription.toJSON(),
        });
      }
    } catch (err) {
      console.warn('SW pushsubscriptionchange recovery warning:', err);
    }
  })());
});
