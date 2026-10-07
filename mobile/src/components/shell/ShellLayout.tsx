import { Outlet } from "react-router-dom";
import { TabBar } from "@/components/shell/TabBar";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";

// The five tab-root screens (Home / Roster / Inbox / Messages-or-Billing /
// Profile) render inside this shell, and so does every pushed full-screen
// view (Add/Edit Patient, Log Session, Generate SEVF, etc. — see App.tsx) —
// the tab bar stays visible underneath a pushed view's own AppBar/back
// arrow, so switching tabs mid-task never requires backing out first.
export function ShellLayout() {
  const { rejectedLogs, telepracticeRequests, unreadMessageCount } = useAppData();
  const { isIndependentPractitioner } = useAuth();
  // Only 'signed' telepractice requests count toward the "needs your
  // attention now" badge — an 'awaiting_signature' one is visible (on
  // Patient Detail) but not yet actionable by the practitioner.
  const signedTelepracticeCount = telepracticeRequests.filter((r) => r.status === "signed").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      <TabBar
        inboxCount={rejectedLogs.length + signedTelepracticeCount}
        messagesCount={unreadMessageCount}
        isIndependentPractitioner={isIndependentPractitioner}
      />
    </div>
  );
}
