import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative paths so the APK (file/https://localhost) loads assets correctly
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});
