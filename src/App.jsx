import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { initStore } from './store/data';
import { hydrateFromSupabase } from './store/db';
import { supabase } from './lib/supabase';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { UserProfileProvider } from './contexts/UserProfileContext';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { useVersionCheck } from './hooks/useVersionCheck';
import ToastContainer from './components/ToastContainer';
// Users page merged into Employees (Team) — import kept for redirect only
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobProfile from './pages/JobProfile';
import JobTakeoff from './pages/JobTakeoff';
import Customers from './pages/Customers';
import CustomerProfile from './pages/CustomerProfile';
import MeasureSheets from './pages/MeasureSheets';
import NewMeasureSheet from './pages/NewMeasureSheet';
import MeasureSheetView from './pages/MeasureSheetView';
import PurchaseOrder from './pages/PurchaseOrder';
import ImportMeasureSheet from './pages/ImportMeasureSheet';
import Installers from './pages/Installers';
import InstallerProfile from './pages/InstallerProfile';
import InstallationCalendar from './pages/InstallationCalendar';
import InstallResponse from './pages/InstallResponse';
import Settings from './pages/Settings';
import Quotes from './pages/Quotes';
import ImportQuotes from './pages/ImportQuotes';
import QuoteBuilder from './pages/QuoteBuilder';
import QuoteView from './pages/QuoteView';
import CustomerQuotePage from './pages/CustomerQuotePage';
import ImportContacts from './pages/ImportContacts';
import ImportHistory from './pages/ImportHistory';
import PricedItems from './pages/PricedItems';
import ImportSupplierPDF from './pages/ImportSupplierPDF';
import Employees from './pages/Employees';
import EmployeeProfile from './pages/EmployeeProfile';
import QuoteFromJob from './pages/QuoteFromJob';
import NewJob from './pages/NewJob';
import PendingApproval from './pages/PendingApproval';
import EmployeeOnboarding from './pages/EmployeeOnboarding';
import Inbox from './pages/Inbox';
import Reviews from './pages/Reviews';
import { useProfile } from './contexts/UserProfileContext';

// Data keys cleared on version change — excludes UI prefs like theme/schema.
// NOTE: lusso_user_profiles is deliberately NOT wiped — it's the signed-in
// user's own profile cache. Wiping it meant that if the post-deploy profile
// re-fetch ever hiccuped, the app fabricated a fresh (pending) profile and
// locked a real account manager out onto the approval screen.
/** Fetch the stamped build version from /version.json */
async function fetchBuildVersion() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.v ? String(d.v) : null;
  } catch { return null; }
}

