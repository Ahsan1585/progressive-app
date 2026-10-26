import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/BrandLockup';
import { ParentSignaturePad } from '@/components/ParentSignaturePad';

// Public, unauthenticated page a parent reaches from the telepractice
// signature-request email — no login, no account. Mirrors
// ActivateAccount.jsx's public-route/tenant-by-slug shape, but deliberately
// NOT wrapped in AuthLayout (that layout's card tops out at 420px, too
// narrow for a session summary + signature pad) — this builds its own
// wider, single-purpose shell using the same Tailwind/BrandLockup visual
// language as the rest of the auth pages.
const DETAIL_ROWS = [
  ['childName', 'Child'],
  ['serviceLabel', 'Service'],
  ['sessionDate', 'Date'],
  ['timeRange', 'Time'],
  ['durationLabel', 'Duration'],
  ['sessionTypeLabel', 'Session Type'],
  ['locationLabel', 'Location'],
  ['providedBy', 'Provided By'],
];

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-10 sm:py-16">
      <div className="mb-8">
        <BrandLockup size="lg" align="center" />
      </div>
      <div className="w-full max-w-xl rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.12)]">
        <div className="h-1 rounded-t-2xl bg-gradient-to-r from-cyan-600 to-teal-500" />
        <div className="p-6 sm:p-8">{children}</div>
      </div>
      <div className="mt-6 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        Secured &amp; HIPAA Compliant
      </div>
    </div>
  );
}

