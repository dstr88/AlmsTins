export interface PetroTinEntry {
  id: string;
  tinId: string;
  entryDate: string;
  kind: 'payment' | 'charge' | 'income' | 'expense';
  amount: number;
  description: string;
  checked: boolean;
  isDefault: boolean;   // true = auto-copies next month; bills always true, income toggleable
  url: string | null;   // optional payment link
}

// ── Splits Tin ────────────────────────────────────────────────────────────────

export interface SplitsPerson {
  id: string;
  splitsId: string;
  name: string;
  isOwner: boolean;   // true = the bookkeeper; their payments post as expenses
  sortOrder: number;
}

export interface SplitsBill {
  id: string;
  splitsId: string;
  name: string;
  amount: number;
  isDefault: boolean; // recurs each month
  noBudget: boolean;  // true = payment won't auto-post to budget register
  sortOrder: number;
  assignments: SplitsAssignment[];
}

export interface SplitsAssignmentLine {
  label: string;  // formula or description
  value: number;  // resolved dollar amount
}

export interface SplitsAssignment {
  id: string;
  billId: string;
  personId: string;
  type: 'flat' | 'pct';
  value: number;       // dollars if flat, 0-100 if pct
  breakdown: string | null; // JSON array of {label, value} lines
}

export interface SplitsPayment {
  id: string;
  personId: string;
  billId: string;
  month: string;       // YYYY-MM
  amount: number;
  paidDate: string;    // YYYY-MM-DD
  budgetEntryId: string | null;
}

export interface SplitsTin {
  id: string;
  tenantId: string;
  name: string;
  interestRate: number;    // monthly % on carried balance, 0 = none
  budgetTinId: string | null; // which budget tin receives income posts
  people: SplitsPerson[];
  bills: SplitsBill[];
  payments: SplitsPayment[];  // current + prior month
  carriedBalances: Record<string, number>; // personId → amount they still owe from prior months
}

// ── Core Tin ──────────────────────────────────────────────────────────────────

export interface PetroTin {
  id: string;
  tenantId: string;
  type: 'debt' | 'budget' | 'business';
  name: string;
  balance?: number;
  creditLimit?: number;
  apr?: number;
  minPayment?: number;
  goalRevenue?: number;
  notes?: string;
  sortOrder: number;
  surplusMode: 'none' | 'slush';
  isSlush: boolean;
  entries: PetroTinEntry[];
}
