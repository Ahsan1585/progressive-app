import { useEffect, useRef, useState } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';

// Office side of practitioner messaging: a practitioner list (left) with
// unread badges + a search box, and the selected practitioner's thread +
// composer (right). Two-way threaded, one thread per practitioner.
export function MessageCenter() {
  const [threads, setThreads] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef(null);

  const fetchThreads = async () => {
    setIsLoadingThreads(true);
    try {
      const res = await api.get('/api/messages/threads');
      setThreads(res.data);
    } catch (err) {
      console.error('Failed to load threads:', err);
    } finally {
      setIsLoadingThreads(false);
    }
  };

  useEffect(() => {
    fetchThreads();
  }, []);

  const openThread = async (practitionerId) => {
    setSelectedId(practitionerId);
    setIsLoadingThread(true);
    try {
      const res = await api.get(`/api/messages/${practitionerId}`);
      setMessages(res.data);
      setThreads((prev) => prev.map((t) => (t.practitioner_id === practitionerId ? { ...t, unread_count: 0 } : t)));
    } catch (err) {
      console.error('Failed to load thread:', err);
    } finally {
      setIsLoadingThread(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId) return;
    setIsSending(true);
    try {
      const res = await api.post(`/api/messages/${selectedId}`, { body });
      setMessages((prev) => [...prev, res.data]);
      setDraft('');
      setThreads((prev) =>
        prev.map((t) => (t.practitioner_id === selectedId ? { ...t, last_message: body, last_message_at: res.data.created_at } : t))
      );
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const filteredThreads = threads.filter((t) =>
    `${t.first_name} ${t.last_name}`.toLowerCase().includes(search.toLowerCase())
  );
  const selectedThread = threads.find((t) => t.practitioner_id === selectedId);

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[420px] border border-slate-200 rounded-2xl overflow-hidden bg-white">
      {/* Practitioner list */}
      <div className="w-72 shrink-0 border-r border-slate-200 flex flex-col">
        <div className="p-3 border-b border-slate-100">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search practitioners…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoadingThreads ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : filteredThreads.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8 px-4">No practitioners found.</p>
          ) : (
            filteredThreads.map((t) => (
              <button
                key={t.practitioner_id}
                onClick={() => openThread(t.practitioner_id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                  selectedId === t.practitioner_id ? 'bg-slate-100' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800 truncate">{t.first_name} {t.last_name}</span>
                  {t.unread_count > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shrink-0">
                      {t.unread_count > 99 ? '99+' : t.unread_count}
                    </span>
                  )}
                </div>
                {t.last_message && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {t.last_message_sender_role !== 'practitioner' ? 'You: ' : ''}{t.last_message}
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            Select a practitioner to view their messages.
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">{selectedThread?.first_name} {selectedThread?.last_name}</h3>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 px-5 py-4">
              {isLoadingThread ? (
                <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No messages yet.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_role !== 'practitioner' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                        m.sender_role !== 'practitioner'
                          ? 'bg-slate-900 text-white rounded-br-sm'
                          : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 ${m.sender_role !== 'practitioner' ? 'text-slate-300' : 'text-slate-400'}`}>
                        {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message this practitioner…"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <Button type="submit" disabled={isSending || !draft.trim()}>Send</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
