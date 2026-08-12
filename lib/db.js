import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool;
function getPool() {
  if (!pool) {
    // Checked in this order so a plain DATABASE_URL always wins if present,
    // but reported by name below either way -- useful when more than one of
    // these ends up set (e.g. two storage integrations connected at once).
    const candidates = [
      ['DATABASE_URL', process.env.DATABASE_URL],
      ['POSTGRES_URL', process.env.POSTGRES_URL],
      ['POSTGRES_PRISMA_URL', process.env.POSTGRES_PRISMA_URL],
    ];
    const found = candidates.find(([, v]) => v);

    if (!found) {
      throw new Error(
        'No database connection string found. None of DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL are set ' +
        'in this deployment\'s environment. If you just added/connected a database, redeploy -- env vars only apply ' +
        'to deployments built after they were added.'
      );
    }

    const [varName, connectionString] = found;
    const scheme = connectionString.split('://')[0];

    // Prisma Postgres's default connection string is routed through Prisma
    // Accelerate (prisma+postgres://, prisma://) -- a proxy protocol the
    // plain `pg` driver used here cannot speak at all, as opposed to a
    // standard postgres:// URL. Caught here with a specific, actionable
    // message instead of letting `pg` fail on it with a cryptic parse error.
    if (scheme !== 'postgres' && scheme !== 'postgresql') {
      throw new Error(
        `${varName} is set, but its scheme is "${scheme}://", not "postgres://". This app connects with the plain ` +
        'pg library, which only understands standard Postgres connection strings -- it cannot use a Prisma Accelerate ' +
        '(prisma+postgres:// / prisma://) URL. If you connected "Prisma Postgres" from Vercel\'s storage marketplace, ' +
        'either switch to a plain "Postgres" (Neon-backed) database instead, or use Prisma\'s direct/non-Accelerate ' +
        'connection string for DATABASE_URL if your plan exposes one.'
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
  })();
  return schemaReady;
}
