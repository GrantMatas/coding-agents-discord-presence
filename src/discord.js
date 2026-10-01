const net = require('node:net');

class DiscordRpc {
  constructor(applicationId) {
    this.applicationId = applicationId;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.ready = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  get connected() { return Boolean(this.socket && !this.socket.destroyed && this.ready === true); }

  async connect() {
    if (this.connected) return;
    this.close();
    let lastError;
    for (let index = 0; index < 10; index++) {
      try {
        await this.connectPipe(`\\\\.\\pipe\\discord-ipc-${index}`);
        return;
      } catch (error) {
        lastError = error;
        this.close();
      }
    }
    throw new Error(`Discord desktop IPC unavailable: ${lastError?.message || 'no pipe found'}`);
  }

  connectPipe(pipeName) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(pipeName);
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      let settled = false;
      const timer = setTimeout(() => fail(new Error('Discord connection timed out')), 1200);
      const fail = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      this.readyResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = true;
        resolve();
      };
      this.readyReject = fail;
      socket.on('connect', () => this.writeFrame(0, { v: 1, client_id: this.applicationId }));
      socket.on('data', data => this.onData(data));
      socket.on('error', fail);
      socket.on('close', () => {
        this.ready = false;
        fail(new Error('Discord disconnected'));
        for (const pending of this.pending.values()) pending.reject(new Error('Discord disconnected'));
        this.pending.clear();
      });
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > 1024 * 1024) { this.close(); return; }
      if (this.buffer.length < 8 + length) return;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      if (opcode === 3) { this.writeRawFrame(4, body); continue; }
      if (opcode === 2) { this.close(); return; }
      if (opcode !== 1) continue;
      let message;
      try { message = JSON.parse(body.toString('utf8')); } catch { continue; }
      if (message.evt === 'READY') { this.readyResolve?.(); continue; }
      if (message.evt === 'ERROR' && !message.nonce) { this.readyReject?.(new Error(message.data?.message || 'Discord rejected the connection')); continue; }
      const pending = this.pending.get(message.nonce);
      if (!pending) continue;
      this.pending.delete(message.nonce);
      if (message.evt === 'ERROR') pending.reject(new Error(message.data?.message || 'Discord rejected activity'));
      else pending.resolve(message);
    }
  }

  writeRawFrame(opcode, body) {
    if (!this.socket || this.socket.destroyed) throw new Error('Discord disconnected');
    const header = Buffer.alloc(8);
    header.writeInt32LE(opcode, 0);
    header.writeInt32LE(body.length, 4);
    this.socket.write(Buffer.concat([header, body]));
  }

  writeFrame(opcode, value) { this.writeRawFrame(opcode, Buffer.from(JSON.stringify(value), 'utf8')); }

  async setActivity(activity) {
    await this.connect();
    const nonce = require('node:crypto').randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error('Discord activity timed out'));
      }, 8000);
      this.pending.set(nonce, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      try { this.writeFrame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce }); }
      catch (error) { clearTimeout(timer); this.pending.delete(nonce); reject(error); }
    });
  }

  close() {
    this.ready = false;
    this.socket?.destroy();
    this.socket = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Discord disconnected'));
    this.pending.clear();
  }
}

module.exports = { DiscordRpc };
