importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyBaKmEYUtyRk7bgz03Df1Gfy55p6hlkByc",
  authDomain: "coupon-sale-tracker.firebaseapp.com",
  projectId: "coupon-sale-tracker",
  storageBucket: "coupon-sale-tracker.firebasestorage.app",
  messagingSenderId: "755043690981",
  appId: "1:755043690981:web:8c5ae52f6befe77702e70c",
  measurementId: "G-DJH27GY09Q"
};
const DB_ID = "(default)";

firebase.initializeApp(firebaseConfig);
const db = DB_ID && DB_ID !== '(default)' ? firebase.app().firestore(DB_ID) : firebase.app().firestore();

let notificationsEnabledGlobal = true;

// Listen to global notification settings doc
db.doc('settings/global').onSnapshot((doc) => {
  if (doc && doc.exists) {
    const data = doc.data();
    notificationsEnabledGlobal = data.notificationsEnabled !== false;
  }
}, (err) => {
  console.warn("Global settings listener error in sw:", err);
});

// Helper to check if the app is currently open and visible to the user
function getIsAppOpen() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientList) => {
      return clientList.some(client => client.visibilityState === 'visible');
    });
}

// Handler to safely display background notifications with mobile splash branding
function sendBackgroundNotification(title, body) {
  if (!notificationsEnabledGlobal) return;

  getIsAppOpen().then((isOpen) => {
    if (!isOpen) {
      self.registration.showNotification(title, {
        body: body,
        icon: '/notification-icon.png',
        badge: '/notification-badge.png',
        vibrate: [100, 50, 100],
        data: {
          dateOfArrival: Date.now(),
          primaryKey: 1
        }
      });
    }
  });
}

const CACHE_NAME = 'coupon-sale-assets-v4';

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
    }).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // Skip caching our internal APIs, firebase libraries, and Google API websocket pathways
  if (
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.startsWith('/api/') ||
    event.request.url.includes('firestore.googleapis.com') ||
    event.request.url.includes('googleapis.com')
  ) {
    return;
  }

  // Dynamic Network-First fallback to Cache to secure full offline browser refreshes
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
          // Navigate fallback
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Coupon Sale Alert';
  const options = {
    body: data.body || 'You have a new notification!',
    icon: '/notification-icon.png',
    badge: '/notification-badge.png',
    vibrate: [100, 50, 100],
    ...data.options
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Real-time Background Collection Listeners for when the app is completely closed

// 1. Transactions Listener
let isInitialTransactions = true;
const knownTransactions = new Set();
db.collection('transactions').onSnapshot((snapshot) => {
  if (!snapshot) return;
  snapshot.docChanges().forEach((change) => {
    const docId = change.doc.id;
    if (change.type === 'added') {
      if (isInitialTransactions) {
        knownTransactions.add(docId);
      } else if (!knownTransactions.has(docId)) {
        knownTransactions.add(docId);
        const data = change.doc.data();
        sendBackgroundNotification('New Transaction Added', `${data.name || 'Unknown'} - ₹${(data.totalAmount || 0).toLocaleString('en-IN')}`);
      }
    } else if (change.type === 'removed') {
      knownTransactions.delete(docId);
    }
  });
  isInitialTransactions = false;
}, (err) => {
  console.warn("SW transactions sync error:", err);
});

// 2. Sponsors Listener
let isInitialSponsors = true;
const knownSponsors = new Map();
db.collection('sponsors').onSnapshot((snapshot) => {
  if (!snapshot) return;
  snapshot.docChanges().forEach((change) => {
    const docId = change.doc.id;
    const data = change.doc.data();
    if (change.type === 'added') {
      if (isInitialSponsors) {
        knownSponsors.set(docId, data);
      } else if (!knownSponsors.has(docId)) {
        knownSponsors.set(docId, data);
        sendBackgroundNotification('New Sponsor Added', `${data.name || 'Unknown'} - ₹${(data.amount || 0).toLocaleString('en-IN')}`);
      }
    } else if (change.type === 'modified') {
      const oldData = knownSponsors.get(docId);
      if (oldData && data.status === 'COLLECTED' && oldData.status !== 'COLLECTED') {
        sendBackgroundNotification('Sponsor Payment Collected', `${data.name || 'Unknown'} - ₹${(data.amount || 0).toLocaleString('en-IN')}`);
      }
      knownSponsors.set(docId, data);
    } else if (change.type === 'removed') {
      knownSponsors.delete(docId);
    }
  });
  isInitialSponsors = false;
}, (err) => {
  console.warn("SW sponsors sync error:", err);
});

// 3. Income & Expenses Listener
let isInitialIncomeExpenses = true;
const knownIncomeExpenses = new Set();
db.collection('incomeExpenses').onSnapshot((snapshot) => {
  if (!snapshot) return;
  snapshot.docChanges().forEach((change) => {
    const docId = change.doc.id;
    if (change.type === 'added') {
      if (isInitialIncomeExpenses) {
        knownIncomeExpenses.add(docId);
      } else if (!knownIncomeExpenses.has(docId)) {
        knownIncomeExpenses.add(docId);
        const data = change.doc.data();
        const typeStr = (data.type || 'income').toLowerCase();
        const typeProper = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);
        sendBackgroundNotification(`New ${typeProper} Added`, `${data.description || 'Unknown'} - ₹${(data.amount || 0).toLocaleString('en-IN')}`);
      }
    } else if (change.type === 'removed') {
      knownIncomeExpenses.delete(docId);
    }
  });
  isInitialIncomeExpenses = false;
}, (err) => {
  console.warn("SW income/expenses sync error:", err);
});

// 4. Secretary Handovers Listener
let isInitialHandovers = true;
const knownHandovers = new Set();
db.collection('secretaryHandovers').onSnapshot((snapshot) => {
  if (!snapshot) return;
  snapshot.docChanges().forEach((change) => {
    const docId = change.doc.id;
    if (change.type === 'added') {
      if (isInitialHandovers) {
        knownHandovers.add(docId);
      } else if (!knownHandovers.has(docId)) {
        knownHandovers.add(docId);
        const data = change.doc.data();
        sendBackgroundNotification('Cash Handed Over', `${data.name || 'Unknown'} - ₹${(data.amount || 0).toLocaleString('en-IN')}`);
      }
    } else if (change.type === 'removed') {
      knownHandovers.delete(docId);
    }
  });
  isInitialHandovers = false;
}, (err) => {
  console.warn("SW handovers sync error:", err);
});
