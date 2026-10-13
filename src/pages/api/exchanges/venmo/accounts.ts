// POST /api/exchanges/venmo/accounts: add an account, with an optional owner label.
// Shared handler: src/lib/exchangeAccountRoutes.ts.
import type { APIRoute } from 'astro';
import { createExchangeAccount } from '@/lib/exchangeAccountRoutes';

export const POST: APIRoute = ({ request }) => createExchangeAccount(request, 'venmo');
