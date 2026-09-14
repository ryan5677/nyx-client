'use strict';
/**
 * Minecraft's "Server List Ping" protocol - the same handshake vanilla's own
 * Multiplayer server list uses to show MOTD/player count/version for each
 * saved server. This is a raw TCP round-trip straight to that server's own
 * port; no Mojang account, no relay, no server of ours involved anywhere.
 * Protocol reference: https://wiki.vg/Server_List_Ping
 */

const net = require('net');

function writeVarInt(value) {
  const bytes = [];
  let v = value;
  for (;;) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v);
      break;
    }
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(bytes);
}

function writeString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

function writeUShort(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value, 0);
  return buf;
}

/** Reads one VarInt from `buf` at `offset`; returns null if more bytes are needed. */
function readVarInt(buf, offset) {
  let value = 0;
  let position = 0;
  let i = offset;
  let currentByte;
  do {
    if (i >= buf.length) return null;
    currentByte = buf[i++];
    value |= (currentByte & 0x7f) << position;
    position += 7;
    if (position >= 32) throw new Error('VarInt too big');
  } while ((currentByte & 0x80) !== 0);
  return { value, next: i };
}

// A server's MOTD can be a plain string or a nested chat component
// ({ text, extra: [...] }) - flatten either shape to plain text.
function extractMotd(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  let out = desc.text || '';
  if (Array.isArray(desc.extra)) out += desc.extra.map(extractMotd).join('');
  return out;
}

/**
 * Ping a Java Edition server the same way the vanilla server list does.
 * Resolves (never rejects) with either
 *   { online: true, latencyMs, motd, playersOnline, playersMax, version }
 * or { online: false, error }.
 */
function pingServer(host, port = 25565, { timeoutMs = 4000, protocolVersion = 767 } = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let settled = false;
    const start = Date.now();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish({ online: false, error: 'Timed out' }));
    socket.on('error', (err) => finish({ online: false, error: err.code || err.message }));

    socket.connect(port, host, () => {
      const handshakeBody = Buffer.concat([
        writeVarInt(0x00),
        writeVarInt(protocolVersion),
        writeString(host),
        writeUShort(port),
        writeVarInt(1), // next state: 1 = status
      ]);
      const handshakePacket = Buffer.concat([writeVarInt(handshakeBody.length), handshakeBody]);

      const statusRequestBody = writeVarInt(0x00);
      const statusRequestPacket = Buffer.concat([writeVarInt(statusRequestBody.length), statusRequestBody]);

      socket.write(Buffer.concat([handshakePacket, statusRequestPacket]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const lengthRead = readVarInt(buffer, 0);
        if (!lengthRead) return; // need more bytes
        const totalLen = lengthRead.next + lengthRead.value;
        if (buffer.length < totalLen) return; // need more bytes

        const idRead = readVarInt(buffer, lengthRead.next);
        if (!idRead) return;
        const strLenRead = readVarInt(buffer, idRead.next);
        if (!strLenRead) return;
        const jsonStr = buffer.toString('utf8', strLenRead.next, strLenRead.next + strLenRead.value);
        const data = JSON.parse(jsonStr);

        finish({
          online: true,
          latencyMs: Date.now() - start,
          motd: extractMotd(data.description),
          playersOnline: data.players?.online ?? null,
          playersMax: data.players?.max ?? null,
          version: data.version?.name || 'Unknown',
        });
      } catch {
        finish({ online: false, error: 'Bad response from server' });
      }
    });
  });
}

module.exports = { pingServer };
