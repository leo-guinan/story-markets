import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'creator',
  base: '/creator-assets/',
  plugins: [react()],
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { input: 'creator.html' },
  },
  test: { include: ['../test/**/*.test.js'] },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/creator-api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
});
