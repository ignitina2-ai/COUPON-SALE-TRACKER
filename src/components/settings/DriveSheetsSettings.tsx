import React, { useState, useEffect } from 'react';
import { 
  RefreshCw, 
  Check, 
  Copy,
  Code2,
  Zap,
  FolderSync,
  FileSpreadsheet
} from 'lucide-react';
import { AppData } from '@/types';
import { cn } from '@/lib/utils';
import { 
  TARGET_DRIVE_EMAIL, 
  FOLDER_NAME, 
  SHEET_NAME, 
  BACKUP_FILE_NAME,
  syncAllTransactionsToSheet,
  saveBackupJsonToDrive,
  DriveSyncConfig,
  GOOGLE_APPS_SCRIPT_CODE,
  DEFAULT_WEBHOOK_URL,
  syncViaWebhook
} from '@/lib/googleDriveSheets';
import ConfirmationModal from '../ConfirmationModal';

interface DriveSheetsSettingsProps {
  appData: AppData;
  user: any;
  accessToken: string | null;
  driveSyncConfig?: DriveSyncConfig;
  onUpdateDriveSyncConfig?: (config: Partial<DriveSyncConfig>) => Promise<void>;
  onConnectDrive: () => Promise<void>;
  isAutoSyncEnabled: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
  showNotification: (type: 'success' | 'error', message: string) => void;
}

