import { isValidElement, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import Card from './Card';

/**
 * A card whose heading folds its body away.
 *
 * This replaces three near-identical `Section` components that had grown up
 * separately in QuoteBuilder, NewMeasureSheet and Content, with slightly
 * different chevrons, padding and toggle behaviour between them.
 *
 * Controlled or uncontrolled:
 *   • pass `open` + `onToggle` to drive it yourself (NewMeasureSheet already
 *     keeps its section state in the page, because saving a sheet reopens
 *     specific sections);
 *   • otherwise pass a `collapse` bag from useCollapsedSections and an `id`,
 *     and it remembers itself.
 *
 * The heading is a real <button> so it works from the keyboard and reads as a
 * control to a screen reader. `actions` renders OUTSIDE that button: a link or
 * a menu nested inside a button is invalid HTML, and in practice the inner
 * control stops firing.
 */
export default function CollapsibleSection({
  // identity + state
  id,
  anchor,                   // DOM id, when something links to this section
  collapse,                 // { isOpen, toggle } from useCollapsedSections
  open: openProp,
  onToggle,
  defaultOpen = true,
  // content
  icon: Icon,
  iconClass = 'text-slate-400',
  title,
  titleClass = 'text-slate-800',
  titleNote,                // muted, inline after the title ("— read before they go out")
  hint,                     // muted, on its own line under the title
  count,
  actions,
  children,
  // styling hooks
  className = '',
  bodyAs: Body = 'div',     // 'ul' when the body is a list
  bodyClass = 'p-5',
  ...rest
}) {
  const bodyId = useId();

  const controlled = openProp !== undefined;
  const open = controlled
    ? openProp
    : collapse
      ? collapse.isOpen(id, defaultOpen)
      : defaultOpen;

  const handle = () => {
    if (controlled) onToggle?.();
    else collapse?.toggle(id, defaultOpen);
  };

  return (
    <Card id={anchor} className={`overflow-hidden ${className}`} {...rest}>
      <div className={`flex items-center ${open ? 'border-b border-slate-100' : ''}`}>
        <button
          type="button"
          onClick={handle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex-1 min-w-0 flex items-center gap-2 px-5 py-4 text-left"
        >
          {/* Either a component (`icon={User}`) or an already-built element
              (`icon={<User size={15} />}`). The call sites this replaced used
              both conventions, and neither was worth rewriting. */}
          {Icon && (
            isValidElement(Icon)
              ? <span className="flex-shrink-0">{Icon}</span>
              : <Icon size={15} className={`${iconClass} flex-shrink-0`} />
          )}
          <div className="min-w-0 flex-1">
            <h2 className={`font-semibold text-sm ${titleClass}`}>
              {title}
              {count !== undefined && count !== null && (
                <span className="text-slate-400 font-normal"> · {count}</span>
              )}
              {titleNote && <span className="ml-1 font-normal text-slate-400">— {titleNote}</span>}
            </h2>
            {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
          </div>
          {/* One chevron that rotates, rather than swapping two icons — it
              cannot get out of step with `open`, and the rotation shows which
              way the section is about to move. */}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
        </button>
        {actions && <div className="flex-shrink-0 pr-4 pl-1">{actions}</div>}
      </div>

      {/* Unmounted rather than hidden: these bodies hold tables, charts and
          photo grids, and a collapsed section should cost nothing to have on
          the page. */}
      {open && <Body id={bodyId} className={bodyClass}>{children}</Body>}
    </Card>
  );
}
