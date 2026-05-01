/**
 * Vitest mock for courtFilingQueue.
 *
 * Prevents ioredis from connecting to Redis during unit tests.
 * Tests use testMode:true in SimulatorProvider which skips queue entirely,
 * but the module graph still resolves the import — this stub stops Redis init.
 */

export const courtFilingQueue = {
  add: async () => ({ id: 'test-job-id' }),
  close: async () => {},
};
