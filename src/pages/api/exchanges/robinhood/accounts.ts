// POST /api/exchanges/robinhood/accounts: add an account, with an optional owner label.
// Shared handler: src/lib/exchangeAccountRoutes.ts.
import type { APIRoute } from 'astro';
import { createExchangeAccount } from '@/lib/exchangeAccountRoutes';

export const POST: APIRoute = ({ request }) => createExchangeAccount(request, 'robinhood');
