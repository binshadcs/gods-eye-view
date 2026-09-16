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

## AIS vessels and tracks

The local AIS provider maintains one upstream WebSocket and an in-memory vessel
and track cache. Independent Vercel instances cannot share that cache and can
compete for AISStream's one-connection-per-key limit.

Run the application backend on an always-running Node host with
`AISSTREAM_API_KEY` configured (`npm run build`, then
`npm run preview -- --host 0.0.0.0`; put it behind HTTPS). Set
`AIS_BACKEND_ORIGIN=https://your-backend.example` in Vercel and redeploy.
The origin must have no path, credentials, query, or fragment. It must point to
that backend, never the Vercel frontend. Only one backend should ingest per key.

Vercel forwards `/api/ais-live` and `/api/ais-live/track` to this backend,
including query parameters. Missing configuration returns actionable JSON with
HTTP 503; unreachable or invalid backends return 502. A missing backend is not a
working live feed: setting `AISSTREAM_API_KEY` on Vercel alone is insufficient.

## Voice and HUD summaries

`/api/realtime/token` and `/api/openai/hud-summary` run as normal HTTP handlers.
Set `OPENAI_API_KEY` in Vercel to enable them. The browser connects directly to
OpenAI for the voice session. Existing optional OpenAI rate-limit settings still
apply per instance; they are not a shared deployment-wide quota.

`/api/realtime/debug-log` returns JSON with HTTP 501 because local conversation
log files are not durable on Vercel. `/api/keys` stays unavailable: the local
settings editor must not be exposed on a public deployment.
