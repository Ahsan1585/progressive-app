import { Outlet, useLocation } from "react-router-dom";
import { TabBar } from "@/components/shell/TabBar";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";

// The five tab-root screens (Home / Roster / Inbox / Messages-or-Billing /
// Profile) render inside this shell, and so does every pushed full-screen
// view (Add/Edit Patient, Log Session, Generate SEVF, etc. — see App.tsx) —
// the tab bar stays visible underneath a pushed view's own AppBar/back
// arrow, so switching tabs mid-task never requires backing out first.
//
// Except while a session note is being entered (Log Session, Edit Log,
// Resubmit): there a stray tab tap left the screen and lost everything typed.
// Those screens have their own bottom bar, and leaving goes through their
// Back / Cancel, which asks before discarding unsaved work.
const NOTE_ENTRY_PATHS = [/^\/patients\/[^/]+\/log$/, /^\/patients\/[^/]+\/logs\/[^/]+\/edit$/, /^\/inbox\/[^/]+\/resubmit$/];
export const hidesTabBar = (pathname: string) => NOTE_ENTRY_PATHS.some((re) => re.test(pathname));

export function ShellLayout() {
  const { pathname } = useLocation();
  const { rejectedLogs, telepracticeRequests, unreadMessageCount, notifications } = useAppData();
  const { isIndependentPractitioner } = useAuth();
  // Only 'signed' telepractice requests count toward the "needs your
  // attention now" badge — an 'awaiting_signature' one is visible (on
  // Patient Detail) but not yet actionable by the practitioner.
  const signedTelepracticeCount = telepracticeRequests.filter((r) => r.status === "signed").length;
  const unreadNotificationCount = isIndependentPractitioner ? notifications.filter((n) => !n.read_at).length : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      {!hidesTabBar(pathname) && <TabBar
        inboxCount={rejectedLogs.length + signedTelepracticeCount + unreadNotificationCount}
        messagesCount={unreadMessageCount}
        isIndependentPractitioner={isIndependentPractitioner}
      />}
    </div>
  );
}
