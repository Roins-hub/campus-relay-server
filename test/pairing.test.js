import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../src/server.js';

async function withApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'campus-relay-'));
  const app = await buildApp({
    dbPath: join(dir, 'relay.json'),
    jwtSecret: 'test-secret',
    logger: false
  });
  try {
    await fn(app);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function registerUser(app, username = `user_${Date.now()}`) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' }
  });
  assert.equal(response.statusCode, 200);
  return response.json().token;
}

test('desktop can create a pairing code that a logged-in mobile user claims', async () => {
  await withApp(async (app) => {
    const start = await app.inject({
      method: 'POST',
      url: '/pairing/desktop/start',
      payload: { deviceName: '宿舍电脑', platform: 'windows' }
    });

    assert.equal(start.statusCode, 201);
    const pairing = start.json();
    assert.match(pairing.code, /^\d{6}$/);
    assert.equal(pairing.pairingUrl, `campus://pair?code=${pairing.code}`);
    assert.equal(pairing.device.name, '宿舍电脑');
    assert.equal(pairing.device.status, 'pending');
    assert.equal(typeof pairing.deviceToken, 'string');

    const token = await registerUser(app);
    const claim = await app.inject({
      method: 'POST',
      url: '/pairing/claim',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: pairing.code }
    });

    assert.equal(claim.statusCode, 200);
    const claimed = claim.json();
    assert.equal(claimed.device.id, pairing.device.id);
    assert.equal(claimed.device.name, '宿舍电脑');
    assert.equal(claimed.device.status, 'offline');

    const devices = await app.inject({
      method: 'GET',
      url: '/devices',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(devices.statusCode, 200);
    assert.deepEqual(devices.json().devices.map((device) => device.id), [pairing.device.id]);

    const secondClaim = await app.inject({
      method: 'POST',
      url: '/pairing/claim',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: pairing.code }
    });
    assert.equal(secondClaim.statusCode, 400);
  });
});
