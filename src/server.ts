import express                from 'express';
import cors                   from 'cors';
import helmet                 from 'helmet';
import rateLimit              from 'express-rate-limit';
import dotenv                 from 'dotenv';
import http                   from 'http';
import { Server as SocketIO } from 'socket.io';

// Bull Board
import { createBullBoard }     from '@bull-board/api';
import { BullMQAdapter }       from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter }      from '@bull-board/express';

dotenv.config();

import authRoutes      from './routes/auth';
import casesRoutes     from './routes/cases';
import documentsRoutes from './routes/documents';
import medicalRoutes   from './routes/medical';
import aiRoutes        from './routes/ai';
import webhookRoutes   from './routes/webhooks';
import simRoutes       from './routes/sim';
import courtRoutes     from './routes/court';

// Queue + worker — imported after dotenv so env vars are available
import { courtFilingQueue }                from './queue/courtFilingQueue';
import { courtFilingWorker, setSocketIO }  from './queue/courtFilingWorker';
import { redisConnection }                 from './queue/redis';
import { getActiveProviderName }           from './court/courtProviderFactory';

const app    = express();
const server = http.createServer(app);
const PORT   = Number(process.env.PORT) || 4000;

// ── CORS — accept the staging Railway domain + local dev ──────────────────────
const FRONTEND_URL   = process.env.FRONTEND_URL || 'http://localhost:5173';
const ALLOWED_ORIGINS = [
  FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  // Allow any Railway subdomain during staging (tighten in production)
  /https:\/\/.*\.up\.railway\.app$/,
];

// ── Socket.io — /court namespace ──────────────────────────────────────────────
const io = new SocketIO(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  pingInterval: 10_000,
  pingTimeout:  30_000,
});

const courtNS = io.of('/court');

courtNS.on('connection', (socket) => {
  console.log(`[Socket.io/court] Client connected: ${socket.id}`);

  socket.on('subscribe', (submissionId: string) => {
    socket.join(`filing:${submissionId}`);
    socket.emit('subscribed', { submissionId });
    console.log(`[Socket.io/court] ${socket.id} → filing:${submissionId}`);
  });

  socket.on('unsubscribe', (submissionId: string) => {
    socket.leave(`filing:${submissionId}`);
    console.log(`[Socket.io/court] ${socket.id} ← filing:${submissionId}`);
  });

  socket.on('disconnect', (reason) =>
    console.log(`[Socket.io/court] ${socket.id} disconnected: ${reason}`)
  );
});

// Inject io into worker (done before startup to avoid timing issues)
setSocketIO(io);

// ── Bull Board ────────────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues:        [new BullMQAdapter(courtFilingQueue)],
  serverAdapter,
});

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // allow Bull Board UI assets
}));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check — always responds, reports subsystem status ─────────────────
// NOTE: This MUST be registered before queue/worker startup so Railway's
// health check probe can succeed even if Redis is still connecting.
let workerReady  = false;
let redisReady   = false;

redisConnection.on('ready', () => { redisReady = true; });

app.get('/health', (_req, res) => {
  let workerRunning = false;
  try { workerRunning = courtFilingWorker.isRunning(); } catch (_) { /* worker not init */ }

  res.status(200).json({
    status:     'ok',
    service:    'yaffa-law-api',
    ts:         new Date().toISOString(),
    provider:   getActiveProviderName(),
    redis:      redisReady ? 'connected' : 'connecting',
    worker:     workerRunning ? 'running' : (workerReady ? 'idle' : 'starting'),
    queues:     { courtFiling: 'online' },
    sockets:    { namespace: '/court', clients: courtNS.sockets.size },
    env:        process.env.NODE_ENV || 'development',
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',          authRoutes);
app.use('/cases',         casesRoutes);
app.use('/cases',         documentsRoutes);
app.use('/cases',         medicalRoutes);
app.use('/ai',            aiRoutes);
app.use('/webhooks',      webhookRoutes);
app.use('/sim',           simRoutes);
app.use('/court',         courtRoutes);
app.use('/admin/queues',  serverAdapter.getRouter());

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start — bind port FIRST, init queue/worker AFTER ─────────────────────────
// Binding first ensures Railway's health check always gets a 200 even if
// Redis is still connecting.  Worker init is non-blocking and non-fatal.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏛️  Yaffa Law API   → http://0.0.0.0:${PORT}`);
  console.log(`   Health          → http://0.0.0.0:${PORT}/health`);
  console.log(`   Bull Board      → http://0.0.0.0:${PORT}/admin/queues`);
  console.log(`   Socket.io       → ws://0.0.0.0:${PORT}/court`);
  console.log(`   Court Provider  → ${getActiveProviderName()}`);
  console.log(`   Node.js         → ${process.version}\n`);

  // Non-blocking worker startup — errors here do NOT crash the server
  (async () => {
    try {
      await redisConnection.ping();
      console.log('[Server] Redis ping OK');
      workerReady = true;
      console.log('[Server] BullMQ worker ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Server] Redis unavailable — BullMQ worker disabled: ${msg}`);
      console.warn('[Server] API running without queue support. Filing status updates will use polling fallback.');
    }
  })();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully…`);
  try {
    server.close(() => console.log('[Server] HTTP server closed'));
    try { await courtFilingWorker.close(); console.log('[Server] BullMQ worker closed'); } catch (_) {}
    try { await courtFilingQueue.close();  console.log('[Server] BullMQ queue closed');  } catch (_) {}
    try { await redisConnection.quit();    console.log('[Server] Redis closed');          } catch (_) {}
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch any unhandled rejections so they don't kill the process
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});

export { courtNS };
export default app;
