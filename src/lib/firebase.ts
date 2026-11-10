import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager, 
  getFirestore,
  memoryLocalCache,
  waitForPendingWrites
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics, isSupported } from 'firebase/analytics';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Analytics if supported in the current environment
export let analytics: any = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {});
}

// Initialize Firestore with robust try-catch fallback and long polling enabled
let firestoreDb;
const dbId = (firebaseConfig as any).firestoreDatabaseId || '(default)';

try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    }),
    experimentalForceLongPolling: true
  }, dbId);
} catch (error) {
  console.warn("Firestore persistent local cache failed to initialize, falling back to memory cache:", error);
  try {
    firestoreDb = initializeFirestore(app, {
      localCache: memoryLocalCache(),
      experimentalForceLongPolling: true
    }, dbId);
  } catch (err2) {
    // If already initialized, fetch the existing instance
    firestoreDb = getFirestore(app, dbId);
  }
}

export const db = firestoreDb;

export async function commitFirestoreWrite(write: Promise<unknown>, path: string): Promise<void> {
  try {
    await write;
    // Non-blocking sync wait: wait at most 500ms for server ack, then let background sync proceed
    // This prevents the UI from freezing or requiring an app refresh
    await Promise.race([
      waitForPendingWrites(db),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  } catch (error) {
    console.error(`Firestore write failed for ${path}:`, error);
    throw error;
  }
}

// Initialize Authentication and Storage
export const auth = getAuth(app);
export const storage = getStorage(app);

// 1. Standard authentication provider with NO sensitive scopes.
// This allows ANY permitted team member or admin to sign in without being blocked by Error 403 (unverified app / test user).
export const authGoogleProvider = new GoogleAuthProvider();
export const googleProvider = authGoogleProvider; // Backward compatibility alias

// 2. Specialized provider with Google Drive & Google Sheets scopes.
// Used when connecting or authorizing Drive / Sheets live sync
export const driveGoogleProvider = new GoogleAuthProvider();
driveGoogleProvider.addScope('https://www.googleapis.com/auth/drive');
driveGoogleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');

// In-memory access token caching (never stored in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

export const getCachedAccessToken = (): string | null => {
  return cachedAccessToken;
};


// Standard handleFirestoreError implementation conforming to the security rules checklist
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

