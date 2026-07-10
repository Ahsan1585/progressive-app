import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout } from "@/components/shell/AuthLayout";
import { Button } from "@/components/ui/button";

// Dead-end for any non-practitioner role (design flow 3). Never attempts to
// render Home/Roster/etc.
export default function UnsupportedRole() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleBack = () => {
    logout("unsupported-role");
    navigate("/login", { replace: true });
  };

  return (
    <AuthLayout>
      <div className="space-y-5 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-warning-bg">
          <ShieldAlert className="size-7 text-warning" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-[20px] font-semibold leading-[26px] text-ink">This app is for practitioners only</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Your account role isn't supported in this mobile app. Please use the admin portal on desktop instead.
          </p>
        </div>
        <Button onClick={handleBack} className="w-full">
          Back to login
        </Button>
      </div>
    </AuthLayout>
  );
}
