import React, { useState } from 'react';
import { 
  Users, 
  Smartphone, 
  Monitor, 
  Clock, 
  Trash2, 
  ShieldAlert, 
  Laptop, 
  Compass, 
  RefreshCw, 
  XSquare, 
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { cn } from '../../lib/utils';

export interface ActiveSession {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  lastActive: string;
  userAgent?: string;
  device?: 'Mobile' | 'Desktop';
}

interface ActiveSessionsProps {
  activeSessions: ActiveSession[];
  currentUser: any;
  showNotification: (type: 'success' | 'error', text: string) => void;
}

export function ActiveSessions({
  activeSessions,
  currentUser,
  showNotification
}: ActiveSessionsProps) {
  const [terminatingId, setTerminatingId] = useState<string | null>(null);

  // Parse user agent to obtain a human-readable browser and platform
  const getBrowserAndOS = (userAgent: string = '') => {
    let browser = 'Unknown Browser';
    let os = 'Unknown OS';

    // Parse OS
    if (/Windows/i.test(userAgent)) os = 'Windows';
    else if (/Macintosh|Mac OS X/i.test(userAgent)) os = 'macOS';
    else if (/iPad/i.test(userAgent)) os = 'iPadOS';
    else if (/iPhone/i.test(userAgent)) os = 'iOS';
    else if (/Android/i.test(userAgent)) os = 'Android';
    else if (/Linux/i.test(userAgent)) os = 'Linux';

    // Parse Browser
    if (/Edg/i.test(userAgent)) browser = 'Microsoft Edge';
    else if (/Chrome/i.test(userAgent) && !/Chromium|Edg/i.test(userAgent)) browser = 'Google Chrome';
    else if (/Safari/i.test(userAgent) && !/Chrome|Edg/i.test(userAgent)) browser = 'Apple Safari';
    else if (/Firefox/i.test(userAgent)) browser = 'Mozilla Firefox';
    else if (/MSIE|Trident/i.test(userAgent)) browser = 'Internet Explorer';
    else if (/Mobile/i.test(userAgent)) browser = 'Mobile Browser';

    return { browser, os };
  };

  // Convert lastActive ISO date to a human-friendly relative time text or date
  const getRelativeTime = (isoString: string) => {
    try {
      const now = new Date();
      const past = new Date(isoString);
      const diffMs = now.getTime() - past.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);

      if (isNaN(past.getTime())) return 'Unknown time';
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return past.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'Unknown';
    }
  };

  const handleTerminateSession = async (sessionId: string, sessionEmail: string) => {
    setTerminatingId(sessionId);
    try {
      await deleteDoc(doc(db, 'activeSessions', sessionId));
      showNotification('success', `Terminated session for ${sessionEmail}.`);
    } catch (err) {
      console.error('Failed to terminate session:', err);
      showNotification('error', 'Failed to terminate session. Please try again.');
    } finally {
      setTerminatingId(null);
    }
  };

  const currentTabSessionId = sessionStorage.getItem('app_session_id');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearSessions = async (keepCurrent: boolean = true) => {
    setIsClearingAll(true);
    try {
      const sessionsToDelete = keepCurrent
        ? activeSessions.filter(s => s.id !== currentTabSessionId)
        : activeSessions;

      if (sessionsToDelete.length === 0) {
        showNotification('success', 'No additional sessions to clear.');
        setIsClearingAll(false);
        setShowClearConfirm(false);
        return;
      }

      await Promise.all(
        sessionsToDelete.map(s => deleteDoc(doc(db, 'activeSessions', s.id)))
      );

      showNotification('success', `Cleared ${sessionsToDelete.length} active device sessions.`);
    } catch (err) {
      console.error('Failed to clear sessions:', err);
      showNotification('error', 'Failed to clear device sessions. Please try again.');
    } finally {
      setIsClearingAll(false);
      setShowClearConfirm(false);
    }
  };

  return (
    <div id="settings-card-active-sessions" className="bg-white p-6 md:p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6 text-left">
      {/* Interactive Header with Pointer Cursor and Tapping Effect */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between gap-3 flex-wrap cursor-pointer select-none -m-2 p-2 rounded-2xl hover:bg-slate-50/80 active:scale-[0.99] transition-all duration-150"
        title={isExpanded ? "Click to collapse Active Device Sessions" : "Click to view Active Device Sessions"}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2.5 rounded-2xl transition-all duration-200",
            isExpanded ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20" : "bg-emerald-50 text-emerald-600"
          )}>
            <Users size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase leading-tight">
                Active Device Sessions
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                {activeSessions.length} Online
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
              Currently signed in devices and active team sessions
            </p>
          </div>
        </div>

        {/* Action Controls & Clear Button */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {activeSessions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              disabled={isClearingAll}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-sm"
              title="Clear active device sessions"
            >
              {isClearingAll ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} className="text-rose-600" />
              )}
              <span>Clear Sessions</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 cursor-pointer shadow-inner",
              isExpanded ? "bg-emerald-600" : "bg-slate-300"
            )}
            title={isExpanded ? "Collapse Active Sessions" : "Expand Active Sessions"}
          >
            <div className={cn(
              "w-4 h-4 bg-white rounded-full transition-transform duration-200 ease-in-out shadow-md",
              isExpanded ? "translate-x-6" : "translate-x-0"
            )} />
          </button>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowClearConfirm(false)}>
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100 text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 tracking-tight">
                  Clear Device Sessions
                </h3>
                <p className="text-xs text-slate-500 font-semibold">
                  Remove signed-in devices from active sessions
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              ക്ലൗഡ് രജിസ്ട്രിയിൽ രേഖപ്പെടുത്തിയിരിക്കുന്ന ഡിവൈസ് സെഷനുകൾ ക്ലിയർ ചെയ്യണോ? മറ്റ് ഡിവൈസുകൾ വീണ്ടും തുറക്കുമ്പോൾ മാത്രമേ പുതിയ സെഷൻ രജിസ്റ്റർ ആകൂ.
            </p>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                disabled={isClearingAll}
                onClick={() => handleClearSessions(true)}
                className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {isClearingAll ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Clear Other Devices (Keep This Device)</span>
              </button>

              <button
                type="button"
                disabled={isClearingAll}
                onClick={() => handleClearSessions(false)}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <span>Clear All Sessions (Including This Device)</span>
              </button>

              <button
                type="button"
                disabled={isClearingAll}
                onClick={() => setShowClearConfirm(false)}
                className="w-full py-2 px-4 text-slate-500 hover:text-slate-700 text-xs font-semibold text-center cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!isExpanded ? (
        /* Collapsed summary layout to save massive amount of space */
        <div className="p-4 bg-slate-50/75 hover:bg-slate-50 border border-slate-100 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors animate-in fade-in duration-300 text-left font-sans">
          <div className="space-y-1.5 w-full sm:w-auto">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Device Session Overview</h4>
            <div className="font-mono text-[9px] text-slate-500 font-bold flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 bg-emerald-55 bg-emerald-50 text-emerald-700 border border-emerald-100/55 px-2.5 py-0.5 rounded-lg">
                Online: {activeSessions.length} devices
              </span>
            </div>
          </div>
          <span className="self-end sm:self-center text-[9px] text-slate-500 font-black uppercase tracking-wider bg-slate-200/50 border border-slate-200/20 px-3 py-1.5 rounded-xl">
            Sessions Security Live
          </span>
        </div>
      ) : (
        /* Expanded view */
        <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <p className="text-slate-500 text-xs font-semibold leading-relaxed text-left border-b border-slate-50 pb-4">
            നിങ്ങളുടെ അക്കൗണ്ട് ഉപയോഗിച്ച് ലോഗിൻ ചെയ്തിരിക്കുന്ന എല്ലാ ഡിവൈസുകളും കാണുക, ആവശ്യമില്ലാത്തവ സുരക്ഷിതമായി ഒഴിവാക്കുക.
          </p>

          {/* Quick Clear Toolbar */}
          {activeSessions.length > 0 && (
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 flex-wrap">
              <span className="text-xs font-black text-slate-700 tracking-tight">
                Currently Signed In Devices ({activeSessions.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleClearSessions(true)}
                  disabled={isClearingAll}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Clear other device sessions"
                >
                  <Trash2 size={12} className="text-slate-500" />
                  <span>Clear Other Devices</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={isClearingAll}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Clear all device sessions"
                >
                  <Trash2 size={12} className="text-rose-600" />
                  <span>Clear All</span>
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {activeSessions.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <p className="text-sm font-bold text-slate-400">ലോഗിൻ വിവരങ്ങൾ ലഭ്യമല്ല (No active sessions found)</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {activeSessions.map((session) => {
                  const { browser, os } = getBrowserAndOS(session.userAgent);
                  const isCurrentSession = session.id === currentTabSessionId;
                  const isCurrentUserAccount = currentUser && session.email?.toLowerCase() === currentUser.email?.toLowerCase();

                  return (
                    <div 
                      key={session.id}
                      className={cn(
                        "p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4",
                        isCurrentSession 
                          ? "bg-blue-50/40 border-blue-100/80 shadow-sm" 
                          : "bg-slate-50/50 border-slate-100/80 hover:bg-slate-50 hover:border-slate-200"
                      )}
                    >
                      <div className="flex items-center gap-3.5 flex-1 min-w-0">
                        {/* User Profile Avatar with custom seed fallback if image not found */}
                        <div className="relative shrink-0">
                          <img 
                            src={session.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(session.displayName || 'User')}`} 
                            alt="Profile Avatar" 
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-full object-cover border border-white shadow-sm shrink-0"
                          />
                          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white"></span>
                        </div>

                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-extrabold text-sm text-slate-800 leading-none truncate">
                              {session.displayName || 'Authorized Admin'}
                            </p>
                            
                            {isCurrentSession && (
                              <span className="text-[9px] font-black uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                                ദിസ് ഡിവൈസ് (This Device)
                              </span>
                            )}
                            
                            {isCurrentUserAccount && !isCurrentSession && (
                              <span className="text-[9px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                                യൂവർ അക്കൗണ്ട് (Your Account)
                              </span>
                            )}
                          </div>
                          
                          <p className="text-[11px] text-slate-400 font-bold leading-none truncate">{session.email}</p>
                          
                          {/* OS and Browser Chips */}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-0.5 rounded-md shadow-sm">
                              {session.device === 'Mobile' ? <Smartphone size={11} className="text-slate-400" /> : <Laptop size={11} className="text-slate-400" />}
                              {os}
                            </span>
                            
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-0.5 rounded-md shadow-sm">
                              <Compass size={11} className="text-slate-400" />
                              {browser}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right side: Session Activities & Terminate triggers */}
                      <div className="flex flex-row md:flex-col items-start md:items-end justify-between md:justify-center gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 md:border-none">
                        <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                          <Clock size={11} className="text-slate-400" />
                          <span>Active: {getRelativeTime(session.lastActive)}</span>
                        </div>

                        {!isCurrentSession && (
                          <button
                            onClick={() => handleTerminateSession(session.id, session.email)}
                            disabled={terminatingId === session.id}
                            className="text-[10px] font-black uppercase tracking-wide bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer self-end shrink-0"
                            title="Log Out Session"
                          >
                            {terminatingId === session.id ? (
                              <RefreshCw size={11} className="animate-spin" />
                            ) : (
                              <Trash2 size={11} />
                            )}
                            <span>Logout Session</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-[11px] text-slate-500 leading-relaxed font-semibold">
            <span className="text-emerald-600 font-extrabold mr-1">💡 സുരക്ഷാ നിർദ്ദേശം:</span> 
            പട്ടികയിൽ കാണുന്ന ഏതെങ്കിലും അപരിചിതമായ ഫോണോ കമ്പ്യൂട്ടറോ ശ്രദ്ധയിൽപ്പെട്ടാൽ ലോഗൗട്ട് ചെയ്യിക്കുകയോ, ഉടൻതന്നെ നിങ്ങളുടെ ഗൂഗിൾ പാസ്‌വേഡ് മാറ്റുകയോ ചെയ്യുക.
          </div>
        </div>
      )}
    </div>
  );
};
