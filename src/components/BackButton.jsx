/**
 * BackButton — reusable back-navigation button.
 *
 * Behaviour:
 *  • Goes to the page that was open last — the previous in-app history entry,
 *    or, when this document is the first one (a reload, a PWA launch, a push
 *    notification opening a deep link), the last page open earlier in this
 *    browser session.
 *  • Falls back to `fallback` only when there is genuinely nothing to go back
 *    to, so the user is never stranded and never thrown out of the app.
 *
 * The decision lives in src/lib/navTrail.js, shared with the Layout's global
 * back control. It used to be `window.history.length > 1` here, which counts
 * pages visited before the app was opened too — so on the app's first page it
 * popped out of the app's own history, landing on the dashboard or worse.
 *
 * Props:
 *  fallback  string    – route used when there is nothing to go back to (default "/")
 *  label     string    – button text (default "Back")
 *  className string    – extra Tailwind classes appended to the button
 *  guard     function  – optional callback called before navigation.
 *                        Return true (or undefined) to allow navigation.
 *                        Return false to cancel. Use for unsaved-changes warnings.
 *                        Example: guard={() => window.confirm('Leave page?')}
 */

import { ArrowLeft } from 'lucide-react';
import { useGoBack } from '../lib/navTrail';

export default function BackButton({ fallback = '/', label = 'Back', className = '', guard }) {
  const goBack = useGoBack(fallback);

  const handleClick = () => {
    // Run guard if provided; if it returns false, cancel navigation
    if (guard) {
      const allowed = guard();
      if (allowed === false) return;
    }
    goBack();
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors py-1 ${className}`}
    >
      <ArrowLeft size={15} />
      {label}
    </button>
  );
}
