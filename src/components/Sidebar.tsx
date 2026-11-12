import React from 'react';
import { 
  LayoutDashboard, 
  PlusCircle, 
  History, 
  Users, 
  Settings as SettingsIcon, 
  ChevronLeft, 
  ChevronRight,
  Menu,
  X,
  CreditCard,
  Gift,
  SlidersHorizontal,
  Banknote,
  LogOut,
  Download,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  user?: any;
  onLogout?: () => void;
  isPrimaryAdmin?: boolean;
  permissions?: {
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    hideIncomeExpense?: boolean;
    hideSecretaryHandover?: boolean;
  };
}

const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  setActiveTab, 
  isOpen, 
  setIsOpen, 
  user, 
  onLogout, 
  isPrimaryAdmin = false,
  permissions,
}) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'transactions', label: 'Transaction History', icon: History },
    { id: 'credit', label: 'Credit Management', icon: CreditCard },
    { id: 'income-expense', label: 'Income & Expense', icon: Banknote },
    { id: 'secretary-handover', label: 'Treasury Handover', icon: Users },
    { id: 'prize-collection', label: 'Prize Collection', icon: Gift },
    { id: 'prize-settings', label: 'Prize Settings', icon: SlidersHorizontal },
    { id: 'settings', label: 'Settings & Backup', icon: SettingsIcon },
  ].filter((item) => {
    if (item.id === 'income-expense' && permissions?.hideIncomeExpense) {
      return false;
    }
    if (item.id === 'secretary-handover' && permissions?.hideSecretaryHandover) {
      return false;
    }
    if (item.id === 'settings' && !isPrimaryAdmin) {
      return false;
    }
    return true;
  });

  const [isInstalled, setIsInstalled] = React.useState(false);

  React.useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    setIsInstalled(!!isStandalone);

    const handleAppInstalled = () => {
      setIsInstalled(true);
      (window as any).deferredInstallPrompt = null;
    };

    window.addEventListener('appinstalled', handleAppInstalled);
    return () => window.removeEventListener('appinstalled', handleAppInstalled);
  }, []);

  const handleInstallClick = async () => {
    const promptEvent = (window as any).deferredInstallPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        setIsInstalled(true);
        (window as any).deferredInstallPrompt = null;
      }
    } else {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
      if (isStandalone) {
        setIsInstalled(true);
      }
    }
  };

  return (
    <>
      {/* Mobile Backdrop with smooth opacity transition */}
      <div 
        className={cn(
          "fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 md:hidden transition-opacity duration-300 ease-out",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsOpen(false)}
        aria-hidden={!isOpen}
      />

      {/* Sidebar with GPU hardware-accelerated smooth slide and spring physics */}
      <aside className={cn(
        "fixed top-0 left-0 h-full bg-slate-900 text-white z-50 transform-gpu will-change-transform shadow-2xl md:shadow-none",
        "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "w-72 max-w-[85vw] md:max-w-none",
        isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        isOpen ? "md:w-64" : "md:w-20"
      )}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 flex items-center justify-between border-b border-slate-800">
            {isOpen ? (
              <span className="font-bold text-xl tracking-tight">COUPON SALE</span>
            ) : (
              <span className="font-bold text-xl mx-auto">C</span>
            )}
            <button 
              onClick={() => setIsOpen(!isOpen)}
              className="p-1.5 hover:bg-slate-800 rounded-lg transition-all active:scale-90 cursor-pointer text-slate-300 hover:text-white"
              title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-2 space-y-2">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (window.innerWidth < 768) setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center p-3 rounded-xl transition-all duration-150 cursor-pointer active:scale-95 select-none",
                  activeTab === item.id 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30 font-bold scale-[1.01]" 
                    : "text-slate-400 hover:bg-slate-800/80 hover:text-white"
                )}
              >
                <item.icon size={22} className={cn(isOpen ? "mr-3" : "mx-auto", "shrink-0 transition-transform duration-150")} />
                {isOpen && <span className="font-medium text-sm">{item.label}</span>}
              </button>
            ))}

            {/* Direct 1-Tap Install APK Option in Side Nav (No Instructions) */}
            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={handleInstallClick}
                className={cn(
                  "w-full flex items-center p-3 rounded-lg transition-all duration-200 cursor-pointer active:scale-95 text-left",
                  isInstalled 
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30"
                )}
                title={isInstalled ? "App Installed on Device (APK Active)" : "Install App as APK"}
              >
                {isInstalled ? (
                  <CheckCircle2 size={24} className={cn(isOpen ? "mr-3 shrink-0 text-emerald-400" : "mx-auto shrink-0 text-emerald-400")} />
                ) : (
                  <Download size={24} className={cn(isOpen ? "mr-3 shrink-0 text-white" : "mx-auto shrink-0 text-white")} />
                )}
                {isOpen && (
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-sm leading-tight">
                      {isInstalled ? "APK Installed" : "Install as APK"}
                    </span>
                    <span className="text-[10px] text-slate-200 truncate mt-0.5">
                      {isInstalled ? "Active on Device" : "1-Tap Install"}
                    </span>
                  </div>
                )}
              </button>
            </div>
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-slate-800 space-y-3">
            {onLogout && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onLogout();
                }}
                className={cn(
                  "w-full flex items-center p-2.5 rounded-lg text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-all duration-200 border border-transparent hover:border-rose-500/20 cursor-pointer active:scale-95"
                )}
                title="Sign out of application"
              >
                <LogOut size={20} className={isOpen ? "mr-3 shrink-0" : "mx-auto shrink-0"} />
                {isOpen && <span className="font-semibold text-sm">Sign Out</span>}
              </button>
            )}
            <div className="text-center text-[10px] text-slate-500">
              {isOpen ? "© 2026 Coupon Management, Developed by Ignatious Joshuva" : "v1.0"}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
