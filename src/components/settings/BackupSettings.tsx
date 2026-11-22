import React, { useEffect, useRef, useState } from 'react';
import { Database, Download, RefreshCw, Bell, BellOff, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AppData } from '@/types';
import { cn } from '@/lib/utils';
import {
  BackgroundPushStatus,
  getBackgroundPushStatus,
  requestNotificationPermission,
  sendTestBackgroundNotification,
  syncPushSubscription,
} from '@/lib/notifications';
import { auth } from '@/lib/firebase';

interface BackupSettingsProps {
  appData: AppData;
  onBackup: () => void;
  onRestore: (data: AppData) => void;
  onToggleNotifications: (enabled: boolean) => void;
  showNotification: (type: 'success' | 'error', message: string) => void;
}

export const BackupSettings: React.FC<BackupSettingsProps> = ({
  appData,
  onBackup,
  onRestore,
  onToggleNotifications,
  showNotification,
}) => {
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [pushStatus, setPushStatus] = useState<BackgroundPushStatus | null>(null);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [isSyncingPush, setIsSyncingPush] = useState(false);

  const refreshPushStatus = async () => {
    const status = await getBackgroundPushStatus();
    setPushStatus(status);
  };

  useEffect(() => {
    void refreshPushStatus();
  }, [appData.notificationsEnabled]);

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (data.transactions && data.sponsors) {
            onRestore(data);
            showNotification('success', 'Data restored successfully!');
          } else {
            showNotification('error', 'Invalid backup file format.');
          }
        } catch (err) {
          showNotification('error', 'Error parsing backup file.');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleToggleNotifications = async () => {
    if (!appData.notificationsEnabled) {
      setIsSyncingPush(true);
      try {
        const granted = await requestNotificationPermission();
        if (granted) {
          await onToggleNotifications(true);
          const syncRes = await syncPushSubscription(auth.currentUser?.email);
          await refreshPushStatus();
          if (syncRes.subscribed) {
            showNotification('success', 'Closed-app push notifications enabled for this device!');
          } else {
            showNotification('success', 'Notifications enabled! Install as app or allow push for background delivery.');
          }
        } else {
          showNotification('error', 'Notification permission denied. Please enable it in your browser settings.');
        }
      } finally {
        setIsSyncingPush(false);
      }
    } else {
      await onToggleNotifications(false);
      await refreshPushStatus();
      showNotification('success', 'Push notifications disabled.');
    }
  };

  const handleSyncThisDevice = async () => {
    setIsSyncingPush(true);
    try {
      const granted = await requestNotificationPermission();
      if (!granted) {
        showNotification('error', 'Please allow browser notification permission first.');
        return;
      }
      if (!appData.notificationsEnabled) {
        await onToggleNotifications(true);
      }
      const res = await syncPushSubscription(auth.currentUser?.email);
      await refreshPushStatus();
      if (res.subscribed) {
        showNotification('success', 'Device registered! Alerts will arrive even when the app is closed.');
      } else {
        showNotification('error', res.reason || 'Background push is not supported in this browser.');
      }
    } finally {
      setIsSyncingPush(false);
    }
  };

  const handleSendTestPush = async () => {
    setIsTestingPush(true);
    try {
      const res = await sendTestBackgroundNotification(5);
      await refreshPushStatus();
      showNotification(res.ok ? 'success' : 'error', res.message);
    } finally {
      setIsTestingPush(false);
    }
  };

  const isClosedAppReady = Boolean(
    appData.notificationsEnabled &&
      pushStatus?.permission === 'granted' &&
      pushStatus?.subscribed
  );

  return (
    <div id="settings-card-backup" className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-left">
          <div className="bg-emerald-50 p-2 rounded-lg text-emerald-600">
            <Database size={20} />
          </div>
          <div className="font-sans">
            <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase leading-tight">Data Backups &amp; Push Notifications</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Secure local backups &amp; closed-app push alerts</p>
          </div>
        </div>

        {/* Toggle switch */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:inline">
            {isExpanded ? 'Setup open' : 'Setup hidden'}
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              'w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 cursor-pointer shadow-inner',
              isExpanded ? 'bg-emerald-600' : 'bg-slate-300'
            )}
            title={isExpanded ? 'Collapse Data Settings' : 'Expand Data Settings'}
          >
            <div
              className={cn(
                'w-4 h-4 bg-white rounded-full transition-transform duration-200 ease-in-out shadow-md',
                isExpanded ? 'translate-x-6' : 'translate-x-0'
              )}
            />
          </button>
        </div>
      </div>

      {!isExpanded ? (
        /* Collapsed summary layout */
        <div
          onClick={() => setIsExpanded(true)}
          className="p-4 bg-slate-50/75 hover:bg-slate-50 border border-slate-100 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors animate-in fade-in duration-300 text-left font-sans cursor-pointer"
        >
          <div className="space-y-1.5 w-full sm:w-auto">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Local Archives &amp; Closed-App Alerts</h4>
            <div className="font-mono text-[9px] text-slate-500 font-bold flex flex-wrap gap-1.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border',
                  isClosedAppReady
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : appData.notificationsEnabled
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200/40'
                )}
              >
                {isClosedAppReady
                  ? '✓ Closed-App Push Ready'
                  : appData.notificationsEnabled
                    ? 'Alerts Active (Tap to register device)'
                    : 'Alerts Disabled'}
              </span>
            </div>
          </div>
          <span className="self-end sm:self-center text-[9px] text-blue-700 font-black uppercase tracking-wider bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl">
            Manage &amp; Test
          </span>
        </div>
      ) : (
        /* Expanded setup */
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <button
            onClick={onBackup}
            className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-2xl transition-all group cursor-pointer text-left"
          >
            <div className="flex items-center gap-4">
              <div className="bg-white p-2 rounded-lg shadow-sm text-blue-600 group-hover:scale-110 transition-transform">
                <Download size={20} />
              </div>
              <div>
                <p className="text-slate-900 font-bold text-sm">Backup Data</p>
                <p className="text-slate-500 text-xs font-medium">Download all records as JSON</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => restoreInputRef.current?.click()}
            className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-2xl transition-all group cursor-pointer text-left"
          >
            <div className="flex items-center gap-4">
              <div className="bg-white p-2 rounded-lg shadow-sm text-emerald-600 group-hover:scale-110 transition-transform">
                <RefreshCw size={20} />
              </div>
              <div>
                <p className="text-slate-900 font-bold text-sm">Restore Data</p>
                <p className="text-slate-500 text-xs font-medium">Upload a previous backup file</p>
              </div>
            </div>
          </button>
          <input
            type="file"
            ref={restoreInputRef}
            onChange={handleRestore}
            accept=".json"
            className="hidden"
          />

          <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-3 text-left">
            <button
              type="button"
              onClick={handleToggleNotifications}
              disabled={isSyncingPush}
              className="w-full flex items-center justify-between transition-all group cursor-pointer text-left disabled:opacity-60"
            >
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'p-2 rounded-lg shadow-sm transition-transform group-hover:scale-110',
                    appData.notificationsEnabled ? 'bg-amber-50 text-amber-600' : 'bg-slate-200 text-slate-400'
                  )}
                >
                  {appData.notificationsEnabled ? <Bell size={20} /> : <BellOff size={20} />}
                </div>
                <div>
                  <p className="text-slate-900 font-bold text-sm">Closed-App Push Notifications</p>
                  <p className="text-slate-500 text-xs font-medium">
                    {isClosedAppReady
                      ? 'Active — alerts arrive even when app is closed'
                      : appData.notificationsEnabled
                        ? 'Enabled globally — register this device below'
                        : 'Disabled'}
                  </p>
                </div>
              </div>
              <div
                className={cn(
                  'w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0',
                  appData.notificationsEnabled ? 'bg-amber-500' : 'bg-slate-300'
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 bg-white rounded-full transition-transform duration-200 ease-in-out',
                    appData.notificationsEnabled ? 'translate-x-6' : 'translate-x-0'
                  )}
                />
              </div>
            </button>

            <div className="pt-2 border-t border-slate-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                {isClosedAppReady ? (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">This device is subscribed for background Web Push</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                    <span className="text-slate-600">
                      {pushStatus?.permission === 'denied'
                        ? 'Permission blocked in browser settings'
                        : 'Tap Register Device to receive alerts when app is closed'}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!isClosedAppReady && (
                  <button
                    type="button"
                    onClick={handleSyncThisDevice}
                    disabled={isSyncingPush}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    {isSyncingPush ? 'Registering...' : 'Register This Device'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSendTestPush}
                  disabled={isTestingPush}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                  title="Schedules a push notification 5 seconds later so you can close the app and test"
                >
                  <Send size={12} />
                  <span>{isTestingPush ? 'Scheduling...' : 'Test Closed-App (5s)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
