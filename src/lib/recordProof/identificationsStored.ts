// Rebuild the identification section of a record that was stored earlier. The entries are append-only
// and immutable, so the ones the record committed to are the tenant's entries recorded up to the end of
// its year and before it was generated; the root in the signed manifest says whether they still match.

import { loadIdentifications } from '../lotIdentificationStore';
import { loadStamps } from '../lotIdentificationStamp';
import { buildIdentificationSection, type BundleIdentifications } from './identifications';
import type { ProofManifest } from './buildProof';

export async function loadBundleIdentifications(tenantId: string, manifest: ProofManifest): Promise<BundleIdentifications | null> {
	if (!manifest.identifications_root) return null;
	const cutoff = [`${manifest.period}-12-31T23:59:59.999Z`, manifest.generated_at].sort()[0];
	const entries = (await loadIdentifications(tenantId)).filter((e) => e.createdAt <= cutoff);
	const batchIds = new Set(entries.map((e) => e.batchId));
	const stamps = [...(await loadStamps(tenantId)).values()].filter((s) => batchIds.has(s.batchId));
	const built = buildIdentificationSection(tenantId, {
		entries,
		stamps,
		covered: manifest.identification_sales?.covered ?? 0,
		total: manifest.identification_sales?.total ?? 0,
	});
	// Only what the signed root commits to is handed out.
	return built && built.root === manifest.identifications_root ? built.section : null;
}
