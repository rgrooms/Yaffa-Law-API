/**
 * Redis connection for BullMQ
 *
 * Uses REDIS_URL from .env (e.g. redis://localhost:6379).
 * Falls back to localhost:6379 for local development.
 * The `maxRetriesPerRequest: null` is required by BullMQ workers.
 */

import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
});

redisConnection.on('connect',      () => console.log('[Redis] Connected'));
redisConnection.on('error',  (err) => console.error('[Redis] Error:', err.message));
redisConnection.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));
