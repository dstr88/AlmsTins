import { useEffect, useRef } from 'react';
import { useTxNotesAutosave } from './client/useTxNotesAutosave';
import { hydrateOnchainUsd } from './client/hydrateOnchainUsd';
import { fifoGroupPolSells } from './client/fifoGroupPolSells';

type Props = {
  rootId?: string;
  displayThresholdUsd?: number;
};

export default function Tin0AllTransactionsClient({
  rootId = 'all-transactions',
  displayThresholdUsd = 1,
}: Props) {
  const listRef = useRef<HTMLElement | null>(null); // ← fixed type

  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;

    const list = root.querySelector<HTMLElement>('.tin0-all__list');
    if (!list) return;
    listRef.current = list;

    const select = root.querySelector<HTMLSelectElement>('.tin0-all__select');
    const lifecycleCarrier = root.querySelector<HTMLElement>('#lifecycle-data');

    // Cache lifecycle
    if (lifecycleCarrier?.textContent) {
      try {
        const payload = JSON.parse(lifecycleCarrier.textContent);
        const key = lifecycleCarrier.dataset?.cacheKey || 'lifecycle:cache';
        localStorage.setItem(key, JSON.stringify(payload));
      } catch (err) {
        console.warn('[TransactionsClient] Cache failed', err);
      }
    }

    const applyFilter = () => {
      if (!select || !list) return;
      const value = select.value || 'all';

      list.querySelectorAll<HTMLElement>('[data-type="row"]').forEach(node => {
        const matches = value === 'all' || node.dataset.source === value;

        const usd = Number(node.dataset.usd ?? 0);
        const importUsd = Number(node.dataset.importUsd ?? 0);

        const isDust =
          Number.isFinite(usd) && usd > 0 &&
          Number.isFinite(importUsd) && importUsd > 0 &&
          usd < displayThresholdUsd &&
          importUsd < displayThresholdUsd;

        node.hidden = !(matches && !isDust);
      });

      fifoGroupPolSells(list);
    };

    select?.addEventListener('change', applyFilter);

    const abortCtrl = new AbortController();

    const runHydrate = async () => {
      await hydrateOnchainUsd(list, displayThresholdUsd, abortCtrl.signal);
      applyFilter();
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(runHydrate, { timeout: 1500 });
    } else {
      setTimeout(runHydrate, 0);
    }

    fifoGroupPolSells(list);
    applyFilter();

    // Just call the hook — it handles its own cleanup
    useTxNotesAutosave(listRef);

    return () => {
      select?.removeEventListener('change', applyFilter);
      abortCtrl.abort();
      // No need to call cleanupAutosave() — useEffect inside the hook does it
    };
  }, [rootId, displayThresholdUsd]);

  return null;
}