function AppRoutes() {
  const { user } = useAuth();
  const { profile, needsOnboarding } = useProfile() || {};
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    initStore();
    if (!user) return;

    // Do we already have cached data on this device? If so, render the app
    // instantly from cache and refresh in the background — NEVER block behind
    // the syncing screen. Only a first-ever login (empty cache) waits.
    const hasLocalData = ['lusso_customers', 'lusso_jobs', 'lusso_quotes']
      .some(k => (localStorage.getItem(k) || '').length > 20);

    const run = async () => {
      // Track the deployed build for reference. We intentionally do NOT wipe
      // local data on a new build: hydrateFromSupabase() already pulls a fresh,
      // authoritative copy (and keeps newer local edits), so wiping only risked
      // flashing an empty app if the re-download was slow on a mobile connection.
      const deployedVersion = await fetchBuildVersion();
      if (deployedVersion) localStorage.setItem('lusso_last_version', deployedVersion);

      if (!hasLocalData) {
        // First load / empty cache: fully hydrate before showing the app so we
        // never flash an empty Jobs/Customers list. Generous timeout (slow
        // mobile + thousands of rows); SlowLoadRetry is the escape hatch.
        setHydrating(true);
        await Promise.race([
          hydrateFromSupabase(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('hydration timed out')), 45000)),
        ]);
      } else {
        // Have cache: the app is already rendered from it. Refresh in the
        // background, but don't let a hung request block — fall through to
        // cached data after 20s and let the visibility/poll catch up.
        await Promise.race([
          hydrateFromSupabase(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('hydration timed out')), 20000)),
        ]);
      }
      // Fresh data is in localStorage now — nudge pages to re-render with it.
      window.dispatchEvent(new CustomEvent('lusso:data-changed'));
    };

    // Never strand the user on the syncing screen: any hydration failure or
    // timeout (network, storage quota, stuck session) logs and falls through to
    // the app with whatever local data exists. The visibility/poll re-hydrates.
    run()
      .catch(e => console.error('[app] hydration failed — continuing with local data:', e))
      .finally(() => setHydrating(false));
  // Depend on user.id only — NOT the user object (onAuthStateChange gives a
  // fresh object on every token refresh).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Re-hydrate when the tab becomes visible again (catches changes made on
  // other devices while this tab was in the background or screen was off).
  useEffect(() => {
    if (!user) return;
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        hydrateFromSupabase().then(() => {
          window.dispatchEvent(new CustomEvent('lusso:data-changed'));
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [user]);

  // ── Polling fallback ──────────────────────────────────────────────────
  // Realtime WebSocket events aren't reliably delivered in all environments.
  // Poll Supabase every 4 seconds while the tab is visible.
  // Each poll fetches only the max(updated_at) across key tables — tiny query.
  // If anything changed since last poll, do a full hydration.
  const lastSeenRef = useRef(null);
  useEffect(() => {
    if (!user || !supabase) return;

    let interval = null;

    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        // Probe the latest updated_at across all key tables in parallel (single-row each)
        const POLL_TABLES = ['jobs','customers','measure_sheets','quotes','installers','calendar_events','priced_items'];
        const results = await Promise.all(
          POLL_TABLES.map(t =>
            supabase.from(t).select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle()
          )
        );
        // Find the most recent updated_at across all tables
        const latest = results
          .map(r => r.data?.updated_at)
          .filter(Boolean)
          .sort()
          .pop() ?? null;

        if (!lastSeenRef.current) {
          // First poll — record baseline only, no hydrate (mount already did that)
          lastSeenRef.current = latest;
        } else if (latest && latest !== lastSeenRef.current) {
          lastSeenRef.current = latest;
          await hydrateFromSupabase();
          window.dispatchEvent(new CustomEvent('lusso:data-changed'));
        }
      } catch { /* silently ignore poll errors */ }
    };

    // Start polling after a short delay so mount hydration completes first
    const start = setTimeout(() => {
      poll();
      interval = setInterval(poll, 4000);
    }, 3000);

    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [user]);

  // Still loading auth session OR syncing from cloud
  if (user === undefined || hydrating) {
    return (
      <div className="loading-screen min-h-screen flex flex-col items-center justify-center gap-3">
        <img src="/brand/lusso-black.png" alt="Lusso" className="loading-logo-light h-9 w-auto animate-pulse" />
        <img src="/brand/lusso-white.png" alt="Lusso" className="loading-logo-dark h-9 w-auto animate-pulse" />
        {hydrating && (
          <p className="text-slate-500 dark:text-slate-300 text-sm font-medium animate-pulse">Syncing from cloud…</p>
        )}
        {/* Escape hatch — if loading hangs (e.g. a stale cached build), let the
            user force a fresh reload instead of being stranded here. */}
        <SlowLoadRetry />
      </div>
    );
  }

  // Not logged in — show login for all protected routes
  if (!user) {
    return (
      <Routes>
        <Route path="/install-response/:token" element={<InstallResponse />} />
        <Route path="/quotes/:id/preview"       element={<CustomerQuotePage />} />
        <Route path="/forgot-password"          element={<ForgotPassword />} />
        <Route path="/reset-password"           element={<ResetPassword />} />
        <Route path="*"                         element={<Login />} />
      </Routes>
    );
  }

  // Pending user — show waiting screen regardless of route
  if (
    profile?.accountType === 'pending_user' ||
    profile?.accountType === 'pending'      || // legacy
    profile?.role        === 'pending'      || // legacy localStorage cache
    profile?.role        === 'pending_user' || // legacy localStorage cache
    profile?.status      === 'pending'
  ) {
    return (
      <Routes>
        <Route path="/install-response/:token" element={<InstallResponse />} />
        <Route path="/quotes/:id/preview"      element={<CustomerQuotePage />} />
        <Route path="*"                        element={<PendingApproval />} />
      </Routes>
    );
  }

  // Approved employee who hasn't completed their profile yet
  if (needsOnboarding) {
    return (
      <Routes>
        <Route path="/install-response/:token" element={<InstallResponse />} />
        <Route path="/quotes/:id/preview"      element={<CustomerQuotePage />} />
        <Route path="*"                        element={<EmployeeOnboarding />} />
      </Routes>
    );
  }

  return (
    <Routes>
        {/* Public pages — no layout wrapper */}
        <Route path="/install-response/:token"  element={<InstallResponse />} />
        <Route path="/quotes/:id/preview"        element={<CustomerQuotePage />} />

        {/* Main app with layout */}
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/"                           element={<Dashboard />} />
              <Route path="/jobs"                       element={<Jobs />} />
              <Route path="/jobs/new"                   element={<NewJob />} />
              <Route path="/jobs/:id"                   element={<JobProfile />} />
              <Route path="/jobs/:id/takeoff"           element={<JobTakeoff />} />
              <Route path="/customers"                  element={<Customers />} />
              <Route path="/customers/:id"              element={<CustomerProfile />} />
              <Route path="/measure-sheets"             element={<MeasureSheets />} />
              <Route path="/measure-sheets/new"         element={<NewMeasureSheet />} />
              <Route path="/measure-sheets/import"      element={<ImportMeasureSheet />} />
              <Route path="/measure-sheets/:id"         element={<MeasureSheetView />} />
              <Route path="/measure-sheets/:id/purchase-order" element={<PurchaseOrder />} />
              <Route path="/measure-sheets/:id/edit"    element={<NewMeasureSheet />} />
              <Route path="/installers"                 element={<Installers />} />
              <Route path="/installers/:id"             element={<InstallerProfile />} />
              <Route path="/calendar"                   element={<InstallationCalendar />} />
              <Route path="/settings"                   element={<Settings />} />
              <Route path="/import"                     element={<ImportContacts />} />
              <Route path="/import-history"             element={<ImportHistory />} />
              <Route path="/priced-items"               element={<PricedItems />} />
              <Route path="/priced-items/import-pdf"   element={<ImportSupplierPDF />} />
              <Route path="/quotes"                     element={<Quotes />} />
              <Route path="/quotes/import"                     element={<ImportQuotes />} />
              <Route path="/quotes/new"                        element={<QuoteBuilder />} />
              <Route path="/quotes/new-from-job/:jobId"        element={<QuoteFromJob />} />
              <Route path="/quotes/:id"                        element={<QuoteView />} />
              <Route path="/quotes/:id/edit"                   element={<QuoteBuilder />} />
              <Route path="/employees"                  element={<Employees />} />
              <Route path="/employees/:id"              element={<EmployeeProfile />} />
              <Route path="/users"                      element={<Navigate to="/employees" replace />} />
              <Route path="/inbox"                      element={<Inbox />} />
              <Route path="/reviews"                    element={<Reviews />} />
              <Route path="*"                           element={<Dashboard />} />
            </Routes>
          </Layout>
        } />
      </Routes>
  );
}

