import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { PROJECT_ROOT } from './config.js';
import { connectionOptions } from './db.js';

/** Menjalankan server/migrations/*.sql yang belum tercatat di schema_migrations (idempoten). */
export async function migrate(log: (msg: string) => void = console.log): Promise<string[]> {
  const dir = resolve(PROJECT_ROOT, 'server/migrations');
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  const conn = await mysql.createConnection(connectionOptions({ multipleStatements: true }));
  const applied: string[] = [];
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id VARCHAR(100) PRIMARY KEY,
         applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT id FROM schema_migrations');
    const done = new Set(rows.map((r) => String(r.id)));

    for (const file of files) {
      const id = file.replace(/\.sql$/, '');
      if (done.has(id)) continue;
      log(`menjalankan migrasi ${id}`);
      const sql = readFileSync(resolve(dir, file), 'utf8');
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [id]);
      applied.push(id);
    }
    if (applied.length === 0) log('tidak ada migrasi baru');
  } finally {
    await conn.end();
  }
  return applied;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(PROJECT_ROOT, 'server/dist/migrate.js');
if (isMain) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.log('migrasi GAGAL:', err);
      process.exit(1);
    });
}
