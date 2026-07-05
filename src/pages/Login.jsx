import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle2 } from 'lucide-react';

export default function Login() {
  const { signIn, signUp, error } = useAuth();
  const [tab, setTab]           = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [signupDone, setSignupDone] = useState(false); // email-confirm required
  const [signupMsg, setSignupMsg]   = useState('');
  const [pwError, setPwError]       = useState('');

  const MIN_PASSWORD = 12;

  const handleSignIn = async (e) => {
    e.preventDefault();
    setLoading(true);
    await signIn(email, password);
    setLoading(false);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setPwError('');
    if (password.length < MIN_PASSWORD) {
      setPwError(`Use at least ${MIN_PASSWORD} characters. Avoid common or reused passwords.`);
      return;
    }
    setLoading(true);
    const result = await signUp(email, password);
    setLoading(false);
    if (result?.success) {
      if (result.needsConfirm) {
        // Supabase sent a confirmation email
        setSignupDone(true);
        setSignupMsg(`A confirmation link has been sent to ${email}. Click it to activate your account, then sign in.`);
      }
      // If !needsConfirm the user is auto-signed-in → UserProfileContext bootstraps them
    }
  };

  const switchTab = (t) => {
    setTab(t);
    setEmail('');
    setPassword('');
    setName('');
    setSignupDone(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-[420px] flex-shrink-0 bg-sidebar flex-col justify-between px-10 py-12">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div>
              <img src="/brand/lusso-white.png" alt="Lusso" className="h-8 w-auto" />
              <div className="text-sidebar-text text-xs mt-1.5">Job Management</div>
            </div>
          </div>

          <h2 className="text-white text-3xl font-bold leading-snug">
            Window furnishings,<br />managed beautifully.
          </h2>
          <p className="text-sidebar-text mt-4 text-sm leading-relaxed">
            Quotes, measure sheets, installers, and customer records — all in one place.
          </p>
        </div>

        <p className="text-sidebar-text text-xs">© {new Date().getFullYear()} Lusso. All rights reserved.</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-[#F7F8F6] px-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <img src="/brand/lusso-black.png" alt="Lusso" className="h-7 w-auto" />
          </div>

          {/* Tabs */}
          <div className="flex bg-slate-100 rounded-xl p-1 mb-7">
            <button
              onClick={() => switchTab('signin')}
              className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
                tab === 'signin'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => switchTab('signup')}
              className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
                tab === 'signup'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Create account
            </button>
          </div>

          {/* ── Sign In ── */}
          {tab === 'signin' && (
            <>
              <h1 className="text-2xl font-bold text-slate-900 mb-1">Welcome back</h1>
              <p className="text-slate-500 text-sm mb-7">Sign in to your account to continue.</p>

              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-slate-700">Password</label>
                    <Link to="/forgot-password" className="text-xs text-amber-600 hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-4 py-3 rounded-xl">
                    {error === 'Invalid login credentials'
                      ? 'Incorrect email or password. Please try again.'
                      : error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </>
          )}

          {/* ── Sign Up ── */}
          {tab === 'signup' && !signupDone && (
            <>
              <h1 className="text-2xl font-bold text-slate-900 mb-1">Create your account</h1>
              <p className="text-slate-500 text-sm mb-7">
                Sign up with your work email. Your Account Manager will assign your role once you're in.
              </p>

              <form onSubmit={handleSignUp} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Work email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="you@lusso.com.au"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); if (pwError) setPwError(''); }}
                    required
                    minLength={MIN_PASSWORD}
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Minimum {MIN_PASSWORD} characters. Leaked or common passwords are rejected.
                  </p>
                </div>

                {(pwError || error) && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-4 py-3 rounded-xl">
                    {pwError || error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
                >
                  {loading ? 'Creating account…' : 'Create account'}
                </button>

                <p className="text-xs text-slate-400 text-center">
                  Already have an account?{' '}
                  <button type="button" onClick={() => switchTab('signin')} className="text-amber-600 hover:underline">
                    Sign in
                  </button>
                </p>
              </form>
            </>
          )}

          {/* ── Sign Up success (email confirm required) ── */}
          {tab === 'signup' && signupDone && (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Check your email</h1>
              <p className="text-slate-500 text-sm leading-relaxed">{signupMsg}</p>
              <button
                onClick={() => switchTab('signin')}
                className="w-full bg-amber-500 hover:bg-amber-400 text-white font-semibold py-3 rounded-xl text-sm transition-colors mt-2"
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
