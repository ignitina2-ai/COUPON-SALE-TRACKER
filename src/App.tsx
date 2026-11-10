/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Menu, X, Cloud, CloudOff, AlertCircle, CheckCircle, Bell, BellRing, Loader2, LogOut } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import TransactionForm from './components/TransactionForm';
import TransactionList from './components/TransactionList';
import CreditManagement from './components/CreditManagement';
import SponsorsList from './components/SponsorsList';
import PrizeCollection from './components/PrizeCollection';
import PrizeCollectionSettings from './components/PrizeCollectionSettings';
import IncomeExpenseManagement from './components/IncomeExpenseManagement';
import TreasuryHandoverManagement from './components/TreasuryHandoverManagement';
import Settings from './components/Settings';
import LoginPage from './components/LoginPage';
import { SplashComponent } from './components/SplashComponent';
import { useActiveResponsiveLogo } from './lib/logo-resolver';
import { 
  AppData, 
  Transaction, 
  Sponsor, 
  IncomeExpense, 
  CreditSettings, 
  SecretaryHandover, 
  PaymentMethod, 
  DEFAULT_PAYMENT_LABELS, 
  CustomPaymentMethod, 
  getDefaultPaymentMethodsList 
} from './types';
import { cn } from './lib/utils';
import { sendNotification, requestNotificationPermission } from './lib/notifications';

// Firebase core modules and standard handlers
import { 
  auth, 
  db, 
  authGoogleProvider,
  driveGoogleProvider,
  googleProvider, 
  OperationType, 
  handleFirestoreError,
  commitFirestoreWrite,
  setCachedAccessToken,
  getCachedAccessToken
} from './lib/firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  getDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { signOut, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { AllowedUser } from './components/settings/AdminSettings';
import { 
  recordTransactionAndBackupToDrive, 
  recordOrUpdateTransactionInSheet,
  saveBackupJsonToDrive, 
  syncAllTransactionsToSheet, 
  getOrCreateDriveFolder, 
  getOrCreateCouponSheet,
  syncViaWebhook,
  DriveSyncConfig,
  DEFAULT_WEBHOOK_URL,
  TARGET_DRIVE_EMAIL,
  FOLDER_NAME,
  SHEET_NAME,
  WORKSPACE_SCOPES
} from './lib/googleDriveSheets';

const STORAGE_KEY = 'coupon_sale_app_data_2026';
const ALLOWED_USERS_KEY = 'coupon_sale_allowed_users_2026';

const DEFAULT_CREDIT_SETTINGS: CreditSettings = {
  reminderEmailTemplate: "Hi {name},\n\nThis is a friendly reminder regarding your outstanding balance of ₹{amount} for the coupons purchased on {date}.\n\nPlease clear the balance at your earliest convenience.\n\nThank you!",
  reminderSMSTemplate: "Hi {name}, reminder for outstanding balance of ₹{amount} for coupons purchased on {date}. Please clear it soon. Thank you!",
  overdueThresholds: [7, 15, 30]
};

