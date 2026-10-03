import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeFrame, createParser, encodeFrame, handshake } from './ws.js';

// One process does two things: serve the static files, and pass inputs between
// up to four players. It knows nothing about the game - all the shooting happens
// on the players' own machines, because the simulation is deterministic - and it
// never sees a position, a score or a hit.
//
// The one thing it does know is which seat a message came from. It stamps that
// on, rather than letting the sender name it: a client that could name its own
// seat could aim somebody else's rifle.
//
//   npm start        # http://localhost:5173

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const SEATS = 4;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';

  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

// --- Relay -----------------------------------------------------------------

/** @type {Map<string, {seats: Array<Conn|null>}>} */
const rooms = new Map();
let nextId = 1;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

class Conn {
  constructor(socket) {
    this.id = nextId++;
    this.socket = socket;
    this.room = null;
    this.seat = -1;
    this.alive = true;
  }

  send(obj) {
    if (!this.alive) return;
    try {
      this.socket.write(encodeFrame(JSON.stringify(obj)));
    } catch {
      this.close();
    }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    try {
      this.socket.write(closeFrame());
      this.socket.end();
    } catch { /* socket was already gone */ }
    leaveRoom(this);
  }
}

/** Everybody in the room except the sender. */
function others(conn) {
  const room = conn.room && rooms.get(conn.room);
  if (!room) return [];
  return room.seats.filter((c) => c && c !== conn);
}

/** Who is sitting where, as four booleans. Sent whenever that changes. */
function roster(room) {
  return room.seats.map((c) => !!c);
}

function leaveRoom(conn) {
  if (!conn.room) return;
  const room = rooms.get(conn.room);
  if (!room) return;

  const seat = conn.seat;
  if (seat >= 0 && room.seats[seat] === conn) room.seats[seat] = null;

  const left = room.seats.filter(Boolean);
  if (left.length) {
    for (const other of left) other.send({ t: 'peerleft', seat, seats: roster(room) });
  } else {
    rooms.delete(conn.room);
  }

  log(`player ${conn.id} left seat ${seat} of room ${conn.room}`);
  conn.room = null;
  conn.seat = -1;
}

function handleMessage(conn, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.t) {
    case 'create': {
      leaveRoom(conn);
      const code = makeCode();
      const room = { seats: new Array(SEATS).fill(null) };
      room.seats[0] = conn;
      rooms.set(code, room);
      conn.room = code;
      conn.seat = 0;
      // `role` is kept for the sake of the shared client: whoever opened the
      // room is the one who picks the arena and starts the match.
      conn.send({
        t: 'room', code, role: 'host', seat: 0, seats: roster(room),
      });
      log(`player ${conn.id} opened room ${code}`);
      break;
    }

    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        conn.send({ t: 'error', msg: `Room ${code} does not exist` });
        return;
      }
      const seat = room.seats.indexOf(null);
      if (seat < 0) {
        conn.send({ t: 'error', msg: `Room ${code} is full` });
        return;
      }
      leaveRoom(conn);
      room.seats[seat] = conn;
      conn.room = code;
      conn.seat = seat;
      conn.send({
        t: 'room', code, role: 'guest', seat, seats: roster(room),
      });
      // Everybody is told who is in the room now, including the new arrival:
      // the menu shows four slots filling up, and whoever opened it decides
      // when there are enough of them.
      for (const other of room.seats.filter(Boolean)) {
        other.send({ t: 'peer', seats: roster(room), seat });
      }
      log(`player ${conn.id} took seat ${seat} of room ${code}`);
      break;
    }

    default: {
      // Everything else (input, start, hash, ping, pong) is passed on untouched,
      // except for the seat it came from, which the relay stamps rather than
      // trusts.
      for (const other of others(conn)) other.send({ ...msg, seat: conn.seat });
      break;
    }
  }
}

server.on('upgrade', (req, socket) => {
  if (!handshake(req, socket)) return;

  const conn = new Conn(socket);
  log(`player ${conn.id} connected`);

  const feed = createParser({
    onMessage: (text) => handleMessage(conn, text),
    onClose: () => conn.close(),
    onPing: () => socket.write(encodeFrame('', { opcode: 0xa })),
  });

  socket.on('data', (chunk) => {
    try {
      feed(chunk);
    } catch (err) {
      log(`parser error for player ${conn.id}: ${err.message}`);
      conn.close();
    }
  });
  socket.on('error', () => conn.close());
  socket.on('close', () => {
    conn.alive = false;
    leaveRoom(conn);
    log(`player ${conn.id} disconnected`);
  });
});

function log(text) {
  if (process.env.QUIET) return;
  console.log(`[relay] ${text}`);
}

server.listen(PORT, () => {
  console.log(`WebReal running at http://localhost:${PORT}/`);
  console.log('To play online: open the page in two to four tabs, or on other machines.');
});
