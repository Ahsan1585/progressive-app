const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { authHandshake } = require('./handshake');
const { registerHandlers } = require('./handlers');

// Attach a socket.io server to the existing HTTP server. One `io` instance
// serves every tenant; isolation is enforced per-socket (see handshake.js)
// and per-room (see rooms.js / bus.js).
//
// `allowedOrigins` is the exact same array index.js builds for the REST
// CORS config — passed in so the two never drift.
function initRealtime(httpServer, app, allowedOrigins) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    // Cloud Run force-closes any request (incl. a WS) at ~60 min; the client
    // auto-reconnects. Keep pings frequent enough to notice a dead peer fast.
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(authHandshake);
  io.on('connection', (socket) => {
    console.log(`[realtime] socket connected: staffId=${socket.data.staffId} role=${socket.data.role} tenant=${socket.data.tenantDb} office=${socket.data.isOffice}`);
    registerHandlers(io, socket);
  });

  // Controllers reach `io` via `req.app.get('io')`.
  app.set('io', io);

  // An authenticated socket can outlive the 24h JWT it connected with (we
  // don't re-verify per event). Sweep every 5 min: any socket whose token
  // `exp` has passed is disconnected, forcing a fresh handshake (or logout).
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [, socket] of io.of('/').sockets) {
      const exp = socket.data?.tokenExp;
      if (exp && exp < now) {
        socket.emit('session:expired');
        socket.disconnect(true);
      }
    }
  }, 5 * 60 * 1000).unref();

  return io;
}

// Exposed for a standalone test harness / future reuse.
function verifyTokenForTest(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { initRealtime, verifyTokenForTest };
