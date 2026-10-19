/**
 * One agent, as a page: its key, the registry of addresses it may pay, its own wallets, its
 * ledger with the totals, and the export of that ledger. The two sentences that say what the Vault does and does not see sit at
 * the top, where they are read: the ledger records the checks the agent asks and the funds that
 * reach its registered addresses, and a transfer to an address that was never registered is
 * invisible here; and Pass means the checks that ran came back without a flag, never that an
 * address is safe.
 *
 * Rendered on the server and hydrated, so every figure is in the page before any script runs.
 * The page keeps the plan's figures current for the panels (and the meter in the bar) by reading
 * the plan again after anything that adds or frees a place.
 */
import { useState } from 'react';
import type { AgentPageData } from '@/lib/agentVault/vaultPages';
import AgentKeyCard from './AgentKeyCard';
import { announcePlan } from './client';
import { copy } from './copy';
import ExportCard from './ExportCard';
import LedgerPanel from './LedgerPanel';
import { HOME_PATH } from './paths';
import RegistryPanel from './RegistryPanel';
import RemoveAgent from './RemoveAgent';
import WalletsPanel from './WalletsPanel';

export default function AgentPage({ data }: { data: AgentPageData }) {
  const [plan, setPlan] = useState(data.plan);

  async function planChanged() {
    const fresh = await announcePlan();
    if (fresh) setPlan(fresh);
  }

  return (
    <div className="ag-page">
      <a className="ag-back" href={HOME_PATH}>
        {copy.agent.back}
      </a>
      <header className="ag-hero">
        <p className="ag-kicker">{copy.agent.kicker}</p>
        <h1 className="ag-title">{data.tin.label}</h1>
        <p className="ag-sub">{copy.agent.created(data.since)}</p>
      </header>

      <div className="ag-notice">
        <p>{copy.agent.limits.records}</p>
        <p>{copy.agent.limits.pass}</p>
      </div>

      <AgentKeyCard tinId={data.tin.id} linked={data.key} available={data.availableKeys} />
      <RegistryPanel tinId={data.tin.id} destinations={data.destinations} plan={plan} onChanged={planChanged} />
      <WalletsPanel tinId={data.tin.id} wallets={data.wallets} plan={plan} />
      <LedgerPanel tinId={data.tin.id} ledger={data.ledger} totals={data.totals} />
      <ExportCard tinId={data.tin.id} since={data.since} today={data.today} signing={data.signing} />
      <RemoveAgent tinId={data.tin.id} />
    </div>
  );
}