export default function App() {
  const [activeTab, setActiveTab ] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 768 : false));
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);

  // Auth and sync statuses
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUser[]>(() => {
    try {
      const saved = localStorage.getItem(ALLOWED_USERS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(() => getCachedAccessToken());
  const [isDriveAutoSyncEnabled, setIsDriveAutoSyncEnabled] = useState(true);
  const [driveSyncConfig, setDriveSyncConfig] = useState<DriveSyncConfig>(() => {
    let cachedUrl = DEFAULT_WEBHOOK_URL;
    try {
      const local = localStorage.getItem('cached_gas_webhook_url');
      if (local && local.trim()) {
        cachedUrl = local.trim();
      }
    } catch (e) {}
    return {
      autoSyncEnabled: true,
      webhookUrl: cachedUrl,
    };
  });

  const [userPermissions, setUserPermissions] = useState({
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canShareReport: true,
    hideIncomeExpense: false,
    hideSecretaryHandover: false,
  });

  const isPrimaryAdminEmail = (email?: string | null) => {
    const e = email?.toLowerCase().trim();
    return e === 'ignitina2@gmail.com';
  };

  const isPrimaryAdmin = isPrimaryAdminEmail(user?.email);

  // Expose setActiveTab on window for sub-components to trigger tab switches easily
  useEffect(() => {
    (window as any).setActiveTab = (tab: string) => {
      setActiveTab(tab);
    };
    return () => {
      delete (window as any).setActiveTab;
    };
  }, []);

  // State model
  const [appData, setAppData] = useState<AppData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
          sponsors: Array.isArray(parsed.sponsors) ? parsed.sponsors : [],
          incomeExpenses: Array.isArray(parsed.incomeExpenses) ? parsed.incomeExpenses : [],
          secretaryHandovers: Array.isArray(parsed.secretaryHandovers) ? parsed.secretaryHandovers : [],
          logo: parsed.logo || '',
          logoMobile: parsed.logoMobile || '',
          logoDesktop: parsed.logoDesktop || '',
          notificationsEnabled: !!parsed.notificationsEnabled,
          creditSettings: parsed.creditSettings || DEFAULT_CREDIT_SETTINGS,
          customPaymentLabels: parsed.customPaymentLabels || DEFAULT_PAYMENT_LABELS,
          paymentMethodsList: parsed.paymentMethodsList || (getDefaultPaymentMethodsList ? getDefaultPaymentMethodsList() : [])
        };
      }
    } catch (e) {
      console.warn("Could not load appData from localStorage cache:", e);
    }
    return {
      transactions: [],
      sponsors: [],
      incomeExpenses: [],
      secretaryHandovers: [],
      logo: '',
      logoMobile: '',
      logoDesktop: '',
      notificationsEnabled: false,
      creditSettings: DEFAULT_CREDIT_SETTINGS,
      customPaymentLabels: DEFAULT_PAYMENT_LABELS,
      paymentMethodsList: getDefaultPaymentMethodsList ? getDefaultPaymentMethodsList() : []
    };
  });

  // Automatically persist appData changes to localStorage so existing data is NEVER lost during updates or reloads
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
      console.warn("Could not persist appData to localStorage cache:", e);
    }
  }, [appData]);

  // Persist allowedUsers changes to localStorage
  useEffect(() => {
    try {
      if (allowedUsers.length > 0) {
        localStorage.setItem(ALLOWED_USERS_KEY, JSON.stringify(allowedUsers));
      }
    } catch (e) {
      console.warn("Could not persist allowedUsers to localStorage:", e);
    }
  }, [allowedUsers]);

  const [showSplash, setShowSplash] = useState(true);
  const { resolvedLogo } = useActiveResponsiveLogo(appData);

  const notificationsEnabledRef = React.useRef(appData.notificationsEnabled);
  useEffect(() => {
    notificationsEnabledRef.current = appData.notificationsEnabled;
  }, [appData.notificationsEnabled]);

  // Real-time Toast Notifications
  const [activeToast, setActiveToast] = useState<{ id: number; title: string; body: string; icon?: string } | null>(null);

  useEffect(() => {
    const handleNotificationEvent = (e: any) => {
      const { title, body, icon } = e.detail || {};
      if (title) {
        setActiveToast({
          id: Date.now(),
          title,
          body: body || '',
          icon: icon || '/splash/mobile.jpg',
        });
      }
    };
    window.addEventListener('app-notification', handleNotificationEvent);
    return () => window.removeEventListener('app-notification', handleNotificationEvent);
  }, []);

  useEffect(() => {
    if (activeToast) {
      const timer = setTimeout(() => {
        setActiveToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeToast]);

  // Synchronize browser favicon and PWA touch icons to the active resolved logo
  useEffect(() => {
    if (resolvedLogo) {
      const iconLink = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      if (iconLink) {
        iconLink.href = resolvedLogo;
      }
      const appleTouchLink = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
      if (appleTouchLink) {
        appleTouchLink.href = resolvedLogo;
      }
    }
  }, [resolvedLogo]);

  // Helper to register active session in firestore
  const registerActiveSession = async (firebaseUser: any, userEmail: string, userName: string) => {
    try {
      let tabSessionId = sessionStorage.getItem('app_session_id');
      if (!tabSessionId) {
        tabSessionId = `session_${firebaseUser.uid}_${Date.now()}`;
        sessionStorage.setItem('app_session_id', tabSessionId);
      }
      await setDoc(doc(db, 'activeSessions', tabSessionId), {
        id: tabSessionId,
        uid: firebaseUser.uid,
        email: userEmail,
        displayName: userName,
        photoURL: firebaseUser.photoURL || '',
        lastActive: new Date().toISOString(),
        userAgent: navigator.userAgent,
        device: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop'
      }, { merge: true });
    } catch (err) {
      console.warn("Could not register active session:", err);
    }
  };

  // Authenticated state listener
  useEffect(() => {
    let activeSubscriptions: (() => void)[] = [];

    const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
      // Clean up previous snapshots
      activeSubscriptions.forEach((unsub) => unsub());
      activeSubscriptions = [];

      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const email = firebaseUser.email?.toLowerCase().trim() || '';

      // Direct access for primary trust administrator
      if (email === 'ignitina2@gmail.com') {
        const dName = firebaseUser.displayName || 'Primary Administrator';
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: dName,
          photoURL: firebaseUser.photoURL || '',
          isLocal: false,
        });
        setUserPermissions({
          canAdd: true,
          canEdit: true,
          canDelete: true,
          canShareReport: true,
          hideIncomeExpense: false,
          hideSecretaryHandover: false,
        });
        setLoading(false);
        setupDbSyncs(true);
        registerActiveSession(firebaseUser, email, dName);
        return;
      }

      // Check allowedUsers whitelist registry for helper sub-users
      try {
        const emailLower = email.toLowerCase().trim();
        let snapshot = await getDoc(doc(db, 'allowedUsers', emailLower));
        if (!snapshot.exists() && email !== emailLower) {
          snapshot = await getDoc(doc(db, 'allowedUsers', email));
        }

        // Collection query fallback in case doc ID differs from normalized email
        if (!snapshot.exists()) {
          try {
            const allUsersSnap = await getDocs(collection(db, 'allowedUsers'));
            const matchingDoc = allUsersSnap.docs.find(d => {
              const dEmail = (d.data().email || d.id || '').toLowerCase().trim();
              return dEmail === emailLower;
            });
            if (matchingDoc) {
              snapshot = matchingDoc as any;
            }
          } catch (e) {
            console.warn("Could not query all allowedUsers:", e);
          }
        }

        let schema: AllowedUser | null = null;
        if (snapshot.exists()) {
          schema = snapshot.data() as AllowedUser;
        } else {
          // Check local cached allowedUsers as an offline/lag fallback
          const localUser = allowedUsers.find(u => u.email.toLowerCase().trim() === emailLower);
          if (localUser) {
            schema = localUser;
            // Also write to cloud Firestore so it is stored remotely
            setDoc(doc(db, 'allowedUsers', emailLower), cleanUndefined(localUser), { merge: true }).catch(console.warn);
          }
        }

        const isUserActive = schema && (schema.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

        if (schema && isUserActive) {
          const dName = firebaseUser.displayName || schema.role || 'Authorized Helper';
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: dName,
            photoURL: firebaseUser.photoURL || '',
            isLocal: false,
            role: schema.role,
          });
          setUserPermissions({
            canAdd: schema.canAdd !== false,
            canEdit: schema.canEdit !== false,
            canDelete: schema.canDelete === true,
            canShareReport: schema.canShareReport !== false,
            hideIncomeExpense: !!schema.hideIncomeExpense,
            hideSecretaryHandover: !!schema.hideSecretaryHandover,
          });
          setLoading(false);
          setupDbSyncs(false);
          registerActiveSession(firebaseUser, email, dName);
        } else {
          setLoginError(`Google account ${email} is not listed in the authorized registry helpers list. Please contact ignitina2@gmail.com to request access.`);
          await signOut(auth);
          setUser(null);
          setLoading(false);
        }
      } catch (err) {
        console.error("Helper whitelist check failed:", err);
        setLoginError("Could not connect to verify system permissions. Please check your internet connection.");
        await signOut(auth);
        setUser(null);
        setLoading(false);
      }
    });

    // Setup real-time listeners across multi-tabs
    function setupDbSyncs(isAdmin: boolean) {
      // Helper to clear error when sync is success
      const clearErrorOnSuccess = () => {
        setFirestoreError(null);
      };

      const handleSyncError = (category: string, err: any) => {
        console.warn(`${category} sync notice:`, err);
        const msg = err?.message || String(err);
        if (err?.code === 'permission-denied') {
          setFirestoreError(`${category}: Permission denied. Please verify your account access.`);
        } else if (!err?.code || (err.code !== 'unavailable' && !msg.includes('offline') && !msg.includes('Backend didn\'t respond'))) {
          setFirestoreError(`${category}: ${msg}`);
        }
      };

      const refreshCollections = async () => {
        try {
          const [transactionsSnap, sponsorsSnap, incomeExpensesSnap, handoversSnap] = await Promise.all([
            getDocs(collection(db, 'transactions')),
            getDocs(collection(db, 'sponsors')),
            getDocs(collection(db, 'incomeExpenses')),
            getDocs(collection(db, 'secretaryHandovers')),
          ]);

          setAppData(prev => ({
            ...prev,
            transactions: transactionsSnap.docs.map(item => ({ ...item.data(), id: item.id } as Transaction)),
            sponsors: sponsorsSnap.docs.map(item => ({ ...item.data(), id: item.id } as Sponsor)),
            incomeExpenses: incomeExpensesSnap.docs.map(item => ({ ...item.data(), id: item.id } as IncomeExpense)),
            secretaryHandovers: handoversSnap.docs.map(item => ({ ...item.data(), id: item.id } as SecretaryHandover)),
          }));
          clearErrorOnSuccess();
        } catch (error) {
          console.warn('Initial Firestore collections load notice:', error);
        }
      };

      // Flags to avoid showing notifications for existing cache/server items on initial loading
      let isInitialTransactions = true;
      let isInitialSponsors = true;
      let isInitialIncomeExpenses = true;
      let isInitialHandovers = true;

      // 1. Transactions Listener (Real-time sync across all devices)
      const unsubTransactions = onSnapshot(collection(db, 'transactions'), (snap) => {
        const list: Transaction[] = [];
        snap.forEach(doc => {
          list.push({ ...doc.data(), id: doc.id } as any);
        });

        // Trigger remote-addition alerts for real-time multi-device notifications
        if (!isInitialTransactions && notificationsEnabledRef.current) {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const docData = change.doc.data() as Transaction;
              const hasPendingWrites = change.doc.metadata.hasPendingWrites;
              if (!hasPendingWrites) {
                sendNotification('New Transaction Added', {
                  body: `${docData.name} - ₹${docData.totalAmount.toLocaleString('en-IN')}`,
                });
              }
            }
          });
        }

        // Only auto-seed if this is the very first connection and Firestore is completely empty
        if (isInitialTransactions) {
          isInitialTransactions = false;
          setAppData(prev => {
            if (list.length === 0 && prev.transactions.length > 0 && isAdmin) {
              prev.transactions.forEach(t => {
                setDoc(doc(db, 'transactions', t.id), cleanUndefined(t), { merge: true }).catch(console.warn);
              });
              return prev;
            }
            return { ...prev, transactions: list };
          });
        } else {
          // On all subsequent updates (including deletes), Firestore server is the authoritative state
          setAppData(prev => ({ ...prev, transactions: list }));
        }

        clearErrorOnSuccess();
      }, (err) => {
        handleSyncError("Transactions", err);
      });
      activeSubscriptions.push(unsubTransactions);

      // 2. Sponsors Listener
      const unsubSponsors = onSnapshot(collection(db, 'sponsors'), (snap) => {
        const list: Sponsor[] = [];
        snap.forEach(doc => {
          list.push({ ...doc.data(), id: doc.id } as any);
        });

        if (!isInitialSponsors && notificationsEnabledRef.current) {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const docData = change.doc.data() as Sponsor;
              const hasPendingWrites = change.doc.metadata.hasPendingWrites;
              if (!hasPendingWrites) {
                sendNotification('New Sponsor Added', {
                  body: `${docData.name} - ₹${docData.amount.toLocaleString('en-IN')}`,
                });
              }
            }
          });
        }

        if (isInitialSponsors) {
          isInitialSponsors = false;
          setAppData(prev => {
            if (list.length === 0 && prev.sponsors.length > 0 && isAdmin) {
              prev.sponsors.forEach(s => {
                setDoc(doc(db, 'sponsors', s.id), cleanUndefined(s), { merge: true }).catch(console.warn);
              });
              return prev;
            }
            return { ...prev, sponsors: list };
          });
        } else {
          setAppData(prev => ({ ...prev, sponsors: list }));
        }

        clearErrorOnSuccess();
      }, (err) => {
        handleSyncError("Sponsors", err);
      });
      activeSubscriptions.push(unsubSponsors);

      // 3. Income & Expenses Listener
      const unsubIncomeExpenses = onSnapshot(collection(db, 'incomeExpenses'), (snap) => {
        const list: IncomeExpense[] = [];
        snap.forEach(doc => {
          list.push({ ...doc.data(), id: doc.id } as any);
        });

        if (!isInitialIncomeExpenses && notificationsEnabledRef.current) {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const docData = change.doc.data() as IncomeExpense;
              const hasPendingWrites = change.doc.metadata.hasPendingWrites;
              if (!hasPendingWrites) {
                const typeStr = (docData.type || 'income').toLowerCase();
                const typeProper = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);
                sendNotification(`New ${typeProper} Added`, {
                  body: `${docData.description} - ₹${docData.amount.toLocaleString('en-IN')}`,
                });
              }
            }
          });
        }

        if (isInitialIncomeExpenses) {
          isInitialIncomeExpenses = false;
          setAppData(prev => {
            if (list.length === 0 && prev.incomeExpenses.length > 0 && isAdmin) {
              prev.incomeExpenses.forEach(ie => {
                setDoc(doc(db, 'incomeExpenses', ie.id), cleanUndefined(ie), { merge: true }).catch(console.warn);
              });
              return prev;
            }
            return { ...prev, incomeExpenses: list };
          });
        } else {
          setAppData(prev => ({ ...prev, incomeExpenses: list }));
        }

        clearErrorOnSuccess();
      }, (err) => {
        handleSyncError("Income/Expenses", err);
      });
      activeSubscriptions.push(unsubIncomeExpenses);

      // 4. Secretary Handovers Listener
      const unsubHandovers = onSnapshot(collection(db, 'secretaryHandovers'), (snap) => {
        const list: SecretaryHandover[] = [];
        snap.forEach(doc => {
          list.push({ ...doc.data(), id: doc.id } as any);
        });

        if (!isInitialHandovers && notificationsEnabledRef.current) {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const docData = change.doc.data() as SecretaryHandover;
              const hasPendingWrites = change.doc.metadata.hasPendingWrites;
              if (!hasPendingWrites) {
                sendNotification('Cash Handed Over', {
                  body: `${docData.name} - ₹${docData.amount.toLocaleString('en-IN')}`,
                });
              }
            }
          });
        }

        if (isInitialHandovers) {
          isInitialHandovers = false;
          setAppData(prev => {
            if (list.length === 0 && prev.secretaryHandovers.length > 0 && isAdmin) {
              prev.secretaryHandovers.forEach(sh => {
                setDoc(doc(db, 'secretaryHandovers', sh.id), cleanUndefined(sh), { merge: true }).catch(console.warn);
              });
              return prev;
            }
            return { ...prev, secretaryHandovers: list };
          });
        } else {
          setAppData(prev => ({ ...prev, secretaryHandovers: list }));
        }

        clearErrorOnSuccess();
      }, (err) => {
        handleSyncError("Handovers", err);
      });
      activeSubscriptions.push(unsubHandovers);

      // 5. Whitelisted Users Listener
      const currentUserEmail = auth.currentUser?.email?.toLowerCase().trim() || '';
      if (isAdmin) {
        const unsubAllowedUsers = onSnapshot(collection(db, 'allowedUsers'), (snap) => {
          if (!snap.empty) {
            const list = snap.docs.map(userDoc => ({
              email: userDoc.id,
              ...userDoc.data()
            } as AllowedUser));
            setAllowedUsers(list);
            try {
              localStorage.setItem(ALLOWED_USERS_KEY, JSON.stringify(list));
            } catch (e) {}
          } else {
            // Push any locally cached allowed users to Cloud Firestore so newly invited helpers can log in on all devices
            setAllowedUsers(prev => {
              if (prev.length > 0) {
                prev.forEach(u => {
                  const uid = u.email.toLowerCase().trim();
                  setDoc(doc(db, 'allowedUsers', uid), cleanUndefined(u), { merge: true }).catch(console.warn);
                });
              }
              return prev;
            });
          }
          clearErrorOnSuccess();
        }, (err) => {
          handleSyncError("Allowed Users", err);
        });
        activeSubscriptions.push(unsubAllowedUsers);
      } else if (currentUserEmail) {
        const unsubCurrentAllowedUser = onSnapshot(doc(db, 'allowedUsers', currentUserEmail), (snap) => {
          const schema = snap.exists() ? (snap.data() as AllowedUser) : null;
          const isUserActive = schema && (schema.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
          if (!schema || !isUserActive) {
            setLoginError(`Your account is not active in the authorized registry. Please contact ignitina2@gmail.com.`);
            signOut(auth);
            setUser(null);
            return;
          }

          const currentUserDoc = schema;
          setUserPermissions({
            canAdd: currentUserDoc.canAdd !== false,
            canEdit: currentUserDoc.canEdit !== false,
            canDelete: currentUserDoc.canDelete === true,
            canShareReport: currentUserDoc.canShareReport !== false,
            hideIncomeExpense: !!currentUserDoc.hideIncomeExpense,
            hideSecretaryHandover: !!currentUserDoc.hideSecretaryHandover,
          });
          clearErrorOnSuccess();
        }, (err) => {
          handleSyncError("User permissions sync", err);
        });
        activeSubscriptions.push(unsubCurrentAllowedUser);
      }

      void refreshCollections();

      // 5.5 Active Sessions Listener
      const unsubActiveSessions = onSnapshot(collection(db, 'activeSessions'), (snap) => {
        const list: any[] = [];
        snap.forEach(doc => {
          list.push({ ...doc.data(), id: doc.id });
        });
        // Sort sessions by latest active first
        list.sort((a, b) => new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime());
        setActiveSessions(list);
        clearErrorOnSuccess();
      }, (err) => {
        handleSyncError("Active Sessions", err);
      });
      activeSubscriptions.push(unsubActiveSessions);

      // 6. Global Branding Settings Listener
      const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setAppData(prev => ({
            ...prev,
            logo: d.logo || '',
            logoMobile: d.logoMobile || '',
            logoDesktop: d.logoDesktop || '',
            notificationsEnabled: !!d.notificationsEnabled,
            creditSettings: d.creditSettings || DEFAULT_CREDIT_SETTINGS,
            customPaymentLabels: d.customPaymentLabels || DEFAULT_PAYMENT_LABELS,
            paymentMethodsList: d.paymentMethodsList || prev.paymentMethodsList
          }));
        }
        clearErrorOnSuccess();
      }, (err) => {
        handleSyncError("Global Settings", err);
      });
      activeSubscriptions.push(unsubSettings);

      // 7. Shared Google Drive & Sheets Sync Config Listener
      const unsubDriveConfig = onSnapshot(doc(db, 'settings', 'driveSyncConfig'), (snap) => {
        if (snap.exists()) {
          const d = snap.data() as DriveSyncConfig;
          const isOldWebhook = !d.webhookUrl || 
            d.webhookUrl.includes('AKfycbyH12BF9zsSX5guESELutMdbmEUPKXvjQL3sZDq01ayQ1nFukzua3bfaGns1Jdo-J_X') ||
            d.webhookUrl.includes('AKfycbwo4Eu7L0TU85LkEsyLfoql81bY_amPwtfn0djqgttXt7PXu0fbdd76Kutr8dHtB0A7jw') ||
            d.webhookUrl.includes('AKfycbxpjHYoRfno3ank4ChMO0f4lDm_muJMU3ESw8q3ugJZdqt4tBrN7D3CH1AmfxcGYqwZ');
          const activeWebhook = isOldWebhook ? DEFAULT_WEBHOOK_URL : d.webhookUrl;
          const merged: DriveSyncConfig = {
            ...d,
            webhookUrl: activeWebhook,
          };
          setDriveSyncConfig(merged);
          if (d.webhookUrl !== activeWebhook) {
            setDoc(doc(db, 'settings', 'driveSyncConfig'), {
              webhookUrl: DEFAULT_WEBHOOK_URL,
              autoSyncEnabled: true,
            }, { merge: true }).catch(console.warn);
          }
          if (d.activeAccessToken) {
            setDriveAccessToken(d.activeAccessToken);
            setCachedAccessToken(d.activeAccessToken);
          }
          if (d.autoSyncEnabled !== undefined) {
            setIsDriveAutoSyncEnabled(d.autoSyncEnabled);
          }
        } else {
          // Initialize in Firestore with the default webhook URL so all team devices sync automatically
          setDoc(doc(db, 'settings', 'driveSyncConfig'), {
            webhookUrl: DEFAULT_WEBHOOK_URL,
            autoSyncEnabled: true,
            lastSyncedAt: new Date().toISOString(),
            lastSyncStatus: 'success',
            lastSyncMessage: 'Initialized with official Trust webhook'
          }, { merge: true }).catch(console.warn);
        }
      }, (err) => {
        console.warn("Drive config sync notice:", err);
      });
      activeSubscriptions.push(unsubDriveConfig);
    }

    return () => {
      unsubscribeAuth();
      activeSubscriptions.forEach((unsub) => unsub());
    };
  }, []);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      // Standard auth provider without sensitive scopes.
      // This allows ANY permitted team member or admin to sign in without being blocked by Error 403 (unverified app / test user).
      await signInWithPopup(auth, authGoogleProvider);
    } catch (err: any) {
      console.error('Google sign-in failed:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        // quiet
      } else if (err.code === 'auth/popup-blocked') {
        setLoginError('Google sign-in popup was blocked. Allow popups for this site and try again.');
      } else if (err.code === 'auth/unauthorized-domain' || (err.message && err.message.includes('unauthorized-domain'))) {
        setLoginError(`Firebase: Error (auth/unauthorized-domain). Add "${window.location.hostname}" under Firebase Console > Authentication > Settings > Authorized domains.`);
      } else if (err.code === 'auth/operation-not-allowed') {
        setLoginError('Google sign-in is disabled. Enable the Google provider under Firebase Console > Authentication > Sign-in method.');
      } else if (err.code === 'auth/account-exists-with-different-credential') {
        setLoginError('This email is already linked to another sign-in method in Firebase.');
      } else if (err.code === 'auth/network-request-failed') {
        setLoginError('Network request failed while contacting Firebase. Check your connection and try again.');
      } else {
        setLoginError(`Google sign-in failed${err.code ? ` (${err.code})` : ''}: ${err.message || 'Unknown Firebase error.'}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleConnectDrive = async () => {
    try {
      setLoginError(null);
      const result = await signInWithPopup(auth, driveGoogleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        const token = credential.accessToken;
        setCachedAccessToken(token);
        setDriveAccessToken(token);

        // Pre-create/verify target Google Drive folder and spreadsheet
        const folder = await getOrCreateDriveFolder(token);
        const sheet = await getOrCreateCouponSheet(token, folder.id);

        const newConfig: Partial<DriveSyncConfig> = {
          activeAccessToken: token,
          tokenUpdatedAt: new Date().toISOString(),
          connectedEmail: result.user.email,
          folderId: folder.id,
          folderLink: folder.webViewLink,
          sheetId: sheet.id,
          sheetLink: sheet.webViewLink,
          autoSyncEnabled: true,
          lastSyncedAt: new Date().toISOString(),
          lastSyncedBy: result.user.email || 'Admin',
          lastSyncStatus: 'success',
          lastSyncMessage: 'Drive & Sheets initialized successfully',
        };

        // Save to shared Firestore settings so ALL permitted team members can sync!
        await setDoc(doc(db, 'settings', 'driveSyncConfig'), cleanUndefined(newConfig), { merge: true });
        setDriveSyncConfig(prev => ({ ...prev, ...newConfig }));
      }
    } catch (err: any) {
      console.error("Drive connection error:", err);
      if (
        err.code === 'auth/access_denied' ||
        (err.message && (
          err.message.includes('access_denied') ||
          err.message.includes('verification process') ||
          err.message.includes('developer-approved testers')
        ))
      ) {
        setLoginError("Google Error 403 (access_denied): The app is in Testing mode. In Google Cloud Console (Project coupon-sale-tracker), go to OAuth consent screen > Test users > add ignitina2@gmail.com and save.");
      } else if (err.code !== 'auth/popup-closed-by-user') {
        setLoginError(err.message || 'Failed to connect Google Drive.');
      }
    }
  };

  const handleUpdateDriveSyncConfig = async (partialConfig: Partial<DriveSyncConfig>) => {
    // 1. Immediately update local React state (0ms latency)
    setDriveSyncConfig(prev => ({ ...prev, ...partialConfig }));
    if (partialConfig.webhookUrl) {
      try {
        localStorage.setItem('cached_gas_webhook_url', partialConfig.webhookUrl);
      } catch (e) {}
    }

    // 2. Persist to Firestore with a fast timeout race so UI never gets stuck on Saving
    try {
      const savePromise = setDoc(doc(db, 'settings', 'driveSyncConfig'), cleanUndefined(partialConfig), { merge: true });
      await Promise.race([
        savePromise,
        new Promise(resolve => setTimeout(resolve, 800))
      ]);
    } catch (err) {
      console.warn("Background update driveSyncConfig warning:", err);
    }
  };

  const handleGoogleLogout = async () => {
    try {
      // 1. Immediately reset React state so UI displays LoginPage instantly
      setUser(null);
      setCachedAccessToken(null);
      setDriveAccessToken(null);
      setIsSidebarOpen(false);
      setLoginError(null);

      // 2. Remove session ID and remove activeSessions in Firestore without blocking UI
      const tabSessionId = sessionStorage.getItem('app_session_id');
      sessionStorage.removeItem('app_session_id');
      if (tabSessionId) {
        deleteDoc(doc(db, 'activeSessions', tabSessionId)).catch(err => {
          console.warn("Could not delete active session on logout:", err);
        });
      }

      // 3. Complete Firebase Auth sign out
      await signOut(auth);
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  // Administration whitelisting controllers
  const handleAddAllowedUser = async (email: string, role: AllowedUser['role'], perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean }) => {
    const emailId = email.toLowerCase().trim();
    try {
      const newAllowedUser: AllowedUser = {
        email: emailId,
        role,
        status: 'ACTIVE',
        canAdd: perms.canAdd,
        canEdit: perms.canEdit,
        canDelete: perms.canDelete,
        addedAt: new Date().toISOString(),
        addedBy: user?.email || 'ignitina2@gmail.com'
      };

      // Optimistically update React state immediately so adding subsequent users requires NO app refresh!
      setAllowedUsers(prev => {
        const filtered = prev.filter(u => u.email.toLowerCase() !== emailId);
        return [newAllowedUser, ...filtered];
      });

      await commitFirestoreWrite(
        setDoc(doc(db, 'allowedUsers', emailId), newAllowedUser, { merge: true }),
        `allowedUsers/${emailId}`
      );
    } catch (err) {
      console.error("Add user error:", err);
      throw err;
    }
  };

  const handleDeleteAllowedUser = async (email: string) => {
    const emailId = email.toLowerCase().trim();
    try {
      setAllowedUsers(prev => prev.filter(u => u.email.toLowerCase() !== emailId));
      await commitFirestoreWrite(
        deleteDoc(doc(db, 'allowedUsers', emailId)),
        `allowedUsers/${emailId}`
      );
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const handleToggleAllowedUserDisabled = async (email: string, currentStatus: AllowedUser['status']) => {
    const emailId = email.toLowerCase().trim();
    const nextStatus = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      setAllowedUsers(prev => prev.map(u => u.email.toLowerCase() === emailId ? { ...u, status: nextStatus } : u));
      await commitFirestoreWrite(
        updateDoc(doc(db, 'allowedUsers', emailId), {
          status: nextStatus
        }),
        `allowedUsers/${emailId}`
      );
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const handleUpdateAllowedUserPermission = async (email: string, field: 'canAdd' | 'canEdit' | 'canDelete' | 'canShareReport' | 'hideIncomeExpense' | 'hideSecretaryHandover', value: boolean) => {
    const emailId = email.toLowerCase().trim();
    try {
      setAllowedUsers(prev => prev.map(u => u.email.toLowerCase() === emailId ? { ...u, [field]: value } : u));
      await commitFirestoreWrite(
        updateDoc(doc(db, 'allowedUsers', emailId), {
          [field]: value
        }),
        `allowedUsers/${emailId}`
      );
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const handleForceSyncLocalToCloud = async (): Promise<boolean> => {
    // Multi-collection cloud database synchronization with 4.5s timeout guarantee (NEVER hangs)
    try {
      const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 4500));

      // 1. Push settings/global to Firestore
      const globalDocRef = doc(db, 'settings', 'global');
      const pushSettings = setDoc(globalDocRef, cleanUndefined({
        logo: appData.logo || '',
        logoMobile: appData.logoMobile || '',
        logoDesktop: appData.logoDesktop || '',
        notificationsEnabled: appData.notificationsEnabled,
        creditSettings: appData.creditSettings || DEFAULT_CREDIT_SETTINGS,
        customPaymentLabels: appData.customPaymentLabels || DEFAULT_PAYMENT_LABELS,
        paymentMethodsList: appData.paymentMethodsList || []
      }), { merge: true }).catch(console.warn);

      // 2. Push any local transactions to Firestore so no sales are lost
      const pushTransactions = (async () => {
        if (appData.transactions && appData.transactions.length > 0) {
          const batch = writeBatch(db);
          appData.transactions.slice(0, 450).forEach(tx => {
            batch.set(doc(db, 'transactions', tx.id), cleanUndefined(tx), { merge: true });
          });
          await batch.commit().catch(console.warn);
        }
      })();

      // 3. Trigger Google Sheet full sync via Webhook
      const webhookUrl = (driveSyncConfig.webhookUrl || DEFAULT_WEBHOOK_URL).trim();
      const pushSheet = (async () => {
        if (webhookUrl && appData.transactions && appData.transactions.length > 0) {
          await syncViaWebhook(webhookUrl, {
            action: 'syncAll',
            transactions: appData.transactions,
            fullBackup: appData,
            syncBackup: true,
          }).catch(console.warn);
        }
      })();

      await Promise.race([
        Promise.all([pushSettings, pushTransactions, pushSheet]),
        timeoutPromise
      ]);

      // 4. Refresh latest snapshots from Firestore server
      const fetchPromise = Promise.all([
        getDocs(collection(db, 'transactions')).catch(() => null),
        getDocs(collection(db, 'sponsors')).catch(() => null),
        getDocs(collection(db, 'incomeExpenses')).catch(() => null),
        getDocs(collection(db, 'secretaryHandovers')).catch(() => null),
        getDoc(doc(db, 'prizeCollection', 'state')).catch(() => null)
      ]);

      const [txSnap, spSnap, ieSnap, shSnap, prizeSnap] = await Promise.race([
        fetchPromise,
        timeoutPromise.then(() => [null, null, null, null, null])
      ]);

      // 5. Update appData with fresh server records if retrieved
      setAppData(prev => {
        let transactions = prev.transactions;
        let sponsors = prev.sponsors;
        let incomeExpenses = prev.incomeExpenses;
        let secretaryHandovers = prev.secretaryHandovers;

        if (txSnap) {
          transactions = txSnap.docs.map(d => ({ ...d.data(), id: d.id } as any));
        }
        if (spSnap) {
          sponsors = spSnap.docs.map(d => ({ ...d.data(), id: d.id } as any));
        }
        if (ieSnap) {
          incomeExpenses = ieSnap.docs.map(d => ({ ...d.data(), id: d.id } as any));
        }
        if (shSnap) {
          secretaryHandovers = shSnap.docs.map(d => ({ ...d.data(), id: d.id } as any));
        }

        return {
          ...prev,
          transactions,
          sponsors,
          incomeExpenses,
          secretaryHandovers
        };
      });

      // 6. Update prize collection in localStorage if cloud has data
      if (prizeSnap && prizeSnap.exists()) {
        const pData = prizeSnap.data();
        if (pData?.tracking && Object.keys(pData.tracking).length > 0) {
          try {
            localStorage.setItem('stCasimirLuckyDraw2026_tracking', JSON.stringify(pData.tracking));
            const colMap: Record<string, boolean> = {};
            Object.keys(pData.tracking).forEach(k => {
              const s = pData.tracking[k]?.status;
              colMap[k] = (s === 'SPONSOR' || s === 'TRUST');
            });
            localStorage.setItem('stCasimirLuckyDraw2026_collected', JSON.stringify(colMap));
            localStorage.setItem('luckyDrawCollectedPrizesV11', JSON.stringify(colMap));
          } catch (e) {}
        }
        if (Array.isArray(pData?.receivedAmounts)) {
          try {
            localStorage.setItem('stCasimirLuckyDraw2026_receivedAmounts', JSON.stringify(pData.receivedAmounts));
          } catch (e) {}
        }
      }

      return true;
    } catch (err) {
      console.warn("Force sync completed with safe fallback:", err);
      return true;
    }
  };

  useEffect(() => {
    const checkNotificationPermission = async () => {
      if ('Notification' in window && Notification.permission === 'default') {
        setShowNotificationPrompt(true);
      }
    };
    checkNotificationPermission();
  }, []);

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      toggleNotifications(true);
    }
    setShowNotificationPrompt(false);
  };

  const generateSafeId = (): string => {
    if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
      try {
        return window.crypto.randomUUID();
      } catch (e) {
        // fallback
      }
    }
    // High-entropy unique ID fallback
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        result += '-';
      }
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const cleanUndefined = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(cleanUndefined);
    }
    const clean: any = {};
    for (const key of Object.keys(obj)) {
      if (obj[key] !== undefined) {
        clean[key] = cleanUndefined(obj[key]);
      }
    }
    return clean;
  };

  // Automated live sync to Google Drive & Google Sheet for ANY permitted team member (Non-blocking background)
  const syncTransactionToDriveAndSheet = (
    action: 'add' | 'update' | 'delete',
    tx: Transaction,
    currentAppData: AppData
  ) => {
    // Run completely in background without blocking UI
    setTimeout(() => {
      // 1. Direct Webhook sync (Google Apps Script) - ALWAYS triggers to guarantee Google Sheet updates
      const webhookUrl = (driveSyncConfig.webhookUrl || DEFAULT_WEBHOOK_URL).trim();
      if (webhookUrl) {
        syncViaWebhook(webhookUrl, {
          action,
          transaction: tx,
          transactions: action === 'delete' ? currentAppData.transactions : [tx],
          syncBackup: false,
        }).then(res => {
          if (res.success) {
            setDriveSyncConfig(prev => ({
              ...prev,
              lastSyncedAt: new Date().toISOString(),
              lastSyncedBy: user?.email || 'Authorized Team Member',
              lastSyncStatus: 'success',
              lastSyncMessage: `Transaction ${tx.id || ''} saved to Sheet`,
            }));
          }
        }).catch(err => {
          console.warn("Webhook transaction sync warning:", err);
        });
      }

      // 2. Direct Google Sheets REST API if direct token is active
      const token = getCachedAccessToken() || driveAccessToken || driveSyncConfig.activeAccessToken;
      if (token) {
        if (action === 'delete') {
          syncAllTransactionsToSheet(token, currentAppData.transactions).catch(console.warn);
        } else {
          recordOrUpdateTransactionInSheet(token, tx).catch(console.warn);
        }
      }
    }, 10);
  };

  // 100% Instant optimistic transaction creation + background cloud sync (0ms latency for user)
  const addTransaction = async (transaction: Omit<Transaction, 'id'>) => {
    if (!userPermissions.canAdd) {
      setFirestoreError("നിങ്ങൾക്ക് ഡാറ്റ ചേർക്കാൻ (Add) അനുവാദമില്ല! (You do not have permission to add transactions.)");
      return;
    }
    const transactionId = generateSafeId();
    const docData: Transaction = {
      ...transaction,
      id: transactionId,
    };

    // 1. Instant Optimistic UI Update (0ms delay)
    const updatedList = [docData, ...appData.transactions.filter(t => t.id !== transactionId)];
    setAppData(prev => ({
      ...prev,
      transactions: updatedList
    }));

    if (appData.notificationsEnabled) {
      sendNotification('New Transaction Added', {
        body: `${docData.name} - ₹${docData.totalAmount.toLocaleString('en-IN')}`,
      });
    }

    // 2. Background Firestore write
    commitFirestoreWrite(
      setDoc(doc(db, 'transactions', transactionId), cleanUndefined(docData)),
      `transactions/${transactionId}`
    ).catch(err => {
      setFirestoreError(`Transaction sync failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 3. Background non-blocking Google Drive & Google Sheet sync
    syncTransactionToDriveAndSheet('add', docData, { ...appData, transactions: updatedList });
  };

  const updateTransaction = async (id: string, updates: Partial<Transaction>) => {
    if (!userPermissions.canEdit) {
      setFirestoreError("നിങ്ങൾക്ക് ഡാറ്റ എഡിറ്റ് ചെയ്യാൻ അനുവാദമില്ല! (You do not have permission to edit transactions.)");
      return;
    }

    // 1. Instant Optimistic UI Update (0ms delay)
    let updatedTx: Transaction | null = null;
    setAppData(prev => {
      const existing = prev.transactions.find(t => t.id === id);
      if (!existing) return prev;
      updatedTx = { ...existing, ...updates };
      return {
        ...prev,
        transactions: prev.transactions.map(t => t.id === id ? updatedTx! : t)
      };
    });

    // 2. Background Firestore update
    commitFirestoreWrite(
      updateDoc(doc(db, 'transactions', id), cleanUndefined(updates)),
      `transactions/${id}`
    ).catch(err => {
      setFirestoreError(`Transaction sync failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 3. Background Google Drive & Sheet sync
    if (updatedTx) {
      const updatedList = appData.transactions.map(t => t.id === id ? updatedTx! : t);
      syncTransactionToDriveAndSheet('update', updatedTx, { ...appData, transactions: updatedList });
    }
  };

  const deleteTransaction = async (ids: string[]) => {
    if (!userPermissions.canDelete) {
      setFirestoreError("You do not have permission to delete Transactions.");
      return;
    }
    if (!ids || ids.length === 0) return;

    // 1. Instant Optimistic UI Update
    const remainingTx = appData.transactions.filter(t => !ids.includes(t.id));
    setAppData(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => !ids.includes(t.id))
    }));

    // Update localStorage immediately so deleted items are removed from cache
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.transactions = remainingTx;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.warn("Could not update localStorage on delete:", e);
    }

    // 2. Direct Cloud Firestore delete
    for (const id of ids) {
      try {
        await commitFirestoreWrite(
          deleteDoc(doc(db, 'transactions', id)),
          `transactions/${id}`
        );
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `transactions/${id}`);
      }
    }

    // 3. Background Google Drive & Sheet sync
    syncTransactionToDriveAndSheet('delete', { id: ids[0] } as any, { ...appData, transactions: remainingTx });
  };

  const toggleTreasurer = async (id: string) => {
    if (!userPermissions.canEdit) {
      setFirestoreError("നിങ്ങൾക്ക് ട്രഷറർ ഫീൽഡ് മാറ്റാൻ അനുവാദമില്ല! (You do not have permission to edit transactions.)");
      return;
    }
    const tx = appData.transactions.find(t => t.id === id);
    if (!tx) return;

    const paidToTreasurer = !tx.paidToTreasurer;
    const treasurerPaidDate = paidToTreasurer ? new Date().toISOString() : null;

    const updatedTx: Transaction = {
      ...tx,
      paidToTreasurer,
      treasurerPaidDate
    };

    // 1. Instant Optimistic UI Update
    setAppData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => t.id === id ? updatedTx : t)
    }));

    // 2. Background Firestore update
    commitFirestoreWrite(
      updateDoc(doc(db, 'transactions', id), cleanUndefined({
        paidToTreasurer,
        treasurerPaidDate
      })),
      `transactions/${id}`
    ).catch(err => {
      setFirestoreError(`Transaction sync failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 3. Background Google Drive & Sheet sync
    const updatedList = appData.transactions.map(t => t.id === id ? updatedTx : t);
    syncTransactionToDriveAndSheet('update', updatedTx, { ...appData, transactions: updatedList });
  };

  const addSponsor = async (sponsor: Omit<Sponsor, 'id'>) => {
    if (!userPermissions.canAdd) {
      setFirestoreError("നിങ്ങൾക്ക് സ്പോൺസർ ചേർക്കാൻ അനുവാദമില്ല! (You do not have permission to add sponsors.)");
      return;
    }
    const sponsorId = generateSafeId();
    const docData: Sponsor = {
      ...sponsor,
      id: sponsorId,
    };

    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'sponsors', sponsorId), cleanUndefined(docData)),
        `sponsors/${sponsorId}`
      );

      if (appData.notificationsEnabled) {
        sendNotification('New Sponsor Added', {
          body: `${docData.name} - ₹${docData.amount.toLocaleString('en-IN')}`,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `sponsors/${sponsorId}`);
    }
  };

  const updateSponsor = async (id: string, updates: Partial<Sponsor>) => {
    if (!userPermissions.canEdit) {
      setFirestoreError("നിങ്ങൾക്ക് സ്പോൺസർ എഡിറ്റ് ചെയ്യാൻ അനുവാദമില്ല! (You do not have permission to edit sponsors.)");
      return;
    }
    const oldSponsor = appData.sponsors.find(s => s.id === id);
    try {
      await commitFirestoreWrite(
        updateDoc(doc(db, 'sponsors', id), cleanUndefined(updates)),
        `sponsors/${id}`
      );

      if (appData.notificationsEnabled && updates.status === 'COLLECTED' && oldSponsor?.status !== 'COLLECTED') {
        sendNotification('Sponsor Payment Collected', {
          body: `${oldSponsor?.name} - ₹${oldSponsor?.amount.toLocaleString('en-IN')}`,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `sponsors/${id}`);
    }
  };

  const deleteSponsor = async (id: string) => {
    if (!userPermissions.canDelete) {
      setFirestoreError("നിങ്ങൾക്ക് ഡാറ്റ ഇല്ലാതാക്കാൻ (Delete) അനുവാദമില്ല! (You do not have permission to delete Sponsors.)");
      return;
    }
    try {
      await commitFirestoreWrite(
        deleteDoc(doc(db, 'sponsors', id)),
        `sponsors/${id}`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `sponsors/${id}`);
    }
  };

  const addIncomeExpense = async (entry: Omit<IncomeExpense, 'id'>) => {
    if (!userPermissions.canAdd) {
      setFirestoreError("നിങ്ങൾക്ക് വരവ് ചിലവ് ചേർക്കാൻ അനുവാദമില്ല! (You do not have permission to add income/expense records.)");
      return;
    }
    const entryId = generateSafeId();
    const docData: IncomeExpense = {
      ...entry,
      id: entryId,
    };

    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'incomeExpenses', entryId), cleanUndefined(docData)),
        `incomeExpenses/${entryId}`
      );

      if (appData.notificationsEnabled) {
        sendNotification(`New ${docData.type.toLowerCase()} Added`, {
          body: `${docData.description} - ₹${docData.amount.toLocaleString('en-IN')}`,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `incomeExpenses/${entryId}`);
    }
  };

  const updateIncomeExpense = async (id: string, updates: Partial<IncomeExpense>) => {
    if (!userPermissions.canEdit) {
      setFirestoreError("നിങ്ങൾക്ക് വരവ് ചിലവ് എഡിറ്റ് ചെയ്യാൻ അനുവാദമില്ല! (You do not have permission to edit income/expense records.)");
      return;
    }
    try {
      await commitFirestoreWrite(
        updateDoc(doc(db, 'incomeExpenses', id), cleanUndefined(updates)),
        `incomeExpenses/${id}`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `incomeExpenses/${id}`);
    }
  };

  const deleteIncomeExpense = async (ids: string[]) => {
    if (!userPermissions.canDelete) {
      setFirestoreError("നിങ്ങൾക്ക് ഡാറ്റ ഇല്ലാതാക്കാൻ (Delete) അനുവാദമില്ല! (You do not have permission to delete Income/Expense records.)");
      return;
    }
    try {
      for (const id of ids) {
        await commitFirestoreWrite(
          deleteDoc(doc(db, 'incomeExpenses', id)),
          `incomeExpenses/${id}`
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `incomeExpenses/${ids.join(',')}`);
    }
  };

  const addSecretaryHandover = async (handover: Omit<SecretaryHandover, 'id'>) => {
    if (!userPermissions.canAdd) {
      setFirestoreError("നിങ്ങൾക്ക് ഹാൻഡ്ഓവർ ചേർക്കാൻ അനുവാദമില്ല! (You do not have permission to add secretary handover records.)");
      return;
    }
    const handoverId = generateSafeId();
    const docData: SecretaryHandover = {
      ...handover,
      id: handoverId,
    };

    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'secretaryHandovers', handoverId), cleanUndefined(docData)),
        `secretaryHandovers/${handoverId}`
      );

      if (appData.notificationsEnabled) {
        sendNotification('Cash Handed Over', {
          body: `${docData.name} - ₹${docData.amount.toLocaleString('en-IN')}`,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `secretaryHandovers/${handoverId}`);
    }
  };

  const updateSecretaryHandover = async (id: string, updates: Partial<SecretaryHandover>) => {
    if (!userPermissions.canEdit) {
      setFirestoreError("നിങ്ങൾക്ക് ഹാൻഡ്ഓവർ എഡിറ്റ് ചെയ്യാൻ അനുവാദമില്ല! (You do not have permission to edit secretary handover records.)");
      return;
    }
    try {
      await commitFirestoreWrite(
        updateDoc(doc(db, 'secretaryHandovers', id), cleanUndefined(updates)),
        `secretaryHandovers/${id}`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `secretaryHandovers/${id}`);
    }
  };

  const deleteSecretaryHandover = async (ids: string[]) => {
    if (!userPermissions.canDelete) {
      setFirestoreError("നിങ്ങൾക്ക് ഡാറ്റ ഇല്ലാതാക്കാൻ (Delete) അനുവാദമില്ല! (You do not have permission to delete Treasury Handover records.)");
      return;
    }
    try {
      for (const id of ids) {
        await commitFirestoreWrite(
          deleteDoc(doc(db, 'secretaryHandovers', id)),
          `secretaryHandovers/${id}`
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `secretaryHandovers/${ids.join(',')}`);
    }
  };

  const updateLogo = async (logo: string) => {
    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'settings', 'global'), { logo }, { merge: true }),
        'settings/global'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const updateLogoMobile = async (logoMobile: string) => {
    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'settings', 'global'), { logoMobile }, { merge: true }),
        'settings/global'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const updateLogoDesktop = async (logoDesktop: string) => {
    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'settings', 'global'), { logoDesktop }, { merge: true }),
        'settings/global'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const updateCreditSettings = async (settings: CreditSettings) => {
    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'settings', 'global'), { creditSettings: settings }, { merge: true }),
        'settings/global'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const updatePaymentLabels = async (labels: Record<PaymentMethod, string>) => {
    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'settings', 'global'), { customPaymentLabels: labels }, { merge: true }),
        'settings/global'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const updatePaymentMethodsList = async (list: CustomPaymentMethod[]) => {
    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'settings', 'global'), { paymentMethodsList: list }, { merge: true }),
        'settings/global'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const toggleNotifications = async (enabled: boolean) => {
    try {
      await commitFirestoreWrite(
        setDoc(doc(db, 'settings', 'global'), { notificationsEnabled: enabled }, { merge: true }),
        'settings/global'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const backupData = () => {
    const dataStr = JSON.stringify(appData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `coupon_app_backup_${new Date().toISOString().split('T')[0]}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const restoreData = async (data: AppData) => {
    try {
      const batch = writeBatch(db);
      
      // Upload transactions in bulk batch
      for (const tx of data.transactions) {
        batch.set(doc(db, 'transactions', tx.id), cleanUndefined(tx));
      }
      // Upload sponsors
      for (const sp of data.sponsors) {
        batch.set(doc(db, 'sponsors', sp.id), cleanUndefined(sp));
      }
      // Upload income expenses
      if (Array.isArray(data.incomeExpenses)) {
        for (const ie of data.incomeExpenses) {
          batch.set(doc(db, 'incomeExpenses', ie.id), cleanUndefined(ie));
        }
      }
      // Upload handovers
      if (Array.isArray(data.secretaryHandovers)) {
        for (const sh of data.secretaryHandovers) {
          batch.set(doc(db, 'secretaryHandovers', sh.id), cleanUndefined(sh));
        }
      }
      
      // Upload branding/settings
      batch.set(doc(db, 'settings', 'global'), {
        logo: data.logo || '',
        logoMobile: data.logoMobile || '',
        logoDesktop: data.logoDesktop || '',
        notificationsEnabled: !!data.notificationsEnabled,
        creditSettings: data.creditSettings || DEFAULT_CREDIT_SETTINGS,
        customPaymentLabels: data.customPaymentLabels || DEFAULT_PAYMENT_LABELS,
        paymentMethodsList: data.paymentMethodsList || []
      }, { merge: true });

      await batch.commit();
    } catch (err) {
      console.error("Bulk restoration failed:", err);
      alert("Failed to sync some imported backup records to Google cloud database.");
    }
  };

  const clearData = async () => {
    try {
      const batch = writeBatch(db);
      for (const tx of appData.transactions) {
        batch.delete(doc(db, 'transactions', tx.id));
      }
      for (const sp of appData.sponsors) {
        batch.delete(doc(db, 'sponsors', sp.id));
      }
      for (const ie of appData.incomeExpenses) {
        batch.delete(doc(db, 'incomeExpenses', ie.id));
      }
      for (const sh of appData.secretaryHandovers) {
        batch.delete(doc(db, 'secretaryHandovers', sh.id));
      }
      await batch.commit();
    } catch (e) {
      console.error(e);
    }
  };

  const renderContent = () => {
    const labels = appData.customPaymentLabels || DEFAULT_PAYMENT_LABELS;
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard 
                 transactions={appData.transactions} 
                 sponsors={appData.sponsors} 
                 incomeExpenses={appData.incomeExpenses} 
                 secretaryHandovers={appData.secretaryHandovers}
                 customPaymentLabels={labels}
                 paymentMethodsList={appData.paymentMethodsList}
                 onDeleteTransaction={deleteTransaction}
                 onToggleTreasurer={toggleTreasurer}
                 onEditTransaction={(t) => {
                   setEditingTransaction(t);
                   setTimeout(() => {
                     const element = document.getElementById('dashboard-add-sale-form-container');
                     if (element) {
                       element.scrollIntoView({ behavior: 'smooth' });
                     }
                   }, 100);
                 }}
                 onAddTransaction={addTransaction}
                 editingTransaction={editingTransaction}
                 onUpdateTransaction={(id, updates) => {
                   updateTransaction(id, updates);
                   setEditingTransaction(null);
                 }}
                 onCancelEdit={() => {
                   setEditingTransaction(null);
                 }}
                 permissions={userPermissions}
               />;
      case 'transactions':
        return (
          <TransactionList 
            transactions={appData.transactions} 
            onDelete={deleteTransaction}
            onToggleTreasurer={toggleTreasurer}
            onAddTransaction={addTransaction}
            onEdit={(t) => {
              setEditingTransaction(t);
              setActiveTab('dashboard');
              setTimeout(() => {
                const element = document.getElementById('dashboard-add-sale-form-container');
                if (element) {
                   element.scrollIntoView({ behavior: 'smooth' });
                }
              }, 100);
            }}
            customPaymentLabels={labels}
            permissions={userPermissions}
          />
        );
      case 'credit':
        return (
          <CreditManagement 
            transactions={appData.transactions} 
            onUpdateTransaction={updateTransaction}
            onEdit={(t) => {
              setEditingTransaction(t);
              setActiveTab('dashboard');
              setTimeout(() => {
                const element = document.getElementById('dashboard-add-sale-form-container');
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth' });
                }
              }, 100);
            }}
            onDelete={deleteTransaction}
            customPaymentLabels={labels}
            paymentMethodsList={appData.paymentMethodsList}
            permissions={userPermissions}
          />
        );
      case 'prize-collection':
        return <PrizeCollection setActiveTab={setActiveTab} />;
      case 'prize-settings':
        return <PrizeCollectionSettings setActiveTab={setActiveTab} />;
      case 'sponsors':
        return (
          <SponsorsList 
            sponsors={appData.sponsors} 
            onAddSponsor={addSponsor}
            onUpdateSponsor={updateSponsor}
            onDeleteSponsor={deleteSponsor}
            permissions={userPermissions}
          />
        );
      case 'income-expense':
        if (userPermissions.hideIncomeExpense) {
          return (
            <div className="p-8 text-center max-w-sm mx-auto mt-20 bg-white border border-slate-150 rounded-3xl shadow-lg shadow-slate-100/50 space-y-4 animate-in fade-in-50 slide-in-from-bottom-5 duration-300">
              <div className="mx-auto w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
                <AlertCircle size={22} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight font-sans">ലോഗിൻ തടഞ്ഞിരിക്കുന്നു (Access Denied)</h2>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider leading-relaxed">
                  ഈ പേജ് കാണാൻ നിങ്ങൾക്ക് അനുവാദമില്ല.
                  <span className="block mt-1 font-semibold text-xs border border-rose-100 bg-rose-50/30 py-1.5 px-3 rounded-xl normal-case text-rose-700 font-sans">You do not have permission to view the Income & Expense tab. Only your main admin can allow this.</span>
                </p>
              </div>
            </div>
          );
        }
        return (
          <IncomeExpenseManagement 
            entries={appData.incomeExpenses}
            onAddEntry={addIncomeExpense}
            onUpdateEntry={updateIncomeExpense}
            onDeleteEntry={deleteIncomeExpense}
            permissions={userPermissions}
          />
        );
      case 'secretary-handover':
        if (userPermissions.hideSecretaryHandover) {
          return (
            <div className="p-8 text-center max-w-sm mx-auto mt-20 bg-white border border-slate-150 rounded-3xl shadow-lg shadow-slate-100/50 space-y-4 animate-in fade-in-50 slide-in-from-bottom-5 duration-300">
              <div className="mx-auto w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
                <AlertCircle size={22} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight font-sans">ലോഗിൻ തടഞ്ഞിരിക്കുന്നു (Access Denied)</h2>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider leading-relaxed">
                  ഈ പേജ് കാണാൻ നിങ്ങൾക്ക് അനുവാദമില്ല.
                  <span className="block mt-1 font-semibold text-xs border border-rose-100 bg-rose-50/30 py-1.5 px-3 rounded-xl normal-case text-rose-700 font-sans">You do not have permission to view the Treasury Handover tab. Only your main admin can allow this.</span>
                </p>
              </div>
            </div>
          );
        }
        return (
          <TreasuryHandoverManagement 
            handovers={appData.secretaryHandovers}
            onAddHandover={addSecretaryHandover}
            onUpdateHandover={updateSecretaryHandover}
            onDeleteHandover={deleteSecretaryHandover}
            transactions={appData.transactions}
            paymentMethodsList={appData.paymentMethodsList}
            customPaymentLabels={labels}
            permissions={userPermissions}
          />
        );
      case 'settings':
        if (!isPrimaryAdmin) {
          return (
            <div className="p-8 text-center max-w-sm mx-auto mt-20 bg-white border border-slate-150 rounded-3xl shadow-lg shadow-slate-100/50 space-y-4 animate-in fade-in-50 slide-in-from-bottom-5 duration-300">
              <div className="mx-auto w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
                <AlertCircle size={22} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight font-sans">ലോഗിൻ തടഞ്ഞിരിക്കുന്നു (Access Denied)</h2>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider leading-relaxed">
                  സെറ്റിംഗ്സ് കാണാൻ നിങ്ങൾക്ക് അനുവാദമില്ല.
                  <span className="block mt-1 font-semibold text-xs border border-rose-100 bg-rose-50/30 py-1.5 px-3 rounded-xl normal-case text-rose-700 font-sans">Only the primary developer main administrator can access settings and backup controls.</span>
                </p>
              </div>
            </div>
          );
        }
        return (
          <Settings 
            appData={appData}
            onUpdateLogo={updateLogo}
            onUpdateLogoMobile={updateLogoMobile}
            onUpdateLogoDesktop={updateLogoDesktop}
            onBackup={backupData}
            onRestore={restoreData}
            onClearData={clearData}
            onToggleNotifications={toggleNotifications}
            onUpdatePaymentLabels={updatePaymentLabels}
            onUpdatePaymentMethodsList={updatePaymentMethodsList}
            user={user}
            allowedUsers={allowedUsers}
            onAddAllowedUser={handleAddAllowedUser}
            onDeleteAllowedUser={handleDeleteAllowedUser}
            onToggleAllowedUserDisabled={handleToggleAllowedUserDisabled}
            onUpdateAllowedUserPermission={handleUpdateAllowedUserPermission}
            onGoogleLogin={handleGoogleLogin}
            onGoogleLogout={handleGoogleLogout}
            onSyncLocalToCloud={handleForceSyncLocalToCloud}
            activeSessions={activeSessions}
            driveAccessToken={driveAccessToken}
            driveSyncConfig={driveSyncConfig}
            onUpdateDriveSyncConfig={handleUpdateDriveSyncConfig}
            onConnectDrive={handleConnectDrive}
            isDriveAutoSyncEnabled={isDriveAutoSyncEnabled}
            onToggleDriveAutoSync={(enabled) => {
              setIsDriveAutoSyncEnabled(enabled);
              handleUpdateDriveSyncConfig({ autoSyncEnabled: enabled });
            }}
          />
        );
      default:
        return <Dashboard 
                 transactions={appData.transactions} 
                 sponsors={appData.sponsors} 
                 incomeExpenses={appData.incomeExpenses} 
                 secretaryHandovers={appData.secretaryHandovers}
                 customPaymentLabels={labels}
                 paymentMethodsList={appData.paymentMethodsList}
                 onDeleteTransaction={deleteTransaction}
                 onToggleTreasurer={toggleTreasurer}
                 onEditTransaction={(t) => {
                   setEditingTransaction(t);
                   setTimeout(() => {
                     const element = document.getElementById('dashboard-add-sale-form-container');
                     if (element) {
                       element.scrollIntoView({ behavior: 'smooth' });
                     }
                   }, 100);
                 }}
                 onAddTransaction={addTransaction}
                 editingTransaction={editingTransaction}
                 onUpdateTransaction={(id, updates) => {
                   updateTransaction(id, updates);
                   setEditingTransaction(null);
                 }}
                 onCancelEdit={() => {
                   setEditingTransaction(null);
                 }}
                 permissions={userPermissions}
               />;
    }
  };

  if (showSplash) {
    return (
      <SplashComponent 
        onComplete={() => setShowSplash(false)} 
        appData={appData} 
      />
    );
  }

  // Loading state gate
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center font-sans text-white p-8">
        <div className="text-center space-y-6">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto" />
          <div className="space-y-1">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-200">Verifying Security Credentials</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Connecting to Firestore server security hub...</p>
          </div>
        </div>
      </div>
    );
  }

  // Security Login Gate block
  if (!user) {
    return (
      <LoginPage 
        onLoginSuccess={() => {}}
        isLoggingIn={isLoggingIn}
        setIsLoggingIn={setIsLoggingIn}
        loginError={loginError}
        setLoginError={setLoginError}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
        user={user}
        isPrimaryAdmin={isPrimaryAdmin}
        permissions={userPermissions}
        onLogout={handleGoogleLogout}
      />

      {/* Main Content */}
      <main className={cn(
        "transition-all duration-300 ease-in-out min-h-screen",
        isSidebarOpen ? "md:ml-64" : "md:ml-20"
      )}>
        {/* Top Header (Mobile Only) */}
        <div className="md:hidden bg-white border-b border-slate-200 p-3 flex items-center justify-between sticky top-0 z-30 font-sans">
          <div className="flex items-center gap-2 min-w-0">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-1.5 text-slate-700 hover:bg-slate-100 rounded-lg transition-all cursor-pointer shrink-0 active:scale-95"
              title="Open Navigation Menu"
              aria-label="Open Navigation Menu"
            >
              <Menu size={22} />
            </button>
            <button 
              onClick={() => {
                setActiveTab('dashboard');
                setTimeout(() => {
                  document.getElementById('overview-menu-dial-container')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 80);
              }}
              className="flex items-center gap-2 hover:opacity-90 active:scale-95 transition-all duration-150 text-left text-slate-950 bg-transparent border-0 min-w-0 cursor-pointer p-1 -m-1 rounded-xl hover:bg-slate-50/80 active:bg-slate-100 select-none"
              title="Go to Overview Menu Dial"
            >
              {resolvedLogo ? (
                <img src={resolvedLogo} alt="Logo" className="w-6 h-6 object-contain shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-[10px] shrink-0">C</div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-slate-900 text-xs tracking-tight uppercase truncate">ST.CASIMIR CHARITABLE TRUST</span>
                <span className="text-[9px] font-semibold text-blue-600 tracking-wider truncate">SCC TRUST LUCKY COUPON SALE 2026</span>
              </div>
            </button>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={handleGoogleLogout}
              className="px-2.5 py-1 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-all flex items-center gap-1 text-[11px] font-bold border border-rose-200 cursor-pointer active:scale-95"
              title="Sign Out of App"
            >
              <LogOut size={13} />
              <span>Logout</span>
            </button>
          </div>
        </div>

        {/* Desktop Header (Logo/Title) */}
        <div className="hidden md:flex items-center justify-between px-8 py-6 bg-white/50 backdrop-blur-sm border-b border-slate-100 sticky top-0 z-30 font-sans">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-4 hover:opacity-90 active:scale-95 transition-all duration-150 text-left bg-transparent border-0 cursor-pointer p-2 -m-2 rounded-2xl hover:bg-slate-50/80 active:bg-slate-100 select-none"
            title="Go to Dashboard"
          >
            {resolvedLogo ? (
              <img src={resolvedLogo} alt="Logo" className="w-10 h-10 object-contain rounded-lg shadow-sm" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            )}
            <div className="flex flex-col">
              <h2 className="text-base font-black text-slate-900 tracking-tight">ST.CASIMIR CHARITABLE TRUST</h2>
              <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mt-0.5">SCC TRUST LUCKY COUPON SALE 2026</p>
            </div>
          </button>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Inc & Exp Balance</p>
              <p className="text-lg font-black text-slate-900">
                ₹{(
                  (appData.incomeExpenses || [])
                    .filter(e => e.type === 'INCOME')
                    .reduce((acc, e) => acc + e.amount, 0) -
                  (appData.incomeExpenses || [])
                    .filter(e => e.type === 'EXPENSE')
                    .reduce((acc, e) => acc + e.amount, 0)
                ).toLocaleString('en-IN')}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 bg-white border border-slate-100 shadow-sm pl-4 pr-1.5 py-1 rounded-2xl">
                <div className="text-right">
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Cloud Synced Team Active
                  </p>
                  <span className="text-[11px] font-bold text-slate-700 block">{user.displayName}</span>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="User photo" className="w-10 h-10 rounded-full border border-slate-200 overflow-hidden shrink-0 shadow-inner" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 rounded-full border border-slate-200 overflow-hidden shrink-0 shadow-inner bg-blue-50 flex items-center justify-center text-xs font-bold text-blue-600">
                    {user.displayName.substring(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              <button
                onClick={handleGoogleLogout}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 border border-rose-100 bg-rose-50/50 hover:bg-rose-50 hover:border-rose-200 text-rose-600 rounded-xl text-xs font-bold transition-all shadow-sm shrink-0 cursor-pointer"
                title="Sign Out of App"
              >
                <LogOut size={14} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>

        {/* Page Content */}
        <div className="p-4 md:p-8 max-w-7xl mx-auto relative animate-fade-in">
          {/* Printable formal header */}
          <div className="hidden print:block print-header">
            <div className="flex items-center justify-between border-b pb-2 mb-4 border-slate-900 font-sans">
              <div className="flex items-center gap-3">
                {resolvedLogo ? (
                  <img src={resolvedLogo} alt="Logo" className="w-10 h-10 object-contain rounded-lg" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
                )}
                <div className="flex flex-col">
                  <h1 className="text-sm font-black text-slate-900 uppercase tracking-tight">ST.CASIMIR CHARITABLE TRUST</h1>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">SCC TRUST LUCKY COUPON SALE 2026</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Report Date</span>
                <span className="text-xs font-black text-slate-800">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
          </div>

          {firestoreError && (
            <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-3xl p-6 text-slate-800 shadow-lg shadow-amber-500/5 flex flex-col md:flex-row items-start justify-between gap-6 animate-in slide-in-from-top-4 duration-500">
              <div className="flex gap-4 items-start">
                <div className="p-3 bg-white border border-amber-200 rounded-2xl text-amber-600 shrink-0 shadow-sm">
                  <AlertCircle size={22} className="animate-bounce" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-black text-amber-950 uppercase tracking-wider flex items-center gap-2">
                    Firebase Sync Notice <span className="text-[10px] text-amber-700 font-bold uppercase tracking-normal bg-amber-100 px-2 py-0.5 rounded-full">Offline Buffering Active</span>
                  </h3>
                  <div className="text-xs font-semibold leading-relaxed text-slate-700 space-y-2">
                    <p>
                      The app is currently reconnecting to the cloud database. We have successfully configured your Firestore Database for project <strong className="text-slate-900 font-black">coupon-sale-tracker</strong> and deployed security rules.
                    </p>
                    <p className="text-amber-800 font-bold">
                      To troubleshoot: 1) Verify that Firestore is active in the Firebase Console. 2) Click the &quot;Reload Connections&quot; button below.
                    </p>
                    <div className="mt-2 bg-white/70 border border-amber-100 rounded-xl p-3">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Detailed Technical Error Code:</span>
                      <code className="text-[10px] font-mono text-rose-700 break-all">{firestoreError}</code>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto shrink-0 md:self-center">
                <button 
                  onClick={() => {
                    setFirestoreError(null);
                    window.location.reload();
                  }}
                  className="w-full md:w-auto px-5 py-3 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-amber-600/20 cursor-pointer"
                >
                  Reload Connections
                </button>
              </div>
            </div>
          )}

          {showNotificationPrompt && (
            <div className="mb-6 bg-blue-600 rounded-3xl p-6 text-white shadow-xl shadow-blue-600/20 flex flex-col md:flex-row items-center justify-between gap-6 animate-in slide-in-from-top-4 duration-500">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                  <BellRing className="text-white" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight">Enable Push Notifications</h3>
                  <p className="text-blue-100 text-sm font-medium">Get real-time updates for sales and sponsor collections.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <button 
                  onClick={() => setShowNotificationPrompt(false)}
                  className="flex-1 md:flex-none px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm transition-all"
                >
                  Later
                </button>
                <button 
                  onClick={handleRequestPermission}
                  className="flex-1 md:flex-none px-6 py-3 bg-white text-blue-600 rounded-xl font-bold text-sm shadow-lg hover:bg-blue-50 transition-all active:scale-95"
                >
                  Enable Now
                </button>
              </div>
            </div>
          )}
          <div key={activeTab} className="page-transition-enter">
            {renderContent()}
          </div>
        </div>
      </main>

      {/* Real-time In-App Notification Toast */}
      {activeToast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100vw-2rem)] sm:w-80 bg-slate-900/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700/80 flex items-start gap-3 animate-in slide-in-from-bottom-3 duration-300">
          <img 
            src={activeToast.icon || '/splash/mobile.jpg'} 
            alt="Notification Icon" 
            className="w-10 h-10 rounded-xl object-contain bg-white/10 p-1 shrink-0 border border-white/10" 
          />
          <div className="flex-1 min-w-0 pr-1">
            <h4 className="text-xs font-black text-white leading-tight truncate">{activeToast.title}</h4>
            {activeToast.body && (
              <p className="text-[11px] text-slate-300 font-medium mt-0.5 leading-snug line-clamp-2">{activeToast.body}</p>
            )}
            <span className="text-[9px] text-blue-400 font-bold uppercase tracking-wider block mt-1">SCC Trust Notification</span>
          </div>
          <button 
            onClick={() => setActiveToast(null)} 
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
