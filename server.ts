import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import type { Request, Response } from 'express';

const require = createRequire(import.meta.url);
const webPush = require('web-push') as typeof import('web-push');

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface StoredPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userEmail?: string;
  device?: string;
  updatedAt?: string;
}

interface NotificationPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  icon?: string;
  badge?: string;
}

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const VAPID_FILE = path.join(ROOT_DIR, '.vapid-keys.json');
const SUBSCRIPTIONS_FILE = path.join(ROOT_DIR, '.push-subscriptions.json');
const FIREBASE_CONFIG_FILE = path.join(ROOT_DIR, 'firebase-applet-config.json');

function loadFirebaseProjectId(): string {
  try {
    const raw = fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.projectId === 'string' && parsed.projectId.trim()) {
      return parsed.projectId.trim();
    }
  } catch (err) {
    console.warn('Could not read firebase-applet-config.json:', err);
  }
  return process.env.FIREBASE_PROJECT_ID || 'coupon-sale-tracker';
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();

function loadOrCreateVapidKeys(): VapidKeys {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();

  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate };
  }

  try {
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
      if (typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string') {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    }
  } catch (err) {
    console.warn('Failed reading cached VAPID keys, regenerating:', err);
  }

  const generated = webPush.generateVAPIDKeys();
  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(generated, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('Could not persist generated VAPID keys to disk:', err);
  }
  return generated;
}

