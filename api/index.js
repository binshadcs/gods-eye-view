import { localProviderPlugins } from '../server/providers/local.js';
import { createProviderHandler } from '../server/vercel/handler.js';
import { vercelServiceRoutes } from '../server/vercel/services.js';

// Preview hooks expose data providers without the local .env editor.
// AIS uses bounded request-time collection; OpenAI HTTP routes run here.
const excluded = new Set(['ais-live-proxy', 'openai-realtime-proxy']);
const handle = createProviderHandler([
  ...localProviderPlugins().filter((plugin) => !excluded.has(plugin.name)),
  vercelServiceRoutes(),
]);

// Providers consume the Node request stream themselves.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.searchParams.get('__gev_path');
  if (route !== null) {
    url.searchParams.delete('__gev_path');
    req.url = `/api/${route}${url.search}`;
  }
  return handle(req, res);
}
