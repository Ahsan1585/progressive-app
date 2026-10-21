import * as React from "react";
import QRCode from "qrcode";
import api from "@/api/axiosInstance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import {
  mfaSetup,
  mfaEnable,
  mfaDisable,
  errMsg,
  digitsOnly,
  type MfaSetupData,
  type MfaEnableResponse,
} from "./mfaApi";

export function RecoveryCodes({ codes, onConfirm }: { codes: string[]; onConfirm: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Save these recovery codes somewhere safe. Each one can be used once to sign in if you lose your authenticator.
        They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-card border border-border bg-surface-sunken p-3.5 font-mono text-sm text-ink select-all">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="w-full" onClick={copy}>
        {copied ? "Copied" : "Copy codes"}
      </Button>
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-5" />
        I saved these recovery codes
      </label>
      <Button type="button" size="lg" className="w-full" disabled={!saved} onClick={onConfirm}>
        Continue
      </Button>

      <Dialog open={copyFailed} onOpenChange={setCopyFailed}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Could not copy</DialogTitle>
            <DialogDescription>
              Your device blocked copying. Press and hold the codes to select them, then copy or write them down before continuing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setCopyFailed(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface MfaSetupProps {
  /** Set during the forced-enrollment login flow; setup starts immediately. */
  mfaToken?: string;
  /** Forced flow: enrollment done and codes acknowledged. Payload carries the login response. */
  onEnrolled?: (payload: MfaEnableResponse) => void;
  /** Settings mode: MFA was turned on (true) or off (false). */
  onChanged?: (enabled: boolean) => void;
}

export function MfaSetup({ mfaToken, onEnrolled, onChanged }: MfaSetupProps) {
  const forced = Boolean(mfaToken);
  const [status, setStatus] = React.useState<"loading" | "idle" | "enrolling" | "codes">(forced ? "idle" : "loading");
  const [mfaEnabled, setMfaEnabled] = React.useState(false);
  const [companyRequired, setCompanyRequired] = React.useState(false);
  const [setup, setSetup] = React.useState<MfaSetupData | null>(null);
  const [qr, setQr] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [result, setResult] = React.useState<MfaEnableResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmingDisable, setConfirmingDisable] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  const [askPassword, setAskPassword] = React.useState<"enable" | "replace" | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);

  const resetPrompt = () => {
    setAskPassword(null);
    setPassword("");
    setCode("");
    setUseRecovery(false);
    setPasswordError(null);
    setError(null);
  };

  const startSetup = async (extra?: { code?: string; recoveryCode?: string }) => {
    setError(null);
    setPasswordError(null);
    setBusy(true);
    try {
      const data = await mfaSetup(mfaToken, password, extra);
      setSetup(data);
      setQr(await QRCode.toDataURL(data.otpauthUri, { width: 208, margin: 1 }));
      setCode("");
      setStatus("enrolling");
      setAskPassword(null);
    } catch (err) {
      const msg = errMsg(err, "Could not start setup. Please try again.");
      const http = (err as { response?: { status?: number } }).response?.status;
      if (!forced && http === 400) setPasswordError(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (askPassword === "replace") void startSetup(useRecovery ? { recoveryCode: code.trim() } : { code });
    else void startSetup();
  };

  React.useEffect(() => {
    if (forced) {
      void startSetup();
      return;
    }
    api
      .get<{ mfaEnabled?: boolean; companyMfaRequired?: boolean }>("/api/auth/me")
      .then((res) => {
        setMfaEnabled(Boolean(res.data.mfaEnabled));
        setCompanyRequired(Boolean(res.data.companyMfaRequired));
      })
      .catch(() => setError("Could not load your security settings."))
      .finally(() => setStatus("idle"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setResult(await mfaEnable(code, mfaToken, password));
      setStatus("codes");
    } catch (err) {
      const msg = errMsg(err, "That code was not accepted. Check your authenticator and try again.");
      if (!forced && /password/i.test(msg)) {
        setStatus("idle");
        setAskPassword(mfaEnabled ? "replace" : "enable");
        setCode("");
        setPasswordError(msg);
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCodesDone = () => {
    if (forced && result) {
      onEnrolled?.(result);
      return;
    }
    setMfaEnabled(true);
    setStatus("idle");
    setResult(null);
    resetPrompt();
    onChanged?.(true);
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mfaDisable(password, code);
      setMfaEnabled(false);
      setConfirmingDisable(false);
      setPassword("");
      setCode("");
      onChanged?.(false);
    } catch (err) {
      const msg = errMsg(err, "Could not turn off two-step verification.");
      const status = (err as { response?: { status?: number } }).response?.status;
      // The company-requires-MFA refusal is something the user must read: dialog, not inline text.
      if (status === 403) setRefusal(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const banner = error && <InlineErrorBanner message={error} />;

  if (status === "loading") return <p className="text-sm text-ink-muted">Loading...</p>;

  if (status === "codes") return <RecoveryCodes codes={result?.recoveryCodes ?? []} onConfirm={handleCodesDone} />;

  if (status === "enrolling") {
    return (
      <form onSubmit={handleEnable} className="space-y-4" noValidate>
        {banner}
        <p className="text-sm text-ink-muted">
          Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code it shows.
        </p>
        {qr && (
          <img
            src={qr}
            alt="Authenticator QR code"
            width={208}
            height={208}
            className="mx-auto rounded-card border border-border bg-white"
          />
        )}
        <div>
          <p className="mb-1 text-xs text-ink-muted">Cannot scan? Enter this key manually:</p>
          <code className="block break-all rounded-control border border-border bg-surface-sunken px-3 py-2 text-sm text-ink select-all">
            {setup?.secret}
          </code>
          <button
            type="button"
            className="mt-1.5 text-xs font-medium text-primary"
            onClick={() => navigator.clipboard?.writeText(setup?.secret ?? "").catch(() => {})}
          >
            Copy key
          </button>
        </div>
        <Field id="mfa-enable-code" label="6-digit code">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(digitsOnly(e.target.value))}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>
          Verify and turn on
        </Button>
      </form>
    );
  }

  if (forced) {
    return (
      <div className="space-y-3">
        {banner}
        <Button type="button" size="lg" className="w-full" loading={busy} onClick={() => void startSetup()}>
          Try again
        </Button>
      </div>
    );
  }

  if (askPassword) {
    const replacing = askPassword === "replace";
    const codeOk = !replacing || (useRecovery ? code.trim().length > 0 : code.length === 6);
    return (
      <form onSubmit={handlePasswordSubmit} className="space-y-4" noValidate>
        {banner}
        <p className="text-sm text-ink-muted">
          {replacing
            ? "To replace your authenticator, confirm your password and a current code. Your old authenticator stops working once the new one is confirmed."
            : "Confirm your account password to continue."}
        </p>
        <Field id="mfa-setup-password" label="Account password" error={passwordError ?? undefined}>
          <PasswordInput
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
          />
        </Field>
        {replacing && (
          <div className="space-y-1.5">
            <Field id="mfa-setup-code" label={useRecovery ? "Recovery code" : "Current 6-digit code"}>
              <Input
                inputMode={useRecovery ? "text" : "numeric"}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(useRecovery ? e.target.value : digitsOnly(e.target.value))}
              />
            </Field>
            <button
              type="button"
              className="text-xs font-medium text-primary"
              onClick={() => {
                setUseRecovery((v) => !v);
                setCode("");
              }}
            >
              {useRecovery ? "Use authenticator code instead" : "Use a recovery code instead"}
            </button>
          </div>
        )}
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={resetPrompt}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={busy} disabled={!password || !codeOk}>
            Continue
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {banner}
      <p className="text-sm text-ink-muted">
        Two-step verification is <span className="font-semibold text-ink">{mfaEnabled ? "on" : "off"}</span>. It adds a
        6-digit code from your authenticator app to every sign-in.
      </p>

      {!mfaEnabled && (
        <Button type="button" size="lg" className="w-full" onClick={() => { setAskPassword("enable"); setError(null); }}>
          Turn on two-step verification
        </Button>
      )}

      {mfaEnabled && !confirmingDisable && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            setAskPassword("replace");
            setPassword("");
            setCode("");
            setError(null);
          }}
        >
          Replace authenticator
        </Button>
      )}

      {mfaEnabled && companyRequired && (
        <p className="text-sm text-ink-muted">Your company requires two-step verification, so it cannot be turned off.</p>
      )}

      {mfaEnabled && !companyRequired && !confirmingDisable && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            setConfirmingDisable(true);
            setCode("");
            setError(null);
          }}
        >
          Turn off
        </Button>
      )}

      {mfaEnabled && confirmingDisable && (
        <form onSubmit={handleDisable} className="space-y-4" noValidate>
          <Field id="mfa-disable-password" label="Password">
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field id="mfa-disable-code" label="Current 6-digit code">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(digitsOnly(e.target.value))}
            />
          </Field>
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmingDisable(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" className="flex-1" loading={busy} disabled={!password || code.length !== 6}>
              Turn off
            </Button>
          </div>
        </form>
      )}

      <Dialog open={refusal !== null} onOpenChange={(o) => !o && setRefusal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cannot turn off</DialogTitle>
            <DialogDescription>{refusal}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setRefusal(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
