import { io } from 'socket.io-client';
import { clearSessionAndNotify } from '@/api/axiosInstance';

// Same origin the REST client talks to (axiosInstance.js). The browser
// opens the WebSocket straight to the Cloud Run backend — Vercel only
// serves static assets and never proxies this.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

let socket = null;

// Singleton. Created lazily and NOT auto-connected — call connectSocket()
// once the user is authenticated (and it refreshes the token first, since
// the token changes on every login).
function getSocket() {
  if (!socket) {
    socket = io(API_BASE_URL, {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: { token: null },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    // A rejected handshake because the TOKEN itself is bad/expired funnels
    // to the same logout path as a REST 401. A rejection because the
    // COMPANY is suspended/trial-expired ('account_blocked' — see
    // backend/src/realtime/handshake.js) is deliberately NOT treated the
    // same way: the token is still valid, so wiping the session here would
    // race against TrialGate's own /api/auth/company-status check and could
    // bounce a freshly-logged-in suspended user straight back to /login
    // with no error shown at all. Leave the session alone and let
    // TrialGate's REST-based check be the one thing that explains and
    // renders the block. socket.io will keep quietly retrying the
    // connection in the background (harmless — it'll just keep getting
    // 'account_blocked' again until the company is reactivated).
    socket.on('connect_error', (err) => {
      if (err?.message === 'unauthorized') {
        clearSessionAndNotify();
      }
    });

    // Server told us the token backing this connection expired mid-session.
    socket.on('session:expired', () => {
      clearSessionAndNotify();
    });
  }
  return socket;
}

function connectSocket() {
  const s = getSocket();
  const token = localStorage.getItem('token');
  if (!token) return s;
  s.auth = { token };
  if (!s.connected) s.connect();
  return s;
}

function disconnectSocket() {
  if (socket && socket.connected) socket.disconnect();
}

export { getSocket, connectSocket, disconnectSocket, API_BASE_URL };
