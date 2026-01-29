// src/components/dashboard/transactions/client/useTxNotesAutosave.ts
import { useRef, useEffect } from 'react';

/**
 * Custom hook that attaches autosave behavior to textareas with class 'tx-notes'
 * inside the provided list element.
 *
 * - Saves notes on input (debounced 600ms) and on blur (immediate)
 * - Shows "Saved" / "Save failed" feedback
 * - Cleans up event listeners and pending timers on unmount
 */
export function useTxNotesAutosave(listRef: React.RefObject<HTMLElement | null>) {
  const saveTimers = useRef<Map<HTMLTextAreaElement, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    const list = listRef.current;
    // Nothing to do if the list element isn't available yet
    if (!list) return;

    const saveNote = async (target: HTMLTextAreaElement) => {
      const id = target.dataset.id;
      if (!id) return;

      const initial = target.dataset.initial ?? '';
      if (target.value === initial) return;

      const savedEl = target.nextElementSibling as HTMLElement | null;
      const row = target.closest('.tx-card') as HTMLElement | null;
      const source = row?.dataset.source ?? '';
      const isOnchain = source.startsWith('onchain_');

      const endpoint = isOnchain
        ? '/api/transactions/annotate'
        : '/api/import/transactions/annotate';

      const payload = isOnchain
        ? {
            transactionId: id,
            note: target.value,
            category: target.dataset.category || null,
          }
        : {
            id,
            note: target.value,
            category: target.dataset.category || null,
            group_id: target.dataset.groupId || null,
          };

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error('Save failed');

        target.dataset.initial = target.value;

        if (savedEl) {
          savedEl.textContent = 'Saved';
          savedEl.classList.add('is-visible');
          setTimeout(() => savedEl.classList.remove('is-visible'), 1500);
        }
      } catch (err) {
        console.warn('[useTxNotesAutosave] Failed to save note:', err);
        if (savedEl) {
          savedEl.textContent = 'Save failed';
          savedEl.classList.add('is-visible');
          setTimeout(() => {
            savedEl.classList.remove('is-visible');
            savedEl.textContent = 'Saved';
          }, 2000);
        }
      }
    };

    const queueSave = (target: HTMLTextAreaElement) => {
      const existing = saveTimers.current.get(target);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => void saveNote(target), 600);
      saveTimers.current.set(target, timer);
    };

    const onInput = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains('tx-notes')) return;
      queueSave(target);
    };

    const onBlur = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains('tx-notes')) return;

      const existing = saveTimers.current.get(target);
      if (existing) clearTimeout(existing);

      void saveNote(target);
    };

    // Attach listeners
    list.addEventListener('input', onInput);
    list.addEventListener('blur', onBlur, true);

    // Cleanup: remove listeners + cancel pending saves
    return () => {
      list.removeEventListener('input', onInput);
      list.removeEventListener('blur', onBlur, true);

      // Clear any pending debounce timers
      saveTimers.current.forEach(clearTimeout);
      saveTimers.current.clear();
    };
  }, [listRef]); // Re-run only when the list ref changes
}