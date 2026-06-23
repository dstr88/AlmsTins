// PetroTins docs FAQ — data only, so copy edits never touch markup.
// Rendered by components/petro-tins/FaqList.astro on /petro-tins/docs.

export interface FaqItem { q: string; a: string; }

export const PETRO_FAQ: FaqItem[] = [
  {
    q: 'Does PetroTins connect to my bank?',
    a: "No. Never. You enter numbers manually. Nothing connects to your bank, brokerage, or any financial account. That's a design decision, not a limitation.",
  },
  {
    q: 'Where is my data stored?',
    a: "In a secure database tied to your account. It's never sold, shared, or used for advertising. You can delete your account at any time from the dropdown menu in the top-right corner — everything goes with it, permanently.",
  },
  {
    q: 'Does the balance update automatically when I log a payment?',
    a: 'Yes — for Debt Tins. When you log a Payment entry, the balance drops by that amount. When you log a Charge, it goes up. The utilization bar and interest calculations update immediately.',
  },
  {
    q: 'Can I use PetroTins and Almstins with the same account?',
    a: 'Yes. One login works for both. PetroTins is for personal finance (debt, budget, bills). Almstins is for crypto portfolio tracking and bookkeeping. Same account, separate dashboards.',
  },
  {
    q: 'Is there a mobile app?',
    a: 'Not yet. PetroTins is a web app that works in your mobile browser. A dedicated mobile app is on the roadmap.',
  },
  {
    q: 'What happens if I delete a tin?',
    a: 'All entries in that tin are deleted permanently. The dashboard totals update immediately. This cannot be undone.',
  },
  {
    q: 'Can multiple people share one account?',
    a: "Not yet — accounts are individual. Use the Splits Tin to track shared expenses between people who each have their own account, or use one person's account as the shared tracker.",
  },
];
