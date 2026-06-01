import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../src/server.js';

async function withApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'campus-relay-files-'));
  const app = await buildApp({
    dbPath: join(dir, 'relay.json'),
    uploadDir: join(dir, 'uploads'),
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

async function registerDesktop(app, token) {
  const response = await app.inject({
    method: 'POST',
    url: '/devices/register',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'desktop', platform: 'windows' }
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

test('mobile user uploads a file that the paired desktop can download', async () => {
  await withApp(async (app) => {
    const token = await registerUser(app);
    const { deviceToken } = await registerDesktop(app, token);

    const content = 'course deadline: Friday';
    const upload = await app.inject({
      method: 'POST',
      url: '/files',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'course.txt',
        type: 'text/plain',
        contentBase64: Buffer.from(content).toString('base64')
      }
    });

    assert.equal(upload.statusCode, 201);
    const uploaded = upload.json().file;
    assert.equal(uploaded.name, 'course.txt');
    assert.equal(uploaded.mimeType, 'text/plain');
    assert.equal(uploaded.size, Buffer.byteLength(content));
    assert.match(uploaded.downloadUrl, /^\/files\/fil_[a-f0-9]+\/download$/);

    const userDownload = await app.inject({
      method: 'GET',
      url: uploaded.downloadUrl,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(userDownload.statusCode, 200);
    assert.equal(userDownload.body, content);

    const desktopDownload = await app.inject({
      method: 'GET',
      url: `${uploaded.downloadUrl}?deviceToken=${encodeURIComponent(deviceToken)}`
    });
    assert.equal(desktopDownload.statusCode, 200);
    assert.equal(desktopDownload.body, content);
  });
});

test('file downloads reject unauthenticated requests', async () => {
  await withApp(async (app) => {
    const token = await registerUser(app);
    const upload = await app.inject({
      method: 'POST',
      url: '/files',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'private.txt',
        type: 'text/plain',
        contentBase64: Buffer.from('private').toString('base64')
      }
    });

    assert.equal(upload.statusCode, 201);
    const denied = await app.inject({
      method: 'GET',
      url: upload.json().file.downloadUrl
    });
    assert.equal(denied.statusCode, 401);
  });
});
