import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 90_000,   // 90s — PDFKit generation + async stage chains
    hookTimeout: 10_000,

    // Manual mocks: redirect Redis and the queue to no-op stubs during tests.
    // Prevents ioredis from attempting a real Redis connection.
    alias: {
      'ioredis':                    path.resolve(__dirname, 'src/__mocks__/ioredis.ts'),
      '../queue/courtFilingQueue':  path.resolve(__dirname, 'src/__mocks__/queue/courtFilingQueue.ts'),
    },
  },
});
