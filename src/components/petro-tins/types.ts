export interface PetroTinEntry {
  id: string;
  tinId: string;
  entryDate: string;
  kind: 'payment' | 'charge' | 'income' | 'expense';
  amount: number;
  description: string;
  checked: boolean;
}

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
  entries: PetroTinEntry[];
}
