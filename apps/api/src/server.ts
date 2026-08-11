import { loadConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = await buildApp(config);

  const port = config.PORT;
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ event: 'server.started', port, publicUrl: config.PUBLIC_URL }, 'Android VPS API is listening');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ event: 'server.shutdown', signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});