import { createRealtimeTokenHandler } from '../providers/openai/realtime.js';
import { handleHudSummary } from '../providers/openai/hud-summary.js';
import { readCappedResponseText } from '../providers/common/http.js';

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
      middlewares.use('/api/ais-live', async (req, res) => {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          return json(res, 405, { error: 'Method not allowed' });
        }
        const incoming = new URL(req.url, 'http://localhost');
        if (!['/', '/track', '/track/'].includes(incoming.pathname)) {
          return json(res, 404, { error: 'Unknown AIS route' });
        }
        const backend = process.env.AIS_BACKEND_ORIGIN;
        if (!backend) {
          return json(res, 503, {
            rows: [],
            status: 'unavailable',
            error:
              'Set AIS_BACKEND_ORIGIN to a persistent AIS backend; AISSTREAM_API_KEY alone cannot provide a shared vessel cache on Vercel',
          });
        }
        try {
          const origin = new URL(backend);
          if (
            !['http:', 'https:'].includes(origin.protocol) ||
            origin.username ||
            origin.password ||
            origin.pathname !== '/' ||
            origin.search ||
            origin.hash
          ) {
            throw new Error('Invalid backend origin');
          }
          const target = new URL(
            `/api/ais-live${incoming.pathname === '/' ? '' : incoming.pathname}`,
            origin,
          );
          target.search = incoming.search;
          const upstream = await fetch(target, {
            signal: AbortSignal.timeout(20_000),
            redirect: 'error',
            headers: { Accept: 'application/json' },
          });
          const body = await readCappedResponseText(upstream, 4 * 1024 * 1024);
          if (body.tooLarge) throw new Error('AIS response too large');
          const payload = JSON.parse(body.text);
          json(res, upstream.status, payload);
        } catch {
          json(res, 502, {
            rows: [],
            status: 'unavailable',
            error:
              'AIS backend request failed; check AIS_BACKEND_ORIGIN and backend availability',
          });
        }
      });
    },
  };
}
