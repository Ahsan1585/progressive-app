import * as React from "react";
import { MessageCircle } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import type { Message } from "@/types";

const POLL_INTERVAL_MS = 20000;

export default function Messages() {
  const { practitioner } = useAuth();
  const { fetchUnreadMessageCount } = useAppData();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const fetchThread = React.useCallback(async (silent = false) => {
    if (!practitioner) return;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<Message[]>(`/api/messages/${practitioner.id}`);
      setMessages(res.data);
      fetchUnreadMessageCount();
    } catch {
      if (!silent) setError("Couldn't load your messages.");
    } finally {
      if (!silent) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practitioner?.id]);

  // Refetch on landing (route components remount on nav) plus a light poll
  // while the tab stays mounted, since a conversation is more time-sensitive
  // than the other tabs' data.
  React.useEffect(() => {
    fetchThread();
    const interval = setInterval(() => fetchThread(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchThread]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !practitioner) return;
    setIsSending(true);
    try {
      const res = await api.post<Message>(`/api/messages/${practitioner.id}`, { body });
      setMessages((prev) => [...prev, res.data]);
      setDraft("");
    } catch {
      // Leave the draft in place so the practitioner can retry.
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="safe-top flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg px-4 pb-3 pt-5">
        <h1 className="text-[20px] font-semibold leading-[26px] text-ink">Messages</h1>
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-3">
        {error ? (
          <InlineErrorBanner message={error} onRetry={() => fetchThread()} />
        ) : isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-3/4" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState icon={MessageCircle} heading="No messages yet" subtext="Say hello to your office." />
        ) : (
          <div className="flex-1 space-y-2">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender_role === "practitioner" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                    m.sender_role === "practitioner"
                      ? "rounded-br-sm bg-primary text-primary-fg"
                      : "rounded-bl-sm bg-surface-sunken text-ink"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${m.sender_role === "practitioner" ? "text-primary-fg/70" : "text-ink-faint"}`}>
                    {new Date(m.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="safe-bottom flex items-center gap-2 border-t border-border bg-bg px-4 py-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message your office…"
          className="min-w-0 flex-1 rounded-control border border-border bg-surface px-3 py-2.5 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={isSending || !draft.trim()}
          className="press-scale shrink-0 rounded-control bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-fg disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
