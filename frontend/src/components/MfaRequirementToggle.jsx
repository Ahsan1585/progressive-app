import { useEffect, useState } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';

// CEO-only company switch: require two-step verification for every user.
// Current value comes from /api/auth/me (companyMfaRequired).
export function MfaRequirementToggle() {
  const [required, setRequired] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { type, text }

  useEffect(() => {
    api.get('/api/auth/me')
      .then((res) => setRequired(Boolean(res.data.companyMfaRequired)))
      .catch(() => setMessage({ type: 'error', text: 'Could not load the current setting.' }))
      .finally(() => setLoaded(true));
  }, []);

  const save = async (next) => {
    setBusy(true); setMessage(null);
    try {
      await api.put('/api/company/mfa-required', { mfaRequired: next });
      setRequired(next); setConfirming(false);
      setMessage({ type: 'success', text: next ? 'Two-step verification is now required for everyone.' : 'Two-step verification is no longer required.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Could not update the setting.' });
    } finally { setBusy(false); }
  };

  const onToggle = () => {
    if (required) save(false);
    else setConfirming(true);
  };

  return (
    <div className="space-y-3 border-t border-slate-100 pt-6">
      <h2 className="text-base font-bold text-slate-800">Security</h2>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="mfa-required-label" className="text-sm font-semibold text-slate-800">Require two-step verification for everyone</p>
          <p className="mt-0.5 text-xs text-slate-500">Users who have not set it up will be asked at their next login. Existing sessions are not interrupted.</p>
        </div>
        <button
          type="button" role="switch" aria-checked={required} aria-labelledby="mfa-required-label"
          disabled={!loaded || busy} onClick={onToggle}
          className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${required ? 'bg-slate-800' : 'bg-slate-300'}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${required ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {confirming && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 space-y-3">
          <p>Turn this on? Everyone in your company who has not set up two-step verification will be required to do so at their next login.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={() => save(true)} disabled={busy}>{busy ? 'Saving...' : 'Require for everyone'}</Button>
          </div>
        </div>
      )}
      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'} className={`text-sm ${message.type === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{message.text}</p>
      )}
    </div>
  );
}
