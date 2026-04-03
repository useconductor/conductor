import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['dist/', 'node_modules/', 'tests/', 'src/dashboard/', 'src/bot/', 'extensions/'],
    },
  },
});
