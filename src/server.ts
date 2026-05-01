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

// Queue + worker
import { courtFilingQueue }                from './queue/courtFilingQueue';
import { courtFilingWorker, setSocketIO }  from './queue/courtFilingWorker';
import { redisConnection }                 from './queue/redis';
import { getActiveProviderName }           from './court/courtProviderFactory';

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 4000;

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

// ── Socket.io — /court namespace ──────────────────────────────────────────────
const io = new SocketIO(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  pingInterval: 10_000,   // heartbeat every 10s
  pingTimeout:  30_000,   // disconnect if no pong in 30s
});

const courtNS = io.of('/court');

courtNS.on('connection', (socket) => {
  console.log(`[Socket.io/court] Client connected: ${socket.id}`);

  // Client subscribes to a specific submission
  socket.on('subscribe', (submissionId: string) => {
    socket.join(`filing:${submissionId}`);
    socket.emit('subscribed', { submissionId });
    console.log(`[Socket.io/court] ${socket.id} → filing:${submissionId}`);
  });

  // Client unsubscribes
  socket.on('unsubscribe', (submissionId: string) => {
    socket.leave(`filing:${submissionId}`);
    console.log(`[Socket.io/court] ${socket.id} ← filing:${submissionId}`);
  });

  socket.on('disconnect', (reason) =>
    console.log(`[Socket.io/court] ${socket.id} disconnected: ${reason}`)
  );
});

// Inject the full io instance (worker emits to /court namespace via courtNS)
setSocketIO(io);

// ── Bull Board ────────────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues:        [new BullMQAdapter(courtFilingQueue)],
  serverAdapter,
});

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
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

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const workerRunning = courtFilingWorker.isRunning();
  res.json({
    status:     'ok',
    service:    'yaffa-law-api',
    ts:         new Date().toISOString(),
    worker:     workerRunning ? 'running' : 'idle',
    provider:   getActiveProviderName(),
    queues:     { courtFiling: 'online' },
    sockets:    {
      namespace: '/court',
      clients:   courtNS.sockets.size,
    },
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

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🏛️  Yaffa Law API   → http://localhost:${PORT}`);
  console.log(`   Health          → http://localhost:${PORT}/health`);
  console.log(`   Bull Board      → http://localhost:${PORT}/admin/queues`);
  console.log(`   Socket.io       → ws://localhost:${PORT}/court\n`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully…`);
  try {
    server.close(() => console.log('[Server] HTTP server closed'));
    await courtFilingWorker.close();
    console.log('[Server] BullMQ worker closed');
    await courtFilingQueue.close();
    console.log('[Server] BullMQ queue closed');
    await redisConnection.quit();
    console.log('[Server] Redis connection closed');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Export courtNS for use in worker
export { courtNS };
export default app;
