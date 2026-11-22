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
  isMobile: boolean;
  isStandalone: boolean;
  isNativeCapacitor: boolean;
  iosNeedsHomeScreen: boolean;
  deviceLabel: string;
  reason?: string;
}

let currentPushEndpoint: string | null = null;
let cachedSubscriptions: StoredPushSubscription[] = [];
let swListenerAttached = false;
let syncInFlightPromise: Promise<{ subscribed: boolean; endpoint?: string | null; reason?: string }> | null = null;

export const setKnownPushSubscriptions = (subs: StoredPushSubscription[]) => {
  cachedSubscriptions = Array.isArray(subs) ? subs : [];
};

export const getKnownPushSubscriptions = () => cachedSubscriptions;

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

export function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Mobile (Android)';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Mobile (iOS)';
  if (/Mobi/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

function getRuntimeFlags() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isMobile: false,
      isStandalone: false,
      isNativeCapacitor: false,
      iosNeedsHomeScreen: false,
    };
  }
  const ua = navigator.userAgent || '';
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isNativeCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());
  return {
    isMobile,
    isStandalone,
    isNativeCapacitor,
    iosNeedsHomeScreen: isIOS && !isStandalone,
  };
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    let reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) {
      reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    }
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    const readyReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return readyReg || reg;
  } catch (err) {
    console.warn('Service Worker readiness check error:', err);
    return null;
  }
}

async function fetchVapidPublicKey(): Promise<string | null> {
  if (typeof window === 'undefined' || window.location.protocol === 'file:') {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
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

  try {
    await setDoc(doc(db, 'pushSubscriptions', subId), record, { merge: true });
  } catch (err) {
    console.warn('Firestore push subscription save notice:', err);
  }

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
  const flags = getRuntimeFlags();
  const deviceLabel = getDeviceLabel();

  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    window.location.protocol === 'file:' ||
    flags.isNativeCapacitor
  ) {
    let reason = 'Web Push is not supported in this browser.';
    if (flags.isNativeCapacitor) {
      reason = 'Android APK WebView cannot receive background Web Push; open the app in Chrome (Install App) for closed-app alerts.';
    } else if (flags.iosNeedsHomeScreen) {
      reason = 'On iPhone/iPad, tap Share -> Add to Home Screen first to enable closed-app alerts.';
    }
    return {
      supported: false,
      permission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
      serviceWorkerReady: false,
      subscribed: false,
      endpoint: null,
      vapidAvailable: false,
      deviceLabel,
      reason,
      ...flags,
    };
  }

  const publicKey = await fetchVapidPublicKey();
  const registration = await getReadyServiceWorkerRegistration();
  let serviceWorkerReady = false;
  let subscribed = false;
  let endpoint: string | null = null;

  if (registration) {
    serviceWorkerReady = true;
    try {
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        subscribed = true;
        endpoint = existing.endpoint;
        currentPushEndpoint = existing.endpoint;
      }
    } catch {
      // ignore
    }
  }

  let reason: string | undefined;
  if (!publicKey) {
    reason = 'Push server API unavailable on this URL (requires Node server hosting).';
  } else if (!serviceWorkerReady) {
    reason = 'Service Worker is still activating — tap Register This Device.';
  } else if (Notification.permission === 'denied') {
    reason = 'Notifications are blocked in your browser site settings.';
  } else if (Notification.permission !== 'granted') {
    reason = 'Notification permission not allowed yet.';
  } else if (!subscribed) {
    reason = 'Permission allowed, but this device is not subscribed yet.';
  }

  return {
    supported: true,
    permission: Notification.permission,
    serviceWorkerReady,
    subscribed,
    endpoint,
    vapidAvailable: Boolean(publicKey),
    deviceLabel,
    reason,
    ...flags,
  };
};

export const syncPushSubscription = async (
  userEmail?: string | null
): Promise<{ subscribed: boolean; endpoint?: string | null; reason?: string }> => {
  if (syncInFlightPromise) {
    return syncInFlightPromise;
  }

  syncInFlightPromise = (async () => {
    const flags = getRuntimeFlags();

    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      window.location.protocol === 'file:' ||
      flags.isNativeCapacitor
    ) {
      return {
        subscribed: false,
        reason: flags.iosNeedsHomeScreen
          ? 'On iPhone/iPad, use Share -> Add to Home Screen first.'
          : flags.isNativeCapacitor
            ? 'Open the web app in Chrome (Install App) for closed-app Web Push.'
            : 'Web Push is not supported in this runtime.',
      };
    }

    attachServiceWorkerPushMessageListener();

    if (Notification.permission !== 'granted') {
      return { subscribed: false, reason: 'Notification permission not granted.' };
    }

    try {
      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) {
        return { subscribed: false, reason: 'Push server VAPID key unavailable on this host.' };
      }

      const registration = await getReadyServiceWorkerRegistration();
      if (!registration) {
        return { subscribed: false, reason: 'Service Worker could not activate. Reload the page and try again.' };
      }

      const appServerKey = urlBase64ToUint8Array(publicKey);
      let subscription = await registration.pushManager.getSubscription();

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
    } finally {
      syncInFlightPromise = null;
    }
  })();

  return syncInFlightPromise;
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
    await syncPushSubscription(auth.currentUser?.email);
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
  delaySeconds = 5,
  scope: 'self' | 'all' = 'self'
): Promise<{ ok: boolean; message: string }> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { ok: false, message: 'Please sign in first to test background notifications.' };
  }

  let subJson: PushSubscriptionJSON | undefined;
  if (scope === 'self') {
    const granted = await requestNotificationPermission();
    if (!granted) {
      return { ok: false, message: 'Notification permission is blocked. Allow notifications in browser settings.' };
    }

    const syncResult = await syncPushSubscription(currentUser.email);
    if (!syncResult.subscribed) {
      return { ok: false, message: syncResult.reason || 'Device push subscription is not ready.' };
    }

    const registration = await getReadyServiceWorkerRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) {
      return { ok: false, message: 'No active push subscription found on this device.' };
    }
    subJson = subscription.toJSON();
  }

  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        subscription: subJson,
        subscriptions: cachedSubscriptions.filter((s) => s.enabled !== false),
        scope,
        device: getDeviceLabel(),
        delaySeconds,
        title: 'SCC Trust Closed-App Test',
        body: 'Success! Notifications are arriving even while the app is closed.',
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: data?.error || 'Could not schedule test notification.' };
    }

    if (delaySeconds > 0) {
      return {
        ok: true,
        message: `Scheduled for ${data?.targetCount || 1} device(s) in ${delaySeconds}s — close/minimize the app now!`,
      };
    }

    if (data?.sent === 0 && data?.failed > 0) {
      return {
        ok: false,
        message: 'Push server failed to deliver to FCM. Re-register this device and verify VAPID keys.',
      };
    }

    return {
      ok: true,
      message: `Delivered to ${data?.sent ?? 1} device(s)!`,
    };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Failed to send test push notification.' };
  }
};

export const sendNotification = (title: string, options?: NotificationOptions) => {
  const notificationOptions = {
    icon: publicAsset('icon-192.png'),
    badge: publicAsset('notification-badge-72.png'),
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
        icon: publicAsset('icon-192.png'),
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
