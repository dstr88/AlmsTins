/**
 * The small meter in the Agentics bar: which plan the account is on and how much of it is used
 * ("Free plan: 2 of 3 agents, 9 of 15 addresses"). No prices, no button to buy anything: it says
 * where the account stands and nothing else.
 *
 * It is rendered on the server with the figures at the time of the request, and it updates itself
 * when a page tells it the figures changed (a browser event from ./client.ts), so adding an address
 * moves the meter without a reload.
 */
import { useEffect, useState } from 'react';
import type { PlanSummary } from '@/lib/agentVault/entitlements';
import { planFactsOf, PLAN_EVENT } from './client';
import { copy } from './copy';

/** The meter's sentence. A plan with no limits says how much is used and that nothing limits it. */
export function planMeterText(plan: Pick<PlanSummary, 'limits' | 'use'>): string {
  const { limits, use } = plan;
  if (limits.bots === null || limits.addresses === null) return copy.plan.unlimited(use.bots, use.addresses);
  return copy.plan.free(use.bots, limits.bots, use.addresses, limits.addresses);
}

export default function PlanMeter({ plan }: { plan: PlanSummary }) {
  const [current, setCurrent] = useState(plan);
  useEffect(() => {
    const onPlan = (event: Event) => {
      const next = planFactsOf((event as CustomEvent).detail as Record<string, unknown> | null);
      if (next) setCurrent(next);
    };
    window.addEventListener(PLAN_EVENT, onPlan);
    return () => window.removeEventListener(PLAN_EVENT, onPlan);
  }, []);
  return (
    <p className="ag-meter" role="status" aria-label={copy.plan.label}>
      {planMeterText(current)}
    </p>
  );
}
