const { runWithTenant } = require('../config/tenantContext');
const { pool } = require('../config/db');
const { threadRoom, officeRoom } = require('./rooms');
const presence = require('./presence');
const { emitViewers, emitUnread, emitTyping } = require('./bus');

// Validate a practitionerId from a client event payload: must be a positive
// integer. Anything else → the event is dropped.
const toPractitionerId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Whether this socket is allowed to touch the given thread.
//   - office: any practitioner thread within its own tenant
//   - practitioner: only their own thread
// tenantDb is NEVER taken from the event — always socket.data.
function canAccessThread(socket, practitionerId) {
  if (socket.data.isOffice) return true;
  return practitionerId === socket.data.staffId;
}

// Re-broadcast the current viewer list for a thread.
function broadcastViewers(io, tenantDb, practitionerId) {
  const room = threadRoom(tenantDb, practitionerId);
  emitViewers(io, tenantDb, practitionerId, presence.listViewers(room));
}

function registerHandlers(io, socket) {
  const { tenantDb, staffId, name, isOffice } = socket.data;

  if (isOffice) {
    socket.join(officeRoom(tenantDb));
  } else {
    // A practitioner only ever has one thread — join it immediately so
    // inbound office messages stream without an explicit thread:open.
    socket.join(threadRoom(tenantDb, staffId));
  }

  // Client opened / focused a chat window for this thread.
  socket.on('thread:open', ({ practitionerId } = {}) => {
    const pid = toPractitionerId(practitionerId);
    if (pid === null || !canAccessThread(socket, pid)) return;
    const room = threadRoom(tenantDb, pid);
    socket.join(room);
    if (isOffice) {
      presence.addViewer(room, socket.id, { staffId, name });
      broadcastViewers(io, tenantDb, pid);
    }
  });

  // Client closed the chat window entirely (not merely minimized).
  socket.on('thread:close', ({ practitionerId } = {}) => {
    const pid = toPractitionerId(practitionerId);
    if (pid === null || !canAccessThread(socket, pid)) return;
    const room = threadRoom(tenantDb, pid);
    // A practitioner stays subscribed to their own thread regardless.
    if (isOffice) {
      socket.leave(room);
      presence.removeViewer(room, socket.id);
      broadcastViewers(io, tenantDb, pid);
    }
  });

  // Client minimized a window: keep receiving messages (stay in the room)
  // but drop out of the "who is viewing" list.
  socket.on('thread:minimize', ({ practitionerId } = {}) => {
    const pid = toPractitionerId(practitionerId);
    if (pid === null || !canAccessThread(socket, pid) || !isOffice) return;
    const room = threadRoom(tenantDb, pid);
    presence.removeViewer(room, socket.id);
    broadcastViewers(io, tenantDb, pid);
  });

  // Client read the thread (window focused, or an inbound arrived while
  // focused). Run the same read-receipt UPDATE the REST getThread does.
  socket.on('thread:read', async ({ practitionerId } = {}) => {
    const pid = toPractitionerId(practitionerId);
    if (pid === null || !canAccessThread(socket, pid)) return;
    try {
      await runWithTenant(tenantDb, async () => {
        if (isOffice) {
          await pool.query(
            `UPDATE messages SET office_read_at = now()
             WHERE practitioner_id = $1 AND sender_role = 'practitioner' AND office_read_at IS NULL`,
            [pid]
          );
        } else {
          await pool.query(
            `UPDATE messages SET practitioner_read_at = now()
             WHERE practitioner_id = $1 AND sender_role <> 'practitioner' AND practitioner_read_at IS NULL`,
            [pid]
          );
        }
      });
      if (isOffice) {
        // The office unread count is global (any staffer clears any thread).
        // Recompute and push to the whole office room so every badge tracks.
        const total = await runWithTenant(tenantDb, async () => {
          const r = await pool.query(
            `SELECT COUNT(*)::int AS c FROM messages
             WHERE sender_role = 'practitioner' AND office_read_at IS NULL`
          );
          return r.rows[0].c;
        });
        emitUnread(io, tenantDb, pid, 0, 'office');
        io.to(officeRoom(tenantDb)).emit('office:unread-total', { total });
      } else {
        emitUnread(io, tenantDb, pid, 0, 'thread');
      }
    } catch (err) {
      console.error('socket thread:read error:', err);
    }
  });

  socket.on('thread:typing', ({ practitionerId, isTyping } = {}) => {
    const pid = toPractitionerId(practitionerId);
    if (pid === null || !canAccessThread(socket, pid)) return;
    socket.to(threadRoom(tenantDb, pid)).emit('thread:typing', {
      practitionerId: pid,
      from: { staffId, name },
      isTyping: !!isTyping,
    });
    // (emitTyping kept in bus.js for symmetry; direct socket.to here avoids
    //  echoing back to the sender.)
    void emitTyping;
  });

  socket.on('disconnect', () => {
    const rooms = presence.removeSocket(socket.id);
    for (const room of rooms) {
      // room name is `t:${tenantDb}:thread:${pid}` — recover pid to re-broadcast
      const parts = room.split(':');
      const pid = toPractitionerId(parts[parts.length - 1]);
      if (pid !== null) broadcastViewers(io, tenantDb, pid);
    }
  });
}

module.exports = { registerHandlers };
