import * as React from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { useToast } from "@/components/ui/toast";
import { PushScreen } from "@/components/shell/PushScreen";
import { AppBar } from "@/components/shell/AppBar";
import { SignatureCapture } from "@/components/SignatureCapture";
import { Button } from "@/components/ui/button";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import type { ApiErrorBody } from "@/types";

// Standalone reuse of the Signature Capture component (design: Profile > My
// saved signature).
export default function ManageSignature() {
  const navigate = useNavigate();
  const { profile, setSavedSignature } = useAppData();
  const { showToast } = useToast();

  const [draft, setDraft] = React.useState<string | null>(profile?.signature ?? null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/practitioner/signature", { signature: draft });
      setSavedSignature(draft);
      showToast("Signature updated.");
      navigate("/profile", { replace: true });
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody } }).response?.data;
      setError(body?.error || "Failed to save signature. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushScreen>
      <AppBar title="My saved signature" />
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {error && <InlineErrorBanner message={error} />}

        <SignatureCapture
          label="Your default signature"
          instructions="Your default practitioner signature — draw with your finger or stylus"
          value={draft}
          onChange={setDraft}
        />

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => navigate("/profile")}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSave} loading={submitting}>
            Save signature
          </Button>
        </div>
      </div>
    </PushScreen>
  );
}
