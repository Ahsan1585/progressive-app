import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Download } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { showAlert } from '@/utils/dialogStore';

// FERPA / IDEA Part C records-sharing consents. Two uses:
//  - child given: that child's consents, open signature requests, and the
//    two ways to add a consent (request a parent e-signature, or record a
//    consent the agency already holds signed on paper).
//  - child null: the agency-wide "Pending consents" list; clicking a row
//    calls onOpenChild(patientId) to open that child's panel.
const RECORD_TYPES = [
  { value: 'session_logs', label: 'Session logs' },
  { value: 'sevf_forms', label: 'SEVF forms' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'full_record_export', label: 'Full record export' },
];
const TYPE_LABEL = Object.fromEntries(RECORD_TYPES.map((t) => [t.value, t.label]));

const IDENTITY_METHODS = [
  { value: 'known_parent', label: 'Known parent/guardian' },
  { value: 'photo_id', label: 'Photo ID checked' },
  { value: 'callback_verified', label: 'Verified by callback' },
  { value: 'in_person', label: 'Verified in person' },
  { value: 'other', label: 'Other' },
];

const todayStr = () => new Date().toLocaleDateString('en-CA');
const defaultExpiry = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toLocaleDateString('en-CA');
};
const tomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
};
const fmtDate = (s) => {
  if (!s) return 'unknown';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (!y || !m || !d || Number.isNaN(dt.getTime())) return 'unknown';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const errMsg = (err, fallback) => err.response?.data?.message || err.response?.data?.error || fallback;
const daysUntil = (s) => {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
};

const selectCls = 'w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700';
const badgeCls = 'text-xs font-semibold px-2 py-0.5 rounded-full border';
const NEUTRAL = 'bg-slate-50 text-slate-600 border-slate-200';

function Field({ label, error, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">{label}</label>
      {children}
      {error && <p role="alert" className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}

function consentStatus(c) {
  if (c.revoked_at) return { label: 'Revoked', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { label: 'Expired', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

const REQUEST_STATUS_CLS = {
  pending: 'bg-blue-50 text-blue-700 border-blue-200',
  signed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  expired: 'bg-amber-50 text-amber-700 border-amber-200',
  cancelled: NEUTRAL,
};

function ConsentForm({ mode, child, onDone, onCancel }) {
  const isPaper = mode === 'paper';
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [types, setTypes] = useState([]);
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [signedOn, setSignedOn] = useState('');
  const [method, setMethod] = useState('');
  const [methodNote, setMethodNote] = useState('');
  const [proofNote, setProofNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleType = (v) => setTypes((prev) => (prev.includes(v) ? prev.filter((t) => t !== v) : [...prev, v]));

  const submit = async () => {
    const e = {};
    if (!recipientName.trim()) e.recipientName = 'Enter who the records will be shared with.';
    if (recipientEmail.trim() && !/^\S+@\S+\.\S+$/.test(recipientEmail.trim())) e.recipientEmail = 'Enter a valid email address.';
    if (!purpose.trim()) e.purpose = 'Enter the purpose of the disclosure.';
    if (types.length === 0) e.types = 'Select at least one type of record.';
    if (!expiresAt) e.expiresAt = 'Choose an expiry date.';
    else if (expiresAt < tomorrowStr()) e.expiresAt = 'Expiry date must be in the future.';
    if (isPaper) {
      if (!signedOn) e.signedOn = 'Enter the date the consent was signed.';
      else if (signedOn > todayStr()) e.signedOn = 'Date signed cannot be in the future.';
      if (!method) e.method = 'Select how the parent/guardian identity was verified.';
      if (method === 'other' && !methodNote.trim()) e.methodNote = 'Describe how identity was verified.';
      if (!attested) e.attested = 'Confirm that a signed paper consent is on file.';
    }
    setErrors(e);
    setServerError('');
    if (Object.keys(e).length) return;

    setSubmitting(true);
    try {
      if (isPaper) {
        await api.post(`/api/patients/${child.id}/consents`, {
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim() || undefined,
          purpose: purpose.trim(),
          recordTypes: types,
          expiresAt,
          identityVerifiedMethod: method,
          identityVerifiedNote: methodNote.trim() || undefined,
          proofNote: proofNote.trim() || undefined,
          signedOn,
          paperAttested: true,
        });
      } else {
        await api.post(`/api/patients/${child.id}/consent-requests`, {
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim() || undefined,
          purpose: purpose.trim(),
          recordTypes: types,
          expiresAt,
        });
      }
      onDone(isPaper ? 'Paper consent recorded.' : 'Signature request sent to the parent.');
    } catch (err) {
      setServerError(errMsg(err, isPaper ? 'Failed to record consent.' : 'Failed to send request.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
      <div>
        <h4 className="text-sm font-bold text-slate-800">{isPaper ? 'Record paper consent' : 'Request parent signature'}</h4>
        <p className="text-xs text-slate-500 mt-0.5">
          {isPaper
            ? 'Use this only for a consent the agency already holds, signed on paper. Do not use it to sign on the parent\'s behalf.'
            : child.parent_email
              ? `A secure signing link will be emailed to ${child.parent_email}. The parent confirms the child's date of birth before signing.`
              : 'A secure signing link is emailed to the parent email on the child record.'}
        </p>
        {!isPaper && !child.parent_email && (
          <p className="text-xs text-amber-700 mt-1">No parent email is on file for this child. Add one first.</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Share records with (recipient)" error={errors.recipientName}>
          <Input value={recipientName} onChange={(ev) => setRecipientName(ev.target.value)} placeholder="e.g. ABC Billing Services" />
        </Field>
        <Field label="Recipient email (optional)" error={errors.recipientEmail}>
          <Input type="email" value={recipientEmail} onChange={(ev) => setRecipientEmail(ev.target.value)} />
        </Field>
      </div>
      <Field label="Purpose" error={errors.purpose}>
        <Input value={purpose} onChange={(ev) => setPurpose(ev.target.value)} placeholder="Why the records are being shared" />
      </Field>
      <Field label="Records covered" error={errors.types}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {RECORD_TYPES.map((t) => (
            <label key={t.value} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={types.includes(t.value)} onChange={() => toggleType(t.value)} className="size-4 accent-blue-600" />
              {t.label}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Consent expires on" error={errors.expiresAt}>
          <Input type="date" value={expiresAt} min={tomorrowStr()} onChange={(ev) => setExpiresAt(ev.target.value)} />
        </Field>
        {isPaper && (
          <Field label="Date signed on paper" error={errors.signedOn}>
            <Input type="date" value={signedOn} max={todayStr()} onChange={(ev) => setSignedOn(ev.target.value)} />
          </Field>
        )}
      </div>

      {isPaper && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Identity verified by" error={errors.method}>
              <select className={selectCls} value={method} onChange={(ev) => setMethod(ev.target.value)}>
                <option value="">Select method...</option>
                {IDENTITY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            {method === 'other' && (
              <Field label="Describe how identity was verified" error={errors.methodNote}>
                <Input value={methodNote} onChange={(ev) => setMethodNote(ev.target.value)} />
              </Field>
            )}
          </div>
          <Field label="Proof note (optional)">
            <Textarea rows={2} value={proofNote} onChange={(ev) => setProofNote(ev.target.value)} placeholder="Where the signed paper copy is kept" />
          </Field>
          <div>
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={attested} onChange={(ev) => setAttested(ev.target.checked)} className="mt-0.5 size-4 accent-blue-600" />
              A signed paper consent is on file
            </label>
            {errors.attested && <p role="alert" className="text-xs text-rose-600 mt-1">{errors.attested}</p>}
          </div>
        </>
      )}

      {serverError && <p role="alert" className="text-sm text-rose-600">{serverError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="size-3.5 animate-spin" /> : isPaper ? 'Record consent' : 'Send request'}
        </Button>
      </div>
    </div>
  );
}

function PendingList({ onOpenChild }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/consent-requests/pending')
      .then((res) => setRows(res.data.requests || []))
      .catch(() => showAlert('Failed to load pending consents.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center text-sm text-slate-400 py-6">Loading...</div>;
  if (rows.length === 0) return <div className="text-center text-sm text-slate-400 py-6">No consents are awaiting a parent signature.</div>;

  const shown = rows.filter((r) => !r.status || r.status === 'pending' || r.status === 'expired');
  if (shown.length === 0) return <div className="text-center text-sm text-slate-400 py-6">No consents are awaiting a parent signature.</div>;

  return shown.map((r) => {
    const isPending = !r.status || r.status === 'pending';
    const days = isPending ? daysUntil(r.requestExpiresAt) : null;
    const soon = days !== null && days < 2;
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => onOpenChild(r.patientId)}
        className="w-full text-left border border-slate-200 rounded-xl p-3 hover:bg-slate-50 cursor-pointer space-y-1"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">{r.patientName}</span>
          <span className="flex items-center gap-1.5">
            {soon && <span className={`${badgeCls} bg-amber-50 text-amber-700 border-amber-200`}>Expires soon</span>}
            {isPending ? (
              days !== null && (
                <span className={`${badgeCls} ${NEUTRAL}`}>
                  {days <= 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} left`}
                </span>
              )
            ) : (
              <span className={`${badgeCls} ${REQUEST_STATUS_CLS.expired}`}>Expired</span>
            )}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Recipient: {r.recipientName} · requested {fmtDate(r.requestedAt || r.createdAt)}
        </p>
      </button>
    );
  });
}

function ChildConsents({ child }) {
  const [consents, setConsents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // null | 'request' | 'paper'
  const [notice, setNotice] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [reqError, setReqError] = useState(null); // { id, message }
  const [reportBusyId, setReportBusyId] = useState(null);
  const [reportError, setReportError] = useState(null); // { id, message }

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/api/patients/${child.id}/consents`),
      api.get(`/api/patients/${child.id}/consent-requests`),
    ])
      .then(([c, r]) => {
        setConsents(c.data.consents || []);
        setRequests(r.data.requests || []);
      })
      .catch(() => showAlert('Failed to load consents.'))
      .finally(() => setLoading(false));
  }, [child.id]);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    setBusyId(id);
    try {
      await api.delete(`/api/patients/${child.id}/consents/${id}`);
      setConfirmRevoke(null);
      load();
    } catch (err) {
      showAlert(errMsg(err, 'Failed to revoke consent.'));
    } finally {
      setBusyId(null);
    }
  };

  const reqAction = async (id, action) => {
    setBusyId(id);
    setReqError(null);
    try {
      if (action === 'resend') {
        await api.post(`/api/patients/${child.id}/consent-requests/${id}/resend`);
        setNotice('Signing link sent again.');
      } else {
        await api.delete(`/api/patients/${child.id}/consent-requests/${id}`);
        setNotice('Request cancelled.');
      }
      load();
    } catch (err) {
      setReqError({ id, message: errMsg(err, `Failed to ${action} request.`) });
    } finally {
      setBusyId(null);
    }
  };

  const typesText = (arr) => (arr || []).map((t) => TYPE_LABEL[t] || t).join(', ');

  // Same blob-download pattern as the full record export in
  // StaffDirectoryChildren; a blob error body is parsed back into JSON so the
  // server's message (e.g. revoked/expired 409) can be shown inline.
  const generateReport = async (c) => {
    setReportBusyId(c.id);
    setReportError(null);
    try {
      const response = await api.get(`/api/patients/${child.id}/consents/${c.id}/report`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      const safe = (s, fb) => String(s || fb).trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fb;
      link.href = url;
      link.setAttribute('download', `consent-report-${safe(child.last_name, 'child')}-${safe(c.recipient_name, 'recipient')}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      let message = 'Failed to generate the report.';
      try {
        const data = err.response?.data;
        const body = data instanceof Blob ? JSON.parse(await data.text()) : data;
        message = body?.message || body?.error || message;
      } catch { /* keep fallback */ }
      setReportError({ id: c.id, message });
    } finally {
      setReportBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
      {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

      {form ? (
        <ConsentForm
          mode={form}
          child={child}
          onCancel={() => setForm(null)}
          onDone={(msg) => { setForm(null); setNotice(msg); load(); }}
        />
      ) : (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={() => { setNotice(''); setForm('request'); }}>Request parent signature</Button>
          <Button size="sm" variant="outline" onClick={() => { setNotice(''); setForm('paper'); }}>Record paper consent</Button>
        </div>
      )}

      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Open signature requests</h4>
        {loading ? (
          <div className="text-sm text-slate-400 py-2">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="text-sm text-slate-400">No signature requests.</div>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="border border-slate-200 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-800">{r.recipientName}</span>
                <span className={`${badgeCls} ${REQUEST_STATUS_CLS[r.status] || NEUTRAL}`}>
                  {r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : ''}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {r.purpose} · {typesText(r.recordTypes)}
              </p>
              <p className="text-xs text-slate-500">
                Sent {fmtDate(r.requestedAt || r.createdAt)} · {r.status === 'signed' ? `signed ${fmtDate(r.signedAt)}` : `request expires ${fmtDate(r.requestExpiresAt)}`}
              </p>
              {reqError && reqError.id === r.id && (
                <p role="alert" className="text-xs text-rose-600">{reqError.message}</p>
              )}
              {r.status === 'pending' && (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => reqAction(r.id, 'resend')}>Resend</Button>
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => reqAction(r.id, 'cancel')}>Cancel</Button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Consents</h4>
        <p className="text-xs text-slate-400">
          To produce the child's complete record instead, use the Export full record button (first icon) on the child's row.
        </p>
        {loading ? null : consents.length === 0 ? (
          <div className="text-sm text-slate-400">No consents on file for this child.</div>
        ) : (
          consents.map((c) => {
            const st = consentStatus(c);
            return (
              <div key={c.id} className="border border-slate-200 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800">{c.recipient_name}</span>
                  <span className="flex items-center gap-1.5">
                    {c.source && (
                      <span className={`${badgeCls} ${NEUTRAL}`}>{c.source === 'electronic' ? 'Electronic' : 'Paper'}</span>
                    )}
                    <span className={`${badgeCls} ${st.cls}`}>{st.label}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-500">{c.purpose} · {typesText(c.record_types)}</p>
                <p className="text-xs text-slate-500">
                  Signed {fmtDate(c.signed_on || c.granted_at)}{c.signed_name ? ` by ${c.signed_name}` : ''} · expires {fmtDate(c.expires_at)}
                  {c.revoked_at ? ` · revoked ${fmtDate(c.revoked_at)}` : ''}
                </p>
                {st.label === 'Active' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-500">
                      Includes only what the parent approved: {typesText(c.record_types)}, plus the signed consent copy.
                    </p>
                    {reportError && reportError.id === c.id && (
                      <p role="alert" className="text-xs text-rose-600">{reportError.message}</p>
                    )}
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" disabled={reportBusyId === c.id} onClick={() => generateReport(c)}>
                        {reportBusyId === c.id ? (
                          <><Loader2 className="size-3.5 animate-spin" /> Preparing...</>
                        ) : (
                          <><Download className="size-3.5" /> Generate report</>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
                {!c.revoked_at && (
                  confirmRevoke === c.id ? (
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <span className="text-xs text-slate-600">Revoke this consent? Records can no longer be shared under it.</span>
                      <Button size="sm" variant="outline" onClick={() => setConfirmRevoke(null)} disabled={busyId === c.id}>Keep</Button>
                      <Button size="sm" onClick={() => revoke(c.id)} disabled={busyId === c.id}>
                        {busyId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : 'Yes, revoke'}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => setConfirmRevoke(c.id)}>Revoke</Button>
                    </div>
                  )
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

export function ConsentsPanel({ child = null, onClose, onOpenChild }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {child ? `Consents - ${child.first_name} ${child.last_name}` : 'Pending consents'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {child
                ? 'Parent permission to share this child\'s records (FERPA / 34 CFR 303.414)'
                : 'Consent requests waiting on a parent signature. Select one to open that child.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {child ? (
          <ChildConsents child={child} />
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            <PendingList onOpenChild={onOpenChild} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
