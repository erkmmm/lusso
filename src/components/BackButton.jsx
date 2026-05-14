/**
 * BackButton — reusable back-navigation button.
 *
 * Behaviour:
 *  • If the browser has history to go back to (arrived via in-app navigation),
 *    calls navigate(-1) so the user returns to the exact previous page.
 *  • If the page was opened directly (bookmark / refresh / external link),
 *    falls back to the provided `fallback` route so the user is never stranded.
 *
 * Props:
 *  fallback  string    – route to navigate to when there is no history (default "/")
 *  label     string    – button text (default "Back")
 *  className string    – extra Tailwind classes appended to the button
 *  guard     function  – optional callback called before navigation.
 *                        Return true (or undefined) to allow navigation.
 *                        Return false to cancel. Use for unsaved-changes warnings.
 *                        Example: guard={() => window.confirm('Leave page?')}
 */

import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function BackButton({ fallback = '/', label = 'Back', className = '', guard }) {
  const navigate = useNavigate();

  const handleClick = () => {
    // Run guard if provided; if it returns false, cancel navigation
    if (guard) {
      const allowed = guard();
      if (allowed === false) return;
    }

    // window.history.length === 1 means this is the only entry in the browser's
    // history stack — the user arrived directly (fresh tab, bookmark, shared link).
    // Anything > 1 means at least one previous navigation exists; go back there.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
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
