import * as React from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, PenLine, LogOut, ChevronRight, Download, Camera } from "lucide-react";
import api from "@/api/axiosInstance";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useToast } from "@/components/ui/toast";
import { resizeImageToDataUrl } from "@/utils/image";

export default function Profile() {
  const { practitioner, logout } = useAuth();
  const { profile, profileLoading, profileError, fetchProfile } = useAppData();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const { canPromptInstall, promptInstall } = useInstallPrompt();
  const { showToast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);

  const handlePickPhoto = () => fileInputRef.current?.click();

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setUploadingPhoto(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await api.post("/api/practitioner/profile-picture", { picture: dataUrl });
      await fetchProfile();
      showToast("Profile picture updated.");
    } catch {
      showToast("Couldn't update your profile picture. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="safe-top flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg px-4 pb-3 pt-5">
        <h1 className="text-[20px] font-semibold leading-[26px] text-ink">Profile</h1>
      </header>

      <div className="flex-1 px-4 py-3">

      <div className="mb-6 flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--elev-rest)]">
        <button
          type="button"
          onClick={handlePickPhoto}
          disabled={uploadingPhoto}
          aria-label="Change profile picture"
          className="press-scale relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-fg disabled:opacity-70"
        >
          {profile?.profile_picture ? (
            <img src={profile.profile_picture} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-base font-bold">
              {practitioner?.firstName?.[0]}
              {practitioner?.lastName?.[0]}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/55 py-0.5">
            {uploadingPhoto ? (
              <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Camera className="size-3 text-white" aria-hidden="true" />
            )}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoSelected}
        />
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
