import { resolve } from 'node:path';
import { PROJECT_ROOT, config } from './config.js';
import { closeDb, exec, queryOne } from './db.js';
import { hashPassword } from './lib/password.js';

/** Membuat akun admin awal HANYA bila belum ada user ber-role admin (tidak menimpa password yang sudah diganti). */
export async function seedAdmin(log: (msg: string) => void = console.log): Promise<boolean> {
  const existing = await queryOne<{ id: number }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing) {
    log('admin sudah ada, seeder dilewati');
    return false;
  }
  const password = config.ADMIN_INITIAL_PASSWORD;
  if (!password) throw new Error('ADMIN_INITIAL_PASSWORD kosong di .env');
  const username = config.ADMIN_USERNAME.toLowerCase();
  await exec(
    "INSERT INTO users (username, display_name, password_hash, role, status, avatar_color) VALUES (?, ?, ?, 'admin', 'active', ?)",
    [username, 'Administrator', await hashPassword(password), '#c62828'],
  );
  log(`admin "${username}" dibuat`);
  return true;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(PROJECT_ROOT, 'server/dist/seed.js');
if (isMain) {
  seedAdmin()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.log('seed GAGAL:', err);
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
