import { defineConfig } from 'vitest/config';

/**
 * The live-model probe. Separate from `vitest.config` so `npm test` never
 * reaches it: these hit a real endpoint, take minutes, and their assertions
 * are about whether a model answered at all — what they are actually for is
 * the transcript they print.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.probe.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
