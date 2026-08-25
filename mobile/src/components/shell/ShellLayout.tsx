import { Outlet } from "react-router-dom";
import { TabBar } from "@/components/shell/TabBar";
import { useAppData } from "@/contexts/AppDataContext";

// The four tab-root screens (Home / Roster / Inbox / Profile) render inside
// this shell. Pushed full-screen views mount outside it (own AppBar, no tab bar).
export function ShellLayout() {
  const { rejectedLogs, telepracticeRequests, unreadMessageCount } = useAppData();
  // Only 'signed' telepractice requests count toward the "needs your
  // attention now" badge — an 'awaiting_signature' one is visible (on
  // Patient Detail) but not yet actionable by the practitioner.
  const signedTelepracticeCount = telepracticeRequests.filter((r) => r.status === "signed").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      <TabBar inboxCount={rejectedLogs.length + signedTelepracticeCount} messagesCount={unreadMessageCount} />
    </div>
  );
}
