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

AIS uses the existing `AISSTREAM_API_KEY`, `AISSTREAM_BOUNDING_BOXES`, and
`AISSTREAM_MESSAGE_TYPES` settings directly. No additional environment variable
or separate backend is required. Configure the existing key in Vercel and redeploy.

The Vercel handler collects AIS messages for up to eight seconds during a snapshot
request, then closes the upstream socket before responding. Concurrent requests
within an instance share collection, and snapshots are reused for 30 seconds.
`/api/ais-live/track` reads the recent tracks collected by that instance.
The local development and preview servers retain continuous ingestion.

This is a sampled feed: messages between collection windows are missed, caches
and tracks reset on cold starts, and separate instances do not share history.
AISStream can reject overlapping connections from different instances using the
same key; provider status reports failures. Missing keys return 503 rather than 404. Continuous fleet coverage and durable tracks require persistent ingestion.

## Voice and HUD summaries

`/api/realtime/token` and `/api/openai/hud-summary` run as normal HTTP handlers.
Set `OPENAI_API_KEY` in Vercel to enable them. The browser connects directly to
OpenAI for the voice session. Existing optional OpenAI rate-limit settings still
apply per instance; they are not a shared deployment-wide quota.

`/api/realtime/debug-log` returns JSON with HTTP 501 because local conversation
log files are not durable on Vercel. `/api/keys` stays unavailable: the local
settings editor must not be exposed on a public deployment.
