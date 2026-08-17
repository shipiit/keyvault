import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Content-script tests opt into jsdom with a `@vitest-environment jsdom`
    // docblock. Node stays the default: it is faster, and src/core must keep
    // working without a DOM so the cryptography is auditable in plain Node.
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js', 'src/content/**/*.js'],
      // Entry points are wiring, not logic: they self-execute on import and
      // exist only to attach listeners. Their behaviour is covered through
      // the modules they call. Excluded so the threshold measures the code
      // that actually decides things.
      exclude: ['src/content/index.js'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
