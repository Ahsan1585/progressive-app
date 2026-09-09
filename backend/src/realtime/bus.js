// The single choke point for every server->client emit. Two reasons it all
// funnels through here:
//   1. Tenant safety — every emit target is a tenant-namespaced room
//      (see rooms.js). This module refuses to emit to anything that isn't,
//      so a caller can't accidentally broadcast tenant-wide or globally.
//   2. Scale path — swapping to a Redis pub/sub adapter later touches only
//      this file (and presence.js).

const { threadRoom, officeRoom } = require('./rooms');

// Hard guard: every room this app emits to MUST be tenant-scoped. `tenantDb`
// comes from the socket handshake (JWT), never from client input, so a
// well-formed room here proves the emit is confined to one tenant.
function assertTenantRoom(room, tenantDb) {
  if (typeof room !== 'string' || !room.startsWith(`t:${tenantDb}:`)) {
    throw new Error(`realtime/bus: refusing to emit to non-tenant-scoped room "${room}"`);
  }
}

// A new message was persisted. Notify everyone in that thread, and give the
// tenant's office room a lightweight "this thread just moved" nudge so
// staffers who don't have the window open can reorder / preview.
function emitMessageNew(io, tenantDb, practitionerId, row) {
  const tr = threadRoom(tenantDb, practitionerId);
  const or = officeRoom(tenantDb);
  assertTenantRoom(tr, tenantDb);
  assertTenantRoom(or, tenantDb);
  io.to(tr).emit('message:new', row);
  io.to(or).emit('thread:activity', {
    practitionerId,
    lastMessage: row.body,
    lastMessageAt: row.created_at,
    lastMessageSenderRole: row.sender_role,
  });
}

// Unread count for a thread changed (someone read it, or a new inbound
// arrived). `scope` is 'office' (goes to the whole office room) or 'thread'
// (goes to just that thread's room — used for the practitioner side).
function emitUnread(io, tenantDb, practitionerId, count, scope = 'office') {
  const room = scope === 'office' ? officeRoom(tenantDb) : threadRoom(tenantDb, practitionerId);
  assertTenantRoom(room, tenantDb);
  io.to(room).emit('thread:unread', { practitionerId, unreadCount: count });
}

// The set of people currently viewing a thread changed.
function emitViewers(io, tenantDb, practitionerId, viewers) {
  const tr = threadRoom(tenantDb, practitionerId);
  assertTenantRoom(tr, tenantDb);
  io.to(tr).emit('thread:viewers', { practitionerId, viewers });
}

// Transient typing indicator, relayed to the other people in a thread.
function emitTyping(io, tenantDb, practitionerId, from, isTyping) {
  const tr = threadRoom(tenantDb, practitionerId);
  assertTenantRoom(tr, tenantDb);
  io.to(tr).emit('thread:typing', { practitionerId, from, isTyping });
}

module.exports = { emitMessageNew, emitUnread, emitViewers, emitTyping };