const vapidKeys = loadOrCreateVapidKeys();
webPush.setVapidDetails(
  'mailto:ignitina2@gmail.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Persistent subscription store backed by local JSON file
const subscriptionStore = new Map<string, StoredPushSubscription>();

function loadSubscriptionsFromDisk() {
  try {
    if (!fs.existsSync(SUBSCRIPTIONS_FILE)) return;
    const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      for (const item of list) {
        if (isValidPushSubscription(item)) {
          subscriptionStore.set(item.endpoint, item);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to load push subscriptions from disk:', err);
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersistSubscriptions() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      const list = Array.from(subscriptionStore.values());
      await fsPromises.writeFile(SUBSCRIPTIONS_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
    } catch (err) {
      console.warn('Could not persist push subscriptions:', err);
    }
  }, 150);
}

function isValidEndpointUrl(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isValidPushSubscription(sub: any): sub is StoredPushSubscription {
  return Boolean(
    sub &&
    typeof sub.endpoint === 'string' &&
    sub.endpoint.length > 10 &&
    sub.endpoint.length <= 2048 &&
    isValidEndpointUrl(sub.endpoint) &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    sub.keys.p256dh.length > 10 &&
    typeof sub.keys.auth === 'string' &&
    sub.keys.auth.length > 5
  );
}

loadSubscriptionsFromDisk();

// Google X.509 certificate cache for verifying Firebase Auth ID tokens (no IAM required)
let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase Auth public certs: HTTP ${resp.status}`);
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  certsExpiresAt = Date.now() + maxAgeSec * 1000;
  return cachedCerts;
}

function decodeBase64Url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

async function verifyFirebaseIdToken(token: string): Promise<{ uid: string; email: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(decodeBase64Url(headerB64).toString('utf-8'));
  const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf-8'));

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Invalid token algorithm or key ID');
  }

  let certs = await getFirebasePublicCerts();
  let cert = certs[header.kid];
  if (!cert) {
    certsExpiresAt = 0;
    certs = await getFirebasePublicCerts();
    cert = certs[header.kid];
  }
  if (!cert) {
    throw new Error('Unknown signing key');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const isValidSig = verifier.verify(cert, decodeBase64Url(sigB64));
  if (!isValidSig) {
    throw new Error('Invalid token signature');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Token expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Token issued in the future');
  }
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error('Token audience mismatch');
  }
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error('Token issuer mismatch');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Missing subject');
  }
  if (typeof payload.email !== 'string' || !payload.email || payload.email_verified !== true) {
    throw new Error('Verified email required');
  }

  return { uid: payload.sub, email: payload.email.toLowerCase().trim() };
}

async function requireAuth(req: Request): Promise<{ uid: string; email: string } | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    return await verifyFirebaseIdToken(token);
  } catch (err) {
    console.warn('Auth verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function dispatchWebPush(
  targets: StoredPushSubscription[],
  notification: NotificationPayload
): Promise<{ sent: number; failed: number; expiredEndpoints: string[] }> {
  const payloadStr = JSON.stringify({
    title: String(notification.title || 'SCC Trust Alert').slice(0, 120),
    body: String(notification.body || 'New update recorded').slice(0, 280),
    tag: notification.tag ? String(notification.tag).slice(0, 100) : `scc-${Date.now()}`,
    url: typeof notification.url === 'string' && notification.url.startsWith('/') ? notification.url : '/',
    icon: notification.icon || '/icon-192.png',
    badge: notification.badge || '/notification-badge-72.png',
    timestamp: Date.now(),
  });

  let sent = 0;
  let failed = 0;
  const expiredEndpoints: string[] = [];

  await Promise.all(
    targets.map(async (sub) => {
      try {
        const res = await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime ?? null,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          payloadStr,
          {
            TTL: 60 * 60 * 12, // 12 hours delivery window while phone is offline/asleep
            urgency: 'high',
          }
        );
        sent += 1;
        console.log(`[Push] Delivered (${res?.statusCode || 201}) to ${sub.device || 'Browser'} (${sub.userEmail || 'user'})`);
      } catch (err: any) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
          subscriptionStore.delete(sub.endpoint);
          console.warn(`[Push] Removed expired endpoint (${statusCode}) for ${sub.device || 'Browser'}`);
        } else {
          failed += 1;
          console.warn('[Push] Delivery failed:', statusCode || err?.message || err, err?.body || '');
        }
      }
    })
  );

  if (expiredEndpoints.length > 0) {
    schedulePersistSubscriptions();
  }

  return { sent, failed, expiredEndpoints };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      pushReady: true,
      subscriptionCount: subscriptionStore.size,
    });
  });

  // Public VAPID key endpoint for browser PushManager.subscribe
  app.get('/api/push/vapid-public-key', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ publicKey: vapidKeys.publicKey });
  });

  // Register/refresh a device Web Push subscription
  app.post('/api/push/subscribe', async (req: Request, res: Response) => {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { subscription, device } = req.body || {};
    if (!isValidPushSubscription(subscription)) {
      res.status(400).json({ error: 'Invalid push subscription payload' });
      return;
    }

    const entry: StoredPushSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      userEmail: authUser.email,
      device: typeof device === 'string' ? device.slice(0, 40) : 'Browser',
      updatedAt: new Date().toISOString(),
    };

    subscriptionStore.set(entry.endpoint, entry);
    schedulePersistSubscriptions();

    res.json({ ok: true, count: subscriptionStore.size });
  });

  // Remove a device Web Push subscription (on opt-out or sign-out)
  app.post('/api/push/unsubscribe', async (req: Request, res: Response) => {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const endpoint = req.body?.endpoint;
    if (typeof endpoint === 'string' && subscriptionStore.has(endpoint)) {
      subscriptionStore.delete(endpoint);
      schedulePersistSubscriptions();
    }

    res.json({ ok: true });
  });

  // Broadcast notification to all registered devices (excluding sender's current device endpoint)
  app.post('/api/push/notify', async (req: Request, res: Response) => {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { notification, excludeEndpoint, subscriptions } = req.body || {};
    if (!notification || typeof notification.title !== 'string') {
      res.status(400).json({ error: 'Notification title required' });
      return;
    }

    // Merge any Firestore-backed active subscriptions passed from authenticated client
    if (Array.isArray(subscriptions)) {
      for (const candidate of subscriptions.slice(0, 100)) {
        if (isValidPushSubscription(candidate)) {
          subscriptionStore.set(candidate.endpoint, {
            endpoint: candidate.endpoint,
            expirationTime: candidate.expirationTime ?? null,
            keys: candidate.keys,
            userEmail: candidate.userEmail,
            device: candidate.device,
            updatedAt: candidate.updatedAt || new Date().toISOString(),
          });
        }
      }
      schedulePersistSubscriptions();
    }

    const targets = Array.from(subscriptionStore.values()).filter((sub) => {
      if (typeof excludeEndpoint === 'string' && excludeEndpoint && sub.endpoint === excludeEndpoint) {
        return false;
      }
      return true;
    });

    if (targets.length === 0) {
      res.json({ ok: true, sent: 0, failed: 0, expiredEndpoints: [] });
      return;
    }

    const result = await dispatchWebPush(targets, notification);
    res.json({ ok: true, ...result });
  });

  // Delayed or immediate test push so user can close the app and verify background delivery
  app.post('/api/push/test', async (req: Request, res: Response) => {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { subscription, subscriptions, delaySeconds = 0, scope = 'self', device, title, body } = req.body || {};
    const clampedDelay = Math.max(0, Math.min(15, Number(delaySeconds) || 0));

    if (Array.isArray(subscriptions)) {
      for (const candidate of subscriptions.slice(0, 100)) {
        if (isValidPushSubscription(candidate)) {
          subscriptionStore.set(candidate.endpoint, {
            endpoint: candidate.endpoint,
            expirationTime: candidate.expirationTime ?? null,
            keys: candidate.keys,
            userEmail: candidate.userEmail || authUser.email,
            device: candidate.device,
            updatedAt: candidate.updatedAt || new Date().toISOString(),
          });
        }
      }
    }

    if (isValidPushSubscription(subscription)) {
      const existing = subscriptionStore.get(subscription.endpoint);
      subscriptionStore.set(subscription.endpoint, {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: subscription.keys,
        userEmail: authUser.email,
        device: typeof device === 'string' ? device.slice(0, 40) : existing?.device,
        updatedAt: new Date().toISOString(),
      });
      schedulePersistSubscriptions();
    }

    let targets: StoredPushSubscription[] = [];
    if (scope === 'all') {
      targets = Array.from(subscriptionStore.values());
    } else if (isValidPushSubscription(subscription)) {
      const stored = subscriptionStore.get(subscription.endpoint);
      targets = [stored || subscription];
    } else {
      targets = Array.from(subscriptionStore.values()).filter(
        (s) => s.userEmail === authUser.email
      );
    }

    if (targets.length === 0) {
      res.status(400).json({ error: 'No active push subscription found for this device.' });
      return;
    }

    const payload: NotificationPayload = {
      title: typeof title === 'string' && title.trim() ? title.trim() : 'SCC Trust Background Alert',
      body:
        typeof body === 'string' && body.trim()
          ? body.trim()
          : 'Background notifications are active! Alerts will arrive even when the app is closed.',
      tag: `scc-test-${Date.now()}`,
      url: '/',
    };

    if (clampedDelay > 0) {
      setTimeout(() => {
        void dispatchWebPush(targets, payload);
      }, clampedDelay * 1000);
      res.json({ ok: true, scheduledInSeconds: clampedDelay, targetCount: targets.length });
      return;
    }

    const result = await dispatchWebPush(targets, payload);
    res.json({ ok: true, targetCount: targets.length, ...result });
  });

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(ROOT_DIR, 'dist', 'index.html'));

  // Always serve Service Worker cleanly without caching
  app.get('/sw.js', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    const swPath = isProd
      ? path.join(ROOT_DIR, 'dist', 'sw.js')
      : path.join(ROOT_DIR, 'public', 'sw.js');
    res.sendFile(swPath);
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
