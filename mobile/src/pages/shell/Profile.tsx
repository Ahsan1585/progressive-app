import * as React from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, PenLine, LogOut, ChevronRight, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

export default function Profile() {
  const { practitioner, logout } = useAuth();
  const { profile, profileLoading, profileError, fetchProfile } = useAppData();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const { canPromptInstall, promptInstall } = useInstallPrompt();

  return (
    <div className="safe-top flex-1 px-4 pb-6 pt-5">
      <h1 className="mb-4 text-[20px] font-semibold leading-[26px] text-ink">Profile</h1>

      <div className="mb-6 flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
        <div className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-fg">
          <span className="text-sm font-bold">
            {practitioner?.firstName?.[0]}
            {practitioner?.lastName?.[0]}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">
            {practitioner?.firstName} {practitioner?.lastName}
          </p>
          <p className="truncate text-sm text-ink-muted">{practitioner?.email}</p>
        </div>
      </div>

      {profileError && <InlineErrorBanner message={profileError} onRetry={fetchProfile} className="mb-4" />}

      <div className="space-y-2">
        {canPromptInstall && (
          <button
            type="button"
            onClick={promptInstall}
            className="press-scale pop-in flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
          >
            <Download className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex-1 text-[15px] font-medium text-ink">Install app</span>
            <span className="text-xs font-medium text-primary">Install</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate("/profile/change-password")}
          className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
        >
          <KeyRound className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="flex-1 text-[15px] font-medium text-ink">Change password</span>
          <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => navigate("/profile/signature")}
          className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
        >
          <PenLine className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="flex-1 text-[15px] font-medium text-ink">My saved signature</span>
          {profileLoading ? (
            <Skeleton className="h-8 w-14" />
          ) : profile?.signature ? (
            <img src={profile.signature} alt="Your saved signature" className="h-8 w-14 rounded bg-white object-contain" />
          ) : (
            <span className="text-xs font-medium text-ink-faint">Not set</span>
          )}
          <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setConfirmLogout(true)}
          className="press-scale flex w-full items-center gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-[var(--elev-rest)]"
        >
          <LogOut className="size-5 shrink-0 text-danger" aria-hidden="true" />
          <span className="flex-1 text-[15px] font-medium text-danger">Log out</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Log out?"
        description="You'll need to sign in again to access your roster and logs."
        confirmLabel="Log out"
        destructive
        onConfirm={() => {
          logout("manual");
          navigate("/login", { replace: true });
        }}
      />
    </div>
  );
}
