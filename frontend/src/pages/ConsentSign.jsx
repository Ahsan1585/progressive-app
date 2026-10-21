import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/BrandLockup';

// Public, unauthenticated page a parent reaches from the records-consent
// signature-request email. Same shell/look as TelepracticeSign. The child's
// name is intentionally never shown anywhere on this page.
const RECORD_TYPE_LABELS = {
  session_logs: 'Session logs',
  sevf_forms: 'SEVF forms',
  invoices: 'Invoices',
  full_record_export: 'Full record export',
};

const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

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
        Private and secure
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

const recordLabels = (types) => (types || []).map((t) => RECORD_TYPE_LABELS[t] || t).join(', ');

const ConsentSign = () => {
  const { slug, token } = useParams();

  // loading | invalid | already_signed | locked | verify | verifying | ready | submitting | success | server_error
  const [status, setStatus] = useState('loading');
  const [dob, setDob] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [details, setDetails] = useState(null);
  const [attested, setAttested] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [signError, setSignError] = useState('');
  const [signedSummary, setSignedSummary] = useState(null);

  const base = `/api/consent-signing/${slug}/${token}`;

  const load = useCallback(async () => {
    if (!slug || !token) {
      setStatus('invalid');
      return;
    }
    setStatus('loading');
    try {
      await api.get(base);
      setStatus('verify');
    } catch (err) {
      const code = err.response?.status;
      if (code === 404) setStatus('invalid');
      else if (code === 409) setStatus('already_signed');
      else if (code === 423) setStatus('locked');
      else setStatus('server_error');
    }
  }, [slug, token, base]);

  useEffect(() => { load(); }, [load]);

  const handleVerify = async (e) => {
    e.preventDefault();
    setVerifyError('');
    if (!dob) {
      setVerifyError('Please enter your child’s date of birth.');
      return;
    }
    setStatus('verifying');
    try {
      const { data } = await api.post(`${base}/verify`, { dob });
      setDetails(data);
      setStatus('ready');
    } catch (err) {
      const code = err.response?.status;
      if (code === 423) setStatus('locked');
      else if (code === 404) setStatus('invalid');
      else if (code === 409) setStatus('already_signed');
      else if (code === 403) {
        setStatus('verify');
        setVerifyError('That date of birth does not match. Please check it and try again.');
      } else {
        setStatus('verify');
        setVerifyError(err.response?.data?.message || err.response?.data?.error || 'Something went wrong. Please try again.');
      }
    }
  };

  const handleSign = async (e) => {
    e.preventDefault();
    setSignError('');
    if (!typedName.trim()) {
      setSignError('Please type your full name to sign.');
      return;
    }
    if (!attested) {
      setSignError('Please tick the box to confirm the statement before signing.');
      return;
    }
    setStatus('submitting');
    try {
      await api.post(`${base}/sign`, { dob, typedName: typedName.trim(), attested: true });
      setSignedSummary(details);
      setStatus('success');
    } catch (err) {
      const code = err.response?.status;
      if (code === 409) setStatus('already_signed');
      else if (code === 423) setStatus('locked');
      else if (code === 404) setStatus('invalid');
      else {
        setStatus('ready');
        setSignError(err.response?.data?.message || err.response?.data?.error || 'Something went wrong. Please try again.');
      }
    }
  };

  if (status === 'loading') {
    return <Shell><p className="text-center text-sm text-slate-500">Loading…</p></Shell>;
  }

  if (status === 'invalid') {
    return (
      <Shell>
        <StatusMessage icon={Clock} tone="warning" title="This link is no longer valid" message="It may have expired, been cancelled, or already been used. Please contact the agency that sent it to request a new one." />
      </Shell>
    );
  }

  if (status === 'locked') {
    return (
      <Shell>
        <StatusMessage icon={AlertCircle} tone="danger" title="This link has been locked" message="For your child's privacy, this link can no longer be used. Please contact the agency to request a new link." />
      </Shell>
    );
  }

  if (status === 'already_signed') {
    return (
      <Shell>
        <StatusMessage icon={CheckCircle2} tone="warning" title="Already signed" message="This consent has already been signed. No further action is needed." />
      </Shell>
    );
  }

  if (status === 'server_error') {
    return (
      <Shell>
        <StatusMessage icon={AlertCircle} tone="danger" title="Something went wrong" message="Please try again in a moment." />
        <Button className="mt-4 w-full" onClick={load}>Try again</Button>
      </Shell>
    );
  }

  if (status === 'verify' || status === 'verifying') {
    return (
      <Shell>
        <h1 className="text-center text-lg font-semibold text-slate-800">Confirm it&apos;s you</h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          To protect your child&apos;s privacy, please enter your child&apos;s date of birth to review and sign this consent.
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

  if (status === 'success') {
    const s = signedSummary || {};
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-slate-800">Thank you. Your consent has been recorded.</h1>
          <p className="mt-2 text-sm text-slate-500">You can safely close this page.</p>
        </div>
        <div className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-100 text-left">
          <Row label="Shared with" value={s.recipientName} />
          <Row label="Records" value={recordLabels(s.recordTypes)} />
          <Row label="Valid until" value={fmtDate(s.consentExpiresAt)} />
        </div>
      </Shell>
    );
  }

  // ready | submitting
  const d = details || {};
  return (
    <Shell>
      <h1 className="text-center text-lg font-semibold text-slate-800">Review and sign your consent</h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        Please read what you are authorizing below. Nothing is shared until you sign.
      </p>

      <div className="my-6 divide-y divide-slate-100 rounded-lg border border-slate-100">
        <Row label="Organization" value={d.organizationName} />
        <Row label="Share with" value={d.recipientName} />
        <Row label="Purpose" value={d.purpose} />
        <Row label="Records covered" value={recordLabels(d.recordTypes)} />
        <Row label="Valid until" value={fmtDate(d.consentExpiresAt)} />
      </div>

      <form onSubmit={handleSign} className="space-y-4">
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-cyan-700"
          />
          <span>{d.attestationText}</span>
        </label>
        <div className="space-y-1.5">
          <label htmlFor="typed-name" className="text-xs font-medium text-slate-600">Type your full name to sign</label>
          <input
            id="typed-name"
            type="text"
            autoComplete="name"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-600"
          />
        </div>
        {signError && <p role="alert" className="text-sm text-red-600">{signError}</p>}
        <Button type="submit" className="w-full h-11" disabled={status === 'submitting' || !attested || !typedName.trim()}>
          {status === 'submitting' ? 'Submitting…' : 'Sign & Submit'}
        </Button>
      </form>
    </Shell>
  );
};

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <span className="w-28 shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <span className="text-right text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

export default ConsentSign;
