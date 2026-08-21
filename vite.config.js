import { defineConfig } from 'vite'

export default defineConfig({
  // Cloudflare Pages serves from the site root.
  base: './',
  build: {
    outDir: 'dist',
    // The anon key is public by design, but source maps would also expose
    // the module layout for no benefit. Keep the bundle lean instead.
    sourcemap: false,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.js'],
    coverage: {
      include: ['src/**/*.js'],
      exclude: ['src/main.js'],
    },
  },
})
