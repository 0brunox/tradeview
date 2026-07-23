import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));

let pool = null;
let ready = false;

export function isDbReady() {
  return ready;
}

export function getPool() {
  return ready ? pool : null;
}

/**
 * Connect to Postgres and ensure the schema exists.
 * Never throws: on any failure the server keeps running in proxy mode.
 */
export async function initDb() {
  if (!config.dbEnabled || !config.databaseUrl) {
    console.warn('[db] disabled — running in proxy mode (no persistence)');
    return;
  }
  try {
    pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 4000 });
    const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
    await pool.query(schema);
    ready = true;
    console.log('[db] connected — schema ready');
  } catch (err) {
    console.warn(`[db] unavailable (${err.message}) — running in proxy mode`);
    if (pool) {
      pool.end().catch(() => {});
    }
    pool = null;
    ready = false;
  }
}
