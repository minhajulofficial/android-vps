import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Node built-ins (including node:sqlite) must be loaded natively, not
    // processed by Vite's resolver.
    server: {
      deps: {
        external: [/^node:/]
      }
    }
  }
});