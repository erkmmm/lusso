import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Users,
  Menu, X, ChevronRight, Bell, Plus, HardHat, CalendarDays,
  CheckCircle2, AlertTriangle, Info, Settings2, FileText,
  ChevronDown, Home, UserCog, Users2, Inbox,
} from 'lucide-react';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead,
  getCustomers, getJobs, getQuotes, getInstallRequests,
} from '../store/data';
import { getEmployeeCountSync } from '../store/profiles';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/UserProfileContext';
import { LogOut } from 'lucide-react';
import { formatDistanceToNow, parseISO, isSameDay } from 'date-fns';

// ── Nav structure ─────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: 'WORKFLOW',
    items: [
      { to: '/',               label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { to: '/customers', label: 'Customers', icon: Users,     countKey: 'customers' },
      { to: '/jobs',      label: 'Jobs',      icon: Briefcase, countKey: 'jobs' },
      { to: '/quotes',    label: 'Quotes',    icon: FileText,  countKey: 'quotes' },
      { to: '/inbox',     label: 'Inbox',     icon: Inbox },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/installers', label: 'Installers', icon: HardHat },
      { to: '/calendar',   label: 'Calendar',   icon: CalendarDays, countKey: 'todayInstalls' },
    ],
  },
  {
    label: 'TEAM',
    items: [
      { to: '/employees', label: 'Team', icon: Users2, countKey: 'employees' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings2 },
    ],
  },
];

// ── + New actions ─────────────────────────────────────────────────────────────
// "New Measure Sheet" is intentionally absent — create/import from inside a Job Workspace.
const NEW_ACTIONS = [
  {
    label: 'New Job',
    sub:   'Create a job for a customer',
    to:    '/jobs/new',
    icon:  Briefcase,
    color: 'text-amber-600',
    bg:    'bg-amber-50',
  },
  {
    label: 'New Quote',
    sub:   'Price and quote a job',
    to:    '/quotes/new',
    icon:  FileText,
    color: 'text-blue-600',
    bg:    'bg-blue-50',
  },
  {
    label: 'New Customer',
    sub:   'Add to your contacts',
    to:    '/customers?new=1',
    icon:  Users,
    color: 'text-purple-600',
    bg:    'bg-purple-50',
  },
];

const NOTIF_ICONS = {
  install_accepted: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50' },
  install_declined: { icon: AlertTriangle, color: 'text-red-500',  bg: 'bg-red-50' },
  default:          { icon: Info,          color: 'text-blue-500',  bg: 'bg-blue-50' },
};

// ── Live counts ───────────────────────────────────────────────────────────────
function computeCounts() {
  const today = new Date();
  return {
    customers: getCustomers().length,
    jobs:      getJobs().length,
    quotes:    getQuotes().length,
    employees:    getEmployeeCountSync(),
    todayInstalls: getInstallRequests().filter(
      r => r.proposedDate && isSameDay(parseISO(r.proposedDate), today)
    ).length,
  };
}

