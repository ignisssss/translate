import { defineConfig } from 'vite';

// './' — относительные пути: сайт работает и на https://user.github.io/repo/,
// и на собственном домене без дополнительной настройки.
export default defineConfig({
  base: process.env.VITE_BASE || './',
  build: { outDir: 'dist', target: 'es2020' },
});
