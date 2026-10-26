/**
 * The one copy button (Area 4, promoted from the Agent Vault's src/components/agentics/ui.tsx).
 *
 * Press it and it copies the whole value, then says "Copied" (or "Copy failed" when the browser has
 * no clipboard to ask or refuses) for a moment, and goes back. The timer is cleared when the button
 * leaves the page. A screen reader hears the result from a live region next to the button, since
 * the button's own name stays the same ("Copy address 0x1234ab…89abcd"); the name carries the value
 * shortened (D4), because nobody needs 42 characters read out.
 *
 * Two looks: `text` (a word: Copy, Copied, Copy failed) and `icon` (⧉, then ✓ or ✕). Words come from
 * src/i18n/components/copyButton.ts in the reader's language, or from the caller (`words`).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { copyText } from '@/lib/clipboard';
import { shortenAddress } from '@/lib/addressDisplay';
import { getClientLang } from '@/lib/i18n/clientLang';
import type { Lang } from '@/lib/i18n/locale';
import { getCopyButton } from '@/i18n/components/copyButton';

export type CopyState = 'idle' | 'copied' | 'failed';

/** How long "Copied" / "Copy failed" stays before the button goes back. */
export const COPY_RESET_MS = 1800;

export interface CopyButtonProps {
  /** The text put on the clipboard, whole. */
  value: string;
  /** What the value is, for the button's name: an address (the default) or anything else. */
  kind?: 'address' | 'value';
  /** The button's accessible name; default "Copy address <value shortened>". */
  label?: string;
  /** Hover text, or a function of the state; default none for a text button, the label for an icon. */
  title?: string | ((state: CopyState) => string);
  variant?: 'text' | 'icon';
  /** The icon before it is pressed (default ⧉); ✓ or ✕ replace it for a moment after. */
  icon?: ReactNode;
  /** The visible words of a text button, when the caller has its own. */
  words?: Partial<Record<CopyState, string>>;
  lang?: Lang;
  /** A class; on an icon it replaces the built-in look (the inline style). */
  className?: string;
  /** Inline style; a function gets the state (for a color that changes once copied). */
  style?: CSSProperties | ((state: CopyState) => CSSProperties);
  /** A class that hides the live region visually; default an inline style that does. */
  srClassName?: string;
}

const ICON: Record<CopyState, string> = { idle: '⧉', copied: '✓', failed: '✕' };

const iconStyle = (state: CopyState): CSSProperties => ({
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 0.2rem',
  color: state === 'copied' ? 'var(--gain)' : state === 'failed' ? 'var(--loss)' : 'var(--text-muted)',
  fontSize: '0.8rem',
  lineHeight: 1,
  transition: 'color 0.15s',
  flexShrink: 0,
});

const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0,
};

export function CopyButton({
  value,
  kind = 'address',
  label,
  title,
  variant = 'text',
  icon,
  words,
  lang,
  className,
  style,
  srClassName,
}: CopyButtonProps) {
  const t = getCopyButton(lang ?? getClientLang());
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const said = state === 'copied' ? (words?.copied ?? t.copied) : state === 'failed' ? (words?.failed ?? t.copyFailed) : '';
  const name = label ?? (kind === 'address' ? t.copyAddress(shortenAddress(value)) : t.copyValue(shortenAddress(value)));
  const own = typeof style === 'function' ? style(state) : style;

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={name}
        title={typeof title === 'function' ? title(state) : title ?? (variant === 'icon' ? name : undefined)}
        data-copy-state={state}
        style={variant === 'icon' && !className ? { ...iconStyle(state), ...own } : own}
        onClick={async () => {
          setState((await copyText(value)) ? 'copied' : 'failed');
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setState('idle'), COPY_RESET_MS);
        }}
      >
        {variant === 'icon' ? (state === 'idle' && icon ? icon : ICON[state]) : said || (words?.idle ?? t.copy)}
      </button>
      <span className={srClassName} style={srClassName ? undefined : srOnly} role="status" aria-live="polite">
        {said}
      </span>
    </>
  );
}

export default CopyButton;
