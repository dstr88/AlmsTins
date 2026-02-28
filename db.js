// db.js - Turso (libSQL) client setup and connection verification

import { createClient } from '@libsql/client';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

export const tursoClient =
  tursoUrl && tursoToken
    ? createClient({
        url: tursoUrl,
        authToken: tursoToken,
      })
    : null;

// Optional: One-time connection verification on startup (logs to console)
async function verifyTursoConnection() {
  try {
    if (!tursoClient) {
      console.warn('Turso verification skipped: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing.');
      return;
    }
    const result = await tursoClient.execute('SELECT sqlite_version()');
    
    // Access the version (works with current @libsql/client versions)
    const version = result.rows[0][0];  // rows is array of arrays (positional)
    // Alternative if using named columns: result.rows[0].sqlite_version()
    
    console.log('Turso connected successfully! SQLite version:', version);
  } catch (err) {
    console.error('Turso connection failed:', err?.message || err);
    // Optional: throw err; or process.exit(1); in production startup
  }
}

// Run verification once on module load (server startup)
verifyTursoConnection().catch(console.error);

// Export the client for use in other files
export default tursoClient;
