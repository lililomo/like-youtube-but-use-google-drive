import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import { config } from './config.js';

/** Opsi koneksi dasar: socket bila DB_HOST=localhost & DB_SOCKET diisi (konvensi MySQL), selain itu TCP. */
export function connectionOptions(extra: Partial<PoolOptions> = {}): PoolOptions {
  const target =
    config.DB_HOST === 'localhost' && config.DB_SOCKET
      ? { socketPath: config.DB_SOCKET }
      : { host: config.DB_HOST, port: config.DB_PORT };
  return {
    ...target,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    enableKeepAlive: true,
    ...extra,
  };
}

export const pool: Pool = mysql.createPool(
  connectionOptions({ connectionLimit: 15, waitForConnections: true, queueLimit: 0 }),
);

// Semua waktu disimpan UTC (DATETIME + NOW()/CURRENT_TIMESTAMP mengikuti zona sesi).
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

export type Db = Pool | PoolConnection;
export type Row = RowDataPacket;

/** SELECT → array baris. */
export async function query<T = Row>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

/** SELECT → baris pertama atau null. */
export async function queryOne<T = Row>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE → ResultSetHeader (insertId, affectedRows). */
export async function exec(sql: string, params: unknown[] = [], db: Db = pool): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(sql, params);
  return res;
}

/** Jalankan fn dalam transaksi; rollback otomatis bila error. */
export async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
