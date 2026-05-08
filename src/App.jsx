import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { initStore } from './store/data';
import { hydrateFromSupabase } from './store/db';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
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

function AppRoutes() {
  const { user } = useAuth();
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    initStore();
    if (user) {
      setHydrating(true);
      hydrateFromSupabase().finally(() => setHydrating(false));
    }
  }, [user]);

  // Still loading auth session OR syncing from cloud
  if (user === undefined || hydrating) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#0F3535]">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center animate-pulse">
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
              <Route path="/jobs/:id"                   element={<JobProfile />} />
              <Route path="/customers"                  element={<Customers />} />
              <Route path="/customers/:id"              element={<CustomerProfile />} />
              <Route path="/measure-sheets"             element={<MeasureSheets />} />
              <Route path="/measure-sheets/new"         element={<NewMeasureSheet />} />
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
              <Route path="/quotes/new"                 element={<QuoteBuilder />} />
              <Route path="/quotes/:id"                 element={<QuoteView />} />
              <Route path="/quotes/:id/edit"            element={<QuoteBuilder />} />
              <Route path="/employees"                  element={<Employees />} />
              <Route path="/employees/:id"              element={<EmployeeProfile />} />
              <Route path="*"                           element={<Dashboard />} />
            </Routes>
          </Layout>
        } />
      </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
