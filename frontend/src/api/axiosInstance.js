import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
});

// Automatically attach the JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Shared by the 401 interceptor below and App.jsx's IdleLogout — both need to
// clear the session and land the user on /login. A DOM event + one router
// listener (App.jsx's SessionExpiredListener) replaces what used to be two
// separate `window.location.assign(`${BASE_URL}login`)` hard redirects: that
// hardcoded path broke under the desktop (Electron) build's relative ("./")
// base, since BASE_URL becomes "./" there instead of "/eis/". This way
// neither call site needs to know or care about the app's base path at all.
export const SESSION_EXPIRED_EVENT = 'session-expired';

export function clearSessionAndNotify() {
  if (!localStorage.getItem('token')) return; // already logged out — nothing to do
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

// Centralized auth-failure handling: on any 401, clear the session and return to login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearSessionAndNotify();
    }
    return Promise.reject(error);
  }
);

export default api;