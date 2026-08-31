// Extra props (id, aria-*, data-*) pass straight through to the wrapper so a
// card can be an anchor/scroll target without needing its own container.
export default function Card({ children, className = '', ...rest }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  );
}
