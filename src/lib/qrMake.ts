/**
 * Making QR codes (Area 5): the one place the app loads `qrcode`. CLIENT-ONLY in practice (it
 * returns a PNG data URL drawn on a canvas), lazy-loaded so a page pays for the library only when
 * it shows a QR.
 *
 * Reading QR codes lives in src/lib/qrScan.ts. In React, use <QrImage> (src/components/ui/QrImage.tsx),
 * which adds the loading state, the alt text and the PNG download.
 */

export interface QrOptions {
  /** Width (and height) of the PNG, in pixels. */
  width: number;
  /** Quiet zone around the code, in modules. */
  margin: number;
}

type ToDataUrl = (text: string, opts?: unknown) => Promise<string>;

/**
 * The PNG data URL of a QR code that encodes `text` exactly, drawn with the library's defaults
 * (error correction 'M') apart from the width and margin given. Throws when the library cannot be
 * loaded or cannot encode the text.
 */
export async function toQrDataUrl(text: string, { width, margin }: QrOptions): Promise<string> {
  // The package is CommonJS; depending on the bundler its functions sit on the module or on `default`.
  const mod = (await import('qrcode')) as unknown as { toDataURL?: ToDataUrl; default?: { toDataURL?: ToDataUrl } };
  const toDataURL = mod.toDataURL ?? mod.default?.toDataURL;
  if (!toDataURL) throw new Error('qrcode');
  return toDataURL(text, { width, margin });
}
