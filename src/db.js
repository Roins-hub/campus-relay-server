import fs from 'node:fs';
import path from 'node:path';

const emptyData = () => ({
  users: [],
  devices: [],
  pairingCodes: [],
  remoteCommands: [],
  files: []
});

export class RelayStore {
  constructor(dbPath) {
    this.filePath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return emptyData();
    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (!raw.trim()) return emptyData();
    return { ...emptyData(), ...JSON.parse(raw) };
  }

  save() {
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2));
    fs.renameSync(tempPath, this.filePath);
  }

  createUser(user) {
    if (this.data.users.some((item) => item.username === user.username)) {
      const error = new Error('username already exists');
      error.code = 'USER_EXISTS';
      throw error;
    }
    this.data.users.push(user);
    this.save();
    return user;
  }

  getUserByUsername(username) {
    return this.data.users.find((user) => user.username === username);
  }

  createDevice(device) {
    this.data.devices.push(device);
    this.save();
    return device;
  }

  listDevices(userId) {
    return this.data.devices
      .filter((device) => device.user_id === userId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  getDeviceForUser(deviceId, userId) {
    return this.data.devices.find((device) => device.id === deviceId && device.user_id === userId);
  }

  getDeviceByToken(token) {
    return this.data.devices.find((device) => device.token === token);
  }

  getDeviceById(deviceId) {
    return this.data.devices.find((device) => device.id === deviceId);
  }

  updateDeviceStatus(deviceId, status, lastSeenAt) {
    const device = this.getDeviceById(deviceId);
    if (!device) return null;
    device.status = status;
    device.last_seen_at = lastSeenAt;
    this.save();
    return device;
  }

  assignDeviceToUser(deviceId, userId, status, lastSeenAt) {
    const device = this.getDeviceById(deviceId);
    if (!device) return null;
    device.user_id = userId;
    device.status = status;
    device.last_seen_at = lastSeenAt;
    this.save();
    return device;
  }

  createPairingCode(pairingCode) {
    this.data.pairingCodes.push(pairingCode);
    this.save();
    return pairingCode;
  }

  getActivePairingCode(code, userId) {
    return this.data.pairingCodes.find((item) => {
      const userMatches = userId === undefined ? true : item.user_id === userId;
      return item.code === code && userMatches && !item.used_at;
    });
  }

  markPairingCodeUsed(code, usedAt) {
    const pairingCode = this.data.pairingCodes.find((item) => item.code === code);
    if (!pairingCode) return null;
    pairingCode.used_at = usedAt;
    this.save();
    return pairingCode;
  }

  createCommand(command) {
    this.data.remoteCommands.push(command);
    this.save();
    return command;
  }

  getCommandForUser(commandId, userId) {
    return this.data.remoteCommands.find((command) => command.id === commandId && command.user_id === userId);
  }

  getCommandForDevice(commandId, deviceId) {
    return this.data.remoteCommands.find((command) => command.id === commandId && command.device_id === deviceId);
  }

  getCommandById(commandId) {
    return this.data.remoteCommands.find((command) => command.id === commandId);
  }

  listQueuedCommands(deviceId) {
    return this.data.remoteCommands
      .filter((command) => command.device_id === deviceId && ['queued', 'sent'].includes(command.status))
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  updateCommand(commandId, patch) {
    const command = this.getCommandById(commandId);
    if (!command) return null;
    Object.assign(command, patch);
    this.save();
    return command;
  }

  createFile(file) {
    this.data.files.push(file);
    this.save();
    return file;
  }

  getFileById(fileId) {
    return this.data.files.find((file) => file.id === fileId);
  }
}

export function createDatabase(dbPath) {
  return new RelayStore(dbPath);
}

export function nowIso() {
  return new Date().toISOString();
}

export function publicDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at
  };
}

export function publicCommand(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function publicFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    downloadUrl: `/files/${row.id}/download`,
    createdAt: row.created_at
  };
}
