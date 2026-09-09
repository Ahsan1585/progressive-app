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

    // A rejected handshake (bad/expired token) funnels to the same logout
    // path as a REST 401.
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
