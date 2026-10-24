import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each test file creates its own SQLite database and sets module-level
    // config via env, so files must not share a worker.
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
  },
});
