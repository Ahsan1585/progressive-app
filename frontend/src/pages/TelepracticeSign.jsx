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

  const [status, setStatus] = useState('loading'); // loading | invalid | expired | already_signed | ready | submitting | success | server_error
  const [summary, setSummary] = useState(null);
  const [signature, setSignature] = useState(null);
  const [signError, setSignError] = useState('');

  const fetchSummary = useCallback(async () => {
    if (!companySlug || !token) {
      setStatus('invalid');
      return;
    }
    setStatus('loading');
    try {
      const { data } = await api.get(`/api/telepractice-signatures/${companySlug}/${token}`);
      setSummary(data.summary);
      setStatus('ready');
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'expired') setStatus('expired');
      else if (code === 'already_signed') setStatus('already_signed');
      else if (code === 'invalid') setStatus('invalid');
      else setStatus('server_error');
    }
  }, [companySlug, token]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSignError('');
    if (!signature) {
      setSignError('Please sign above before submitting.');
      return;
    }
    setStatus('submitting');
    try {
      await api.post(`/api/telepractice-signatures/${companySlug}/${token}/sign`, { signatureBase64: signature });
      setStatus('success');
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'expired') setStatus('expired');
      else if (code === 'already_signed') setStatus('already_signed');
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
        <StatusMessage icon={AlertCircle} tone="danger" title="This link isn't valid" message="Double-check the link from your email, or ask your practitioner to resend it." />
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
        Please review and sign {summary?.childName}&apos;s session
      </h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        By signing below, you confirm that the session described below took place as shown.
      </p>

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
        <ParentSignaturePad value={signature} onChange={setSignature} error={signError} />
        <Button type="submit" className="w-full h-11" disabled={status === 'submitting' || !signature}>
          {status === 'submitting' ? 'Submitting…' : 'Sign & Submit'}
        </Button>
      </form>
    </Shell>
  );
};

export default TelepracticeSign;
