import { useEffect } from 'react';

// Activate the existing Save button so validation, conflict checks and the
// latest form state follow exactly the same path as a mouse click.
export function useEditorSaveShortcut(editorRef, saveButtonRef, enabled) {
  useEffect(() => {
    if (!enabled) return;
    let pendingFrame = 0;
    const onKeyDown = event => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      const editor = editorRef.current;
      const button = saveButtonRef.current;
      // Project panels stay mounted while hidden. A different section or an
      // open dialog must never save an editor behind it.
      const modalOpen = [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
        .some(dialog => dialog.getClientRects().length);
      if (!editor?.getClientRects().length || !button || modalOpen) return;
      event.preventDefault();
      if (event.repeat || pendingFrame || button.matches(':disabled')) return;
      // Room/group fields commit on blur. Wait for that React update before
      // clicking, otherwise the shortcut would save their previous value.
      if (editor.contains(document.activeElement)) document.activeElement?.blur();
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        if (editor.isConnected && editor.getClientRects().length && button.isConnected && !button.matches(':disabled')) button.click();
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
    };
  }, [editorRef, saveButtonRef, enabled]);
}