// ── Update banner — shown when a new deployment is detected ──────────────────
// Escape hatches on the loading screen: after 12s offer a reload, and a
// full sign-out+reset so a stuck session (or wrongly-cached profile) can
// always be broken out of and re-authenticated.
function SlowLoadRetry() {
  const [slow, setSlow] = useState(false);
  const { signOut } = useAuth();
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, []);
  if (!slow) return null;
  const hardReset = async () => {
    try { await signOut(); } catch { /* ignore */ }
    try { localStorage.removeItem('lusso_user_profiles'); localStorage.removeItem('lusso_last_version'); } catch { /* ignore */ }
    window.location.reload();
  };
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <button
        onClick={() => window.location.reload()}
        className="text-xs font-medium text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:text-slate-600 transition-colors"
      >
        Taking a while? Tap to reload
      </button>
      <button
        onClick={hardReset}
        className="text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 underline"
      >
        Still stuck? Sign out and start over
      </button>
    </div>
  );
}

function UpdateBanner() {
  const { updateAvailable, applyUpdate } = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div className="fixed bottom-20 lg:bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">New version available</p>
          <p className="text-xs text-slate-400">Tap to update and get the latest features.</p>
        </div>
        <button
          onClick={applyUpdate}
          className="flex-shrink-0 bg-white text-slate-900 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          Update
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <UserProfileProvider>
            <RealtimeProvider>
              <AppRoutes />
              <UpdateBanner />
              <ToastContainer />
            </RealtimeProvider>
          </UserProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
