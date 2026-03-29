/**
 * DrawerHost
 *
 * Mounts into a portal div on the bookkeeping page and listens for the
 * custom `open-transaction-drawer` event dispatched by the Astro page script
 * when a `.tin-row--alert` row is clicked.
 */
import React, { useEffect, useState } from 'react';
import TransactionDrawer, { type DrawerItem } from './TransactionDrawer';

export default function DrawerHost() {
  const [item, setItem] = useState<DrawerItem | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DrawerItem>).detail;
      setItem(detail);
    };

    window.addEventListener('open-transaction-drawer', handler);
    return () => window.removeEventListener('open-transaction-drawer', handler);
  }, []);

  return (
    <TransactionDrawer
      item={item}
      onClose={() => setItem(null)}
    />
  );
}