function StatusMessage({ icon: Icon, tone, title, message }) {
  const toneClasses = {
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    danger: 'bg-red-50 border-red-200 text-red-700',
  }[tone];
  return (
    <div className={`rounded-xl border p-5 text-center ${toneClasses}`}>
      <Icon className="mx-auto mb-2 size-6" aria-hidden="true" />
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

const TelepracticeSign = () => {
  const { companySlug, token } = useParams();

  const [status, setStatus] = useState('loading'); // loading | invalid | expired | already_signed | locked | cancelled | verify | verifying | ready | submitting | success | server_error
  const [summary, setSummary] = useState(null);
  const [signature, setSignature] = useState(null);
  const [signError, setSignError] = useState('');
  const [dob, setDob] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [attested, setAttested] = useState(false);
  const [attestationText, setAttestationText] = useState('');

  const fetchSummary = useCallback(async () => {
    if (!companySlug || !token) {
      setStatus('invalid');
      return;
    }
    setStatus('loading');
    try {
      await api.get(`/api/telepractice-signatures/${companySlug}/${token}`);
      setStatus('verify');
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'expired') setStatus('expired');
      else if (code === 'already_signed') setStatus('already_signed');
      else if (code === 'cancelled') setStatus('cancelled');
      else if (code === 'locked') setStatus('locked');
      else if (code === 'invalid') setStatus('invalid');
      else setStatus('server_error');
    }
  }, [companySlug, token]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const handleVerify = async (e) => {
    e.preventDefault();
    setVerifyError('');
    if (!dob) {
      setVerifyError('Please enter your child’s date of birth.');
      return;
    }
    setStatus('verifying');
    try {
      const { data } = await api.post(`/api/telepractice-signatures/${companySlug}/${token}/verify`, { dob });
      setSummary(data.summary);
      setAttestationText(data.attestationText);
      setStatus('ready');
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'expired') setStatus('expired');
      else if (code === 'already_signed') setStatus('already_signed');
      else if (code === 'cancelled') setStatus('cancelled');
      else if (code === 'locked') setStatus('locked');
      else if (code === 'invalid') setStatus('invalid');
      else {
        setStatus('verify');
        setVerifyError(err.response?.data?.message || 'Something went wrong. Please try again.');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSignError('');
    if (!attested) {
      setSignError('Please tick the box to confirm the statement before signing.');
      return;
    }
    if (!signature) {
      setSignError('Please sign above before submitting.');
      return;
    }
    setStatus('submitting');
    try {
      await api.post(`/api/telepractice-signatures/${companySlug}/${token}/sign`, { signatureBase64: signature, attested: true, dob });
      setStatus('success');
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'expired') setStatus('expired');
      else if (code === 'already_signed') setStatus('already_signed');
      else if (code === 'cancelled') setStatus('cancelled');
      else if (code === 'locked') setStatus('locked');
      else if (code === 'invalid') setStatus('invalid');
      else {
        setStatus('ready');
        setSignError(err.response?.data?.message || 'Something went wrong. Please try again.');
      }
    }
  };

  if (status === 'loading') {
    return (
      <Shell>
        <p className="text-center text-sm text-slate-500">Loading session details…</p>
      </Shell>
    );
  }

  if (status === 'invalid') {
    return (
      <Shell>
        <StatusMessage icon={Clock} tone="warning" title="This link has expired or was already used" message="Signing links only work once and expire after 7 days. Ask your practitioner to send you a new one." />
      </Shell>
    );
  }

  if (status === 'locked') {
    return (
      <Shell>
        <StatusMessage icon={AlertCircle} tone="danger" title="This link has been locked" message="For your child's privacy, this link can no longer be used. Ask your practitioner to send you a new link." />
      </Shell>
    );
  }

  if (status === 'verify' || status === 'verifying') {
    return (
      <Shell>
        <h1 className="text-center text-lg font-semibold text-slate-800">Confirm it&apos;s you</h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          To protect your child&apos;s privacy, please enter your child&apos;s date of birth to view and sign this session record.
        </p>
        <form onSubmit={handleVerify} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="child-dob" className="text-xs font-medium text-slate-600">Child&apos;s date of birth</label>
            <input
              id="child-dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              required
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-600"
            />
          </div>
          {verifyError && <p role="alert" className="text-sm text-red-600">{verifyError}</p>}
          <Button type="submit" className="w-full h-11" disabled={status === 'verifying' || !dob}>
            {status === 'verifying' ? 'Checking…' : 'Continue'}
          </Button>
        </form>
      </Shell>
    );
  }

  if (status === 'expired') {
    return (
      <Shell>
        <StatusMessage icon={Clock} tone="warning" title="This link has expired" message="Ask your practitioner to resend the signing link." />
      </Shell>
    );
  }

  if (status === 'cancelled') {
    return (
      <Shell>
        <StatusMessage icon={CheckCircle2} tone="warning" title="Nothing to sign" message="Your practitioner cancelled this change, so this link is no longer needed. No further action is needed." />
      </Shell>
    );
  }

  if (status === 'already_signed') {
    return (
      <Shell>
        <StatusMessage icon={CheckCircle2} tone="warning" title="Already signed" message="This session has already been signed. No further action is needed." />
      </Shell>
    );
  }

  if (status === 'server_error') {
    return (
      <Shell>
        <StatusMessage icon={AlertCircle} tone="danger" title="Something went wrong" message="Please try again in a moment." />
        <Button className="mt-4 w-full" onClick={fetchSummary}>Try again</Button>
      </Shell>
    );
  }

  if (status === 'success') {
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-slate-800">Thank you — you&apos;re all set</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your signature has been recorded. You can safely close this page.
          </p>
        </div>
      </Shell>
    );
  }

  // status === 'ready' or 'submitting'
  const timeRange = summary?.startTime && summary?.endTime ? `${summary.startTime} – ${summary.endTime}` : '';
  const providedBy = summary?.practitionerDisciplineLabel
    ? `${summary.practitionerName}, ${summary.practitionerDisciplineLabel}`
    : summary?.practitionerName;
  const displayValues = { ...summary, timeRange, providedBy };

  return (
    <Shell>
      <h1 className="text-center text-lg font-semibold text-slate-800">
        {summary?.dateChange
          ? <>Please review the corrected date and sign {summary?.childName}&apos;s session again</>
          : <>Please review and sign {summary?.childName}&apos;s session</>}
      </h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        By signing below, you confirm that the session described below took place as shown.
      </p>
      {summary?.dateChange && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">The date on this session was corrected</p>
          <p className="mt-1">
            You signed it for <span className="font-semibold line-through decoration-amber-500">{summary.dateChange.from}</span>.
            The session took place on <span className="font-semibold">{summary.dateChange.to}</span>.
          </p>
        </div>
      )}

      <div className="my-6 divide-y divide-slate-100 rounded-lg border border-slate-100">
        {DETAIL_ROWS.map(([key, label]) =>
          displayValues[key] ? (
            <div key={key} className="flex items-start justify-between gap-4 px-4 py-2.5">
              <span className="w-28 shrink-0 text-xs font-medium text-slate-500">{label}</span>
              <span className="text-right text-sm font-semibold text-slate-800">{displayValues[key]}</span>
            </div>
          ) : null
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-cyan-700"
          />
          <span>{attestationText}</span>
        </label>
        <ParentSignaturePad value={signature} onChange={setSignature} error={signError} />
        <Button type="submit" className="w-full h-11" disabled={status === 'submitting' || !signature || !attested}>
          {status === 'submitting' ? 'Submitting…' : 'Sign & Submit'}
        </Button>
      </form>
    </Shell>
  );
};

export default TelepracticeSign;
