"use strict";
/* Event bus for Server-Sent Events. In-process: the ingest path publishes,
 * routes/stream.js subscribers receive. Pure module. */

const clients = new Set();

function addClient(res) { clients.add(res); }
function removeClient(res) { clients.delete(res); }

function broadcast(kind, data) {
  const frame = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

function heartbeat() {
  for (const res of clients) {
    try { res.write(": hb\n\n"); } catch { clients.delete(res); }
  }
}

setInterval(heartbeat, 15000).unref();

module.exports = { addClient, removeClient, broadcast, _clients: clients };
