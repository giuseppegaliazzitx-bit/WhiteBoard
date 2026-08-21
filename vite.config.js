import { defineConfig } from 'vite'

export default defineConfig({
  // Cloudflare Pages serves from the site root.
  base: './',
  build: {
    outDir: 'dist',
    /**
     * Pinned explicitly. Vite 6 changed the default from 'modules' to
     * 'baseline-widely-available', which quietly drops everything older than
     * roughly Safari 16 / Chrome 107.
     *
     * Nothing here needs that: boot is wrapped in a function specifically to
     * avoid top-level await, which is the feature that would force the target
     * up. So the wider set costs nothing and the support floor stays a choice
     * rather than something a dependency bump decides.
     */
    target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'],
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
