import { useState, useEffect } from 'react';
import WalletYearChangesModal from './WalletYearChangesModal';

interface Props {
  selectedYear: number;
}

export default function WalletYearChangesWrapper({ selectedYear }: Props) {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  useEffect(() => {
    const walletList = document.getElementById('wallet-list');
    if (!walletList) return;

    const handleClick = (e: Event) => {
      const item = (e.target as HTMLElement).closest('[data-wallet-id]');
      if (!item) return;
      const walletId = (item as any).dataset.walletId;
      setSelectedWallet(walletId);
    };

    walletList.addEventListener('click', handleClick);
    return () => walletList.removeEventListener('click', handleClick);
  }, []);

  return selectedWallet ? (
    <WalletYearChangesModal
      walletId={selectedWallet}
      year={selectedYear}
      onClose={() => setSelectedWallet(null)}
    />
  ) : null;
}
