/**
 * A QR code for an address on an agent's page, so a person can send to it from a phone. Two places
 * have one: each of the agent's own wallets (to fund the wallet), and each registered address the
 * agent may pay (the other side of the flow). A small QR icon beside the address opens a dialog with
 * the code, the whole address written out (never shortened: someone may send money to it), the
 * chain, a copy button and a PNG download.
 *
 * The code contains the address exactly as stored and nothing else: no amount, no chain prefix. A
 * plain address is what every wallet app reads, but it does not tell the app which chain to use, so
 * the dialog says which chain to send on, in words.
 *
 * For a registered address the dialog also shows where it stands on the list (the same Pass, Fail,
 * Limited or Not checked pill as its row) and the owner's label. A flagged address keeps its QR code,
 * because the owner decides, but the dialog says first that a person should review it before anything
 * is sent to it: a QR code makes paying easy, so it never makes paying a flagged address look routine.
 * Almstins verifies and flags; it is never in the payment path.
 *
 * The dialog is the shared <Modal> (src/components/ui/Modal.tsx: Escape, focus kept inside and given
 * back, backdrop click to close) and the code is the shared <QrImage> (drawn in the browser by
 * src/lib/qrMake.ts). Everything that came from the registry (an address, a label) is rendered as
 * text by React, which escapes it. Nothing here builds HTML from data.
 */
import { useId, useState } from 'react';
import { shortenAddress } from '@/lib/addressDisplay';
import type { AgentWallet, Destination } from '@/lib/agentVault/store';
import { Modal } from '@/components/ui/Modal';
import { QrImage } from '@/components/ui/QrImage';
import { copy } from './copy';
import { pillOf, TrustPill, VaultCopyButton } from './ui';

/** Width and height of the code on screen, in pixels, and its quiet zone, in modules. */
export const WALLET_QR_SIZE = 240;
export const WALLET_QR_MARGIN = 2;

/** What a QR dialog is about: one of the agent's own wallets, or one of the addresses it may pay. */
export type QrSubject =
  | { kind: 'wallet'; wallet: Pick<AgentWallet, 'address' | 'chain'> }
  | { kind: 'destination'; destination: Pick<Destination, 'address' | 'chain' | 'label' | 'trustStatus' | 'trust'> };

const addressOf = (s: QrSubject): string => (s.kind === 'wallet' ? s.wallet.address : s.destination.address);

/** What the code encodes: the address exactly, nothing added. */
export const walletQrText = (wallet: Pick<AgentWallet, 'address'>): string => wallet.address;
export const qrTextOf = (s: QrSubject): string => addressOf(s);

/** The PNG's file name: what it is and the chain, never an address or a label. */
export const walletQrFileName = (wallet: Pick<AgentWallet, 'chain'>): string => `almstins-agent-wallet-${wallet.chain}-qr.png`;
export const qrFileNameOf = (s: QrSubject): string =>
  s.kind === 'wallet' ? walletQrFileName(s.wallet) : `almstins-registered-address-${s.destination.chain}-qr.png`;

/** A QR code drawn small: three finder squares and a few modules. Decorative; the button carries the name. */
function QrIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 1h6v6H1V1zm1.5 1.5v3h3v-3h-3zM9 1h6v6H9V1zm1.5 1.5v3h3v-3h-3zM1 9h6v6H1V9zm1.5 1.5v3h3v-3h-3z" />
      <path d="M3.25 3.25h1.5v1.5h-1.5zM11.25 3.25h1.5v1.5h-1.5zM3.25 11.25h1.5v1.5h-1.5zM9 9h2v2H9zM13 9h2v2h-2zM11 11h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2z" />
    </svg>
  );
}

/** What the dialog shows. Rendered on its own in tests; the code is drawn in the browser. */
export function QrPanel({ subject, chainName, titleId, onClose }: { subject: QrSubject; chainName: string; titleId: string; onClose: () => void }) {
  const address = addressOf(subject);
  const dest = subject.kind === 'destination' ? subject.destination : null;
  return (
    <>
      <div className="ag-card__head">
        <h2 className="ag-card__title" id={titleId}>
          {dest ? copy.registry.qrTitle : copy.wallets.qrTitle}
        </h2>
        <span className="ag-pill">{chainName}</span>
      </div>
      {dest ? (
        <div className="ag-qr__status">
          <TrustPill kind={pillOf(dest)} />
          {dest.label ? <span className="ag-hint">{copy.ledger.addressLabel(dest.label)}</span> : null}
        </div>
      ) : null}
      {dest?.trustStatus === 'flagged' ? <p className="ag-notice ag-notice--warn">{copy.registry.qrFlagged}</p> : null}
      {dest?.trustStatus === 'pending' ? <p className="ag-hint">{copy.registry.qrPending}</p> : null}
      <div className="ag-qr">
        <QrImage
          text={qrTextOf(subject)}
          size={WALLET_QR_SIZE}
          margin={WALLET_QR_MARGIN}
          alt={dest ? copy.registry.qrAlt(chainName) : copy.wallets.qrAlt(chainName)}
          className="ag-qr__img"
          download={{ filename: qrFileNameOf(subject), label: copy.wallets.qrDownload, className: 'ag-link' }}
        >
          <p className="ag-addr ag-mono ag-qr__addr">{address}</p>
          <p className="ag-hint">{copy.wallets.qrChain(chainName)}</p>
        </QrImage>
      </div>
      <div className="ag-form">
        <VaultCopyButton value={address} />
        <button className="ag-btn ag-btn--small" type="button" onClick={onClose}>
          {copy.wallets.qrClose}
        </button>
      </div>
    </>
  );
}

/** The wallet form of the panel, kept for callers and tests that know only wallets. */
export function WalletQrPanel({ wallet, chainName, titleId, onClose }: { wallet: AgentWallet; chainName: string; titleId: string; onClose: () => void }) {
  return <QrPanel subject={{ kind: 'wallet', wallet }} chainName={chainName} titleId={titleId} onClose={onClose} />;
}

/** The QR icon beside an address, and the dialog it opens. */
export function QrButton({ subject, chainName }: { subject: QrSubject; chainName: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const short = shortenAddress(addressOf(subject));
  const isWallet = subject.kind === 'wallet';
  return (
    <>
      <button
        className="ag-btn ag-btn--small ag-btn--icon"
        type="button"
        aria-haspopup="dialog"
        aria-label={isWallet ? copy.wallets.qrOpen(short) : copy.registry.qrOpen(short)}
        title={isWallet ? copy.wallets.qrOpenTitle : copy.registry.qrOpenTitle}
        onClick={() => setOpen(true)}
      >
        <QrIcon />
      </button>
      {open ? (
        <Modal labelledBy={titleId} onClose={() => setOpen(false)} maxWidth="420px">
          <QrPanel subject={subject} chainName={chainName} titleId={titleId} onClose={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
  );
}

/** The QR icon beside one of the agent's own wallets. */
export default function WalletQrButton({ wallet, chainName }: { wallet: AgentWallet; chainName: string }) {
  return <QrButton subject={{ kind: 'wallet', wallet }} chainName={chainName} />;
}

/** The QR icon beside a registered address. */
export function DestinationQrButton({ destination, chainName }: { destination: Destination; chainName: string }) {
  return <QrButton subject={{ kind: 'destination', destination }} chainName={chainName} />;
}
