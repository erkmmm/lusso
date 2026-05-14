import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { initStore } from './store/data';
import { hydrateFromSupabase } from './store/db';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { UserProfileProvider } from './contexts/UserProfileContext';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { useVersionCheck } from './hooks/useVersionCheck';
import Users from './pages/Users';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobProfile from './pages/JobProfile';
import Customers from './pages/Customers';
import CustomerProfile from './pages/CustomerProfile';
import MeasureSheets from './pages/MeasureSheets';
import NewMeasureSheet from './pages/NewMeasureSheet';
import MeasureSheetView from './pages/MeasureSheetView';
import ImportMeasureSheet from './pages/ImportMeasureSheet';
import Installers from './pages/Installers';
import InstallerProfile from './pages/InstallerProfile';
import InstallationCalendar from './pages/InstallationCalendar';
import InstallResponse from './pages/InstallResponse';
import Settings from './pages/Settings';
import Quotes from './pages/Quotes';
import QuoteBuilder from './pages/QuoteBuilder';
import QuoteView from './pages/QuoteView';
import CustomerQuotePage from './pages/CustomerQuotePage';
import ImportContacts from './pages/ImportContacts';
import ImportHistory from './pages/ImportHistory';
import PricedItems from './pages/PricedItems';
import Employees from './pages/Employees';
import EmployeeProfile from './pages/EmployeeProfile';
import QuoteFromJob from './pages/QuoteFromJob';
import NewJob from './pages/NewJob';
import PendingApproval from './pages/PendingApproval';
import EmployeeOnboarding from './pages/EmployeeOnboarding';
import { useProfile } from './contexts/UserProfileContext';

function AppRoutes() {
  const { user } = useAuth();
  const { profile, needsOnboarding } = useProfile() || {};
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    initStore();
    if (user) {
      setHydrating(true);
      hydrateFromSupabase().finally(() => setHydrating(false));
    }
  }, [user]);

  // Re-hydrate when the tab becomes visible again (catches changes made on
  // other devices while this tab was in the background or screen was off).
  useEffect(() => {
    if (!user) return;
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        hydrateFromSupabase();
      }
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [user]);

  // Still loading auth session OR syncing from cloud
  if (user === undefined || hydrating) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#0F3535]">
        <div className="w-10 h-10 rounded-2xl bg-amber-500 flex items-center justify-center animate-pulse">
          <span className="text-white font-bold text-lg">L</span>
        </div>
        {hydrating && (
          <p className="text-teal-300 text-sm font-medium animate-pulse">Syncing from cloud…</p>
        )}
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
              <Route path="/customers"                  element={<Customers />} />
              <Route path="/customers/:id"              element={<CustomerProfile />} />
              <Route path="/measure-sheets"             element={<MeasureSheets />} />
              <Route path="/measure-sheets/new"         element={<NewMeasureSheet />} />
              <Route path="/measure-sheets/import"      element={<ImportMeasureSheet />} />
              <Route path="/measure-sheets/:id"         element={<MeasureSheetView />} />
              <Route path="/measure-sheets/:id/edit"    element={<NewMeasureSheet />} />
              <Route path="/installers"                 element={<Installers />} />
              <Route path="/installers/:id"             element={<InstallerProfile />} />
              <Route path="/calendar"                   element={<InstallationCalendar />} />
              <Route path="/settings"                   element={<Settings />} />
              <Route path="/import"                     element={<ImportContacts />} />
              <Route path="/import-history"             element={<ImportHistory />} />
              <Route path="/priced-items"               element={<PricedItems />} />
              <Route path="/quotes"                     element={<Quotes />} />
              <Route path="/quotes/new"                        element={<QuoteBuilder />} />
              <Route path="/quotes/new-from-job/:jobId"        element={<QuoteFromJob />} />
              <Route path="/quotes/:id"                        element={<QuoteView />} />
              <Route path="/quotes/:id/edit"                   element={<QuoteBuilder />} />
              <Route path="/employees"                  element={<Employees />} />
              <Route path="/employees/:id"              element={<EmployeeProfile />} />
              <Route path="/users"                      element={<Users />} />
              <Route path="*"                           element={<Dashboard />} />
            </Routes>
          </Layout>
        } />
      </Routes>
  );
}

// ── Update banner — shown when a new deployment is detected ──────────────────
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
            </RealtimeProvider>
          </UserProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
