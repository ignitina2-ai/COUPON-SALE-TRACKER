import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { publicAsset } from './publicAsset';

export interface StoredPushSubscription {
  id?: string;
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userEmail: string;
  device?: string;
  updatedAt: string;
  enabled?: boolean;
}

export interface BackgroundPushStatus {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  serviceWorkerReady: boolean;
  subscribed: boolean;
  endpoint: string | null;
  vapidAvailable: boolean;
}

let currentPushEndpoint: string | null = null;
let cachedSubscriptions: StoredPushSubscription[] = [];
let swListenerAttached = false;

export const setKnownPushSubscriptions = (subs: StoredPushSubscription[]) => {
  cachedSubscriptions = Array.isArray(subs) ? subs : [];
};

export const getCurrentPushEndpoint = () => currentPushEndpoint;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function hashEndpointId(endpoint: string): Promise<string> {
  try {
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
      const encoded = new TextEncoder().encode(endpoint);
      const digest = await window.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch (_e) {
    // fallback below
  }
  let hash = 2166136261;
  for (let i = 0; i < endpoint.length; i++) {
    hash ^= endpoint.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sub_${(hash >>> 0).toString(36)}_${endpoint.length}`;
}

function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop';
}

async function fetchVapidPublicKey(): Promise<string | null> {
  if (typeof window === 'undefined' || window.location.protocol === 'file:') {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch('/api/push/vapid-public-key', {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.publicKey === 'string' && data.publicKey.length > 20
      ? data.publicKey
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function persistSubscriptionToCloudAndServer(
  subJson: PushSubscriptionJSON,
  emailOverride?: string | null
): Promise<boolean> {
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    return false;
  }

  currentPushEndpoint = subJson.endpoint;
  const currentUser = auth.currentUser;
  const userEmail = (currentUser?.email || emailOverride || '').toLowerCase().trim();
  if (!currentUser || !userEmail) {
    return false;
  }

  const subId = await hashEndpointId(subJson.endpoint);
  const record: StoredPushSubscription = {
    id: subId,
    endpoint: subJson.endpoint,
    expirationTime: subJson.expirationTime ?? null,
    keys: {
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
    },
    userEmail,
    device: getDeviceLabel(),
    updatedAt: new Date().toISOString(),
    enabled: true,
  };

  // Persist to Firestore so all server restarts retain this device
  try {
    await setDoc(doc(db, 'pushSubscriptions', subId), record, { merge: true });
  } catch (err) {
    console.warn('Firestore push subscription save notice:', err);
  }

  // Register on Express server
  try {
    const idToken = await currentUser.getIdToken();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        subscription: {
          endpoint: record.endpoint,
          expirationTime: record.expirationTime,
          keys: record.keys,
        },
        device: record.device,
      }),
    });
  } catch (err) {
    console.warn('Server push subscription sync notice:', err);
  }

  return true;
}

function attachServiceWorkerPushMessageListener() {
  if (swListenerAttached || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  swListenerAttached = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED' && event.data?.subscription) {
      void persistSubscriptionToCloudAndServer(event.data.subscription);
    }
  });
}

export const getBackgroundPushStatus = async (): Promise<BackgroundPushStatus> => {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    window.location.protocol === 'file:'
  ) {
    return {
      supported: false,
      permission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
      serviceWorkerReady: false,
      subscribed: false,
      endpoint: null,
      vapidAvailable: false,
    };
  }

  const publicKey = await fetchVapidPublicKey();
  let serviceWorkerReady = false;
  let subscribed = false;
  let endpoint: string | null = null;

  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (registration) {
      serviceWorkerReady = true;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        subscribed = true;
        endpoint = existing.endpoint;
        currentPushEndpoint = existing.endpoint;
      }
    }
  } catch {
    // ignore
  }

  return {
    supported: true,
    permission: Notification.permission,
    serviceWorkerReady,
    subscribed,
    endpoint,
    vapidAvailable: Boolean(publicKey),
  };
};

export const syncPushSubscription = async (
  userEmail?: string | null
): Promise<{ subscribed: boolean; endpoint?: string | null; reason?: string }> => {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    window.location.protocol === 'file:'
  ) {
    return { subscribed: false, reason: 'Web Push not supported in this runtime.' };
  }

  attachServiceWorkerPushMessageListener();

  if (Notification.permission !== 'granted') {
    return { subscribed: false, reason: 'Notification permission not granted.' };
  }

  try {
    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) {
      return { subscribed: false, reason: 'Push server VAPID key unavailable.' };
    }

    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!registration) {
      return { subscribed: false, reason: 'Service Worker not ready.' };
    }

    const appServerKey = urlBase64ToUint8Array(publicKey);
    let subscription = await registration.pushManager.getSubscription();

    // If browser has an old subscription with a different VAPID key, refresh it cleanly
    if (subscription?.options?.applicationServerKey) {
      const existingKey = new Uint8Array(subscription.options.applicationServerKey);
      if (!uint8ArraysEqual(existingKey, appServerKey)) {
        await subscription.unsubscribe().catch(() => {});
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
    }

    const subJson = subscription.toJSON();
    await persistSubscriptionToCloudAndServer(subJson, userEmail);
    return { subscribed: true, endpoint: subJson.endpoint || null };
  } catch (err: any) {
    console.warn('Push subscription setup notice:', err);
    return {
      subscribed: false,
      reason: err?.message || 'Could not register background push subscription.',
    };
  }
};

export const unsubscribePushNotifications = async (removeFromFirestore = true): Promise<void> => {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    const endpoint = subscription?.endpoint || currentPushEndpoint;

    if (endpoint && auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ endpoint }),
        });
      } catch {
        // ignore network errors during sign out
      }

      if (removeFromFirestore) {
        try {
          const subId = await hashEndpointId(endpoint);
          await deleteDoc(doc(db, 'pushSubscriptions', subId));
        } catch {
          // ignore
        }
      }
    }

    if (subscription) {
      await subscription.unsubscribe().catch(() => {});
    }
    currentPushEndpoint = null;
  } catch (err) {
    console.warn('Push unsubscribe notice:', err);
  }
};

export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    console.log('This browser does not support desktop notification');
    return false;
  }

  let granted = Notification.permission === 'granted';

  if (!granted && Notification.permission !== 'denied') {
    try {
      const permission = await Notification.requestPermission();
      granted = permission === 'granted';
    } catch (error) {
      console.warn('Notification permission error:', error);
      return false;
    }
  }

  if (granted) {
    void syncPushSubscription(auth.currentUser?.email);
  }

  return granted;
};

export const broadcastBackgroundPush = async (payload: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}): Promise<void> => {
  if (typeof window === 'undefined' || window.location.protocol === 'file:') return;
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  try {
    const idToken = await currentUser.getIdToken();
    let subs = cachedSubscriptions;
    if (subs.length === 0) {
      try {
        const snap = await getDocs(collection(db, 'pushSubscriptions'));
        subs = snap.docs.map((d) => ({ ...d.data(), id: d.id } as StoredPushSubscription));
        cachedSubscriptions = subs;
      } catch {
        // ignore if offline
      }
    }

    const res = await fetch('/api/push/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        notification: {
          title: payload.title,
          body: payload.body,
          tag: payload.tag,
          url: payload.url || '/',
        },
        excludeEndpoint: currentPushEndpoint,
        subscriptions: subs.filter((s) => s.enabled !== false),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.expiredEndpoints) && data.expiredEndpoints.length > 0) {
        for (const expired of data.expiredEndpoints) {
          const subId = await hashEndpointId(expired);
          await deleteDoc(doc(db, 'pushSubscriptions', subId)).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('Background push broadcast skipped:', err);
  }
};

export const sendTestBackgroundNotification = async (
  delaySeconds = 5
): Promise<{ ok: boolean; message: string }> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { ok: false, message: 'Please sign in first to test background notifications.' };
  }

  const granted = await requestNotificationPermission();
  if (!granted) {
    return { ok: false, message: 'Notification permission is blocked. Allow notifications in browser settings.' };
  }

  const syncResult = await syncPushSubscription(currentUser.email);
  if (!syncResult.subscribed) {
    return { ok: false, message: syncResult.reason || 'Device push subscription is not ready.' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return { ok: false, message: 'No active push subscription found on this device.' };
    }

    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        delaySeconds,
        title: 'SCC Trust Closed-App Test',
        body: 'Success! Notifications are arriving even while the app is closed.',
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: data?.error || 'Could not schedule test notification.' };
    }

    return {
      ok: true,
      message:
        delaySeconds > 0
          ? `Test notification scheduled in ${delaySeconds}s — close or minimize the app now to verify!`
          : 'Test background notification sent!',
    };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Failed to send test push notification.' };
  }
};

export const sendNotification = (title: string, options?: NotificationOptions) => {
  const notificationOptions = {
    icon: publicAsset('splash/mobile.jpg'),
    badge: publicAsset('notification-badge.png'),
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
    ...options,
  };

  // Try sending native notification via Service Worker ONLY IF permission has been explicitly granted
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => {
            if (Notification.permission === 'granted') {
              return registration.showNotification(title, notificationOptions);
            }
          })
          .catch((err) => {
            console.warn('Service Worker notification notice:', err);
            fallbackLegacyNotification(title, notificationOptions);
          });
      } else {
        fallbackLegacyNotification(title, notificationOptions);
      }
    }
  } catch (err) {
    console.warn('Native notification suppressed:', err);
  }

  // Always dispatch a custom event so the in-app toast listener can show it beautifully
  try {
    const event = new CustomEvent('app-notification', {
      detail: {
        title,
        body: options?.body || '',
        icon: publicAsset('splash/mobile.jpg'),
      },
    });
    window.dispatchEvent(event);
  } catch (error) {
    console.error('Custom event dispatch failed:', error);
  }
};

const fallbackLegacyNotification = (title: string, options?: NotificationOptions) => {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, options);
    }
  } catch (error) {
    console.warn('Desktop notification legacy constructor failed:', error);
  }
};
