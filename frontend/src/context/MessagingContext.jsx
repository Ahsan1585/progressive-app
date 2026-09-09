import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { connectSocket, disconnectSocket, getSocket } from '@/realtime/socket';
import { MessageDock } from '@/components/messaging/MessageDock';

// eslint-disable-next-line react-refresh/only-export-components
export const MessagingContext = createContext(null);

const OFFICE_ROLES = ['ceo', 'staff'];
const MAX_EXPANDED = 3;
const DOCK_SAVE_DEBOUNCE_MS = 500;
const SOUND_KEY = 'messageSoundEnabled';

const isOfficeSession = () => {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  return !!token && OFFICE_ROLES.includes(role);
};

// Decode practitionerId from the JWT without verifying (same trick the
// practitioner MessagesPanel already uses — server always re-authorizes).
const myIdFromToken = () => {
  try {
    const t = localStorage.getItem('token');
    return JSON.parse(atob(t.split('.')[1])).practitionerId;
  } catch {
    return null;
  }
};

export function MessagingProvider({ children }) {
  useLocation(); // re-render on route change so `active` re-evaluates below
  const [active, setActive] = useState(isOfficeSession());

  // ---- data ----
  const [threadsById, setThreadsById] = useState({}); // {id: {practitionerId, name, lastMessage, lastMessageAt, lastMessageSenderRole, lastOfficeReplyName, unreadCount}}
  const [messagesById, setMessagesById] = useState({}); // {id: message[]}
  const [openThreads, setOpenThreads] = useState([]); // [{practitionerId, minimized, order}]
  const [viewersById, setViewersById] = useState({}); // {id: [{staffId, name}]}
  const [typingById, setTypingById] = useState({}); // {id: {name}|null}
  const [totalUnread, setTotalUnread] = useState(0);
  const [soundEnabled, setSoundEnabledState] = useState(() => localStorage.getItem(SOUND_KEY) !== 'false');

  const focusedThreadRef = useRef(null); // practitionerId of the window with keyboard focus
  const saveTimerRef = useRef(null);
  const audioRef = useRef(null);
  const myStaffId = useRef(myIdFromToken());
  const openThreadsRef = useRef(openThreads); // latest openThreads for the reconnect handler
  useEffect(() => { openThreadsRef.current = openThreads; }, [openThreads]);
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  // Plays the notification chime. Defined as a ref-backed function so the
  // socket effect (which mounts once per session) can call the latest
  // version without re-subscribing.
  const playSound = useCallback(() => {
    if (!soundEnabledRef.current) return;
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/message.mp3');
        audioRef.current.volume = 0.4;
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch { /* ignore */ }
  }, []);
  const playSoundRef = useRef(playSound);
  useEffect(() => { playSoundRef.current = playSound; }, [playSound]);

  // ---- auth lifecycle ----
  useEffect(() => {
    const recheck = () => setActive(isOfficeSession());
    window.addEventListener('auth-changed', recheck);
    window.addEventListener('storage', recheck);
    return () => {
      window.removeEventListener('auth-changed', recheck);
      window.removeEventListener('storage', recheck);
    };
  }, []);

  const setSoundEnabled = useCallback((v) => {
    setSoundEnabledState(v);
    localStorage.setItem(SOUND_KEY, String(v));
  }, []);

  // ---- persist dock state (debounced) ----
  const persistDock = useCallback((next) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.put('/api/messages/dock', { openThreads: next }).catch(() => {});
    }, DOCK_SAVE_DEBOUNCE_MS);
  }, []);

  const setOpenThreadsPersisted = useCallback((updater) => {
    setOpenThreads((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      persistDock(next);
      return next;
    });
  }, [persistDock]);

  // ---- socket wiring ----
  useEffect(() => {
    console.info('[messaging] provider effect; active =', active, 'role =', localStorage.getItem('role'));
    if (!active) {
      // Session ended (logout / idle-logout). Drop the socket and wipe every
      // cached conversation so nothing lingers on the login screen or bleeds
      // into the next user. Runs only on the active->false transition.
      disconnectSocket();
      /* eslint-disable react-hooks/set-state-in-effect */
      setThreadsById({});
      setMessagesById({});
      setOpenThreads([]);
      setViewersById({});
      setTypingById({});
      setTotalUnread(0);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    myStaffId.current = myIdFromToken();
    const socket = connectSocket();
    console.info('[messaging] connectSocket called; socket id =', socket?.id, 'connected =', socket?.connected);
    socket.on('connect', () => console.info('[messaging] socket CONNECTED', socket.id));
    socket.on('connect_error', (e) => console.warn('[messaging] socket connect_error:', e?.message));
    socket.on('disconnect', (r) => console.info('[messaging] socket disconnected:', r));

    // Initial load
    const load = async () => {
      try {
        const [threadsRes, dockRes] = await Promise.all([
          api.get('/api/messages/threads'),
          api.get('/api/messages/dock'),
        ]);
        const map = {};
        let unread = 0;
        for (const t of threadsRes.data) {
          map[t.practitioner_id] = {
            practitionerId: t.practitioner_id,
            name: `${t.first_name} ${t.last_name}`.trim(),
            lastMessage: t.last_message,
            lastMessageAt: t.last_message_at,
            lastMessageSenderRole: t.last_message_sender_role,
            lastOfficeReplyName: t.last_office_reply_name,
            unreadCount: Number(t.unread_count) || 0,
          };
          unread += Number(t.unread_count) || 0;
        }
        setThreadsById(map);
        setTotalUnread(unread);
        setOpenThreads(Array.isArray(dockRes.data.openThreads) ? dockRes.data.openThreads : []);
      } catch {
        /* silent — dock just starts empty */
      }
    };
    load();

    // Re-sync on (re)connect — covers the Cloud Run 60-min forced reconnect.
    const onConnect = () => {
      load();
      // rejoin every open thread's room
      openThreadsRef.current.forEach((t) => socket.emit('thread:open', { practitionerId: t.practitionerId }));
    };

    const onMessageNew = (row) => {
      const pid = row.practitioner_id;
      setMessagesById((prev) => {
        const list = prev[pid] || [];
        if (list.some((m) => m.id === row.id)) return prev; // dedupe our own echo
        return { ...prev, [pid]: [...list, row] };
      });
      // Update the thread list preview + ordering
      setThreadsById((prev) => ({
        ...prev,
        [pid]: {
          ...(prev[pid] || { practitionerId: pid, name: 'Practitioner' }),
          lastMessage: row.body,
          lastMessageAt: row.created_at,
          lastMessageSenderRole: row.sender_role,
        },
      }));
      // Unread + sound: only if it's an inbound (practitioner-authored) message
      // to a thread whose window isn't the focused one.
      const isInbound = row.sender_role === 'practitioner';
      const isFocused = focusedThreadRef.current === pid && !document.hidden;
      if (isInbound && !isFocused) {
        setThreadsById((prev) => ({
          ...prev,
          [pid]: { ...(prev[pid] || { practitionerId: pid }), unreadCount: ((prev[pid]?.unreadCount) || 0) + 1 },
        }));
        playSoundRef.current();
      } else if (isInbound && isFocused) {
        socket.emit('thread:read', { practitionerId: pid });
      }
    };

    const onThreadActivity = ({ practitionerId, lastMessage, lastMessageAt, lastMessageSenderRole }) => {
      setThreadsById((prev) => ({
        ...prev,
        [practitionerId]: {
          ...(prev[practitionerId] || { practitionerId, name: 'Practitioner' }),
          lastMessage, lastMessageAt, lastMessageSenderRole,
        },
      }));
    };

    const onThreadUnread = ({ practitionerId, unreadCount }) => {
      setThreadsById((prev) => ({
        ...prev,
        [practitionerId]: { ...(prev[practitionerId] || { practitionerId }), unreadCount },
      }));
    };

    const onOfficeUnreadTotal = ({ total }) => setTotalUnread(Number(total) || 0);

    const onThreadViewers = ({ practitionerId, viewers }) => {
      setViewersById((prev) => ({
        ...prev,
        [practitionerId]: (viewers || []).filter((v) => v.staffId !== myStaffId.current),
      }));
    };

    const onThreadTyping = ({ practitionerId, from, isTyping }) => {
      if (from?.staffId === myStaffId.current) return;
      setTypingById((prev) => ({ ...prev, [practitionerId]: isTyping ? { name: from?.name } : null }));
    };

    socket.on('connect', onConnect);
    socket.on('message:new', onMessageNew);
    socket.on('thread:activity', onThreadActivity);
    socket.on('thread:unread', onThreadUnread);
    socket.on('office:unread-total', onOfficeUnreadTotal);
    socket.on('thread:viewers', onThreadViewers);
    socket.on('thread:typing', onThreadTyping);

    return () => {
      socket.off('connect', onConnect);
      socket.off('message:new', onMessageNew);
      socket.off('thread:activity', onThreadActivity);
      socket.off('thread:unread', onThreadUnread);
      socket.off('office:unread-total', onOfficeUnreadTotal);
      socket.off('thread:viewers', onThreadViewers);
      socket.off('thread:typing', onThreadTyping);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Unlock audio on the first user gesture (autoplay policy).
  useEffect(() => {
    if (!active) return;
    const unlock = () => {
      try {
        if (!audioRef.current) { audioRef.current = new Audio('/message.mp3'); audioRef.current.volume = 0.4; }
        audioRef.current.play().then(() => { audioRef.current.pause(); audioRef.current.currentTime = 0; }).catch(() => {});
      } catch { /* ignore */ }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [active]);

  // ---- actions ----
  const fetchThreadHistory = useCallback(async (practitionerId) => {
    try {
      const res = await api.get(`/api/messages/${practitionerId}`);
      setMessagesById((prev) => ({ ...prev, [practitionerId]: res.data }));
    } catch { /* ignore */ }
  }, []);

  const markThreadRead = useCallback((practitionerId) => {
    getSocket().emit('thread:read', { practitionerId });
    setThreadsById((prev) => ({
      ...prev,
      [practitionerId]: { ...(prev[practitionerId] || { practitionerId }), unreadCount: 0 },
    }));
  }, []);

  const openThread = useCallback((practitionerId) => {
    setOpenThreadsPersisted((prev) => {
      const existing = prev.find((t) => t.practitionerId === practitionerId);
      let next;
      if (existing) {
        next = prev.map((t) => (t.practitionerId === practitionerId ? { ...t, minimized: false } : t));
      } else {
        const maxOrder = prev.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
        next = [...prev, { practitionerId, minimized: false, order: maxOrder + 1 }];
      }
      // Enforce max expanded: if more than MAX_EXPANDED are non-minimized,
      // minimize the oldest-order non-minimized one that ISN'T the one just opened.
      const expanded = next.filter((t) => !t.minimized).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (expanded.length > MAX_EXPANDED) {
        const toMin = expanded.find((t) => t.practitionerId !== practitionerId);
        if (toMin) next = next.map((t) => (t.practitionerId === toMin.practitionerId ? { ...t, minimized: true } : t));
      }
      return next;
    });
    getSocket().emit('thread:open', { practitionerId });
    fetchThreadHistory(practitionerId);
    markThreadRead(practitionerId);
  }, [setOpenThreadsPersisted, fetchThreadHistory, markThreadRead]);

  const closeThread = useCallback((practitionerId) => {
    setOpenThreadsPersisted((prev) => prev.filter((t) => t.practitionerId !== practitionerId));
    getSocket().emit('thread:close', { practitionerId });
    if (focusedThreadRef.current === practitionerId) focusedThreadRef.current = null;
  }, [setOpenThreadsPersisted]);

  const minimizeThread = useCallback((practitionerId) => {
    setOpenThreadsPersisted((prev) =>
      prev.map((t) => (t.practitionerId === practitionerId ? { ...t, minimized: true } : t)));
    getSocket().emit('thread:minimize', { practitionerId });
    if (focusedThreadRef.current === practitionerId) focusedThreadRef.current = null;
  }, [setOpenThreadsPersisted]);

  const restoreThread = useCallback((practitionerId) => openThread(practitionerId), [openThread]);

  const focusThread = useCallback((practitionerId) => {
    focusedThreadRef.current = practitionerId;
    markThreadRead(practitionerId);
  }, [markThreadRead]);

  const blurThread = useCallback((practitionerId) => {
    if (focusedThreadRef.current === practitionerId) focusedThreadRef.current = null;
  }, []);

  const sendMessage = useCallback(async (practitionerId, body) => {
    const text = (body || '').trim();
    if (!text) return;
    const res = await api.post(`/api/messages/${practitionerId}`, { body: text });
    setMessagesById((prev) => {
      const list = prev[practitionerId] || [];
      if (list.some((m) => m.id === res.data.id)) return prev;
      return { ...prev, [practitionerId]: [...list, res.data] };
    });
  }, []);

  const setTyping = useCallback((practitionerId, isTyping) => {
    getSocket().emit('thread:typing', { practitionerId, isTyping });
  }, []);

  const value = useMemo(() => ({
    active,
    threads: Object.values(threadsById).sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return (a.name || '').localeCompare(b.name || '');
    }),
    threadsById,
    messagesById,
    openThreads,
    viewersById,
    typingById,
    totalUnread,
    unreadById: Object.fromEntries(Object.values(threadsById).map((t) => [t.practitionerId, t.unreadCount || 0])),
    soundEnabled,
    setSoundEnabled,
    openThread,
    closeThread,
    minimizeThread,
    restoreThread,
    markThreadRead,
    focusThread,
    blurThread,
    sendMessage,
    setTyping,
    fetchThreadHistory,
  }), [
    active, threadsById, messagesById, openThreads, viewersById, typingById, totalUnread, soundEnabled,
    setSoundEnabled, openThread, closeThread, minimizeThread, restoreThread, markThreadRead, focusThread,
    blurThread, sendMessage, setTyping, fetchThreadHistory,
  ]);

  return (
    <MessagingContext.Provider value={value}>
      {children}
      {active && <MessageDock />}
    </MessagingContext.Provider>
  );
}
