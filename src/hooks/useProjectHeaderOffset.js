import { useLayoutEffect, useRef } from 'react';

// Nested sticky controls sit below the project's actual header, including
// wrapped names, addresses and tools. On phones the project header scrolls
// normally, so the nested toolbar can stick at the top of the scroll area.
export function useProjectHeaderOffset(enabled) {
  const workspaceRef = useRef(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const workspace = workspaceRef.current;
    const header = workspace?.querySelector('.project-workspace-header');
    if (!header) return;
    const measure = () => {
      const sticky = getComputedStyle(header).position === 'sticky';
      const offset = sticky ? Math.ceil(header.getBoundingClientRect().height) + 12 : 0;
      workspace.style.setProperty('--project-header-offset', `${offset}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      workspace.style.removeProperty('--project-header-offset');
    };
  }, [enabled]);
  return workspaceRef;
}
