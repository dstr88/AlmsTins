// POST /api/exchanges/exodus/accounts/update: rename an account and/or set its owner label.
// Shared handler: src/lib/exchangeAccountRoutes.ts.
import type { APIRoute } from 'astro';
import { updateExchangeAccount } from '@/lib/exchangeAccountRoutes';

export const POST: APIRoute = ({ request }) => updateExchangeAccount(request, 'exodus');
