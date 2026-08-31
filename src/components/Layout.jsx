import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Users,
  Menu, X, ChevronRight, Bell, Plus, HardHat, CalendarDays, Star,
  CheckCircle2, AlertTriangle, Info, Settings2, FileText,
  ChevronDown, Home, UserCog, Users2, Inbox, ArrowLeft,
  Globe, Eye, MessageSquare, Clock, ClipboardList, XCircle, Sun, Tags, Upload, ListChecks, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead,
  getCustomers, getJobs, getQuotes, getInstallRequests,
} from '../store/data';
import { getEmployeeCountSync } from '../store/profiles';
import { toast } from './ToastContainer';
import RouteErrorBoundary from './ErrorBoundary';
import PushPrompt from './PushPrompt';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/UserProfileContext';
import { useSidebar } from '../contexts/SidebarContext';
import { LogOut } from 'lucide-react';
import { formatDistanceToNow, parseISO, isSameDay } from 'date-fns';

// ── Nav structure ─────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: 'WORKFLOW',
    items: [
      { to: '/',               label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { to: '/today',          label: 'Today',     icon: ListChecks },
      { to: '/customers', label: 'Customers', icon: Users,     countKey: 'customers' },
      { to: '/jobs',      label: 'Projects',  icon: Briefcase, countKey: 'jobs' },
      { to: '/inbox',     label: 'Inbox',     icon: Inbox },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/installers',   label: 'Installers',    icon: HardHat },
      { to: '/calendar',     label: 'Calendar',      icon: CalendarDays, countKey: 'todayInstalls' },
      { to: '/reviews',      label: 'Reviews',       icon: Star },
      // The price library was reachable only from a button inside Settings, so
      // nobody could find it. It's a working tool, not a setting.
      { to: '/priced-items', label: 'Price Library', icon: Tags },
      { to: '/imports',      label: 'Import',        icon: Upload },
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
// One front door. A project is the whole piece of work for a customer; quotes,
// measure sheets and POs are created INSIDE it (pre-filled), so the customer is
// only ever entered once. There is deliberately no standalone "New Quote".
const NEW_ACTIONS = [
  {
    label: 'New Project',
    sub:   'Start a job for a customer — quote, measure & order all live inside it',
    to:    '/jobs/new',
    icon:  Briefcase,
    color: 'text-amber-600',
    bg:    'bg-amber-50',
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
  install_accepted:   { icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
  install_declined:   { icon: AlertTriangle, color: 'text-red-500',    bg: 'bg-red-50' },
  web_enquiry:        { icon: Globe,         color: 'text-amber-600',  bg: 'bg-amber-50' },
  comm_inbound:       { icon: MessageSquare, color: 'text-violet-500', bg: 'bg-violet-50' },
  quote_first_opened: { icon: Eye,           color: 'text-sky-500',    bg: 'bg-sky-50' },
  quote_viewed:       { icon: Eye,           color: 'text-sky-400',    bg: 'bg-sky-50' },
  quote_accepted:     { icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
  quote_declined:     { icon: XCircle,       color: 'text-red-500',    bg: 'bg-red-50' },
  task_assigned:      { icon: ClipboardList, color: 'text-slate-500',  bg: 'bg-slate-100' },
  task_due:           { icon: Clock,         color: 'text-orange-500', bg: 'bg-orange-50' },
  needs_booking:      { icon: CalendarDays,  color: 'text-teal-600',   bg: 'bg-teal-50' },
  review_ready:       { icon: Star,          color: 'text-yellow-500', bg: 'bg-yellow-50' },
  morning_brief:      { icon: Sun,           color: 'text-amber-500',  bg: 'bg-amber-50' },
  default:            { icon: Info,          color: 'text-blue-500',   bg: 'bg-blue-50' },
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

// ── Build marker ──────────────────────────────────────────────────────────────
// Which build is this browser actually running? The values are inlined at build
// time (vite.config.js `define`), so this reports the running bundle rather than
// whatever version.json the server happens to serve — meaning a stale cached
// bundle shows up as an old marker instead of being masked by a fresh fetch.
// A trailing "+" on the SHA means the build had uncommitted changes.
function BuildMarker() {
  const built = new Date(__BUILT_AT__);
  const when = isNaN(built)
    ? ''
    : built.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <div
      className="mt-3 pt-2.5 border-t border-sidebar-border/60 flex items-center gap-1.5 text-[10px] text-sidebar-text opacity-40 select-text"
      title={`Build ${__BUILD_SHA__} — ${isNaN(built) ? __BUILT_AT__ : built.toISOString()}`}
    >
      <span className="font-mono">{__BUILD_SHA__}</span>
      {when && <><span aria-hidden="true">·</span><span>{when}</span></>}
    </div>
  );
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

/**
 * The notification bell and its panel.
 *
 * Extracted so it can sit in the sidebar on a laptop and in the mobile top bar,
 * without two copies of the panel drifting apart. `placement` only moves the
 * panel: from the sidebar it flies out to the right, since there is no room
 * below a control that already sits at the bottom of the screen.
 */
function NotificationBell({ open, setOpen, unread, notifications, onMarkAllRead, onNotifClick, placement = 'below' }) {
  // Its own ref and its own outside-click. Both placements are mounted at once
  // (one is simply hidden by a breakpoint), so a single shared ref would point
  // at whichever mounted last — and a click on the VISIBLE bell would read as
  // "outside" the hidden one and close the panel the instant it opened.
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        title="Notifications"
        className={`relative p-1.5 rounded-lg transition-colors ${
          placement === 'side'
            ? 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
        }`}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute w-80 max-w-[calc(100vw-1rem)] bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden ${
          placement === 'side' ? 'left-full bottom-0 ml-2' : 'right-0 top-full mt-2'
        }`}>
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">Notifications</span>
            {unread > 0 && (
              <button onClick={onMarkAllRead} className="text-xs text-amber-600 hover:underline">Mark all read</button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
            {notifications.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">No notifications</p>
            ) : (
              notifications.slice(0, 20).map(n => {
                const { icon: NIcon, color, bg } = NOTIF_ICONS[n.type] || NOTIF_ICONS.default;
                return (
                  <button key={n.id} onClick={() => onNotifClick(n)}
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
  );
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { rail, toggle: toggleRail } = useSidebar();
  const [notifOpen, setNotifOpen]     = useState(false);
  const [sideNewOpen, setSideNewOpen]   = useState(false); // sidebar "New" dropdown
  const [mobileNewOpen, setMobileNewOpen] = useState(false); // mobile bottom sheet
  const [notifications, setNotifs]    = useState(getNotifications);
  const [counts, setCounts]           = useState(computeCounts);
  const sideNewRef    = useRef(null); // wraps sidebar + New section
  const mobileSheetRef = useRef(null); // mobile action sheet
  const navigate      = useNavigate();
  const location      = useLocation();
  const { user, signOut } = useAuth();

  // Global back — shown on every page except the dashboard. Goes back in
  // history, or to the dashboard if there's nowhere to go back to.
  const isDashboard = location.pathname === '/';
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  // Content scrolls inside <main>, not the window, so React Router can't reset
  // it. Scroll the page to the top on every route change (incl. back/forward)
  // so you always land at the top of the page you arrive on.
  const mainRef = useRef(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
    window.scrollTo(0, 0);
  }, [location.pathname]);
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

  // Never let a full-storage save fail silently — warn the user prominently so
  // they can free space / go online (the record is still pushed to the cloud).
  useEffect(() => {
    let last = 0;
    const onFull = () => {
      const now = Date.now();
      if (now - last < 60000) return; // don't spam
      last = now;
      toast('Device storage is full — saved to the cloud but not this device. Free up space or sync soon.', 'error', { duration: 10000 });
    };
    window.addEventListener('lusso:storage-full', onFull);
    return () => window.removeEventListener('lusso:storage-full', onFull);
  }, []);

  // Tapping a push notification focuses the open app and posts the target
  // route back to it — route it through the router so it doesn't hard-reload.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e) => {
      if (e.data?.type === 'lusso:navigate' && e.data.url) navigate(e.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  // Close popups on outside click
  useEffect(() => {
    const handler = (e) => {
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
    if (n.link) navigate(n.link);
    else if (n.jobId) navigate(`/jobs/${n.jobId}`);
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
    <div className="app-shell flex h-screen overflow-hidden bg-slate-50">

      {/* ── Mobile sidebar overlay ─────────────────────────────────────────── */}
      {/* Layering on mobile: bottom nav z-20 < this scrim z-30 < sidebar z-40 <
          modals z-50, so an open drawer covers the nav instead of being clipped
          by it. */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile + New sheet overlay is co-located with the sheet below ── */}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      {/* Width is the only thing that animates — the contents swap instantly, so
          nothing is caught mid-fade while the rail is settling.

          `lg:translate-none`, NOT `lg:translate-x-0`. Tailwind v4 compiles these
          to the `translate` CSS property, and ANY value other than `none` —
          including a zero one — makes the element a stacking context. On desktop
          this aside is otherwise static/z-auto, so a translate of 0px trapped
          everything inside it in its own stacking context: the notification and
          "New" panels are absolutely positioned with z-50, but the sidebar paints
          before <main> in DOM order, so dashboard cards drew straight over the
          top of them however high that z-index went. `none` creates no stacking
          context, and the desktop sidebar never needed a translate anyway — it
          only exists to cancel the mobile drawer's -translate-x-full. */}
      <aside className={`app-sidebar fixed inset-y-0 left-0 z-40 bg-sidebar flex flex-col transition-[width,translate] duration-200 lg:translate-none lg:static lg:z-auto ${
        rail ? 'w-64 lg:w-16' : 'w-64'
      } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>

        {/* Logo */}
        <div className={`flex items-center border-b border-sidebar-border ${rail ? 'justify-center px-2 py-4' : 'gap-3 px-6 py-5'}`}>
          {rail ? (
            <button
              onClick={toggleRail}
              title="Expand navigation (⌘\\)"
              aria-label="Expand navigation"
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-sidebar-hover transition-colors group"
            >
              {/* The mark, swapping to the expand affordance on hover — the rail
                  has no room for both, and the logo is the obvious thing to aim
                  at when you want your navigation back. */}
              <img src="/icon-192.png" alt="Lusso" className="h-6 w-6 rounded group-hover:hidden" />
              <PanelLeftOpen size={18} className="text-white hidden group-hover:block" />
            </button>
          ) : (
            <>
              <div>
                <img src="/brand/lusso-white.png" alt="Lusso" className="h-6 w-auto" />
                <div className="text-slate-400 text-xs mt-1">Job Management</div>
              </div>
              <button
                onClick={toggleRail}
                title="Collapse navigation (⌘\\)"
                aria-label="Collapse navigation"
                className="ml-auto hidden lg:block text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <PanelLeftClose size={17} />
              </button>
              <button aria-label="Close sidebar" className="ml-auto lg:hidden text-slate-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
                <X size={18} />
              </button>
            </>
          )}
        </div>

        {/* Back — desktop only; the mobile bar still carries its own. */}
        {!isDashboard && (
          <div className={`hidden lg:block ${rail ? 'px-2 pt-3' : 'px-4 pt-4'}`}>
            <button
              onClick={goBack}
              aria-label="Back"
              title="Back"
              className={`flex items-center rounded-lg text-sidebar-text hover:bg-sidebar-hover hover:text-white transition-colors ${
                rail ? 'w-10 h-10 mx-auto justify-center' : 'w-full gap-2 px-3 py-2 text-sm'
              }`}
            >
              <ArrowLeft size={17} />
              {!rail && <span className="font-medium">Back</span>}
            </button>
          </div>
        )}

        {/* + New dropdown */}
        <div className={`${rail ? 'px-2 py-3' : 'px-4 py-4'} relative`} ref={sideNewRef}>
          <button
            onClick={() => setSideNewOpen(v => !v)}
            title={rail ? 'New' : undefined}
            aria-label="New"
            className={`bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center ${
              rail ? 'w-10 h-10 mx-auto justify-center' : 'w-full gap-2 px-4 py-2.5'
            }`}
          >
            <Plus size={16} />
            {!rail && (
              <>
                <span className="flex-1 text-left">New</span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${sideNewOpen ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>

          {sideNewOpen && (
            <div className={`bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50 ${
              // In the rail the menu can't sit under a 40px button — it flies out
              // beside it instead, which is also where a rail user expects it.
              rail ? 'absolute left-full top-2 ml-2 w-64' : 'mt-1.5 relative'
            }`}>
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
        <nav className={`flex-1 pb-4 overflow-y-auto overflow-x-visible ${rail ? 'px-2 space-y-2' : 'px-3 space-y-4'}`}>
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              {rail ? (
                // A hairline stands in for the section heading, so the grouping
                // survives without the words.
                <div className="h-px bg-sidebar-border/60 mx-2 mb-2 first:hidden" aria-hidden="true" />
              ) : (
                <p className="px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase text-sidebar-text opacity-40 select-none">
                  {section.label}
                </p>
              )}
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
                      title={rail ? label : undefined}
                      aria-label={rail ? label : undefined}
                      className={({ isActive }) =>
                        `flex items-center rounded-lg text-sm transition-colors relative ${
                          rail ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2.5'
                        } ${
                          isActive
                            ? 'bg-sidebar-active text-white font-medium'
                            : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon size={17} />
                          {rail ? (
                            // No room for the number, but "there is something
                            // waiting" still has to survive the collapse.
                            count > 0 && (
                              <span
                                className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-sidebar"
                                aria-label={`${count} waiting`}
                              />
                            )
                          ) : (
                            <>
                              <span className="flex-1">{label}</span>
                              <CountBadge n={count} active={isActive} />
                            </>
                          )}
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
        <div className={`border-t border-sidebar-border ${rail ? 'px-2 py-3' : 'px-4 py-4'}`}>
          {rail ? (
            // Who you are and the way out — the two things worth 40px each.
            <div className="flex flex-col items-center gap-2">
              <div className="hidden lg:block">
                <NotificationBell
            open={notifOpen} setOpen={setNotifOpen}
                  unread={unread} notifications={notifications}
                  onMarkAllRead={handleMarkAllRead} onNotifClick={handleNotifClick}
                  placement="side"
                />
              </div>
              <div
                className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold"
                title={displayName || user?.email || 'User'}
              >
                {(displayName || user?.email || 'A')[0].toUpperCase()}
              </div>
              <button onClick={signOut} aria-label="Sign out" title="Sign out"
                className="text-sidebar-text hover:text-white p-1.5 rounded transition-colors">
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(displayName || user?.email || 'A')[0].toUpperCase()}
                </div>
                <div className="hidden lg:block -ml-1">
                  <NotificationBell
            open={notifOpen} setOpen={setNotifOpen}
                    unread={unread} notifications={notifications}
                    onMarkAllRead={handleMarkAllRead} onNotifClick={handleNotifClick}
                    placement="side"
                  />
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

              <BuildMarker />
            </>
          )}
        </div>

      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar — MOBILE ONLY.
            On a laptop the sidebar is already on screen, so this row was
            spending ~53px of every page on a logo the sidebar repeats, a
            breadcrumb chevron pointing at nothing, and two controls that fit
            perfectly well in the sidebar itself. Back and the bell moved there;
            below `lg` the sidebar is a drawer, so the bar still earns its keep.
            z-10 keeps burger + bell above any in-page backdrop/dropdowns. */}
        <header className="lg:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0 relative z-10">
          <button aria-label="Open navigation" className="lg:hidden text-slate-500 hover:text-slate-800" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          {!isDashboard && (
            <button aria-label="Back" onClick={goBack}
              className="flex items-center gap-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg px-2 py-1.5 transition-colors flex-shrink-0">
              <ArrowLeft size={18} />
              <span className="hidden sm:inline text-sm font-medium">Back</span>
            </button>
          )}
          <div className="flex items-center gap-1.5 text-sm text-slate-500 min-w-0">
            <img src="/brand/lusso-black.png" alt="Lusso" className="brand-logo-light h-4 w-auto" />
            <img src="/brand/lusso-white.png" alt="Lusso" className="brand-logo-dark h-4 w-auto" />
            <ChevronRight size={14} />
          </div>
          <div className="flex-1" />

          <NotificationBell
            open={notifOpen} setOpen={setNotifOpen}
            unread={unread} notifications={notifications}
            onMarkAllRead={handleMarkAllRead} onNotifClick={handleNotifClick}
          />
        </header>

        {/* Page content — extra bottom padding on mobile for bottom nav */}
        <main ref={mainRef} className="app-main flex-1 overflow-y-auto overflow-x-hidden pb-16 lg:pb-0">
          <RouteErrorBoundary>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-100 flex items-stretch h-16 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] no-print">
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
              <span>Projects</span>
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

      <PushPrompt />

    </div>
  );
}
