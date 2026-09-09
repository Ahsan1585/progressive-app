// In-memory "who is looking at which thread right now" tracking, powering
// the "Sarah is viewing" indicator. Lives in this one process only — fine
// while the backend runs a single Cloud Run instance. When that changes,
// this Map moves to Redis and the rest of the code is unaffected.

// threadRoom -> Map<socketId, { staffId, name }>
const viewersByRoom = new Map();

function addViewer(room, socketId, viewer) {
  let m = viewersByRoom.get(room);
  if (!m) { m = new Map(); viewersByRoom.set(room, m); }
  m.set(socketId, viewer);
}

function removeViewer(room, socketId) {
  const m = viewersByRoom.get(room);
  if (!m) return;
  m.delete(socketId);
  if (m.size === 0) viewersByRoom.delete(room);
}

// A socket disconnected — drop it from every room it was viewing. Returns
// the list of rooms it was in so the caller can re-broadcast each.
function removeSocket(socketId) {
  const affected = [];
  for (const [room, m] of viewersByRoom) {
    if (m.delete(socketId)) {
      affected.push(room);
      if (m.size === 0) viewersByRoom.delete(room);
    }
  }
  return affected;
}

// Distinct viewers in a room, de-duplicated by staffId (one person may have
// the thread open in two tabs). Newest entry per staffId wins.
function listViewers(room) {
  const m = viewersByRoom.get(room);
  if (!m) return [];
  const byStaff = new Map();
  for (const v of m.values()) byStaff.set(v.staffId, v);
  return [...byStaff.values()];
}

module.exports = { addViewer, removeViewer, removeSocket, listViewers };
