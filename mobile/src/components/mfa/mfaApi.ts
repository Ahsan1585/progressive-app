import axios from "axios";
import api from "@/api/axiosInstance";
import type { LoginResponse, ApiErrorBody } from "@/types";

// Calls made with a short-lived mfaToken (mid-login) must NOT go through the
// shared axios instance: its interceptor would overwrite Authorization with
// any stale session token, and its 401 handler would drop the session.
const bare = axios.create({ baseURL: api.defaults.baseURL });

function post<T>(url: string, body: unknown, mfaToken?: string) {
  return mfaToken
    ? bare.post<T>(url, body, { headers: { Authorization: `Bearer ${mfaToken}` } })
    : api.post<T>(url, body);
}

export interface MfaSetupData {
  secret: string;
  otpauthUri: string;
}

// With an mfaToken the response also carries the full login payload.
export type MfaEnableResponse = { recoveryCodes: string[]; deviceToken?: string; deviceTokenExpiresAt?: string; deviceId?: string } & Partial<LoginResponse>;

// Forced enrollment (mfaToken) sends no password. Settings flow (session token)
// must send the account password; replacing an existing authenticator also sends
// a current code or recovery code via `extra`.
export const mfaSetup = (mfaToken?: string, password?: string, extra?: { code?: string; recoveryCode?: string }) =>
  post<MfaSetupData>("/api/auth/mfa/setup", mfaToken ? {} : { password, ...(extra ?? {}) }, mfaToken).then((r) => r.data);
export const mfaEnable = (code: string, mfaToken?: string, password?: string, rememberDevice?: boolean) =>
  post<MfaEnableResponse>(
    "/api/auth/mfa/enable",
    { ...(mfaToken ? { code } : { code, password }), ...(rememberDevice ? { rememberDevice: true } : {}) },
    mfaToken,
  ).then((r) => r.data);
export const mfaDisable = (password: string, code: string) =>
  api.post<{ success: boolean }>("/api/auth/mfa/disable", { password, code }).then((r) => r.data);
export type MfaVerifyResponse = LoginResponse & { deviceToken?: string; deviceTokenExpiresAt?: string; deviceId?: string };
export const mfaVerify = (body: { mfaToken: string; code?: string; recoveryCode?: string; rememberDevice?: boolean }) =>
  bare.post<MfaVerifyResponse>("/api/auth/mfa/verify", body).then((r) => r.data);

export interface TrustedDevice {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}
// Trusted devices (session token).
export const mfaListDevices = () =>
  api.get<{ devices: TrustedDevice[] }>("/api/auth/mfa/devices").then((r) => r.data.devices ?? []);
export const mfaRevokeDevice = (id: string) =>
  api.delete<{ success: boolean }>(`/api/auth/mfa/devices/${encodeURIComponent(id)}`).then((r) => r.data);
export const mfaRevokeAllDevices = () =>
  api.delete<{ success: boolean }>("/api/auth/mfa/devices").then((r) => r.data);

export function errMsg(err: unknown, fallback: string): string {
  const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
  return body?.error || fallback;
}

export const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 6);
