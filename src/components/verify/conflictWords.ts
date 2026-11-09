/**
 * ConflictList, the logic: the words a platform's entity card uses for its conflicted entries
 * (guard PR B, spec 3h). Pure. The entries are the platform's own list; the other party is a word
 * (G5), never a tenant or a domain, and nothing here can add one.
 */
export type ConflictWith = 'merchant' | 'platform';

export interface EntityConflictView {
  address: string;
  chain: string;
  conflictWith: ConflictWith;
  since: string | null;
}

export interface ConflictWords {
  entConflicts: string;
  entConflictsOne: string;
  conflictWithMerchant: string;
  conflictWithPlatform: string;
}

/** The count line: the one-entry sentence, or the plural with {n} filled. Nothing for zero. */
export function conflictCountLine(n: number, t: ConflictWords): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? t.entConflictsOne : t.entConflicts.replace('{n}', String(n));
}

export function conflictWord(w: ConflictWith, t: ConflictWords): string {
  return w === 'platform' ? t.conflictWithPlatform : t.conflictWithMerchant;
}
