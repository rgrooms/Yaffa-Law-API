/**
 * Vitest mock for ioredis.
 *
 * Prevents any Redis connection attempts in tests.
 * All ioredis calls are no-ops.
 */

const Redis = class {
  on() { return this; }
  connect()    { return Promise.resolve(); }
  disconnect() { return Promise.resolve(); }
  quit()       { return Promise.resolve(); }
  get()        { return Promise.resolve(null); }
  set()        { return Promise.resolve('OK'); }
  del()        { return Promise.resolve(0); }
  ping()       { return Promise.resolve('PONG'); }
};

export default Redis;
module.exports = Redis;
module.exports.default = Redis;
