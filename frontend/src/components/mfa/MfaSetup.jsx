import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mfaSetup, mfaEnable, mfaDisable, errMsg } from './mfaApi';

const digitsOnly = (v) => v.replace(/\D/g, '').slice(0, 6);

export function RecoveryCodes({ codes, onConfirm, busy }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch { /* clipboard blocked - codes remain selectable */ }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Save these recovery codes somewhere safe. Each can be used once to sign in if you lose your authenticator.
        They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-800 select-all">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <Button type="button" variant="outline" onClick={copy} className="w-full">
        {copied ? 'Copied' : 'Copy codes'}
      </Button>
      <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5" />
        I saved these recovery codes
      </label>
      <Button type="button" className="w-full" disabled={!saved || busy} onClick={onConfirm}>
        Continue
      </Button>
    </div>
  );
}

/**
 * Props:
 *  mfaToken   - set in the forced-enrollment login flow (setup starts immediately)
 *  onEnrolled - (payload) enrollment finished and codes acknowledged; payload is the
 *               enable response (contains the login payload when mfaToken was used)
 *  onChanged  - settings mode: called after MFA was turned on or off
 */
export function MfaSetup({ mfaToken, onEnrolled, onChanged }) {
  const forced = Boolean(mfaToken);
  const [status, setStatus] = useState(forced ? 'idle' : 'loading'); // loading | idle | enrolling | codes
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [companyRequired, setCompanyRequired] = useState(false);
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  // Settings flow: which password prompt is showing ('enable' | 'replace' | null)
  const [askPassword, setAskPassword] = useState(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const resetPrompt = () => { setAskPassword(null); setPassword(''); setCode(''); setUseRecovery(false); setPasswordError(''); setError(''); };

  const startSetup = async (extra) => {
    setError(''); setPasswordError(''); setBusy(true);
    try {
      const data = await mfaSetup(mfaToken, password, extra);
      setSetup(data);
      setQr(await QRCode.toDataURL(data.otpauthUri, { width: 192, margin: 1 }));
      setCode('');
      setStatus('enrolling');
      setAskPassword(null);
    } catch (err) {
      const msg = errMsg(err, 'Could not start setup. Please try again.');
      if (!forced && err?.response?.status === 400) setPasswordError(msg);
      else setError(msg);
    } finally { setBusy(false); }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (askPassword === 'replace') startSetup(useRecovery ? { recoveryCode: code.trim() } : { code });
    else startSetup();
  };

  useEffect(() => {
    if (forced) { startSetup(); return; }
    api.get('/api/auth/me')
      .then((res) => {
        setMfaEnabled(Boolean(res.data.mfaEnabled));
        setCompanyRequired(Boolean(res.data.companyMfaRequired));
        setStatus('idle');
      })
      .catch(() => { setError('Could not load your security settings.'); setStatus('idle'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnable = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const data = await mfaEnable(mfaToken, code, password);
      setResult(data);
      setStatus('codes');
    } catch (err) {
      const msg = errMsg(err, 'That code was not accepted. Check your authenticator and try again.');
      if (!forced && /password/i.test(msg)) { setStatus('idle'); setAskPassword(mfaEnabled ? 'replace' : 'enable'); setCode(''); setPasswordError(msg); }
      else setError(msg);
    } finally { setBusy(false); }
  };

  const handleCodesDone = () => {
    if (forced) { onEnrolled?.(result); return; }
    setMfaEnabled(true); setStatus('idle'); setResult(null); resetPrompt();
    onChanged?.(true);
  };

  const handleDisable = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await mfaDisable(password, code);
      setMfaEnabled(false); setConfirmingDisable(false); setPassword(''); setCode('');
      onChanged?.(false);
    } catch (err) {
      setError(errMsg(err, 'Could not turn off two-step verification.'));
    } finally { setBusy(false); }
  };

  const errorBanner = error && (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
  );

  if (status === 'loading') return <p className="text-sm text-slate-500">Loading...</p>;

  if (status === 'codes') return <RecoveryCodes codes={result?.recoveryCodes || []} onConfirm={handleCodesDone} />;

  if (status === 'enrolling') {
    return (
      <form onSubmit={handleEnable} className="space-y-4">
        {errorBanner}
        <p className="text-sm text-slate-600">
          Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code it shows.
        </p>
        {qr && <img src={qr} alt="Authenticator QR code" width={192} height={192} className="mx-auto rounded-lg border border-slate-200" />}
        <div>
          <p className="text-xs text-slate-500 mb-1">Cannot scan? Enter this key manually:</p>
          <code className="block break-all rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm select-all">{setup?.secret}</code>
          <button type="button" className="mt-1 text-xs font-medium text-blue-600 hover:underline"
            onClick={() => navigator.clipboard?.writeText(setup?.secret || '').catch(() => {})}>Copy key</button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mfa-enable-code">6-digit code</Label>
          <Input id="mfa-enable-code" inputMode="numeric" autoComplete="one-time-code" autoFocus
            value={code} onChange={(e) => setCode(digitsOnly(e.target.value))} placeholder="123456" />
        </div>
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? 'Verifying...' : 'Verify and turn on'}
        </Button>
      </form>
    );
  }

  // idle: settings mode, or forced mode while setup is loading / failed
  if (forced) {
    return (
      <div className="space-y-3">
        {errorBanner}
        {busy ? <p className="text-sm text-slate-500">Preparing setup...</p>
          : <Button type="button" onClick={() => startSetup()} className="w-full">Try again</Button>}
      </div>
    );
  }

  if (askPassword) {
    const replacing = askPassword === 'replace';
    const codeOk = !replacing || (useRecovery ? code.trim().length > 0 : code.length === 6);
    return (
      <form onSubmit={handlePasswordSubmit} className="space-y-4">
        {errorBanner}
        <p className="text-sm text-slate-600">
          {replacing
            ? 'To replace your authenticator, confirm your password and a current code. Your old authenticator stops working once the new one is confirmed.'
            : 'Confirm your account password to continue.'}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="mfa-setup-password">Account password</Label>
          <Input id="mfa-setup-password" type="password" autoComplete="current-password" autoFocus
            value={password} onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
            aria-invalid={Boolean(passwordError)} />
          {passwordError && <p role="alert" className="text-sm text-red-600">{passwordError}</p>}
        </div>
        {replacing && (
          <div className="space-y-1.5">
            <Label htmlFor="mfa-setup-code">{useRecovery ? 'Recovery code' : 'Current 6-digit code'}</Label>
            <Input id="mfa-setup-code" inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code"
              value={code} onChange={(e) => setCode(useRecovery ? e.target.value : digitsOnly(e.target.value))} />
            <button type="button" className="text-xs font-medium text-blue-600 hover:underline"
              onClick={() => { setUseRecovery((v) => !v); setCode(''); }}>
              {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={resetPrompt}>Cancel</Button>
          <Button type="submit" disabled={busy || !password || !codeOk}>{busy ? 'Checking...' : 'Continue'}</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {errorBanner}
      <p className="text-sm text-slate-600">
        Two-step verification: <strong>{mfaEnabled ? 'On' : 'Off'}</strong>. It adds a 6-digit code from your authenticator app to every sign-in.
      </p>
      {!mfaEnabled && <Button type="button" onClick={() => { setAskPassword('enable'); setError(''); }}>Turn on two-step verification</Button>}
      {mfaEnabled && !confirmingDisable && (
        <Button type="button" variant="outline" className="mr-2" onClick={() => { setAskPassword('replace'); setPassword(''); setCode(''); setError(''); }}>
          Replace authenticator
        </Button>
      )}
      {mfaEnabled && companyRequired && (
        <p className="text-sm text-slate-500">Your company requires two-step verification, so it cannot be turned off.</p>
      )}
      {mfaEnabled && !companyRequired && !confirmingDisable && (
        <Button type="button" variant="outline" onClick={() => { setConfirmingDisable(true); setCode(''); setError(''); }}>
          Turn off
        </Button>
      )}
      {mfaEnabled && confirmingDisable && (
        <form onSubmit={handleDisable} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mfa-disable-password">Password</Label>
            <Input id="mfa-disable-password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mfa-disable-code">Current 6-digit code</Label>
            <Input id="mfa-disable-code" inputMode="numeric" autoComplete="one-time-code"
              value={code} onChange={(e) => setCode(digitsOnly(e.target.value))} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => { setConfirmingDisable(false); setError(''); }}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy || !password || code.length !== 6}>
              {busy ? 'Turning off...' : 'Turn off'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
