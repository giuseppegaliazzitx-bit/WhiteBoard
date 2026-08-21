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
    /**
     * Pin the Supabase config off for tests, overriding whatever is in the
     * developer's .env.
     *
     * Without this the suite is not hermetic: on a machine with Supabase
     * configured, the smoke test boots the real adapter and supabase-js throws
     * "native WebSocket not found" under Node. Tests must not depend on local
     * environment state. The Supabase adapter has its own coverage against a
     * fake client, which is where that path belongs.
     */
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_BOARD_ID: 'main',
    },
    coverage: {
      include: ['src/**/*.js'],
      exclude: ['src/main.js'],
    },
  },
})
