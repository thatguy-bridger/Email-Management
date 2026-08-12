import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool;
function getPool() {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL;
    if (!connectionString) {
      throw new Error(
        'No database connection string found. Set DATABASE_URL (or connect Vercel Postgres, which sets POSTGRES_URL).'
      );
    }
    pool = new pg.Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export async function query(text, params) {
  const client = getPool();
  return client.query(text, params);
}

let schemaReady = null;

// Serverless cold starts are frequent, so schema init runs lazily on first
// query instead of a separate migration step -- there is no persistent
// process to run one ahead of time.
export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await query(sql);
    const { seedDefaults } = await import('./seed.js');
    await seedDefaults();
  })();
  return schemaReady;
}
