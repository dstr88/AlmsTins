/**
 * POST /api/import/detect
 *
 * Reads the first line of a CSV upload and fingerprints which exchange it
 * came from. Returns the detected source, display name, and the import
 * endpoint to POST the full file to.
 *
 * Body: multipart/form-data with a "file" field (only the first ~2 KB is
 * needed, but the full file is accepted so the client doesn't need to slice).
 */

import type { APIRoute } from 'astro';
import { inflateRawSync } from 'node:zlib';
import { requireTenantSession } from '@/lib/requireTenantSession';

// ── ZIP extraction (Snowtrace wraps its CSV in a deflate ZIP) ────────────────
function extractCsvFromZip(buf: Buffer): string | null {
  // Local file header magic: PK\x03\x04
  if (buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) {
    return null;
  }
  try {
    const compression    = buf.readUInt16LE(8);
    const compressedSize = buf.readUInt32LE(18);
    const filenameLen    = buf.readUInt16LE(26);
    const extraLen       = buf.readUInt16LE(28);
    const dataOffset     = 30 + filenameLen + extraLen;

    if (compression === 0) {
      // Stored — no compression
      return buf.slice(dataOffset).toString('utf-8');
    }
    if (compression === 8) {
      // Deflate
      const compressed = buf.slice(dataOffset, dataOffset + compressedSize);
      return inflateRawSync(compressed).toString('utf-8');
    }
  } catch { /* fall through */ }
  return null;
}

export const prerender = false;

// ── Fingerprint table ────────────────────────────────────────────────────────
// Each entry lists headers that MUST all be present for a match.
// More-specific signatures are listed first so they win ties.
const SIGNATURES = [
  {
    source: 'crypto_com',
    name: 'Crypto.com',
    endpoint: '/api/import/crypto-com',
    required: ['Transaction Description', 'Transaction Kind', 'Native Amount (in USD)'],
  },
  {
    source: 'exodus',
    name: 'Exodus',
    endpoint: '/api/import/exodus',
    required: ['FROMPORTFOLIO', 'TOPORTFOLIO', 'INAMOUNT', 'PERSONALNOTE'],
  },
  {
    source: 'coinbase',
    name: 'Coinbase',
    endpoint: '/api/import/coinbase',
    required: ['Quantity Transacted', 'Total (inclusive of fees and/or spread)'],
  },
  {
    source: 'gemini',
    name: 'Gemini',
    endpoint: '/api/import/gemini',
    required: ['Fee (USD) USD'],            // unique double-currency suffix
  },
  {
    source: 'cashapp',
    name: 'Cash App',
    endpoint: '/api/import/cashapp',
    required: ['Asset Type', 'Asset Amount', 'Asset Price'],
  },
  {
    source: 'venmo',
    name: 'Venmo',
    endpoint: '/api/import/venmo',
    required: ['Asset In (Quantity)', 'Transaction Fee (Quantity)'],
  },
  {
    source: 'robinhood',
    name: 'Robinhood',
    endpoint: '/api/import/robinhood',
    required: ['Transaction', 'Quantity', 'Symbol', 'Price'],
  },
  {
    source: 'kraken',
    name: 'Kraken',
    endpoint: '/api/import/kraken',
    required: ['txid', 'refid', 'aclass'],   // unique to Kraken Ledger History CSV
  },
  {
    source: 'avalanche_cchain',
    name: 'Avalanche C-Chain (Snowtrace)',
    endpoint: '/api/import/snowtrace',
    required: ['Transaction Hash', 'Value_IN(AVAX)', 'Value_OUT(AVAX)'],
  },
] as const;

function detectFromHeaders(headerLine: string): (typeof SIGNATURES)[number] | null {
  // Strip BOM and carriage returns
  const cleaned = headerLine.replace(/^\uFEFF/, '').replace(/\r/g, '');

  // Try comma first, then tab (Snowtrace exports TSV despite .csv extension)
  const delimiter = cleaned.includes('\t') ? '\t' : ',';
  const cols = new Set(
    cleaned.split(delimiter).map((h) => h.replace(/^"|"$/g, '').trim()),
  );

  for (const sig of SIGNATURES) {
    if (sig.required.every((col) => cols.has(col))) {
      return sig;
    }
  }
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireTenantSession(request);

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return json({ error: 'No file provided.' }, 400);
    }

    // Read the file — check for ZIP wrapper first (Snowtrace exports ZIP as .csv)
    const buf = Buffer.from(await file.arrayBuffer());
    let text: string;

    const extracted = extractCsvFromZip(buf);
    if (extracted !== null) {
      text = extracted;
    } else {
      // Plain text CSV — just need the header line
      text = buf.slice(0, 4096).toString('utf-8');
    }
    // Some exports (e.g. Gemini from Google Sheets) prepend a spreadsheet title
    // row before the real header. Scan the first 10 lines to find a match.
    const lines = text.split('\n').slice(0, 10);
    let match: ReturnType<typeof detectFromHeaders> = null;
    for (const line of lines) {
      match = detectFromHeaders(line);
      if (match) break;
    }

    if (!match) {
      return json({
        detected: false,
        error: 'Unrecognised CSV format. Is this a supported exchange export?',
      }, 422);
    }

    return json({
      detected: true,
      source: match.source,
      name: match.name,
      endpoint: match.endpoint,
    });
  } catch (err) {
    console.error('[import/detect]', err);
    return json({ error: 'Detection failed.' }, 500);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
