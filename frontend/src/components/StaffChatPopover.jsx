import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import api from '@/api/axiosInstance';

const POLL_INTERVAL_MS = 8000;

// Floating chat widget (bottom-right), scoped to a single practitioner —
// opened from their row's Message button in the Staff Directory, replacing
// the old standalone Messages tab. Polls while open so a reply that arrives
// mid-conversation just appears, like a real chat.
export function StaffChatPopover({ practitioner, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef(null);

  const fetchThread = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await api.get(`/api/messages/${practitioner.id}`);
      setMessages(res.data);
    } catch (err) {
      console.error('Failed to load thread:', err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchThread();
    const interval = setInterval(() => fetchThread(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practitioner.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setIsSending(true);
    try {
      const res = await api.post(`/api/messages/${practitioner.id}`, { body });
      setMessages((prev) => [...prev, res.data]);
      setDraft('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[480px] w-[340px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-800">{practitioner.first_name} {practitioner.last_name}</p>
          <p className="text-xs text-slate-400">{practitioner.position_title || 'Practitioner'}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 cursor-pointer"
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 px-3 py-3">
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender_role !== 'practitioner' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
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

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <button
          type="submit"
          disabled={isSending || !draft.trim()}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
        >
          Send
        </button>
      </form>
    </div>
  );
}
