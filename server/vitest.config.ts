import { defineConfig } from 'vitest/config';

// Tes tidak membaca .env asli: konfigurasi minimal disuntik lewat env.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      DV_ENV_FILE: '/nonexistent/.env',
      NODE_ENV: 'test',
      APP_KEY: 'base64:' + Buffer.alloc(32, 7).toString('base64'),
      INTERNAL_TOKEN: 'x'.repeat(64),
      DB_USER: 'test',
      DB_NAME: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
