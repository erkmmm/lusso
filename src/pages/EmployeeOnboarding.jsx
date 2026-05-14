import { useState } from 'react';
import { User, Phone, MapPin, AlertCircle, CheckCircle, LogOut } from 'lucide-react';
import { useProfile } from '../contexts/UserProfileContext';
import { completeEmployeeProfile } from '../store/profiles';
import { supabase } from '../lib/supabase';

export default function EmployeeOnboarding() {
  const { profile, refreshProfile } = useProfile();
  const [form, setForm] = useState({
    displayName:          profile?.displayName || '',
    phone:                profile?.phone || '',
    address:              profile?.address || '',
    emergencyContactName: profile?.emergencyContactName || '',
    emergencyContactPhone: profile?.emergencyContactPhone || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState(false);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.displayName.trim()) { setError('Full name is required.'); return; }
    if (!form.phone.trim())       { setError('Phone number is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await completeEmployeeProfile({ ...form, id: profile?.id });
      await refreshProfile();
      setDone(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await supabase?.auth.signOut();
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F3535] p-4">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-xl">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">All set!</h2>
          <p className="text-gray-500 text-sm">Your profile is complete. Taking you to the app…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F3535] flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center mx-auto mb-3 shadow-lg">
          <span className="text-white font-bold text-2xl">L</span>
        </div>
        <h1 className="text-white text-2xl font-bold">Welcome to Lusso</h1>
        <p className="text-teal-300 text-sm mt-1">Complete your profile to get started</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Section: Personal */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Personal Details</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Full Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.displayName}
                onChange={e => set('displayName', e.target.value)}
                placeholder="Your full name"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Mobile Number <span className="text-red-500">*</span></label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  placeholder="04xx xxx xxx"
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Home Address</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <textarea
                  value={form.address}
                  onChange={e => set('address', e.target.value)}
                  placeholder="Street, Suburb, State, Postcode"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section: Emergency Contact */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Emergency Contact</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Contact Name</label>
              <input
                type="text"
                value={form.emergencyContactName}
                onChange={e => set('emergencyContactName', e.target.value)}
                placeholder="e.g. Jane Smith (Partner)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Contact Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="tel"
                  value={form.emergencyContactPhone}
                  onChange={e => set('emergencyContactPhone', e.target.value)}
                  placeholder="04xx xxx xxx"
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-gray-50">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-[#0F3535] text-white font-semibold py-3 rounded-xl hover:bg-teal-800 transition-colors disabled:opacity-50 text-sm"
          >
            {saving ? 'Saving…' : 'Complete Profile & Enter App'}
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full mt-3 flex items-center justify-center gap-2 text-gray-400 hover:text-gray-600 text-sm py-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </form>

      <p className="text-teal-400 text-xs mt-6 text-center max-w-xs">
        This information is stored securely and only visible to your account manager.
      </p>
    </div>
  );
}
