import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Aset lama dipertahankan agar tab yang masih memakai index.html lama tidak 404 saat memuat chunk;
    // scripts/deploy.sh menghapus aset berumur > 7 hari.
    emptyOutDir: false,
    target: 'es2020',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3210',
      '/stream': 'http://127.0.0.1:3210',
      '/media': 'http://127.0.0.1:3210',
    },
  },
});
