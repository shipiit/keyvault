import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
