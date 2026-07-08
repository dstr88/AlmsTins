/**
 * securityEvents.ts
 *
 * Detects and logs suspicious activity from the AI chat endpoint.
 * Fire-and-forget — never blocks the request or tips off the caller.
 */

import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';

const OWNER_EMAIL = 'donnie@titaniumhut.com';

// ── Injection pattern library ─────────────────────────────────────────────────
// Covers the common jailbreak playbook. Intentionally kept readable so it is
// easy to add new patterns when new techniques emerge.
const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore_instructions', re: /ignore\s+(previous|prior|all|your)\s+(instructions?|rules?|prompts?|directives?)/i },
  { name: 'disregard_instructions', re: /disregard\s+(all|previous|prior|your)?\s*(instructions?|rules?|prompts?)/i },
  { name: 'forget_instructions',  re: /forget\s+(everything|all|previous|your)\s*(instructions?|rules?|prompts?)?/i },
  { name: 'reveal_system_prompt', re: /(?:reveal|show|print|output|repeat|display|give me)\s+(?:your\s+)?(?:system\s+)?prompt/i },
  { name: 'system_prompt_probe',  re: /what(?:'s| is)\s+(?:your|the)\s+(?:system\s+)?prompt/i },
  { name: 'persona_override',     re: /you\s+are\s+(?:now\s+)?(?:a\s+)?(?:dan|jailbreak|unrestricted|unfiltered|evil|hacked)/i },
  { name: 'act_as_dan',           re: /act\s+as\s+(?:dan|jailbreak|a\s+different|an?\s+unrestricted)/i },
  { name: 'pretend_no_rules',     re: /pretend\s+(?:you\s+have\s+no|there\s+are\s+no)\s+(?:rules?|restrictions?|guidelines?)/i },
  { name: 'override_instructions',re: /override\s+(?:your\s+)?(?:instructions?|rules?|guidelines?|restrictions?)/i },
  { name: 'bypass_restrictions',  re: /bypass\s+(?:your\s+)?(?:instructions?|rules?|restrictions?|filters?|safety)/i },
  { name: 'new_instructions',     re: /(?:new|updated?|different)\s+instructions?:\s*/i },
  { name: 'end_of_prompt_marker', re: /(?:---+|===+|###)\s*(?:end\s+of\s+(?:system\s+)?prompt|instructions?\s+end|begin\s+user)/i },
  { name: 'xml_escape_attempt',   re: /<\/portfolio_data>/i },
  { name: 'other_users_data',     re: /(?:other|another|different|all)\s+(?:users?|tenants?|accounts?)\s+(?:data|transactions?|holdings?)/i },
];

export function detectInjection(question: string): string[] {
  return INJECTION_PATTERNS
    .filter(p => p.re.test(question))
    .map(p => p.name);
}

// ── Logging ───────────────────────────────────────────────────────────────────

async function writeEvent(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute({
      sql: `INSERT INTO security_events (tenant_id, event_type, payload)
            VALUES ($1, $2, $3)`,
      args: [tenantId, eventType, JSON.stringify(payload)],
    });
  } catch (err) {
    console.error('[security] failed to write event', err);
  }
}

async function sendAlert(subject: string, body: string): Promise<void> {
  try {
    await sendMail({ to: OWNER_EMAIL, subject, text: body });
  } catch (err) {
    console.error('[security] failed to send alert email', err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call before every chat API request.
 * Checks for injection patterns, logs to DB, and emails an alert.
 * Never throws — all errors are caught internally.
 */
export async function auditChatQuestion(
  tenantId: string,
  question: string,
): Promise<void> {
  const matched = detectInjection(question);
  if (matched.length === 0) return;

  const payload = {
    patterns: matched,
    question_preview: question.slice(0, 300),
    question_length: question.length,
  };

  // Fire both in parallel, non-blocking
  void writeEvent(tenantId, 'injection_attempt', payload);

  const body = [
    `Possible prompt injection detected in AI chat.`,
    ``,
    `Tenant:   ${tenantId}`,
    `Patterns: ${matched.join(', ')}`,
    `Length:   ${question.length} chars`,
    ``,
    `Question preview:`,
    `"${question.slice(0, 500)}"`,
    ``,
    `This question was still processed. Review security_events table for full history.`,
  ].join('\n');

  void sendAlert(`[Almstins Security] Injection attempt detected`, body);

  // Log to server output as well for Render log tailing
  console.warn('[security] injection_attempt', { tenantId, patterns: matched, questionLength: question.length });
}
