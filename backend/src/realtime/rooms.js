// Socket.io room names. One `io` server serves every tenant, so every room
// is namespaced by the tenant's database name — an emit for tenant A's
// thread can never reach a socket connected for tenant B, even though they
// share the process. (Defense in depth: handlers also authorize per-socket.)

const threadRoom = (tenantDb, practitionerId) => `t:${tenantDb}:thread:${practitionerId}`;

// Every office socket for a tenant joins this room on connect — used for
// list-level events (unread-count bumps, thread reordering) that any office
// staffer needs regardless of which chat windows they have open.
const officeRoom = (tenantDb) => `t:${tenantDb}:office`;

module.exports = { threadRoom, officeRoom };
