/**
 * An address on a screen (Area 4): shortened per D4 (`0x1234ab…89abcd`, src/lib/addressDisplay.ts),
 * linked to its chain's block explorer when there is a safe link (src/lib/explorerLinks.ts), with a
 * copy button that copies it whole.
 *
 * Pass `short={false}` wherever someone might send money to the address (a payment or receiving
 * address, next to a QR code): there it is shown whole, wrapping as it must, never cut. The whole
 * address is also the hover text of a shortened one.
 *
 * Server-rendered Astro pages use <AddressText> (src/components/ui/AddressText.astro) instead.
 */
import type { CSSProperties } from 'react';
import { shortenAddress } from '@/lib/addressDisplay';
import { explorerAddressUrl, explorerTxUrl } from '@/lib/explorerLinks';
import type { Lang } from '@/lib/i18n/locale';
import { CopyButton } from './CopyButton';

export interface AddressProps {
  value: string;
  /** The chain, for the explorer link. With no chain (or no safe link) the text is plain. */
  chain?: string | null;
  /** Shortened (the default) or whole. Whole wherever someone might send money to it. */
  short?: boolean;
  /** A copy button after it (default true). */
  copy?: boolean;
  /** Link to the explorer when there is a safe link (default true). */
  link?: boolean;
  /** An address (the default) or a transaction hash: picks the explorer page and the button's name. */
  kind?: 'address' | 'tx';
  lang?: Lang;
  /** Style of the text. Its color applies to the link; text that is not a link is muted. */
  style?: CSSProperties;
  /** Style of the copy button (merged over the icon's own). */
  copyStyle?: CSSProperties;
  /** Style of the text when it is not a link, over the muted color. */
  plainStyle?: CSSProperties;
}

const MONO: CSSProperties = { fontFamily: 'monospace' };

export function Address({
  value,
  chain,
  short = true,
  copy = true,
  link = true,
  kind = 'address',
  lang,
  style,
  copyStyle,
  plainStyle,
}: AddressProps) {
  const text = short ? shortenAddress(value) : value;
  const url = link ? (kind === 'tx' ? explorerTxUrl(chain, value) : explorerAddressUrl(chain, value)) : null;
  const base: CSSProperties = { ...MONO, ...(short ? null : { overflowWrap: 'anywhere' }), ...style };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', minWidth: 0, maxWidth: '100%' }}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={short ? value : undefined}
          style={{ color: 'var(--accent)', textDecoration: 'none', ...base }}
        >
          {text} ↗
        </a>
      ) : (
        <span title={short ? value : undefined} style={{ ...base, color: 'var(--text-muted)', ...plainStyle }}>
          {text}
        </span>
      )}
      {copy && <CopyButton value={value} kind={kind === 'tx' ? 'value' : 'address'} variant="icon" lang={lang} style={copyStyle} />}
    </span>
  );
}

export default Address;
