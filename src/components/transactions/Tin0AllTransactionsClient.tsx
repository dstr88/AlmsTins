import React, { useEffect, useMemo, useRef } from 'react';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';

type Props = {
  rootId?: string; // defaults to "all-transactions"
  displayThresholdUsd?: number; // keep in sync with SSR
};

export default function Tin0AllTransactionsClient({
  rootId = 'all-transactions',
  displayThresholdUsd = 1,
}: Props) {
  const saveTimers = useRef<WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>>(
    new WeakMap(),
  );

  const root = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return document.getElementById(rootId);
  }, [rootId]);

  useEffect(() => {
    if (!root) return;

    const list = root.querySelector('.tin0-all__list') as HTMLElement | null;
    const select = root.querySelector('.tin0-all__select') as HTMLSelectElement | null;
    const lifecycleCarrier = root.querySelector('#lifecycle-data') as HTMLElement | null;

    if (!list) return;

    // --- Cache lifecycle payload to localStorage (optional)
    if (lifecycleCarrier?.textContent) {
      try {
        const payload = JSON.parse(lifecycleCarrier.textContent);
        const key = (lifecycleCarrier as any).dataset?.cacheKey || 'lifecycle:cache';
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch (error) {
        console.warn('[Tin0AllTransactionsClient] Failed to cache lifecycle data', error);
      }
    }

    // --- Filter by source (+ dust filter)
    const onSelectChange = () => {
      const value = select?.value ?? 'all';
      const rows = list.querySelectorAll('[data-type="row"]');
      rows.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;

        const usd = Number(node.dataset.usd || 0);
        const importUsd = Number(node.dataset.importUsd || 0);

        // dust logic (this matches your current "OR"; swap to AND if you want)
        const isDust =
          (Number.isFinite(usd) && usd > 0 && usd < displayThresholdUsd) ||
          (Number.isFinite(importUsd) && importUsd > 0 && importUsd < displayThresholdUsd);

        const matches = value === 'all' || node.dataset.source === value;
        node.toggleAttribute('hidden', !(matches && !isDust));
      });

      fifoGroupPolSells(list);
    };

    select?.addEventListener('change', onSelectChange);

    // --- Notes autosave
    const saveNote = async (target: HTMLTextAreaElement) => {
      const id = target.dataset.id;
      if (!id) return;

      const initial = target.dataset.initial ?? '';
      if (target.value === initial) return;

      const savedEl = target.nextElementSibling as HTMLElement | null;
      const row = target.closest('.tx-card') as HTMLElement | null;

      const source = row?.dataset.source ?? '';
      const isOnchain = source.startsWith('onchain_');
      const endpoint = isOnchain ? '/api/transactions/annotate' : '/api/import/transactions/annotate';

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
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Failed to save');

        target.dataset.initial = target.value;

        if (savedEl) {
          savedEl.textContent = 'Saved';
          savedEl.classList.add('is-visible');
          window.setTimeout(() => savedEl.classList.remove('is-visible'), 1500);
        }
      } catch {
        if (savedEl) {
          savedEl.textContent = 'Save failed';
          savedEl.classList.add('is-visible');
          window.setTimeout(() => {
            savedEl.classList.remove('is-visible');
            savedEl.textContent = 'Saved';
          }, 2000);
        }
      }
    };

    const queueSave = (target: HTMLTextAreaElement) => {
      const existing = saveTimers.current.get(target);
      if (existing) clearTimeout(existing);
      const handle = setTimeout(() => void saveNote(target), 600);
      saveTimers.current.set(target, handle);
    };

    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains('tx-notes')) return;
      queueSave(target);
    };

    const onBlur = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains('tx-notes')) return;

      const existing = saveTimers.current.get(target);
      if (existing) clearTimeout(existing);
      void saveNote(target);
    };

    list.addEventListener('input', onInput);
    list.addEventListener('blur', onBlur, true);

    // --- Onchain USD hydration (prices)
    const normalizePriceSymbol = (symbol?: string | null) => {
      if (!symbol) return '';
      const upper = String(symbol).toUpperCase();
      if (upper === 'APOLWETH') return 'WETH';
      if (upper === 'APOLWMATIC') return 'POL';
      if (upper === 'APOLUSDC') return 'USDC';
      if (upper === 'APOLUSDT') return 'USDT';
      if (upper === 'APOLDAI') return 'DAI';
      if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
      return upper;
    };

    const parseAmount = (raw: string, decimals: number) => {
      if (!raw) return 0;
      const safeDecimals = Number.isFinite(decimals) ? decimals : 18;
      const padded = String(raw).padStart(safeDecimals + 1, '0');
      const whole = padded.slice(0, -safeDecimals) || '0';
      const fraction = padded.slice(-safeDecimals).replace(/0+$/, '');
      const numeric = Number(fraction ? `${whole}.${fraction}` : whole);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const formatUsd = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return '—';
      return `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    };

    const hydrateOnchainUsd = async () => {
      const rows = Array.from(list.querySelectorAll('[data-type="row"][data-onchain="true"]')).filter(
        (n) => n instanceof HTMLElement,
      ) as HTMLElement[];

      if (!rows.length) return;

      const symbols = new Set<string>();
      rows.forEach((row) => {
        const s = normalizePriceSymbol(row.dataset.symbol);
        if (s) symbols.add(s);
      });

      const sanitized = allowlistSymbols(Array.from(symbols));
      if (!sanitized.length) return;

      let priceMap: Record<string, number> = {};
      try {
        const response = await fetch(
          `/api/market/coingecko-prices?symbols=${encodeURIComponent(sanitized.join(','))}`,
        );
        if (response.ok) {
          const payload = await response.json();
          priceMap = payload.prices ?? {};
        }
      } catch {
        priceMap = {};
      }

      rows.forEach((row) => {
        const raw = row.dataset.raw ?? '';
        const decimals = Number(row.dataset.decimals ?? 18);
        const symbol = normalizePriceSymbol(row.dataset.symbol);
        const price = Number(priceMap[symbol] ?? 0);
        const amount = parseAmount(raw, decimals);
        const usd = amount * (Number.isFinite(price) ? price : 0);

        const usdEl = row.querySelector('[data-role="usd"]');
        if (usdEl) usdEl.textContent = usd > 0 ? formatUsd(usd) : '—';

        row.dataset.usd = String(usd);

        // hide dust on hydration
        if (usd > 0 && usd < displayThresholdUsd) row.setAttribute('hidden', 'true');
      });
    };

    // --- FIFO grouping (POL sells)
    function fifoGroupPolSells(listEl: HTMLElement) {
      const existingGroups = Array.from(listEl.querySelectorAll('.tx-group'));
      existingGroups.forEach((group) => {
        while (group.firstChild) listEl.insertBefore(group.firstChild, group);
        group.remove();
      });

      const all = Array.from(listEl.querySelectorAll('[data-type="row"]')).filter(
        (n) => n instanceof HTMLElement,
      ) as HTMLElement[];

      const fullDate = (iso: string) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso || '';
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
      };

      const getRowSymbol = (row: HTMLElement) => normalizePriceSymbol(row.dataset.symbol || '');
      const getDir = (row: HTMLElement) => (row.dataset.direction || '').toLowerCase();
      const getTime = (row: HTMLElement) => Date.parse(row.dataset.timestamp || '') || 0;

      const getTokenQty = (row: HTMLElement) => {
        if (row.dataset.onchain === 'true') {
          return parseAmount(row.dataset.raw || '', Number(row.dataset.decimals || 18));
        }
        const v = Number(row.dataset.importAmount || 0);
        return Number.isFinite(v) ? Math.abs(v) : 0;
      };

      const getUsd = (row: HTMLElement) => {
        const usd1 = Number(row.dataset.usd || 0);
        if (Number.isFinite(usd1) && usd1 > 0) return Math.abs(usd1);

        const usd2 = Number(row.dataset.importUsd || 0);
        if (Number.isFinite(usd2) && usd2 > 0) return Math.abs(usd2);

        return 0;
      };

      const buys = all
        .filter((row) => getRowSymbol(row) === 'POL' && getDir(row) === 'in')
        .sort((a, b) => getTime(a) - getTime(b))
        .map((row) => ({
          row,
          dateIso: row.dataset.timestamp || '',
          remaining: getTokenQty(row),
          usdTotal: getUsd(row),
        }))
        .filter((lot) => lot.remaining > 0);

      const sells = all
        .filter((row) => getRowSymbol(row) === 'POL' && getDir(row) === 'out')
        .sort((a, b) => getTime(b) - getTime(a));

      for (const sellRow of sells) {
        const sellQty = getTokenQty(sellRow);
        const sellUsd = getUsd(sellRow);
        if (!(sellQty > 0)) continue;

        let need = sellQty;
        let costUsd = 0;
        let usedQty = 0;
        let lastBuyIso = '';

        const matched: Array<{ row: HTMLElement; take: number; takeUsd: number }> = [];

        for (const lot of buys) {
          if (need <= 0) break;
          if (lot.remaining <= 0) continue;

          const take = Math.min(need, lot.remaining);
          const lotQty = getTokenQty(lot.row);
          const lotUsd = lot.usdTotal;
          const perToken = lotQty > 0 ? lotUsd / lotQty : 0;
          const takeUsd = perToken > 0 ? perToken * take : 0;

          lot.remaining -= take;
          need -= take;

          usedQty += take;
          costUsd += takeUsd;
          lastBuyIso = lot.dateIso || lastBuyIso;

          matched.push({ row: lot.row, take, takeUsd });
        }

        if (usedQty <= 0) continue;

        const weightedBuy = costUsd > 0 && usedQty > 0 ? costUsd / usedQty : 0;
        const sellPrice = sellUsd > 0 && sellQty > 0 ? sellUsd / sellQty : 0;
        const pnl = sellUsd > 0 && costUsd > 0 ? sellUsd - costUsd : null;

        const wrapper = document.createElement('div');
        wrapper.className = 'tx-group';

        const header = document.createElement('div');
        header.className = 'tx-group__header';

        const plClass = pnl === null ? '' : pnl >= 0 ? 'is-profit' : 'is-loss';
        const plText = pnl === null ? '—' : `${pnl >= 0 ? '+' : ''}${formatUsd(pnl)}`;

        header.innerHTML = `
          <span>Sold: <strong>${fullDate(sellRow.dataset.timestamp || '')}</strong></span>
          <span>Last buy: <strong>${lastBuyIso ? fullDate(lastBuyIso) : '—'}</strong></span>
          <span>Wtd buy: <strong>${formatUsd(weightedBuy)}</strong></span>
          <span>Sell: <strong>${formatUsd(sellPrice)}</strong></span>
          <span class="tx-pl ${plClass}">P/L: <strong>${plText}</strong></span>
        `.trim();

        wrapper.appendChild(header);
        sellRow.parentElement?.insertBefore(wrapper, sellRow);
        wrapper.appendChild(sellRow);

        matched
          .slice()
          .sort((a, b) => getTime(a.row) - getTime(b.row))
          .forEach(({ row, take, takeUsd }) => {
            const buyQty = getTokenQty(row);
            const buyUsd = getUsd(row);
            const buyPx = buyQty > 0 ? buyUsd / buyQty : 0;

            const lotLine = document.createElement('div');
            lotLine.className = 'tx-lotline';
            lotLine.innerHTML = `
              <span class="tx-lotline__label">Buy lot</span>
              <span class="tx-lotline__muted">${fullDate(row.dataset.timestamp || '')}</span>
              <span>Used: ${take.toLocaleString(undefined, { maximumFractionDigits: 6 })} POL</span>
              <span>Lot px: ${formatUsd(buyPx)}</span>
              <span>Basis used: ${formatUsd(takeUsd)}</span>
            `.trim();

            wrapper.appendChild(lotLine);
            wrapper.appendChild(row);
          });
      }
    }

    // kick off work
    const runHydrate = () => void hydrateOnchainUsd();
    if (typeof (window as any).requestIdleCallback === 'function') {
      (window as any).requestIdleCallback(runHydrate, { timeout: 1500 });
    } else {
      setTimeout(runHydrate, 0);
    }
    fifoGroupPolSells(list);

    // cleanup
    return () => {
      select?.removeEventListener('change', onSelectChange);
      list.removeEventListener('input', onInput);
      list.removeEventListener('blur', onBlur, true);
    };
  }, [root, displayThresholdUsd]);

  return null;
}
