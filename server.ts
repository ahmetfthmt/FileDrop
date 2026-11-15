import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { attachSignalingServer } from './server/signaling.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  const server = http.createServer(app);
  const { service } = attachSignalingServer(server);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: service.getRoomCount() });
  });

  app.post('/share-target', (_req, res) => {
    res.redirect(303, '/');
  });

  const distDir = path.resolve(__dirname, 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const useProdStatic =
    process.env.NODE_ENV === 'production' ||
    (process.env.NODE_ENV !== 'development' && fs.existsSync(distIndex));

  if (!useProdStatic) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(distIndex);
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`File Drop server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start File Drop server:', error);
  process.exit(1);
});