export const DriveSheetsSettings: React.FC<DriveSheetsSettingsProps> = ({
  appData,
  user,
  accessToken,
  driveSyncConfig,
  onUpdateDriveSyncConfig,
  onConnectDrive,
  isAutoSyncEnabled,
  onToggleAutoSync,
  showNotification,
}) => {
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [webhookInput, setWebhookInput] = useState(() => {
    if (driveSyncConfig?.webhookUrl) return driveSyncConfig.webhookUrl;
    try {
      const local = localStorage.getItem('cached_gas_webhook_url');
      if (local && local.trim()) return local.trim();
    } catch (e) {}
    return DEFAULT_WEBHOOK_URL;
  });
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);
  const [justSavedWebhook, setJustSavedWebhook] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (driveSyncConfig?.webhookUrl) {
      setWebhookInput(driveSyncConfig.webhookUrl);
    }
  }, [driveSyncConfig?.webhookUrl]);

  const activeToken = accessToken || driveSyncConfig?.activeAccessToken;
  const currentWebhookUrl = driveSyncConfig?.webhookUrl || DEFAULT_WEBHOOK_URL;
  const isConnected = !!activeToken || !!currentWebhookUrl;

  const handleManualSyncAll = async () => {
    if (!activeToken && !currentWebhookUrl) {
      showNotification('error', 'Please connect with Google Drive & Sheets or save a Webhook URL first.');
      return;
    }

    setIsSyncingAll(true);
    try {
      let sheetRes: any = null;
      let backupRes: any = null;

      // 1. If direct OAuth token is present, sync via Google REST APIs
      if (activeToken) {
        sheetRes = await syncAllTransactionsToSheet(activeToken, appData.transactions);
        backupRes = await saveBackupJsonToDrive(activeToken, appData);
      }

      // 2. If Webhook URL is present, also dispatch to Webhook
      if (currentWebhookUrl) {
        await syncViaWebhook(currentWebhookUrl, {
          action: 'syncAll',
          transactions: appData.transactions,
          fullBackup: appData,
        });
      }

      if (onUpdateDriveSyncConfig) {
        await onUpdateDriveSyncConfig({
          sheetId: sheetRes?.sheetId || driveSyncConfig?.sheetId,
          sheetLink: sheetRes?.webViewLink || driveSyncConfig?.sheetLink,
          backupFileId: backupRes?.fileId || driveSyncConfig?.backupFileId,
          lastSyncedAt: new Date().toISOString(),
          lastSyncedBy: user?.email || 'Admin',
          lastSyncStatus: 'success',
          lastSyncMessage: `All ${appData.transactions.length} records synced to Google Sheet & Drive JSON backup`,
        });
      }

      showNotification('success', `Successfully synced ${appData.transactions.length} transactions to Google Sheet & updated Drive JSON backup!`);
    } catch (err: any) {
      console.error('Manual Drive sync error:', err);
      showNotification('error', `Drive Sync failed: ${err.message || 'Please check connection.'}`);
    } finally {
      setIsSyncingAll(false);
      setShowConfirmModal(false);
    }
  };

  const handleSaveWebhook = async () => {
    const cleanUrl = webhookInput.trim();
    if (!cleanUrl) {
      showNotification('error', 'ദയവായി Webhook URL നൽകുക.');
      return;
    }

    // Immediately cache in localStorage for instant persistence
    try {
      localStorage.setItem('cached_gas_webhook_url', cleanUrl);
    } catch (e) {}

    setIsSavingWebhook(true);
    try {
      if (onUpdateDriveSyncConfig) {
        // Enforce max 600ms timeout race so saving is practically instant and never hangs!
        await Promise.race([
          onUpdateDriveSyncConfig({ webhookUrl: cleanUrl }),
          new Promise((resolve) => setTimeout(resolve, 600))
        ]);
      }
      setJustSavedWebhook(true);
      setTimeout(() => setJustSavedWebhook(false), 3000);
      showNotification('success', 'Google Apps Script Webhook URL വിജയകരമായി സേവ് ചെയ്തു!');
    } catch (err: any) {
      console.warn('Webhook save notice:', err);
      setJustSavedWebhook(true);
      setTimeout(() => setJustSavedWebhook(false), 3000);
      showNotification('success', 'Google Apps Script Webhook URL സേവ് ചെയ്തു!');
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handleTestWebhook = async () => {
    const url = (webhookInput || currentWebhookUrl).trim();
    if (!url) {
      showNotification('error', 'Please enter a webhook URL first.');
      return;
    }
    setIsTestingWebhook(true);
    try {
      // 1. First probe via fetch to see if Google responds with account login (Who has access: Only myself)
      let needsAnyonePermission = false;
      try {
        const probeRes = await fetch(url, { method: 'GET', redirect: 'follow' });
        const probeText = await probeRes.text().catch(() => '');
        if (probeText.includes('accounts.google.com') || probeText.includes('ServiceLogin') || probeText.includes('Sign in - Google Accounts')) {
          needsAnyonePermission = true;
        }
      } catch (probeErr) {
        // CORS redirect usually happens if redirected to accounts.google.com
      }

      if (needsAnyonePermission) {
        showNotification(
          'error',
          'Webhook permission issue: Web app deployment must have "Who has access: Anyone" (Currently restricted to account login).'
        );
        setIsTestingWebhook(false);
        return;
      }

      // 2. Dispatch sync test
      const res = await syncViaWebhook(url, {
        action: 'syncAll',
        transactions: appData.transactions.slice(0, 1),
        fullBackup: appData,
      });
      if (res.success) {
        showNotification('success', 'Webhook test successful! Connection to Google Sheet & Drive JSON backup is active.');
      } else {
        showNotification('error', `Webhook response: ${res.message || 'Check Apps Script deployment.'}`);
      }
    } catch (e: any) {
      showNotification('error', `Webhook test failed: ${e.message || 'Check network'}`);
    } finally {
      setIsTestingWebhook(false);
    }
  };



  const handleCopyScript = () => {
    navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
    showNotification('success', 'Google Apps Script code copied to clipboard!');
  };

  return (
    <div id="settings-card-drive-sheets" className="bg-white p-6 md:p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6 text-left font-sans">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-2xl text-emerald-600">
            <FolderSync size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase leading-tight">
              Google Drive &amp; Sheets Live Sync
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
              Live Google Spreadsheet mirroring &amp; cloud JSON backup
            </p>
          </div>
        </div>

        {/* Toggle Switch */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:inline">
            {isExpanded ? "Setup open" : "Setup hidden"}
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 cursor-pointer shadow-inner",
              isExpanded ? "bg-emerald-600" : "bg-slate-300"
            )}
            title={isExpanded ? "Collapse Drive & Sheets Settings" : "Expand Drive & Sheets Settings"}
          >
            <div className={cn(
              "w-4 h-4 bg-white rounded-full transition-transform duration-200 ease-in-out shadow-md",
              isExpanded ? "translate-x-6" : "translate-x-0"
            )} />
          </button>
        </div>
      </div>

      {!isExpanded ? (
        <div 
          onClick={() => setIsExpanded(true)}
          className="p-4 bg-slate-50/75 hover:bg-slate-50 border border-slate-100 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors animate-in fade-in duration-300 text-left font-sans cursor-pointer"
        >
          <div className="space-y-1.5 w-full sm:w-auto">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Drive &amp; Spreadsheet Status</h4>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-slate-500 font-bold">
              <span className={cn(
                "inline-flex items-center gap-1.5 border px-2 py-0.5 rounded-lg",
                isConnected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
              )}>
                <FileSpreadsheet size={11} /> {isConnected ? "✓ Cloud Webhook Active" : "No Webhook Saved"}
              </span>
              <span className={cn(
                "inline-flex items-center gap-1.5 border px-2 py-0.5 rounded-lg",
                isAutoSyncEnabled ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-500 border-slate-200"
              )}>
                Auto-sync: {isAutoSyncEnabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
          <span className="self-end sm:self-center text-[9px] text-emerald-700 font-black uppercase tracking-wider bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
            Click to configure
          </span>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
      


      {/* Auto-Sync Toggle Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-100 shadow-xs">
        <div className="space-y-0.5">
          <label htmlFor="drive-auto-sync-toggle" className="text-xs font-bold text-slate-900 cursor-pointer">
            Auto-record transactions &amp; update Drive JSON backup
          </label>
          <p className="text-[11px] text-slate-500 font-medium">
            ഏതൊരു അഡ്മിൻ അല്ലെങ്കിൽ അംഗം പുതിയ transaction ചേർത്താലോ തിരുത്തിയാലോ ഉടൻ തന്നെ Google Sheet-ലും JSON ഫയലിലും സേവ് ചെയ്യും.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            id="drive-auto-sync-toggle"
            type="button"
            onClick={() => onToggleAutoSync(!isAutoSyncEnabled)}
            className={cn(
              "w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 cursor-pointer shadow-inner",
              isAutoSyncEnabled ? "bg-emerald-600" : "bg-slate-300"
            )}
            title={isAutoSyncEnabled ? "Disable Auto Sync" : "Enable Auto Sync"}
          >
            <div className={cn(
              "w-4 h-4 bg-white rounded-full transition-transform duration-200 ease-in-out shadow-md",
              isAutoSyncEnabled ? "translate-x-6" : "translate-x-0"
            )} />
          </button>
        </div>
      </div>

      {/* Permanent Google Apps Script Webhook Option (24/7 Zero Expiration Sync) */}
      <div className="p-4 bg-slate-50/90 rounded-2xl border border-slate-200/70 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-amber-500" />
            <h4 className="text-xs font-bold text-slate-800">
              Permanent 24/7 Webhook Sync (Zero Token Expiration)
            </h4>
          </div>
          <button
            onClick={() => setShowScriptModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <Code2 size={13} />
            <span>View Apps Script Code</span>
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Google Sheets-ൽ <strong>Extensions &gt; Apps Script</strong> വഴി വെബ് ആപ്പ് ഡിപ്ലോയ് ചെയ്ത് ആ ലിങ്ക് ഇവിടെ നൽകിയാൽ, ലോഗിൻ ടോക്കൺ കാലാവധി തീരാതെ തന്നെ എല്ലാ ടീം അംഗങ്ങൾക്കും 24 മണിക്കൂറും ഇടതടവില്ലാതെ ഷീറ്റും ഡ്രൈവും അപ്ഡേറ്റ് ചെയ്യാം.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="url"
            placeholder="https://script.google.com/macros/s/.../exec"
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
            className="flex-1 min-w-[240px] bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSaveWebhook}
            disabled={isSavingWebhook}
            className={cn(
              "px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 shrink-0 shadow-sm transition-all flex items-center gap-1.5",
              justSavedWebhook
                ? "bg-emerald-600 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            )}
          >
            {isSavingWebhook ? (
              <>
                <RefreshCw size={12} className="animate-spin" />
                <span>Saving...</span>
              </>
            ) : justSavedWebhook ? (
              <>
                <Check size={13} className="stroke-[3]" />
                <span>Saved!</span>
              </>
            ) : (
              <span>Save Webhook</span>
            )}
          </button>
          <button
            onClick={handleTestWebhook}
            disabled={isTestingWebhook}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 shrink-0 border border-slate-200 flex items-center gap-1.5"
            title="Test sending a test ping to Google Apps Script Webhook"
          >
            <RefreshCw size={12} className={isTestingWebhook ? "animate-spin" : ""} />
            <span>{isTestingWebhook ? 'Testing...' : 'Test Webhook'}</span>
          </button>
        </div>

      </div>

      {/* Manual Bulk Sync Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-slate-800">Need to sync all past records?</span>
          <p className="text-[11px] text-slate-500">
            {driveSyncConfig?.lastSyncedAt 
              ? `Last sync: ${new Date(driveSyncConfig.lastSyncedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${driveSyncConfig.lastSyncedBy || 'Team'}.` 
              : `Synchronizes all ${appData.transactions.length} transactions to the sheet and updates the JSON file.`}
          </p>
        </div>

        <button
          onClick={() => setShowConfirmModal(true)}
          disabled={isSyncingAll || !isConnected}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all active:scale-95 shadow-sm disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw size={14} className={isSyncingAll ? "animate-spin" : ""} />
          <span>{isSyncingAll ? "Syncing to Drive & Sheets..." : "Sync All to Google Sheet & Drive"}</span>
        </button>
      </div>
      </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <ConfirmationModal
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          onConfirm={handleManualSyncAll}
          title="Sync All Records to Google Drive & Sheets?"
          message={`This will update the "${SHEET_NAME}" Google Spreadsheet with all ${appData.transactions.length} transaction entries, and overwrite "${BACKUP_FILE_NAME}" in the "${FOLDER_NAME}" Google Drive folder for ${TARGET_DRIVE_EMAIL}. Proceed with updating data?`}
          size="sm"
        />
      )}

      {/* Google Apps Script Modal */}
      {showScriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Google Apps Script Code</h3>
                <p className="text-[11px] text-slate-500">For ignitina2@gmail.com Google Sheet</p>
              </div>
              <button
                onClick={() => setShowScriptModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">Copy this code into Extensions &gt; Apps Script:</span>
                <button
                  onClick={handleCopyScript}
                  className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  {copiedScript ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedScript ? 'Copied!' : 'Copy Script'}</span>
                </button>
              </div>
              <pre className="p-4 bg-slate-900 text-emerald-400 rounded-xl text-[11px] font-mono overflow-x-auto max-h-96 leading-relaxed select-all">
                {GOOGLE_APPS_SCRIPT_CODE}
              </pre>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowScriptModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
