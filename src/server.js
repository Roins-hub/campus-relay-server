import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createDatabase, nowIso, publicCommand, publicDevice } from './db.js';

dotenv.config();

export const defaultConfig = {
  port: Number(process.env.PORT || 8780),
  host: process.env.HOST || '127.0.0.1',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  dbPath: process.env.DB_PATH || './data/relay.sqlite',
  corsOrigin: process.env.CORS_ORIGIN || '*'
};

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function sixDigitCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function pairingUrl(code) {
  return `campus://pair?code=${encodeURIComponent(code)}`;
}

export async function buildApp(inputConfig = {}) {
  const config = { ...defaultConfig, ...inputConfig };
  const db = createDatabase(config.dbPath);
  const app = Fastify({ logger: config.logger ?? true });

  await app.register(cors, { origin: config.corsOrigin === '*' ? true : config.corsOrigin });
  await app.register(websocket);

  const desktopSockets = new Map();
  const mobileSocketsByUser = new Map();

  function signUser(user) {
    return jwt.sign({ sub: user.id, username: user.username, kind: 'user' }, config.jwtSecret, { expiresIn: '30d' });
  }

  function verifyUserToken(request) {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw app.httpErrors.unauthorized('Missing token');
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.kind !== 'user') throw app.httpErrors.unauthorized('Invalid token');
    return payload;
  }

  function sendJson(socket, message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function broadcastToUser(userId, message) {
    if (!userId) return;
    const sockets = mobileSocketsByUser.get(userId);
    if (!sockets) return;
    for (const socket of sockets) sendJson(socket, message);
  }

  function markDeviceStatus(deviceId, status) {
    db.updateDeviceStatus(deviceId, status, nowIso());
  }

  app.get('/health', async () => ({
    ok: true,
    service: 'campus-relay-server',
    version: '0.1.0',
    time: nowIso()
  }));

  app.post('/auth/register', async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || !password || password.length < 8) {
      return reply.code(400).send({ error: 'username and password(>=8) are required' });
    }

    const user = { id: id('usr'), username: String(username).trim(), created_at: nowIso() };
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      db.createUser({ ...user, password_hash: passwordHash });
    } catch (error) {
      if (error.code === 'USER_EXISTS') {
        return reply.code(409).send({ error: 'username already exists' });
      }
      throw error;
    }

    return { token: signUser(user), user: { id: user.id, username: user.username } };
  });

  app.post('/auth/login', async (request, reply) => {
    const { username, password } = request.body || {};
    const user = db.getUserByUsername(String(username || '').trim());
    if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
      return reply.code(401).send({ error: 'invalid username or password' });
    }

    return { token: signUser(user), user: { id: user.id, username: user.username } };
  });

  app.get('/me', async (request) => {
    const auth = verifyUserToken(request);
    return { user: { id: auth.sub, username: auth.username } };
  });

  app.post('/devices/register', async (request) => {
    const auth = verifyUserToken(request);
    const createdAt = nowIso();
    const device = {
      id: id('dev'),
      userId: auth.sub,
      name: String(request.body?.name || '校园智办桌面端'),
      platform: String(request.body?.platform || 'desktop'),
      token: id('dtk'),
      createdAt
    };

    db.createDevice({
      id: device.id,
      user_id: device.userId,
      name: device.name,
      platform: device.platform,
      token: device.token,
      status: 'offline',
      last_seen_at: null,
      created_at: device.createdAt
    });

    return { device: { id: device.id, name: device.name, platform: device.platform }, deviceToken: device.token };
  });

  app.get('/devices', async (request) => {
    const auth = verifyUserToken(request);
    const rows = db.listDevices(auth.sub);
    return { devices: rows.map(publicDevice) };
  });

  app.post('/pairing/desktop/start', async (request, reply) => {
    const createdAt = nowIso();
    const device = {
      id: id('dev'),
      user_id: null,
      name: String(request.body?.deviceName || request.body?.name || '校园智办桌面端').trim() || '校园智办桌面端',
      platform: String(request.body?.platform || 'desktop'),
      token: id('dtk'),
      status: 'pending',
      last_seen_at: null,
      created_at: createdAt
    };
    db.createDevice(device);

    const code = sixDigitCode();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    db.createPairingCode({
      code,
      device_id: device.id,
      user_id: null,
      expires_at: expiresAt,
      used_at: null,
      created_at: createdAt
    });

    return reply.code(201).send({
      code,
      pairingUrl: pairingUrl(code),
      expiresAt,
      device: publicDevice(device),
      deviceToken: device.token
    });
  });

  app.post('/pairing/claim', async (request, reply) => {
    const auth = verifyUserToken(request);
    const code = String(request.body?.code || '').trim();
    const pairing = db.getActivePairingCode(code);

    if (!pairing || pairing.expires_at < Date.now()) {
      return reply.code(400).send({ error: 'pairing code is invalid or expired' });
    }

    const device = db.getDeviceById(pairing.device_id);
    if (!device) return reply.code(404).send({ error: 'device not found' });
    if (device.user_id && device.user_id !== auth.sub) {
      return reply.code(409).send({ error: 'device is already paired' });
    }

    db.assignDeviceToUser(device.id, auth.sub, 'offline', nowIso());
    db.markPairingCodeUsed(code, nowIso());
    return { device: publicDevice(db.getDeviceById(device.id)) };
  });

  app.post('/devices/:deviceId/pairing-code', async (request, reply) => {
    const auth = verifyUserToken(request);
    const device = db.getDeviceForUser(request.params.deviceId, auth.sub);
    if (!device) return reply.code(404).send({ error: 'device not found' });

    const code = sixDigitCode();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    db.createPairingCode({
      code,
      device_id: device.id,
      user_id: auth.sub,
      expires_at: expiresAt,
      used_at: null,
      created_at: nowIso()
    });

    return { code, pairingUrl: pairingUrl(code), expiresAt };
  });

  app.post('/devices/pair', async (request, reply) => {
    const auth = verifyUserToken(request);
    const code = String(request.body?.code || '').trim();
    const pairing = db.getActivePairingCode(code, auth.sub);

    if (!pairing || pairing.expires_at < Date.now()) {
      return reply.code(400).send({ error: 'pairing code is invalid or expired' });
    }

    db.markPairingCodeUsed(code, nowIso());
    const device = db.getDeviceById(pairing.device_id);
    return { device: publicDevice(device) };
  });

  app.post('/commands', async (request, reply) => {
    const auth = verifyUserToken(request);
    const { deviceId, type, payload } = request.body || {};
    const device = db.getDeviceForUser(deviceId, auth.sub);
    if (!device) return reply.code(404).send({ error: 'device not found' });
    if (!type) return reply.code(400).send({ error: 'type is required' });

    const commandId = id('cmd');
    const createdAt = nowIso();
    db.createCommand({
      id: commandId,
      user_id: auth.sub,
      device_id: device.id,
      type: String(type),
      payload_json: JSON.stringify(payload ?? {}),
      status: 'queued',
      result_json: null,
      created_at: createdAt,
      updated_at: createdAt
    });

    const command = publicCommand(db.getCommandById(commandId));
    const desktop = desktopSockets.get(device.id);
    if (desktop) {
      db.updateCommand(commandId, { status: 'sent', updated_at: nowIso() });
      command.status = 'sent';
      sendJson(desktop, { event: 'command.created', command });
    }

    return reply.code(202).send({ command });
  });

  app.get('/commands/:commandId', async (request, reply) => {
    const auth = verifyUserToken(request);
    const row = db.getCommandForUser(request.params.commandId, auth.sub);
    if (!row) return reply.code(404).send({ error: 'command not found' });
    return { command: publicCommand(row) };
  });

  app.get('/ws/desktop', { websocket: true }, (socket, request) => {
    const token = request.query?.token;
    const device = db.getDeviceByToken(String(token || ''));
    if (!device) {
      socket.close(1008, 'invalid device token');
      return;
    }

    desktopSockets.set(device.id, socket);
    markDeviceStatus(device.id, 'online');
    broadcastToUser(device.user_id, { event: 'device.status', device: publicDevice({ ...device, status: 'online', last_seen_at: nowIso() }) });

    const queued = db.listQueuedCommands(device.id);
    for (const row of queued) {
      db.updateCommand(row.id, { status: 'sent', updated_at: nowIso() });
      sendJson(socket, { event: 'command.created', command: { ...publicCommand(row), status: 'sent' } });
    }

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        sendJson(socket, { event: 'error', error: 'invalid json' });
        return;
      }

      if (message.event === 'command.result') {
        const command = db.getCommandForDevice(message.commandId, device.id);
        if (!command) return;

        const status = ['completed', 'failed', 'running'].includes(message.status) ? message.status : 'completed';
        const result = {
          status,
          text: message.text || '',
          artifacts: Array.isArray(message.artifacts) ? message.artifacts : [],
          updatedAt: nowIso()
        };
        db.updateCommand(command.id, { status, result_json: JSON.stringify(result), updated_at: result.updatedAt });
        broadcastToUser(command.user_id, {
          event: 'command.updated',
          command: publicCommand(db.getCommandById(command.id))
        });
      }

      if (message.event === 'desktop.heartbeat') {
        markDeviceStatus(device.id, 'online');
      }
    });

    socket.on('close', () => {
      if (desktopSockets.get(device.id) === socket) desktopSockets.delete(device.id);
      markDeviceStatus(device.id, 'offline');
      broadcastToUser(device.user_id, { event: 'device.status', device: publicDevice({ ...device, status: 'offline', last_seen_at: nowIso() }) });
    });
  });

  app.get('/ws/mobile', { websocket: true }, (socket, request) => {
    let payload;
    try {
      payload = jwt.verify(String(request.query?.token || ''), config.jwtSecret);
    } catch {
      socket.close(1008, 'invalid token');
      return;
    }

    if (payload.kind !== 'user') {
      socket.close(1008, 'invalid token');
      return;
    }

    const sockets = mobileSocketsByUser.get(payload.sub) || new Set();
    sockets.add(socket);
    mobileSocketsByUser.set(payload.sub, sockets);
    sendJson(socket, { event: 'connected', userId: payload.sub });

    socket.on('close', () => {
      sockets.delete(socket);
      if (sockets.size === 0) mobileSocketsByUser.delete(payload.sub);
    });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const status = error.statusCode || 500;
    reply.code(status).send({ error: status === 500 ? 'internal server error' : error.message });
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildApp();
  await app.listen({ host: defaultConfig.host, port: defaultConfig.port });
}
