import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The QR maker, the QR image and the frame reader (Area 5). The libraries are stubbed: CI has no
 * canvas, and what matters here is what is passed to them and what comes back. The unit config
 * compiles JSX with the classic runtime, so React is a global before the component is imported.
 */

afterEach(() => {
	vi.doUnmock('qrcode');
	vi.doUnmock('jsqr');
	vi.resetModules();
});

describe('toQrDataUrl', () => {
	it('encodes the text exactly, with only the width and margin given (the library defaults stay)', async () => {
		const toDataURL = vi.fn(async () => 'data:image/png;base64,QR');
		vi.doMock('qrcode', () => ({ toDataURL }));
		const { toQrDataUrl } = await import('../../src/lib/qrMake');
		const text = 'https://almstins.com/verify/scan?address=0xAbC%20';
		expect(await toQrDataUrl(text, { width: 220, margin: 1 })).toBe('data:image/png;base64,QR');
		expect(toDataURL).toHaveBeenCalledWith(text, { width: 220, margin: 1 });
	});

	it('finds the function on `default` too (the package is CommonJS)', async () => {
		const toDataURL = vi.fn(async () => 'data:x');
		vi.doMock('qrcode', () => ({ toDataURL: undefined, default: { toDataURL } }));
		const { toQrDataUrl } = await import('../../src/lib/qrMake');
		expect(await toQrDataUrl('bc1qabc', { width: 240, margin: 1 })).toBe('data:x');
		expect(toDataURL).toHaveBeenCalledWith('bc1qabc', { width: 240, margin: 1 });
	});

	it('throws when there is nothing to draw with, or the library fails, so a screen can say so', async () => {
		vi.doMock('qrcode', () => ({ toDataURL: undefined, default: {} }));
		const { toQrDataUrl } = await import('../../src/lib/qrMake');
		await expect(toQrDataUrl('x', { width: 1, margin: 0 })).rejects.toThrow('qrcode');
		vi.resetModules();
		vi.doMock('qrcode', () => ({ toDataURL: async () => { throw new Error('too long'); } }));
		const again = await import('../../src/lib/qrMake');
		await expect(again.toQrDataUrl('x', { width: 1, margin: 0 })).rejects.toThrow('too long');
	});
});

describe('decodeQrFromImageData', () => {
	const frame = { data: new Uint8ClampedArray(16), width: 2, height: 2 };

	it('passes the frame to jsQR, light-on-dark codes included, and returns the payload', async () => {
		const jsQR = vi.fn(() => ({ data: 'ethereum:0xabc' }));
		vi.doMock('jsqr', () => ({ default: jsQR }));
		const { decodeQrFromImageData } = await import('../../src/lib/qrScan');
		expect(decodeQrFromImageData(frame)).toBe('ethereum:0xabc');
		expect(jsQR).toHaveBeenCalledWith(frame.data, 2, 2, { inversionAttempts: 'attemptBoth' });
	});

	it('returns null when the frame has no code', async () => {
		vi.doMock('jsqr', () => ({ default: () => null }));
		const { decodeQrFromImageData } = await import('../../src/lib/qrScan');
		expect(decodeQrFromImageData(frame)).toBeNull();
	});
});

describe('<QrImage>', () => {
	let QrImage: typeof import('../../src/components/ui/QrImage').QrImage;
	let QrImageView: typeof import('../../src/components/ui/QrImage').QrImageView;
	beforeAll(async () => {
		(globalThis as { React?: typeof React }).React = React;
		({ QrImage, QrImageView } = await import('../../src/components/ui/QrImage'));
	});
	const render = (el: React.ReactElement) => renderToStaticMarkup(el);
	const h = React.createElement;

	it('shows the image at its size with its alt text, then the children, then the download link', () => {
		const html = render(h(QrImageView, {
			dataUrl: 'data:QR', size: 220, alt: 'Payment QR', className: 'vd-qr__img',
			download: { filename: 'almstins-payment-eth.png', label: 'Download PNG', className: 'vd-qr__dl' },
		}, h('p', null, 'hint')));
		expect(html).toBe(
			'<img class="vd-qr__img" src="data:QR" alt="Payment QR" width="220" height="220"/>'
			+ '<p>hint</p>'
			+ '<a class="vd-qr__dl" href="data:QR" download="almstins-payment-eth.png">Download PNG</a>',
		);
	});

	it('shows the placeholder, and no download link, until the code is drawn; it says when it failed', () => {
		const placeholder = (s: 'loading' | 'failed') => h('span', null, s);
		const download = { filename: 'a.png', label: 'Download' };
		expect(render(h(QrImageView, { dataUrl: '', size: 240, alt: 'QR', placeholder, download }))).toBe('<span>loading</span>');
		expect(render(h(QrImageView, { dataUrl: '', failed: true, size: 240, alt: 'QR', placeholder, download }))).toBe('<span>failed</span>');
		expect(render(h(QrImageView, { dataUrl: '', size: 240, alt: 'QR' }))).toMatch(/^<div aria-hidden="true" style="width:240px/);
	});

	it('server-renders as loading (the code is drawn in the browser)', () => {
		const placeholder = (s: 'loading' | 'failed') => h('i', null, s);
		expect(render(h(QrImage, { text: 'bc1qabc', size: 240, margin: 1, alt: 'QR', placeholder }))).toBe('<i>loading</i>');
	});
});

describe('the real libraries (no stubs)', () => {
	const ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

	it('toQrDataUrl draws byte for byte what a direct toDataURL call draws (as the screens did before Area 5)', async () => {
		const QRCode = await import('qrcode');
		const { toQrDataUrl } = await import('../../src/lib/qrMake');
		for (const [text, width] of [[ADDRESS, 240], [`https://almstins.com/verify/scan?address=${encodeURIComponent(ADDRESS)}`, 220]] as const) {
			const before = await QRCode.toDataURL(text, { width, margin: 1 });
			expect(await toQrDataUrl(text, { width, margin: 1 })).toBe(before);
			expect(before).toMatch(/^data:image\/png;base64,/);
		}
	});

	it('a code made by qrcode reads back with decodeQrFromImageData, also light on dark', async () => {
		const QRCode = await import('qrcode');
		const { decodeQrFromImageData } = await import('../../src/lib/qrScan');
		const { modules } = QRCode.create(ADDRESS, {});
		const scale = 4;
		const quiet = 4;
		const side = (modules.size + quiet * 2) * scale;
		const frame = (invert: boolean) => {
			const data = new Uint8ClampedArray(side * side * 4);
			for (let y = 0; y < side; y++) {
				for (let x = 0; x < side; x++) {
					const mx = Math.floor(x / scale) - quiet;
					const my = Math.floor(y / scale) - quiet;
					const dark = mx >= 0 && my >= 0 && mx < modules.size && my < modules.size && modules.get(my, mx) === 1;
					const v = dark !== invert ? 0 : 255;
					data.set([v, v, v, 255], (y * side + x) * 4);
				}
			}
			return { data, width: side, height: side };
		};
		expect(decodeQrFromImageData(frame(false))).toBe(ADDRESS);
		expect(decodeQrFromImageData(frame(true))).toBe(ADDRESS);
		expect(decodeQrFromImageData({ data: new Uint8ClampedArray(side * side * 4).fill(255), width: side, height: side })).toBeNull();
	});
});
