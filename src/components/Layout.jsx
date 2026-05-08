import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Users, ClipboardList,
  Menu, X, ChevronRight, Bell, Plus, HardHat, CalendarDays,
  CheckCircle2, AlertTriangle, Info, Settings2, FileText, Library,
} from 'lucide-react';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead,
} from '../store/data';
import { useAuth } from '../contexts/AuthContext';
import { LogOut } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';

const NAV = [
  { to: '/',                label: 'Dashboard',     icon: LayoutDashboard, exact: true },
  { to: '/jobs',            label: 'Jobs',          icon: Briefcase },
  { to: '/customers',       label: 'Customers',     icon: Users },
  { to: '/measure-sheets',  label: 'Measure Sheets',icon: ClipboardList },
  { to: '/quotes',          label: 'Quotes',        icon: FileText },
  { to: '/priced-items',    label: 'Price Library', icon: Library },
  { to: '/installers',      label: 'Installers',    icon: HardHat },
  { to: '/calendar',        label: 'Calendar',      icon: CalendarDays },
  { to: '/settings',        label: 'Settings',      icon: Settings2 },
];

const NOTIF_ICONS = {
  install_accepted: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50' },
  install_declined: { icon: AlertTriangle, color: 'text-red-500',  bg: 'bg-red-50' },
  default:          { icon: Info,          color: 'text-blue-500',  bg: 'bg-blue-50' },
};

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [notifOpen, setNotifOpen]       = useState(false);
  const [notifications, setNotifs]      = useState(getNotifications);
  const notifRef = useRef(null);
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const unread = notifications.filter(n => !n.isRead).length;

  // Refresh notifications periodically
  useEffect(() => {
    const id = setInterval(() => setNotifs(getNotifications()), 2000);
    return () => clearInterval(id);
  }, []);

  // Close notif panel on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
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

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-sidebar flex flex-col transform transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">L</span>
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">Lusso</div>
            <div className="text-slate-400 text-xs">Job Management</div>
          </div>
          <button className="ml-auto lg:hidden text-slate-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Quick action */}
        <div className="px-4 py-4">
          <button
            onClick={() => { navigate('/measure-sheets/new'); setSidebarOpen(false); }}
            className="w-full flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            <Plus size={16} />
            New Measure Sheet
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 pb-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
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
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.email?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium leading-tight truncate">{user?.email || 'Admin'}</div>
              <div className="text-sidebar-text text-xs">Lusso</div>
            </div>
            <button
              onClick={signOut}
              title="Sign out"
              className="text-sidebar-text hover:text-white p-1 rounded transition-colors flex-shrink-0"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button className="lg:hidden text-slate-500 hover:text-slate-800" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-1.5 text-sm text-slate-500 min-w-0">
            <span className="text-amber-600 font-medium">Lusso</span>
            <ChevronRight size={14} />
          </div>
          <div className="flex-1" />

          {/* Notification bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen(!notifOpen)}
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
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
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
                      const { icon: Icon, color, bg } = NOTIF_ICONS[n.type] || NOTIF_ICONS.default;
                      return (
                        <button
                          key={n.id}
                          onClick={() => handleNotifClick(n)}
                          className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left ${!n.isRead ? 'bg-amber-50/40' : ''}`}
                        >
                          <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                            <Icon size={13} className={color} />
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

          <button
            onClick={() => navigate('/measure-sheets/new')}
            className="hidden sm:flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
          >
            <Plus size={15} />
            New Measure Sheet
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
