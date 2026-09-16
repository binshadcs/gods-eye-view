# Vercel deployment

Use the Vite preset, `npm run build`, and the `dist` output directory, with Node 24.
The `/api/*` rewrite invokes `api/index.js`, which installs the existing data
providers using their preview hooks. Keep this rewrite before the frontend fallback.

Set provider credentials in Vercel's environment settings; local `.env` files are
not deployed. Google Maps and Cesium tokens are build-time settings, so redeploy
after changing them. Other provider keys stay server-side.

After deploying, check `/api/celestrak/stations` for TLE text,
`/api/opensky` for JSON, and `/api/adsblol/mil` for JSON. These URLs must not return
the application HTML. Upstream outages and rate limits can still cause errors.

Provider memory caches are per function instance. Satellite disk caching uses
temporary storage on Vercel; it is not durable across instances. Other optional
disk caches may fall back to memory when the deployment filesystem is read-only.

Live ships require continuous AIS ingestion and a shared store; this function
does not start that persistent connection. Voice services and the local provider
settings editor are also excluded. Their routes return JSON 404 responses.
