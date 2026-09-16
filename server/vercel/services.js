import { createRealtimeTokenHandler } from '../providers/openai/realtime.js';
import { handleHudSummary } from '../providers/openai/hud-summary.js';
import { aisLiveProxy } from '../providers/vessels/ais-live.js';

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function vercelServiceRoutes() {
  return {
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/realtime/token', createRealtimeTokenHandler());
      middlewares.use('/api/openai/hud-summary', handleHudSummary);
      middlewares.use('/api/realtime/debug-log', async (req, res) => {
        json(res, 501, {
          error: 'Local conversation logging is unavailable on Vercel',
        });
      });
      aisLiveProxy({ requestScoped: true }).configurePreviewServer({
        middlewares,
      });
    },
  };
}
