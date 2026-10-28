import { useSidebar } from '../contexts/SidebarContext';

// A page's save / submit bar, pinned to the bottom of the CONTENT column.
//
// It used to be `fixed bottom-16 lg:bottom-0 left-0 right-0 z-20 lg:pl-72`.
// Two things were wrong with that on a desktop:
//
//   • The padding moved the BUTTONS clear of the sidebar, but the bar's own
//     white background still spanned from left-0 — so it painted straight over
//     the navigation. The desktop sidebar is `lg:static lg:z-auto`, so it has
//     no stacking context to defend itself and a fixed z-20 bar wins.
//   • 72 is 288px and the sidebar is never 288px: it is 256px (`w-64`)
//     expanded and 64px (`lg:w-16`) as a rail. So the offset was wrong in both
//     states, and completely wrong in the rail.
//
// The bar now starts where the sidebar ends and follows it when it collapses,
// matching the sidebar's own 200ms width transition so the two move together.
// Left as `fixed` rather than `sticky` deliberately: on a phone it has to clear
// the bottom tab bar, which `bottom-16` does and a sticky element inside the
// page's padding box would not.
export default function StickyActionBar({ children, className = '' }) {
  const { rail } = useSidebar();
  return (
    <div
      // data-rail is what the glass theme keys off to inset the bar: there the
      // sidebar floats on a 14px margin, so its right edge is 14px further over
      // than left-16/left-64 assume, and the bar's own left edge slid underneath
      // it. Exposed as an attribute rather than letting the stylesheet reach for
      // the Tailwind class names, which are an implementation detail.
      data-rail={rail ? 'true' : 'false'}
      className={`app-action-bar fixed bottom-16 lg:bottom-0 left-0 right-0 z-20 bg-white border-t border-slate-200 px-4 py-3 transition-[left] duration-200 ${
        rail ? 'lg:left-16' : 'lg:left-64'
      } ${className}`}
    >
      {children}
    </div>
  );
}
