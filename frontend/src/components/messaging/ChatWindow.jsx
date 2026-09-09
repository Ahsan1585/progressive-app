import { useEffect, useRef, useState } from 'react';
import { X, Minus } from 'lucide-react';
import { useMessaging } from '@/context/useMessaging';

// One expanded conversation in the office dock. Socket-driven (no polling):
// history is fetched once on mount into the shared context cache, then
// message:new events append live.
export function ChatWindow({ practitionerId }) {
  const {
    threadsById, messagesById, viewersById, typingById,
    closeThread, minimizeThread, focusThread, blurThread, sendMessage, setTyping, fetchThreadHistory,
  } = useMessaging();

  const thread = threadsById[practitionerId];
  const messages = messagesById[practitionerId] || [];
  const viewers = viewersById[practitionerId] || [];
  const typing = typingById[practitionerId];

  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    fetchThreadHistory(practitionerId);
    focusThread(practitionerId);
    return () => blurThread(practitionerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practitionerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, typing]);

  const onInput = (e) => {
    setDraft(e.target.value);
    setTyping(practitionerId, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(practitionerId, false), 2500);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setIsSending(true);
    try {
      await sendMessage(practitionerId, body);
      setDraft('');
      setTyping(practitionerId, false);
    } catch {
      /* keep the draft so the user can retry */
    } finally {
      setIsSending(false);
    }
  };

  const name = thread?.name || 'Practitioner';
  const viewerLabel = viewers.length === 0
    ? null
    : viewers.length === 1
      ? `${viewers[0].name} is viewing`
      : `${viewers.map((v) => v.name.split(' ')[0]).join(', ')} are viewing`;

  return (
    <div
      className="flex h-[460px] w-[86vw] max-w-[340px] flex-col overflow-hidden rounded-2xl border-2 border-slate-800 bg-white shadow-[0_20px_60px_-12px_rgba(0,0,0,0.55)]"
      onClick={() => focusThread(practitionerId)}
    >
      <div className="flex items-start justify-between border-b border-slate-200 bg-slate-900 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{name}</p>
          {viewerLabel
            ? <p className="truncate text-[11px] text-emerald-300">{viewerLabel}</p>
            : thread?.lastOfficeReplyName
              ? <p className="truncate text-[11px] text-slate-400">Last reply: {thread.lastOfficeReplyName}</p>
              : <p className="text-[11px] text-slate-400">&nbsp;</p>}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); minimizeThread(practitionerId); }}
            className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeThread(practitionerId); }}
            className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-3">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No messages yet.</p>
        ) : (
          messages.map((m) => {
            const isOffice = m.sender_role !== 'practitioner';
            return (
              <div key={m.id} className={`flex flex-col ${isOffice ? 'items-end' : 'items-start'}`}>
                <span className={`mb-0.5 px-1 text-[11px] font-semibold ${isOffice ? 'text-slate-500' : 'text-blue-600'}`}>
                  {isOffice ? (m.sender_name || 'Office') : name}
                </span>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  isOffice ? 'rounded-br-sm bg-slate-900 text-white' : 'rounded-bl-sm bg-blue-600 text-white'
                }`}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${isOffice ? 'text-slate-300' : 'text-blue-100'}`}>
                    {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {typing && (
          <p className="px-1 text-[11px] italic text-slate-400">{typing.name || name} is typing…</p>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5">
        <input
          type="text"
          value={draft}
          onChange={onInput}
          placeholder="Type a message…"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
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
