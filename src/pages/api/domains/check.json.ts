// src/pages/api/domains/check.json.ts
import type { APIRoute } from 'astro';

const sldRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const tldRegex = /^[a-z0-9-]{2,24}$/i;

function getTagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

export const GET: APIRoute = async ({ request, url }) => {
  // Debug logs (keep these for now)
  console.log('API /api/domains/check.json was hit!');
  console.log('Full URL:', url.toString());
  console.log('Search params:', Object.fromEntries(url.searchParams));

  const sld = (url.searchParams.get("sld") || "").toLowerCase().trim();
  const tld = (url.searchParams.get("tld") || "").toLowerCase().trim();

  // Original validation
  if (!sldRegex.test(sld) || !tldRegex.test(tld)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid domain input." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const endpoint = process.env.ENOM_ENDPOINT;
  const uid = process.env.ENOM_UID;
  const pw = process.env.ENOM_PW;

  if (!endpoint || !uid || !pw) {
    return new Response(
      JSON.stringify({ ok: false, error: "Server not configured for eNom." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const params = new URLSearchParams({
    UID: uid,
    PW: pw,
    SLD: sld,
    TLD: tld,
    Command: "check",
    responsetype: "xml"
  });

  let xml = "";
  try {
    const res = await fetch(`${endpoint}?${params.toString()}`);
    xml = await res.text();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "eNom request failed." }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error('eNom fetch error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: "Network error contacting eNom." }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const errCount = parseInt(getTagValue(xml, "ErrCount") || "0", 10);
  if (errCount > 0) {
    const err1 = getTagValue(xml, "Err1") || "eNom error.";
    return new Response(
      JSON.stringify({ ok: false, error: err1 }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const rrpCode = getTagValue(xml, "RRPCode");
  const rrpText = getTagValue(xml, "RRPText") || "";
  let available = false;

  if (rrpCode === "210") {
    available = true;
  } else if (rrpCode === "211") {
    available = false;
  } else if (rrpText) {
    const lower = rrpText.toLowerCase();
    available = lower.includes("available") && !lower.includes("not available");
  }

  return new Response(
    JSON.stringify({
      ok: true,
      domain: `${sld}.${tld}`,
      available,
      rrpCode: rrpCode || null,
      rrpText: rrpText || null
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
};