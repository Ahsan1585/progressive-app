import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket, disconnectSocket, getSocket } from '@/realtime/socket';

// Practitioner-side real-time messaging. Practitioners have exactly one
// thread ("the office"), so this is much simpler than the office dock: open
// one socket, join own thread room, surface inbound messages + an unread
// count. No dock, no persistence.
export function usePractitionerMessages() {
  const [liveMessages, setLiveMessages] = useState([]); // messages that arrived over the socket
  const [unread, setUnread] = useState(0);
  const myIdRef = useRef(null);
  const panelOpenRef = useRef(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    if (!token || role !== 'practitioner') return;

    try {
      myIdRef.current = JSON.parse(atob(token.split('.')[1])).practitionerId;
    } catch {
      return;
    }

    const socket = connectSocket();
    const join = () => socket.emit('thread:open', { practitionerId: myIdRef.current });
    join();
    socket.on('connect', join);

    const onMessageNew = (row) => {
      if (row.practitioner_id !== myIdRef.current) return;
      setLiveMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      const inbound = row.sender_role !== 'practitioner';
      if (inbound) {
        if (panelOpenRef.current) {
          socket.emit('thread:read', { practitionerId: myIdRef.current });
        } else {
          setUnread((n) => n + 1);
        }
      }
    };
    socket.on('message:new', onMessageNew);

    return () => {
      socket.off('connect', join);
      socket.off('message:new', onMessageNew);
      disconnectSocket();
    };
  }, []);

  const markRead = useCallback(() => {
    setUnread(0);
    if (myIdRef.current) getSocket().emit('thread:read', { practitionerId: myIdRef.current });
  }, []);

  const setPanelOpen = useCallback((open) => {
    panelOpenRef.current = open;
    if (open) markRead();
  }, [markRead]);

  return { liveMessages, unread, markRead, setPanelOpen };
}
