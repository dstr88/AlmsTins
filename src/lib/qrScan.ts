/**
 * Reusable QR scanning — CLIENT-ONLY (uses camera, canvas, jsQR).
 *
 * Deliberately decoupled from what happens with the result: it captures + decodes
 * and hands back the raw decoded string. Each caller does its own thing with it
 * (run a safety check, compare to a merchant destination, fill an input, …).
 *
 * Deterministic decode via jsQR — works on every browser incl. iOS Safari, and
 * (unlike Claude Vision) never misreads a character, which matters when the
 * decoded string is a payment destination.
 *
 * Three ways to use it:
 *
 * 1. Custom element (drop-in button):
 *      import '@/lib/qrScan';
 *      <qr-scan-button label="📷 Scan QR" button-class="my-btn"></qr-scan-button>
 *      el.addEventListener('scan',       e => use((e as CustomEvent).detail.payload));
 *      el.addEventListener('scan-empty', () => …);   // image had no QR
 *      el.addEventListener('scan-error', () => …);   // image unreadable
 *      el.addEventListener('scan-start', () => …);   // decoding began
 *
 * 2. Programmatic (trigger from your own handler, must be inside a user gesture):
 *      import { promptScan } from '@/lib/qrScan';
 *      const payload = await promptScan();           // null = cancelled / no QR
 *
 * 3. Pure decode (you already have the image File):
 *      import { decodeQrFromImageFile } from '@/lib/qrScan';
 *      const payload = await decodeQrFromImageFile(file);
 */
import jsQR from 'jsqr';

const MAX_DIM = 1100; // downscale large photos before decode (speed)

/** Decode the first QR code found in an image File. Returns its payload, or null. */
export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image load failed'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return jsQR(data, w, h)?.data ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Open the camera / photo picker and resolve the decoded QR payload (or null on
 * cancel / no-QR). Must be called from within a user gesture (e.g. a click).
 */
export function promptScan(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment'); // rear camera on mobile
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.addEventListener(
      'change',
      async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return resolve(null);
        try {
          resolve(await decodeQrFromImageFile(file));
        } catch {
          resolve(null);
        }
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * <qr-scan-button> — a light-DOM custom element rendering a button that captures
 * a photo, decodes it, and emits `scan` (detail.payload), `scan-empty`,
 * `scan-error`, or `scan-start`. Style the inner button via the `button-class`
 * attribute or the default `.qr-scan-btn` class.
 */
// Declared inside a function so `extends HTMLElement` is only evaluated on the
// client — top-level `extends HTMLElement` crashes SSR (HTMLElement is undefined
// on the server) for any module that imports this file (e.g. a React island).
function defineQrScanButton() {
  class QrScanButton extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = this.getAttribute('button-class') ?? 'qr-scan-btn';
    btn.textContent = this.getAttribute('label') ?? '📷 Scan QR';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      this.dispatchEvent(new CustomEvent('scan-start', { bubbles: true }));
      try {
        const payload = await decodeQrFromImageFile(file);
        this.dispatchEvent(
          payload
            ? new CustomEvent('scan', { bubbles: true, detail: { payload } })
            : new CustomEvent('scan-empty', { bubbles: true }),
        );
      } catch {
        this.dispatchEvent(new CustomEvent('scan-error', { bubbles: true }));
      }
    });

    this.appendChild(btn);
    this.appendChild(input);
  }
}

  if (!customElements.get('qr-scan-button')) {
    customElements.define('qr-scan-button', QrScanButton);
  }
}

if (typeof window !== 'undefined') defineQrScanButton();
