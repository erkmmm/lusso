import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/UserProfileContext';
import { Clock, LogOut, Mail, ShieldCheck } from 'lucide-react';

export default function PendingApproval() {
  const { user, signOut } = useAuth();
  const { displayName, profile } = useProfile() || {};

  const name = displayName || user?.email?.split('@')[0] || 'there';

  return (
    <div className="min-h-screen bg-[#F7F8F6] flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-10">
          <img src="/brand/lusso-black.png" alt="Lusso" className="h-8 w-auto" />
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
            <Clock size={28} className="text-amber-500" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-slate-900">Awaiting approval, {name}</h1>
            <p className="text-slate-500 text-sm mt-2 leading-relaxed">
              Your account has been created and is pending approval by an Account Manager.
              You'll receive access once your role has been assigned.
            </p>
          </div>

          <div className="bg-slate-50 rounded-xl px-4 py-4 space-y-2 text-left">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Mail size={14} className="text-slate-400 flex-shrink-0" />
              <span className="truncate">{user?.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck size={14} className="text-amber-500 flex-shrink-0" />
              <span className="text-amber-700 font-medium">Status: Pending approval</span>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Contact your Account Manager if you need access urgently.
          </p>

          <button
            onClick={signOut}
            className="flex items-center justify-center gap-2 w-full border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          © {new Date().getFullYear()} Lusso. All rights reserved.
        </p>
      </div>
    </div>
  );
}
