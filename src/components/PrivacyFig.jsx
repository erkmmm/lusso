import { createContext, useContext } from 'react';

// Dashboard "privacy mode" — lets a salesperson blur every money/figure on the
// dashboard with one toggle so a client glancing at the screen on site can't
// read revenue, margins, customer spend, etc. Purely visual: the real values
// are still in the DOM, just blurred, and unblur instantly when toggled off.
export const PrivacyCtx = createContext(false);

export const useDashPrivacy = () => useContext(PrivacyCtx);

// Blur classes shared by every figure. inline-block guarantees the CSS filter
// actually paints (some browsers skip filters on plain inline boxes).
export const FIG_BLUR = 'inline-block blur-[6px] select-none';

// Wrap any on-screen figure: <Fig>{fmtCompact(value)}</Fig>. Blurs when privacy
// mode is on, otherwise renders the children untouched.
export function Fig({ children, className = '' }) {
  const priv = useContext(PrivacyCtx);
  if (!priv) return className ? <span className={className}>{children}</span> : children;
  return <span className={`${FIG_BLUR} ${className}`}>{children}</span>;
}
