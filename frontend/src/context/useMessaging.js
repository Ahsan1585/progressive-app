import { useContext } from 'react';
import { MessagingContext } from './MessagingContext.jsx';

// Access the shared messaging state (socket, threads, open chat windows,
// unread counts). Returns null when there is no MessagingProvider above —
// callers on non-office pages should guard, though in practice the provider
// is mounted app-wide in App.jsx.
export const useMessaging = () => useContext(MessagingContext);
