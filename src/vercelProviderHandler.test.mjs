import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderHandler } from '../server/vercel/handler.js';
import handler from '../api/index.js';

function response() {
  return {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
      this.headersSent = true;
    },
    end(body) {
      this.body = body;
      this.writableEnded = true;
    },
  };
}

test('provider mount strips only the path prefix and preserves queries', async () => {
  let received;
  const handle = createProviderHandler([
    {
      configurePreviewServer({ middlewares }) {
        middlewares.use('/api/opensky', async (req, res) => {
          received = req.url;
          res.end('{}');
        });
      },
    },
  ]);
  const req = { url: '/api/opensky?lat=10&lon=20' };
  await handle(req, response());
  assert.equal(received, '/?lat=10&lon=20');
  assert.equal(req.url, '/api/opensky?lat=10&lon=20');
  const res = response();
  await handle({ url: '/api/opensky-track' }, res);
  assert.equal(res.status, 404);
});

test('rewritten satellite request reaches the actual provider with a stripped path', async () => {
  const res = response();
  await handler(
    { url: '/api?__gev_path=celestrak/invalid%21', headers: {} },
    res,
  );
  assert.equal(res.status, 400);
  assert.equal(res.body, 'invalid group');
});

test('unavailable and local settings endpoints return JSON, never frontend HTML', async () => {
  for (const path of ['unknown', 'keys', 'setup/keys', 'setup/status']) {
    const res = response();
    await handler({ url: `/api?__gev_path=${path}`, headers: {} }, res);
    assert.equal(res.status, 404);
    assert.match(res.headers['Content-Type'], /application\/json/);
    assert.ok(JSON.parse(res.body).error);
  }
});

test('provider exceptions are sanitized', async () => {
  const handle = createProviderHandler([
    {
      configurePreviewServer({ middlewares }) {
        middlewares.use('/api/fail', async () => {
          throw new Error('private detail');
        });
      },
    },
  ]);
  const res = response();
  await handle({ url: '/api/fail' }, res);
  assert.equal(res.status, 502);
  assert.doesNotMatch(res.body, /private detail/);
});

test('flight routes return provider JSON through the Vercel entry point', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return new Response(
      JSON.stringify(
        String(url).includes('opensky')
          ? { time: Math.floor(Date.now() / 1000), states: [] }
          : { ac: [], now: Date.now() / 1000 },
      ),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  });
  for (const path of ['opensky', 'adsblol/mil']) {
    const res = response();
    await handler(
      {
        url: `/api/index?__gev_path=${path}&lat=10&lon=20`,
        headers: {},
        method: 'GET',
      },
      res,
    );
    assert.equal(res.status, 200);
    assert.doesNotThrow(() => JSON.parse(res.body));
  }
  assert.ok(requests.some((url) => url.includes('opensky-network.org')));
  assert.ok(requests.some((url) => url.includes('api.adsb.lol/v2/mil')));
});

test('excluded services now have explicit Vercel handlers', async (t) => {
  setEnv(t, 'AIS_BACKEND_ORIGIN', '');
  setEnv(t, 'OPENAI_API_KEY', '');
  for (const [path, method, status] of [
    ['ais-live', 'GET', 503],
    ['ais-live/track?mmsi=123456789', 'GET', 503],
    ['realtime/token', 'GET', 503],
    ['openai/hud-summary', 'GET', 405],
    ['realtime/debug-log', 'POST', 501],
  ]) {
    const res = response();
    await handler({ url: `/api/${path}`, method, headers: {} }, res);
    assert.equal(res.statusCode, status, path);
    assert.ok(JSON.parse(res.body).error);
  }
});

test('AIS forwards snapshots and tracks, preserving query and provider status', async (t) => {
  setEnv(t, 'AIS_BACKEND_ORIGIN', 'https://ais.example.com');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(String(url));
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return new Response(
      JSON.stringify({ rows: [], samples: [], status: 'live' }),
      { status: 200 },
    );
  });
  for (const path of ['ais-live&maxRows=50', 'ais-live/track&mmsi=123456789']) {
    const res = response();
    await handler(
      { url: `/api/index?__gev_path=${path}`, method: 'GET', headers: {} },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).status, 'live');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.deepEqual(requests, [
    'https://ais.example.com/api/ais-live?maxRows=50',
    'https://ais.example.com/api/ais-live/track?mmsi=123456789',
  ]);
});

test('AIS upstream failures return sanitized JSON', async (t) => {
  setEnv(t, 'AIS_BACKEND_ORIGIN', 'https://ais.example.com');
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('private detail');
  });
  const res = response();
  await handler({ url: '/api/ais-live', method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(res.body, /private detail/);
});

function setEnv(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

test('voice token and HUD HTTP routes reach their providers', async (t) => {
  setEnv(t, 'OPENAI_API_KEY', 'test-only');
  setEnv(t, 'GEV_RATELIMIT_OPENAI_PER_MIN', '');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ value: 'ephemeral-test-token' }));
  });
  const res = response();
  await handler(
    {
      url: '/api/index?__gev_path=realtime/token&tier=mini',
      method: 'GET',
      headers: {},
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).value, 'ephemeral-test-token');
  assert.equal(res.headers['X-GEV-Voice-Tier'], 'mini');
  assert.equal(requests.length, 1);
  process.env.OPENAI_API_KEY = '';
  const hud = response();
  await handler(
    {
      url: '/api/index?__gev_path=openai/hud-summary',
      method: 'POST',
      headers: {},
    },
    hud,
  );
  assert.equal(hud.statusCode, 200);
  assert.equal(JSON.parse(hud.body).configured, false);
});
