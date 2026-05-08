import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { initStore } from './store/data';
import { hydrateFromSupabase } from './store/db';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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

function AppRoutes() {
  const { user } = useAuth();

  useEffect(() => {
    initStore();
    if (user) hydrateFromSupabase();
  }, [user]);

  // Still loading session
  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8F6]">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 animate-pulse" />
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
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
