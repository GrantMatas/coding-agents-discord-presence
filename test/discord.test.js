const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');
const { DiscordRpc } = require('../src/discord');

function frame(opcode, value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('handshakes, publishes an activity, and clears it', async t => {
  const pipe = `\\\\.\\pipe\\codex-presence-test-${crypto.randomUUID()}`;
  const seen = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const length = buffer.readInt32LE(4);
        if (buffer.length < length + 8) break;
        const opcode = buffer.readInt32LE(0);
        const message = JSON.parse(buffer.subarray(8, 8 + length).toString());
        buffer = buffer.subarray(8 + length);
        if (opcode === 0) socket.write(frame(1, { evt: 'READY', data: {} }));
        if (opcode === 1) {
          seen.push(message.args.activity);
          socket.write(frame(1, { nonce: message.nonce, data: {} }));
        }
      }
    });
  });
  await new Promise(resolve => server.listen(pipe, resolve));
  const rpc = new DiscordRpc('123456789012345678');
  t.after(() => { rpc.close(); server.close(); });
  await rpc.connectPipe(pipe);
  await rpc.setActivity({ details: 'Thinking with Codex' });
  await rpc.setActivity(null);
  assert.deepEqual(seen, [{ details: 'Thinking with Codex' }, null]);
});
