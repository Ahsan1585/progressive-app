import { Outlet } from "react-router-dom";
import { TabBar } from "@/components/shell/TabBar";
import { useAppData } from "@/contexts/AppDataContext";

// The four tab-root screens (Home / Roster / Inbox / Profile) render inside
// this shell. Pushed full-screen views mount outside it (own AppBar, no tab bar).
export function ShellLayout() {
  const { rejectedLogs } = useAppData();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      <TabBar inboxCount={rejectedLogs.length} />
    </div>
  );
}
