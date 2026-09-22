import 'dotenv/config';
import http from 'http';
import { buildApp } from './app';
import { logger } from './lib/logger';
import { initRealtime } from './realtime/socketServer';

const app = buildApp();
const httpServer = http.createServer(app);
initRealtime(httpServer);

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  logger.info({ port }, 'qr-ordering server listening (http + ws /realtime)');
});

export { app };
