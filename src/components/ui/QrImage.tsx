/**
 * A QR code on a screen (Area 5): drawn in the browser by toQrDataUrl (src/lib/qrMake.ts), with a
 * placeholder while it loads (or if it cannot be drawn), alt text, and an optional link that saves
 * it as a PNG.
 *
 * It renders a fragment, not a box: the image (or placeholder), then `children`, then the download
 * link, so a screen keeps its own wrapper and puts its hint text between the code and the link.
 *
 * Reading QR codes lives in src/lib/qrScan.ts.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { toQrDataUrl } from '@/lib/qrMake';

export interface QrDownload {
  /** The PNG's file name. Keep labels and names out of it: they can be a person's name. */
  filename: string;
  label: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export interface QrImageViewProps {
  /** The PNG data URL, or '' while it is being drawn. */
  dataUrl: string;
  /** True when the code could not be drawn. */
  failed?: boolean;
  /** Width and height of the image, in pixels. */
  size: number;
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** Shown instead of the image while it loads or when it failed. Defaults to an empty box. */
  placeholder?: (state: 'loading' | 'failed') => ReactNode;
  /** A link that saves the PNG, shown once the code is drawn. */
  download?: QrDownload;
  /** Shown between the code and the download link. */
  children?: ReactNode;
}

export interface QrImageProps extends Omit<QrImageViewProps, 'dataUrl' | 'failed'> {
  /** What the code encodes, exactly. */
  text: string;
  /** Quiet zone around the code, in modules. */
  margin: number;
}

/** Draws the QR code for `text`; starts over (back to loading) whenever the text changes. */
export function useQrDataUrl(text: string, width: number, margin: number): { dataUrl: string; failed: boolean } {
  const [dataUrl, setDataUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setDataUrl('');
    setFailed(false);
    toQrDataUrl(text, { width, margin }).then(
      (url) => { if (alive) setDataUrl(url); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [text, width, margin]);
  return { dataUrl, failed };
}

function defaultPlaceholder(size: number) {
  return () => <div aria-hidden="true" style={{ width: size, maxWidth: '100%', aspectRatio: '1', background: 'var(--surface-card-2)' }} />;
}

/** The QR code's markup for a data URL already drawn (or not yet): what <QrImage> renders. */
export function QrImageView({ dataUrl, failed = false, size, alt, className, style, placeholder, download, children }: QrImageViewProps) {
  const empty = placeholder ?? defaultPlaceholder(size);
  return (
    <>
      {dataUrl
        ? <img className={className} src={dataUrl} alt={alt} width={size} height={size} style={style} />
        : empty(failed ? 'failed' : 'loading')}
      {children}
      {dataUrl && download && (
        <a className={download.className} href={dataUrl} download={download.filename} style={download.style}>{download.label}</a>
      )}
    </>
  );
}

export function QrImage({ text, margin, ...view }: QrImageProps) {
  const { dataUrl, failed } = useQrDataUrl(text, view.size, margin);
  return <QrImageView dataUrl={dataUrl} failed={failed} {...view} />;
}
