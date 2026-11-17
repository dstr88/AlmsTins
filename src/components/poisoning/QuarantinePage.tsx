/** The account-wide Quarantine page's list (src/pages/dashboard/quarantine.astro). */

import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getQuarantine } from '@/i18n/components/quarantine';
import type { QuarantineEntry } from '@/lib/quarantineEntry';
import { QuarantineList } from './QuarantineList';
import { onQuarantine } from './quarantineEvents';

export function QuarantinePage({ entries: initial }: { entries: QuarantineEntry[] }) {
	const t = getQuarantine(getClientLang());
	const [entries, setEntries] = useState(initial);
	useEffect(() => onQuarantine(setEntries), []);
	return <QuarantineList entries={entries} all={entries} emptyText={t.emptyAll} />;
}

export default QuarantinePage;
