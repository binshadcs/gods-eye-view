/** Adapt provider mount paths to Node requests, including Connect prefix stripping. */
export function createProviderHandler(plugins) {
  const routes = [];
  const server = {
    middlewares: {
      use(prefix, handler) {
        routes.push({ prefix, handler });
      },
    },
  };
  for (const plugin of plugins) plugin.configurePreviewServer?.(server);

  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const route = routes.find(
      ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'API route unavailable on this deployment' }),
      );
      return;
    }
    const originalUrl = req.url;
    req.originalUrl = originalUrl;
    const suffix = originalUrl.slice(route.prefix.length);
    req.url = suffix.startsWith('/') ? suffix : `/${suffix}`;
    try {
      await route.handler(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Data provider request failed' }));
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      req.url = originalUrl;
    }
  };
}
