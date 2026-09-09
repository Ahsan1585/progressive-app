import { useMemo, useState } from 'react';
import { MessageCircle, Search, X, Volume2, VolumeX } from 'lucide-react';
import { useMessaging } from '@/context/useMessaging';
import { ChatWindow } from './ChatWindow';

const MAX_EXPANDED = 3;

// The persistent office chat dock. Mounted by MessagingProvider (App.jsx) so
// it survives route/tab changes; only rendered while an office session is
// active. Bottom-right: a launcher button, an optional directory panel, up
// to 3 expanded ChatWindows, and a tray of minimized/overflow pills.
export function MessageDock() {
  const {
    threads, openThreads, unreadById, totalUnread,
    openThread, restoreThread, soundEnabled, setSoundEnabled,
  } = useMessaging();

  const [dirOpen, setDirOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Split open threads into expanded (shown as windows) vs minimized/overflow
  // (shown as pills). Order by their saved `order`.
  const ordered = useMemo(
    () => [...openThreads].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [openThreads]
  );
  const expanded = ordered.filter((t) => !t.minimized).slice(0, MAX_EXPANDED);
  const expandedIds = new Set(expanded.map((t) => t.practitionerId));
  const trayThreads = ordered.filter((t) => !expandedIds.has(t.practitionerId));

  const filteredDir = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => !q || (t.name || '').toLowerCase().includes(q));
  }, [threads, search]);

  const nameFor = (pid) => threads.find((t) => t.practitionerId === pid)?.name || 'Practitioner';

  return (
    <>
      {/* One fixed dock at bottom-right. Horizontal layout:
          [ expanded chat windows ... ][ right column: tray pills above the launcher ]
          so the windows never sit underneath the launcher/pills. */}
      <div className="pointer-events-none fixed bottom-0 right-0 z-40 flex items-end gap-3 p-4">
        {expanded.map((t) => (
          <div key={t.practitionerId} className="pointer-events-auto">
            <ChatWindow practitionerId={t.practitionerId} />
          </div>
        ))}

        {/* Right column — tray pills stacked above the launcher */}
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          {trayThreads.map((t) => (
            <button
              key={t.practitionerId}
              type="button"
              onClick={() => restoreThread(t.practitionerId)}
              className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md hover:bg-slate-50 cursor-pointer"
            >
              <span className="max-w-[140px] truncate">{nameFor(t.practitionerId)}</span>
              {(unreadById[t.practitionerId] || 0) > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadById[t.practitionerId] > 99 ? '99+' : unreadById[t.practitionerId]}
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setDirOpen((v) => !v)}
            className="relative flex size-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)] hover:bg-slate-800 cursor-pointer"
            aria-label="Messages"
          >
            <MessageCircle className="h-6 w-6" />
            {totalUnread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Directory panel — floats above the launcher column */}
      {dirOpen && (
        <div className="fixed bottom-[5.5rem] right-4 z-50 flex h-[420px] w-[320px] flex-col overflow-hidden rounded-2xl border-2 border-slate-800 bg-white shadow-[0_20px_60px_-12px_rgba(0,0,0,0.55)]">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-3.5 py-2.5">
            <p className="text-sm font-bold text-white">Messages</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
                title={soundEnabled ? 'Mute new-message sound' : 'Unmute new-message sound'}
              >
                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setDirOpen(false)}
                className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search practitioners…"
                className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredDir.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No practitioners.</p>
            ) : (
              filteredDir.map((t) => (
                <button
                  key={t.practitionerId}
                  type="button"
                  onClick={() => { openThread(t.practitionerId); setDirOpen(false); }}
                  className="flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
                >
                  <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    {(t.name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{t.name}</p>
                      {t.unreadCount > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                          {t.unreadCount > 99 ? '99+' : t.unreadCount}
                        </span>
                      )}
                    </div>
                    {t.lastMessage && (
                      <p className="truncate text-xs text-slate-500">
                        {t.lastMessageSenderRole && t.lastMessageSenderRole !== 'practitioner' ? 'You: ' : ''}
                        {t.lastMessage}
                      </p>
                    )}
                    {t.lastOfficeReplyName && (
                      <p className="truncate text-[11px] text-slate-400">Last reply: {t.lastOfficeReplyName}</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

    </>
  );
}
