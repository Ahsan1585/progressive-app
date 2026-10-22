import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { showAlert } from '@/utils/dialogStore';

// Agency-wide register of every records consent: who may receive what, whether
// it is in force, whether records have gone out, and how it ended. Clicking a
// row opens that child's consents (to send records or request a renewal).
const TYPE_LABEL = { session_logs: 'Session logs', sevf_forms: 'SEVF forms', invoices: 'Invoices', full_record_export: 'Full record' };

const STATUS = {
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expiring: { label: 'Expiring soon', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  expired: { label: 'Expired', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  revoked: { label: 'Revoked', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'awaiting', label: 'Awaiting send', test: (c) => c.awaitingSend },
  { key: 'expiring', label: 'Expiring soon', test: (c) => c.status === 'expiring' },
  { key: 'active', label: 'Active', test: (c) => c.status === 'active' || c.status === 'expiring' },
  { key: 'ended', label: 'Expired or revoked', test: (c) => c.status === 'expired' || c.status === 'revoked' },
];

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const typesText = (arr) => (arr || []).map((t) => TYPE_LABEL[t] || t).join(', ');
const badgeCls = 'text-[14px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap';

const csvCell = (v) => {
  let s = String(v ?? '');
  // Neutralize spreadsheet formulas in free text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

function downloadCsv(rows) {
  const header = ['Child', 'Child ID', 'Recipient', 'Recipient email', 'Purpose', 'Records', 'Source', 'Signed', 'Expires', 'Status', 'Ended by', 'Records sent', 'Downloads'];
  const lines = [header, ...rows.map((c) => [
    c.patientName, c.childId, c.recipientName, c.recipientEmail, c.purpose, typesText(c.recordTypes),
    c.source === 'electronic' ? 'Electronic' : c.source === 'paper' ? 'Paper' : 'Earlier entry',
    fmtDate(c.signedOn), fmtDate(c.expiresAt), (STATUS[c.status] || {}).label,
    c.revokedBy === 'parent' ? 'Parent' : c.revokedBy === 'staff' ? 'Staff' : '',
    c.sentCount > 0 ? `${c.sentCount} (last ${fmtDate(c.lastSentAt)})` : 'Not sent', c.downloads,
  ])];
  const blob = new Blob([lines.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `consent-register-${new Date().toLocaleDateString('en-CA')}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function ConsentRegister({ onClose, onOpenChild }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.get('/api/consent-register')
      .then((res) => setRows(res.data.consents || []))
      .catch(() => showAlert('Failed to load the consent register.'))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)?.test || (() => true);
    const q = query.trim().toLowerCase();
    return rows.filter((c) => test(c) && (!q
      || `${c.patientName} ${c.childId} ${c.recipientName} ${c.recipientEmail} ${c.purpose}`.toLowerCase().includes(q)));
  }, [rows, filter, query]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])), [rows]);

  return createPortal(
    <div className="staff-type fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[22px] font-extrabold tracking-tight leading-tight text-slate-900">Consent register</h3>
            <p className="text-[14px] text-slate-600 mt-0.5">Every records-sharing consent on file. Select a row to open that child.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={() => downloadCsv(shown)}>
              <Download className="size-3.5" /> Export CSV
            </Button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 cursor-pointer" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-[14px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer ${filter === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {f.label} ({counts[f.key] ?? 0})
            </button>
          ))}
          <div className="ml-auto w-full sm:w-64">
            <Input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search child, recipient, purpose" aria-label="Search consents" />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="text-center text-[16px] text-slate-500 py-10">Loading...</div>
          ) : shown.length === 0 ? (
            <div className="text-center text-[16px] text-slate-500 py-10">{rows.length === 0 ? 'No consents on file yet.' : 'No consents match.'}</div>
          ) : (
            <table className="w-full text-[16px]">
              <thead className="sticky top-0 bg-slate-50 text-left text-[14px] font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-2">Child</th>
                  <th className="px-4 py-2">Shared with</th>
                  <th className="px-4 py-2">Records</th>
                  <th className="px-4 py-2">Signed</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((c) => {
                  const st = STATUS[c.status] || STATUS.active;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpenChild(c.patientId)}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {c.patientName}
                        <div className="text-[14px] font-normal text-slate-600 font-mono">{c.childId}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {c.recipientName}
                        <div className="text-[14px] text-slate-600">{c.recipientEmail || 'No email on file'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {typesText(c.recordTypes)}
                        <div className="text-[14px] text-slate-500">{c.source === 'electronic' ? 'Electronic' : c.source === 'paper' ? `Paper${c.hasScan ? ', scan on file' : ''}` : 'Earlier entry'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(c.signedOn)}</td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(c.expiresAt)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`${badgeCls} ${st.cls}`}>{st.label}</span>
                        {c.status === 'revoked' && c.revokedBy && (
                          <div className="text-[14px] text-slate-600 mt-1">by {c.revokedBy === 'parent' ? 'the parent' : 'staff'}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {c.awaitingSend ? (
                          <span className={`${badgeCls} bg-amber-100 text-amber-900 border-amber-400`}>Not sent</span>
                        ) : c.sentCount > 0 ? (
                          <span className="text-[14px] text-slate-600">
                            {c.sentCount}x, last {fmtDate(c.lastSentAt)}
                            {c.downloads > 0 ? `, ${c.downloads} download${c.downloads === 1 ? '' : 's'}` : ''}
                          </span>
                        ) : (
                          <span className="text-[14px] text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
