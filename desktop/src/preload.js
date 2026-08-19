// Intentionally minimal — the admin-dashboard flow's entire auth model is
// localStorage + axios (see frontend/src/api/axiosInstance.js), no
// IPC-driven functionality is needed for login/admin-dashboard as currently
// built. This file exists to satisfy contextIsolation/sandbox (a preload is
// required for those to take effect) rather than to expose a native API.
//
// If Electron safeStorage-backed token hardening is adopted later (see
// desktop/README.md's "deferred hardening" note), the get/set/clear token
// operations it needs would be exposed here via contextBridge, scoped to
// exactly those operations — never a general IPC passthrough.
