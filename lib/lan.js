'use strict';
/**
 * Listens for Minecraft's real "Open to LAN" broadcasts on the local
 * network - the same UDP multicast vanilla's Multiplayer > LAN tab listens
 * for. Purely passive and local-network-only; no internet, no accounts, no
 * server of ours involved anywhere in this.
 */

const dgram = require('dgram');

const MULTICAST_ADDR = '224.0.2.60';
const MULTICAST_PORT = 4445;
const MOTD_RE = /\[MOTD\](.*?)\[\/MOTD\]/;
const AD_RE = /\[AD\](\d+)\[\/AD\]/;
const STALE_AFTER_MS = 5000; // vanilla rebroadcasts every ~1.5s while a world is open to LAN

/**
 * Starts listening. `onChange` is called with the current list of live LAN
 * games (`[{ address, port, motd, lastSeen }]`) whenever it changes. Returns
 * a stop() function.
 */
function startLanScan(onChange) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const seen = new Map(); // `${address}:${port}` -> entry

  const emit = () => onChange(Array.from(seen.values()));

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    const motdMatch = MOTD_RE.exec(text);
    const adMatch = AD_RE.exec(text);
    if (!motdMatch || !adMatch) return;
    const port = Number(adMatch[1]);
    seen.set(`${rinfo.address}:${port}`, { address: rinfo.address, port, motd: motdMatch[1], lastSeen: Date.now() });
    emit();
  });

  socket.on('error', () => {}); // best-effort: a bind/multicast failure just means the LAN list stays empty

  socket.bind(MULTICAST_PORT, () => {
    try {
      socket.addMembership(MULTICAST_ADDR);
    } catch {
      // some networks/sandboxes block multicast joins - fail quiet
    }
  });

  const pruneInterval = setInterval(() => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    let changed = false;
    for (const [key, entry] of seen) {
      if (entry.lastSeen < cutoff) {
        seen.delete(key);
        changed = true;
      }
    }
    if (changed) emit();
  }, 2000);

  return function stop() {
    clearInterval(pruneInterval);
    try {
      socket.close();
    } catch {
      // already closed
    }
  };
}

module.exports = { startLanScan };