// ── Nav count badge ───────────────────────────────────────────────────────────
function CountBadge({ n, active }) {
  if (!n || n === 0) return null;
  return (
    <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none ${
      active ? 'bg-white/20 text-white' : 'bg-white/10 text-sidebar-text'
    }`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen]     = useState(false);
  const [sideNewOpen, setSideNewOpen]   = useState(false); // sidebar "New" dropdown
  const [mobileNewOpen, setMobileNewOpen] = useState(false); // mobile bottom sheet
  const [notifications, setNotifs]    = useState(getNotifications);
  const [counts, setCounts]           = useState(computeCounts);
  const notifRef      = useRef(null);
  const sideNewRef    = useRef(null); // wraps sidebar + New section
  const mobileSheetRef = useRef(null); // mobile action sheet
  const navigate      = useNavigate();
  const { user, signOut } = useAuth();
  const { isAM, displayName, profile } = useProfile() || {};

  const unread = notifications.filter(n => !n.isRead).length;

  // Refresh notifications + counts on data changes instead of polling
  useEffect(() => {
    const refresh = () => {
      setNotifs(getNotifications());
      setCounts(computeCounts());
    };
    window.addEventListener('lusso:data-changed', refresh);
    return () => window.removeEventListener('lusso:data-changed', refresh);
  }, []);

  // Close popups on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (sideNewRef.current && !sideNewRef.current.contains(e.target)) setSideNewOpen(false);
      if (mobileSheetRef.current && !mobileSheetRef.current.contains(e.target)) setMobileNewOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNotifClick = (n) => {
    markNotificationRead(n.id);
    setNotifs(getNotifications());
    setNotifOpen(false);
    if (n.jobId) navigate(`/jobs/${n.jobId}`);
  };

  const handleMarkAllRead = () => {
    markAllNotificationsRead();
    setNotifs(getNotifications());
  };

  // Close both menus and navigate
  const handleNew = (to) => {
    setSideNewOpen(false);
    setMobileNewOpen(false);
    setSidebarOpen(false);
    navigate(to);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">

      {/* ── Mobile sidebar overlay ─────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile + New sheet overlay is co-located with the sheet below ── */}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-sidebar flex flex-col transform transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
          <div>
            <img src="/brand/lusso-white.png" alt="Lusso" className="h-6 w-auto" />
            <div className="text-slate-400 text-xs mt-1">Job Management</div>
          </div>
          <button aria-label="Close sidebar" className="ml-auto lg:hidden text-slate-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* + New dropdown */}
        <div className="px-4 py-4" ref={sideNewRef}>
          <button
            onClick={() => setSideNewOpen(v => !v)}
            className="w-full flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            <Plus size={16} />
            <span className="flex-1 text-left">New</span>
            <ChevronDown size={14} className={`transition-transform duration-200 ${sideNewOpen ? 'rotate-180' : ''}`} />
          </button>

          {sideNewOpen && (
            <div className="mt-1.5 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50 relative">
              {NEW_ACTIONS.map(({ label, sub, to, icon: Icon, color, bg }) => (
                <button
                  key={to}
                  onClick={() => handleNew(to)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0"
                >
                  <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                    <Icon size={14} className={color} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{label}</div>
                    <div className="text-xs text-slate-400">{sub}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grouped nav */}
        <nav className="flex-1 px-3 pb-4 space-y-4 overflow-y-auto">
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <p className="px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase text-sidebar-text opacity-40 select-none">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map(({ to, label, icon: Icon, exact, countKey, amOnly }) => {
                  if (amOnly && !isAM) return null;
                  const count = countKey ? counts[countKey] : null;
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end={exact}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive
                            ? 'bg-sidebar-active text-white font-medium'
                            : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon size={17} />
                          <span className="flex-1">{label}</span>
                          <CountBadge n={count} active={isActive} />
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {(displayName || user?.email || 'A')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium leading-tight truncate">
                {displayName || user?.email || 'User'}
              </div>
              {(() => {
                const role = profile?.employeeRole;
                if (isAM || role === 'account_manager') return (
                  <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/20 text-amber-300 rounded-full px-1.5 py-0.5 mt-0.5">
                    Account Manager
                  </span>
                );
                if (role === 'installer') return (
                  <span className="inline-flex items-center text-[10px] font-medium bg-blue-500/20 text-blue-300 rounded-full px-1.5 py-0.5 mt-0.5">
                    Installer
                  </span>
                );
                if (role === 'salesperson') return (
                  <span className="inline-flex items-center text-[10px] font-medium bg-teal-500/20 text-teal-300 rounded-full px-1.5 py-0.5 mt-0.5">
                    Salesperson
                  </span>
                );
                return (
                  <span className="inline-flex items-center text-[10px] font-medium bg-slate-500/20 text-slate-300 rounded-full px-1.5 py-0.5 mt-0.5">
                    Standard User
                  </span>
                );
              })()}
            </div>
            <button onClick={signOut} aria-label="Sign out"
              className="text-sidebar-text hover:text-white p-1 rounded transition-colors flex-shrink-0">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar — z-10 keeps burger + bell above any in-page backdrop/dropdowns */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0 relative z-10">
          <button aria-label="Open navigation" className="lg:hidden text-slate-500 hover:text-slate-800" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-1.5 text-sm text-slate-500 min-w-0">
            <img src="/brand/lusso-black.png" alt="Lusso" className="h-4 w-auto" />
            <ChevronRight size={14} />
          </div>
          <div className="flex-1" />

          {/* Notification bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
              className="relative text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1rem)] bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="font-semibold text-slate-800 text-sm">Notifications</span>
                  {unread > 0 && (
                    <button onClick={handleMarkAllRead} className="text-xs text-amber-600 hover:underline">Mark all read</button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                  {notifications.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-8">No notifications</p>
                  ) : (
                    notifications.slice(0, 20).map(n => {
                      const { icon: NIcon, color, bg } = NOTIF_ICONS[n.type] || NOTIF_ICONS.default;
                      return (
                        <button key={n.id} onClick={() => handleNotifClick(n)}
                          className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left ${!n.isRead ? 'bg-amber-50/40' : ''}`}>
                          <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                            <NIcon size={13} className={color} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-800">{n.title}</p>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                            <p className="text-xs text-slate-400 mt-1">{formatDistanceToNow(parseISO(n.createdAt), { addSuffix: true })}</p>
                          </div>
                          {!n.isRead && <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1.5" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Page content — extra bottom padding on mobile for bottom nav */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden pb-16 lg:pb-0">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-100 flex items-stretch h-16 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] no-print">
        {/* Home */}
        <NavLink to="/" end className={({ isActive }) =>
          `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive ? 'text-amber-600' : 'text-slate-400 hover:text-slate-700'}`}>
          <Home size={20} />
          <span>Home</span>
        </NavLink>

        {/* Jobs */}
        <NavLink to="/jobs" className={({ isActive }) =>
          `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors relative ${isActive ? 'text-amber-600' : 'text-slate-400 hover:text-slate-700'}`}>
          {({ isActive }) => (
            <>
              <div className="relative">
                <Briefcase size={20} />
                {counts.jobs > 0 && (
                  <span className={`absolute -top-1 -right-2 text-[9px] font-bold rounded-full px-1 leading-tight ${isActive ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                    {counts.jobs > 99 ? '99+' : counts.jobs}
                  </span>
                )}
              </div>
              <span>Jobs</span>
            </>
          )}
        </NavLink>

        {/* + New — centre pill */}
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={() => setMobileNewOpen(v => !v)}
            aria-label="Create new"
            className="w-12 h-12 rounded-2xl bg-amber-500 hover:bg-amber-400 flex items-center justify-center shadow-lg transition-colors -mt-4"
          >
            <Plus size={22} className="text-white" />
          </button>
        </div>

        {/* Calendar */}
        <NavLink to="/calendar" className={({ isActive }) =>
          `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors relative ${isActive ? 'text-amber-600' : 'text-slate-400 hover:text-slate-700'}`}>
          {({ isActive }) => (
            <>
              <div className="relative">
                <CalendarDays size={20} />
                {counts.todayInstalls > 0 && (
                  <span className={`absolute -top-1 -right-2 text-[9px] font-bold rounded-full px-1 leading-tight ${isActive ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                    {counts.todayInstalls}
                  </span>
                )}
              </div>
              <span>Calendar</span>
            </>
          )}
        </NavLink>

        {/* Customers */}
        <NavLink to="/customers" className={({ isActive }) =>
          `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive ? 'text-amber-600' : 'text-slate-400 hover:text-slate-700'}`}>
          <Users size={20} />
          <span>Contacts</span>
        </NavLink>
      </nav>

      {/* ── Mobile + New action sheet ─────────────────────────────────────── */}
      {mobileNewOpen && (
        <>
          {/* Backdrop — onClick (not onPointerDown) so sheet item clicks fire first */}
          <div
            className="lg:hidden fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setMobileNewOpen(false)}
          />
          {/* Sheet — z-50, ref excludes it from mousedown outside-click handler */}
          <div
            ref={mobileSheetRef}
            className="lg:hidden fixed bottom-20 left-3 right-3 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden no-print"
          >
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Create New</p>
            </div>
            {NEW_ACTIONS.map(({ label, sub, to, icon: Icon, color, bg }) => (
              <button
                key={to}
                type="button"
                onClick={() => { setMobileNewOpen(false); navigate(to); }}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-100 transition-colors border-b border-slate-50 last:border-0 text-left"
              >
                <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon size={18} className={color} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800">{label}</div>
                  <div className="text-xs text-slate-400">{sub}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

    </div>
  );
}
