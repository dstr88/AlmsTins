import { fileURLToPath } from 'node:url';

/**
 * The receivables host pages, in one list (plan convention 7). Source-pin tests find a host's
 * file through hostPath(), never through a hard-coded path, so moving the pages from
 * src/pages/verify/ to src/pages/receivables/ changes the one HOST_DIR line below.
 */
const HOST_DIR = 'src/pages/verify';

export const RECEIVABLES_HOSTS = {
	registry: `${HOST_DIR}/registry.astro`,
	desk: `${HOST_DIR}/desk.astro`,
	client: `${HOST_DIR}/client.astro`,
} as const;

export type ReceivablesHost = keyof typeof RECEIVABLES_HOSTS;

/** The absolute path of a host page's source file. */
export function hostPath(host: ReceivablesHost): string {
	return fileURLToPath(new URL(`../../${RECEIVABLES_HOSTS[host]}`, import.meta.url));
}
