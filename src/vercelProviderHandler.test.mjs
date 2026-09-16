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
  for (const path of ['unknown', 'ais-live', 'realtime/token', 'keys']) {
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
