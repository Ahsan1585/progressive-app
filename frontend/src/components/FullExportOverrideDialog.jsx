import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const REASONS = [
  { value: 'parent_request', label: 'Parent/guardian records request' },
  { value: 'internal_review', label: 'Internal review' },
  { value: 'audit', label: 'Audit or compliance review' },
  { value: 'legal', label: 'Legal request' },
];

// Error responses arrive as blobs because the request used responseType 'blob'.
export async function readBlobError(err) {
  const data = err?.response?.data;
  try {
    const text = data instanceof Blob ? await data.text() : null;
    return text ? JSON.parse(text) : (data && typeof data === 'object' ? data : {});
  } catch {
    return {};
  }
}

export function downloadPdfBlob(data, child) {
  const url = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `record-export-${(child.last_name || 'child').replace(/\s+/g, '_')}.pdf`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function FullExportOverrideDialog({ child, requiresMfaCode = false, onClose }) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setPassword('');
    setCode('');
    onClose();
  };

  const codeMissing = requiresMfaCode && code.length !== 6;

  const submit = async (e) => {
    e.preventDefault();
    if (!reason || !password || codeMissing || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = { password, reason };
      if (requiresMfaCode) payload.code = code;
      const response = await api.post(
        `/api/patients/${child.id}/record-export/override`,
        payload,
        { responseType: 'blob' }
      );
      downloadPdfBlob(response.data, child);
      setPassword('');
      setCode('');
      onClose();
    } catch (err) {
      const body = await readBlobError(err);
      setError(body.error || 'Failed to export this child\'s record.');
      setPassword('');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="staff-type fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[22px] font-extrabold tracking-tight leading-tight text-slate-900">Export full record without parent consent</h3>
            <p className="text-[14px] text-slate-600 mt-0.5">{child.first_name} {child.last_name}</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 cursor-pointer">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-[16px] text-slate-600">
            No parent consent covers a full record export for this child. As an admin you can continue by confirming your password and giving a reason. This is recorded in the audit log.
          </p>
          <div>
            <label htmlFor="full-export-reason" className="block text-[14px] font-medium text-slate-700 mb-1">Reason</label>
            <select
              id="full-export-reason"
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              required
              className="w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-[16px] text-slate-800"
            >
              <option value="">Select a reason</option>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="full-export-password" className="block text-[14px] font-medium text-slate-700 mb-1">Your password</label>
            <Input
              id="full-export-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
            />
          </div>
          {requiresMfaCode && (
            <div>
              <label htmlFor="full-export-code" className="block text-[14px] font-medium text-slate-700 mb-1">Authenticator code</label>
              <Input
                id="full-export-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
              <p className="text-[14px] text-slate-600 mt-1">From your authenticator app</p>
            </div>
          )}
          {error && <p role="alert" className="text-[16px] text-red-600">{error}</p>}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !reason || !password || codeMissing}>
            {busy && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
            Export
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}
