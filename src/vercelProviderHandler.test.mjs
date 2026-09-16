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
  setEnv(t, 'AISSTREAM_API_KEY', '');
  setEnv(t, 'OPENAI_API_KEY', '');
  for (const [path, method, status] of [
    ['ais-live', 'GET', 503],
    ['ais-live/track?mmsi=bad', 'GET', 400],
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

test('AIS request collection uses existing settings, shares sockets and returns vessels and tracks', async (t) => {
  const { WebSocketServer } = await import('ws');
  const { aisLiveProxy } =
    await import('../server/providers/vessels/ais-live.js');
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => upstream.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        for (const client of upstream.clients) client.terminate();
        upstream.close(resolve);
      }),
  );
  setEnv(t, 'AISSTREAM_API_KEY', 'test-ais-key');
  setEnv(t, 'AISSTREAM_URL', `ws://127.0.0.1:${upstream.address().port}`);
  setEnv(t, 'AISSTREAM_BOUNDING_BOXES', '[[[10,20],[11,21]]]');
  setEnv(t, 'AISSTREAM_MESSAGE_TYPES', 'PositionReport');
  let connections = 0;
  let subscription;
  upstream.on('connection', (socket) => {
    connections++;
    socket.on('message', (data) => {
      subscription = JSON.parse(data.toString());
      for (const [offset, latitude] of [
        [-60, 10],
        [0, 10.1],
      ]) {
        socket.send(
          JSON.stringify({
            MessageType: 'PositionReport',
            MetaData: {
              MMSI: 123456789,
              latitude,
              longitude: 20,
              time_utc: new Date(Date.now() + offset * 1000).toISOString(),
            },
            Message: {
              PositionReport: {
                UserID: 123456789,
                Latitude: latitude,
                Longitude: 20,
              },
            },
          }),
        );
      }
    });
  });
  const plugin = aisLiveProxy({ requestScoped: true, collectionMs: 200 });
  t.after(() => plugin.closeBundle());
  const handle = createProviderHandler([plugin]);
  const first = response();
  const second = response();
  await Promise.all([
    handle({ url: '/api/ais-live?maxRows=1', method: 'GET' }, first),
    handle({ url: '/api/ais-live?maxRows=1', method: 'GET' }, second),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).status, 'live');
  assert.equal(JSON.parse(first.body).rows.length, 1);
  assert.equal(JSON.parse(second.body).rows.length, 1);
  assert.equal(connections, 1);
  assert.deepEqual(subscription, {
    APIKey: 'test-ais-key',
    BoundingBoxes: [
      [
        [10, 20],
        [11, 21],
      ],
    ],
    FilterMessageTypes: ['PositionReport'],
  });
  await handle({ url: '/api/ais-live', method: 'GET' }, response());
  assert.equal(connections, 1);
  const track = response();
  await handle(
    { url: '/api/ais-live/track?mmsi=123456789', method: 'GET' },
    track,
  );
  assert.equal(track.statusCode, 200);
  assert.equal(JSON.parse(track.body).samples.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    upstream.clients.size,
    0,
    'socket must close before the function becomes idle',
  );
});
