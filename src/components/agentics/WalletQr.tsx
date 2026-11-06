/**
 * A QR code for one of an agent's own wallets, so a person can fund the wallet from a phone: a small
 * QR icon beside the wallet's address opens a dialog with the code, the whole address written out
 * (never shortened: someone may send money to it), the chain, a copy button and a PNG download.
 *
 * The code contains the address exactly as stored and nothing else: no amount, no chain prefix. A plain
 * address is what every wallet app reads, but it does not tell the app which chain to use, so the
 * dialog says which chain to send on, in words.
 *
 * The dialog is the shared <Modal> (src/components/ui/Modal.tsx: Escape, focus kept inside and given
 * back, backdrop click to close) and the code is the shared <QrImage> (drawn in the browser by
 * src/lib/qrMake.ts). Everything that came from the registry (the address) is rendered as text by
 * React, which escapes it. Nothing here builds HTML from data.
 */
import { useId, useState } from 'react';
import { shortenAddress } from '@/lib/addressDisplay';
import type { AgentWallet } from '@/lib/agentVault/store';
import { Modal } from '@/components/ui/Modal';
import { QrImage } from '@/components/ui/QrImage';
import { copy } from './copy';
import { VaultCopyButton } from './ui';

/** Width and height of the code on screen, in pixels, and its quiet zone, in modules. */
export const WALLET_QR_SIZE = 240;
export const WALLET_QR_MARGIN = 2;

/** What the code encodes: the wallet's address exactly, nothing added. */
export const walletQrText = (wallet: Pick<AgentWallet, 'address'>): string => wallet.address;

/** The PNG's file name: the chain only, never an address or a label. */
export const walletQrFileName = (wallet: Pick<AgentWallet, 'chain'>): string => `almstins-agent-wallet-${wallet.chain}-qr.png`;

/** A QR code drawn small: three finder squares and a few modules. Decorative; the button carries the name. */
function QrIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 1h6v6H1V1zm1.5 1.5v3h3v-3h-3zM9 1h6v6H9V1zm1.5 1.5v3h3v-3h-3zM1 9h6v6H1V9zm1.5 1.5v3h3v-3h-3z" />
      <path d="M3.25 3.25h1.5v1.5h-1.5zM11.25 3.25h1.5v1.5h-1.5zM3.25 11.25h1.5v1.5h-1.5zM9 9h2v2H9zM13 9h2v2h-2zM11 11h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2z" />
    </svg>
  );
}

/** What the dialog shows for one wallet. Rendered on its own in tests; the code is drawn in the browser. */
export function WalletQrPanel({ wallet, chainName, titleId, onClose }: { wallet: AgentWallet; chainName: string; titleId: string; onClose: () => void }) {
  return (
    <>
      <div className="ag-card__head">
        <h2 className="ag-card__title" id={titleId}>
          {copy.wallets.qrTitle}
        </h2>
        <span className="ag-pill">{chainName}</span>
      </div>
      <div className="ag-qr">
        <QrImage
          text={walletQrText(wallet)}
          size={WALLET_QR_SIZE}
          margin={WALLET_QR_MARGIN}
          alt={copy.wallets.qrAlt(chainName)}
          className="ag-qr__img"
          download={{ filename: walletQrFileName(wallet), label: copy.wallets.qrDownload, className: 'ag-link' }}
        >
          <p className="ag-addr ag-mono ag-qr__addr">{wallet.address}</p>
          <p className="ag-hint">{copy.wallets.qrChain(chainName)}</p>
        </QrImage>
      </div>
      <div className="ag-form">
        <VaultCopyButton value={wallet.address} />
        <button className="ag-btn ag-btn--small" type="button" onClick={onClose}>
          {copy.wallets.qrClose}
        </button>
      </div>
    </>
  );
}

/** The QR icon beside a wallet, and the dialog it opens. */
export default function WalletQrButton({ wallet, chainName }: { wallet: AgentWallet; chainName: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return (
    <>
      <button
        className="ag-btn ag-btn--small ag-btn--icon"
        type="button"
        aria-haspopup="dialog"
        aria-label={copy.wallets.qrOpen(shortenAddress(wallet.address))}
        title={copy.wallets.qrOpenTitle}
        onClick={() => setOpen(true)}
      >
        <QrIcon />
      </button>
      {open ? (
        <Modal labelledBy={titleId} onClose={() => setOpen(false)} maxWidth="420px">
          <WalletQrPanel wallet={wallet} chainName={chainName} titleId={titleId} onClose={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
  );
}
