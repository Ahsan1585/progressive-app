import { useEffect, useRef, useState } from 'react';
import api from '@/api/axiosInstance';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Practitioner-side messaging — a single thread with the office (the
// practitioner's own practitioner_id is the thread key server-side, so no
// practitioner list is needed here, unlike the office's chat dock).
// `liveMessages` (from usePractitionerMessages) are socket-delivered rows
// that arrived after the initial fetch; merged in and de-duplicated by id.
export function MessagesPanel({ open, onOpenChange, onThreadRead, liveMessages = [] }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef(null);

  const fetchThread = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const payload = JSON.parse(atob(token.split('.')[1]));
      const res = await api.get(`/api/messages/${payload.practitionerId}`);
      setMessages(res.data);
      onThreadRead?.();
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Merge any socket-delivered messages the panel hasn't shown yet.
  useEffect(() => {
    if (liveMessages.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const additions = liveMessages.filter((m) => !seen.has(m.id));
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, [liveMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setIsSending(true);
    try {
      const token = localStorage.getItem('token');
      const payload = JSON.parse(atob(token.split('.')[1]));
      const res = await api.post(`/api/messages/${payload.practitionerId}`, { body });
      setMessages((prev) => [...prev, res.data]);
      setDraft('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] flex flex-col max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Messages</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 py-2 min-h-[240px]">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No messages yet. Say hello to your office.</p>
          ) : (
            messages.map((m) => {
              const mine = m.sender_role === 'practitioner';
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  {!mine && (
                    <span className="mb-0.5 px-1 text-[11px] font-semibold text-slate-500">
                      {m.sender_name || 'Office'}
                    </span>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                      mine
                        ? 'bg-slate-900 text-white rounded-br-sm'
                        : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={`text-[10px] mt-1 ${mine ? 'text-slate-300' : 'text-slate-400'}`}>
                      {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message your office…"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <Button type="submit" disabled={isSending || !draft.trim()}>Send</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
