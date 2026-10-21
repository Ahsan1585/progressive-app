import axios from 'axios';
import api from '@/api/axiosInstance';

// Calls made with a short-lived mfaToken (mid-login) must NOT go through the
// shared axios instance: its interceptor would overwrite Authorization with
// any stale session token, and its 401 handler would clear the session.
const bare = axios.create({ baseURL: api.defaults.baseURL });

const client = (mfaToken) => ({
  post: (url, body) =>
    mfaToken
      ? bare.post(url, body, { headers: { Authorization: `Bearer ${mfaToken}` } })
      : api.post(url, body),
});

// Forced enrollment (mfaToken) sends no password. Settings flow (session token)
// must send the account password; replacing an existing authenticator also
// sends a current code or recovery code (extra = { code } | { recoveryCode }).
export const mfaSetup = (mfaToken, password, extra) =>
  client(mfaToken).post('/api/auth/mfa/setup', mfaToken ? {} : { password, ...(extra || {}) }).then((r) => r.data);
export const mfaEnable = (mfaToken, code, password) =>
  client(mfaToken).post('/api/auth/mfa/enable', mfaToken ? { code } : { code, password }).then((r) => r.data);
export const mfaDisable = (password, code) => api.post('/api/auth/mfa/disable', { password, code }).then((r) => r.data);
export const mfaVerify = (body) => bare.post('/api/auth/mfa/verify', body).then((r) => r.data);

export const errMsg = (err, fallback) => err?.response?.data?.error || err?.response?.data?.message || fallback;

// Trusted devices (session token). Response: { devices: [{ id, label, createdAt, lastUsedAt, expiresAt }] }
export const mfaListDevices = () => api.get('/api/auth/mfa/devices').then((r) => r.data.devices || []);
export const mfaRevokeDevice = (id) => api.delete(`/api/auth/mfa/devices/${encodeURIComponent(id)}`).then((r) => r.data);
export const mfaRevokeAllDevices = () => api.delete('/api/auth/mfa/devices').then((r) => r.data);
