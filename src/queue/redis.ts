/**
 * Redis connection for BullMQ
 *
 * Uses REDIS_URL from .env (e.g. redis://localhost:6379).
 * Falls back to localhost:6379 for local development.
 * The `maxRetriesPerRequest: null` is required by BullMQ workers.
 *
 * TLS: Railway may provide a rediss:// URL — handled automatically via tls option.
 * Non-fatal: connection errors are logged but do NOT crash the process.
 */

import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Railway Redis uses TLS (rediss://) — enable tls option for those URLs
const tlsOptions = REDIS_URL.startsWith('rediss://')
  ? { tls: { rejectUnauthorized: false } }
  : {};

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck:     false, // Don't block queue/worker creation on ready check
  lazyConnect:          false,
  retryStrategy: (times: number) => {
    // Retry up to 10 times with exponential backoff, then give up gracefully
    if (times > 10) {
      console.error('[Redis] Max retries exceeded — running without Redis');
      return null; // Stop retrying
    }
    return Math.min(times * 200, 3000);
  },
  ...tlsOptions,
});

redisConnection.on('connect',      () => console.log('[Redis] Connected ✓'));
redisConnection.on('ready',        () => console.log('[Redis] Ready'));
redisConnection.on('error',  (err) => console.error('[Redis] Error:', err.message));
redisConnection.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));
redisConnection.on('close',        () => console.warn('[Redis] Connection closed'));

export const isRedisAvailable = (): boolean => redisConnection.status === 'ready';
