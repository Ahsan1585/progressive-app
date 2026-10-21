import React, { useState } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '');

// Part C (34 CFR 303.404/303.406) Confidentiality Official fields + a
// print-friendly roster of everyone with access. Form state lives in the
// parent (CompanySettings) so the existing Save button persists it.
export const ConfidentialitySection = ({ form, setField }) => {
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const hasOfficial = !!form.confidentiality_official_name?.trim();

  const loadRoster = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/company/access-roster');
      setRoster(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the access roster.');
    } finally {
      setLoading(false);
    }
  };

  const printRoster = () => {
    if (!roster) return;
    const rows = roster.staff.map((s) => `<tr><td>${escapeHtml(`${s.first_name || ''} ${s.last_name || ''}`.trim())}</td><td>${escapeHtml(s.position_title)}</td><td>${escapeHtml(s.role_name)}</td><td>${escapeHtml(fmtDate(s.date_added))}</td></tr>`).join('');
    const o = roster.official;
    const officialHtml = o
      ? `${escapeHtml(o.name)}${o.title ? `, ${escapeHtml(o.title)}` : ''}${o.email ? ` &middot; ${escapeHtml(o.email)}` : ''}${o.phone ? ` &middot; ${escapeHtml(o.phone)}` : ''}`
      : 'Not designated';
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Access Roster</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:6px 10px;text-align:left;font-size:13px}th{background:#f1f5f9}</style></head><body><h1 style="font-size:18px">Access Roster</h1><p style="font-size:13px"><strong>Confidentiality Official:</strong> ${officialHtml}</p><p style="font-size:12px;color:#475569">Active staff with access to child records. Generated ${escapeHtml(new Date().toLocaleString())}.</p><table><thead><tr><th>Name</th><th>Position</th><th>Role</th><th>Date added</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="space-y-4 border-t border-slate-100 pt-6">
      <h2 className="text-base font-bold text-slate-800">Confidentiality</h2>
      {!hasOfficial && (
        <div role="alert" className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-xs font-semibold text-amber-800">
          Part C requires a designated Confidentiality Official. Enter one below and save.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label>Official Name</Label>
          <Input value={form.confidentiality_official_name} onChange={(e) => setField('confidentiality_official_name', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={form.confidentiality_official_title} onChange={(e) => setField('confidentiality_official_title', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" value={form.confidentiality_official_email} onChange={(e) => setField('confidentiality_official_email', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input type="tel" value={form.confidentiality_official_phone} onChange={(e) => setField('confidentiality_official_phone', e.target.value)} />
        </div>
      </div>

      <div>
        <Button type="button" variant="outline" onClick={loadRoster} className="cursor-pointer">
          {open ? 'Refresh access roster' : 'View access roster'}
        </Button>
      </div>

      {open && (
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {roster && !loading && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">
                  <span className="font-semibold">Confidentiality Official:</span>{' '}
                  {roster.official ? `${roster.official.name}${roster.official.title ? `, ${roster.official.title}` : ''}` : 'Not designated'}
                </p>
                <Button type="button" size="sm" variant="outline" onClick={printRoster} className="cursor-pointer">Print</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Position</th>
                      <th className="py-2 pr-4">Role</th>
                      <th className="py-2">Date added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.staff.map((s, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2 pr-4">{`${s.first_name || ''} ${s.last_name || ''}`.trim()}</td>
                        <td className="py-2 pr-4">{s.position_title}</td>
                        <td className="py-2 pr-4">{s.role_name}</td>
                        <td className="py-2">{fmtDate(s.date_added)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
