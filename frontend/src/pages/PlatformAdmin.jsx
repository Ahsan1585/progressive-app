import { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, Plus, Ban, KeyRound, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLockup } from '@/components/BrandLockup';

// Same lockup as every other authenticated-app header (BrandLockup.jsx) —
// this page doesn't load marketing.css, but BrandLockup is inline-styled
// throughout so it doesn't need to.
function BrandHeader() {
  return (
    <div style={{ padding: '18px 24px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
      <BrandLockup size="sm" />
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Deliberately uses a bare axios instance, not the shared api client from
// axiosInstance.js — that client's response interceptor redirects to the
// tenant /login page on any 401, which would fire on every wrong-key
// attempt here and is the wrong failure mode for a page with no tenant
// session at all. Auth is a single shared secret (see requirePlatformAdminKey
// in platformAdminRoutes.js), not a JWT — not a real admin-user system yet,
// same "unpolished Phase-1" scope as the rest of that surface.
function platformApi(key) {
  return axios.create({
    baseURL: API_BASE,
    headers: { 'x-platform-admin-key': key },
  });
}

function KeyPrompt({ onUnlocked }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setChecking(true);
    setError('');
    try {
      await platformApi(key.trim()).get('/api/platform/promo-codes');
      sessionStorage.setItem('platformAdminKey', key.trim());
      onUnlocked(key.trim());
    } catch {
      setError('Incorrect key.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <BrandHeader />
      <div className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-lg p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-5 h-5 text-slate-600" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Platform Admin</h1>
        </div>
        <div className="space-y-2 mb-4">
          <Label htmlFor="platform-key">Admin key</Label>
          <Input id="platform-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        </div>
        {error && <p className="text-sm text-red-600 font-medium mb-3">{error}</p>}
        <Button type="submit" disabled={checking || !key.trim()} className="w-full h-11">
          {checking ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
          Unlock
        </Button>
      </form>
      </div>
    </div>
  );
}

const STATUS_STYLES = {
  trial: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-teal-50 text-teal-700 border-teal-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

// Local YYYY-MM-DD for an <input type="date">, defaulting to the company's
// current trial_ends_at (so opening the editor shows what's already set,
// not today) or otherwise today.
function toDateInputValue(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toISOString().slice(0, 10);
}

function TrialEndEditor({ company, client, onSaved }) {
  const [date, setDate] = useState(() => toDateInputValue(company.trial_ends_at));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Only a company already on a trial has a trial end date to adjust —
  // setting one on an active/suspended/cancelled company would silently
  // demote it back onto a trial clock, which is a different, more
  // consequential action than this control is meant for (see the matching
  // guard in setTrialEndDate, platformAdminController.js).
  if (company.status !== 'trial') {
    return <span className="text-xs text-slate-400">Not on a trial</span>;
  }

  const handleSave = async () => {
    if (!date) return;
    setIsSaving(true);
    setError('');
    try {
      // End of that day, not midnight UTC — a date picked as "today" should
      // still count as not-yet-expired for the rest of that day.
      const trialEndsAt = new Date(`${date}T23:59:59`).toISOString();
      await client.post(`/api/platform/companies/${company.slug}/trial-end`, { trialEndsAt });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-[150px] text-xs" />
      <Button type="button" size="sm" variant="outline" disabled={isSaving || !date} onClick={handleSave} className="h-8">
        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Set'}
      </Button>
      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}

function CompaniesTable({ apiKey }) {
  const client = platformApi(apiKey);
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState('');

  const fetchCompanies = () => {
    client.get('/api/platform/companies')
      .then(({ data }) => setCompanies(data.companies))
      .catch(() => setError('Failed to load companies.'));
  };

  useEffect(() => { fetchCompanies(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const daysLeft = (trialEndsAt) => {
    if (!trialEndsAt) return null;
    return Math.ceil((new Date(trialEndsAt) - new Date()) / (24 * 60 * 60 * 1000));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {error && <p className="p-6 text-sm text-red-600 font-medium">{error}</p>}
      {companies === null && !error && (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      )}
      {companies && companies.length === 0 && (
        <p className="p-6 text-sm text-slate-500">No companies yet.</p>
      )}
      {companies && companies.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Company</th>
              <th className="text-left px-4 py-3">Company code</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Trial ends</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-left px-4 py-3">Set trial end date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {companies.map((c) => {
              const left = c.status === 'trial' ? daysLeft(c.trial_ends_at) : null;
              return (
                <tr key={c.slug}>
                  <td className="px-4 py-3 font-semibold text-slate-800">{c.display_name}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{c.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[c.status] || STATUS_STYLES.cancelled}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.trial_ends_at
                      ? `${new Date(c.trial_ends_at).toLocaleDateString()}${left !== null ? (left >= 0 ? ` (${left}d left)` : ` (expired ${Math.abs(left)}d ago)`) : ''}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <TrialEndEditor company={c} client={client} onSaved={fetchCompanies} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PromoCodeManager({ apiKey }) {
  const client = platformApi(apiKey);
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState('');

  const [form, setForm] = useState({ code: '', daysExtension: '', maxRedemptions: '', expiresAt: '', note: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchCodes = () => {
    client.get('/api/platform/promo-codes')
      .then(({ data }) => setCodes(data.promoCodes))
      .catch(() => setError('Failed to load promo codes.'));
  };

  useEffect(() => { fetchCodes(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError('');
    try {
      await client.post('/api/platform/promo-codes', {
        code: form.code,
        daysExtension: Number(form.daysExtension),
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        expiresAt: form.expiresAt || null,
        note: form.note || null,
      });
      setForm({ code: '', daysExtension: '', maxRedemptions: '', expiresAt: '', note: '' });
      fetchCodes();
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Failed to create promo code.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeactivate = async (id) => {
    await client.post(`/api/platform/promo-codes/${id}/deactivate`);
    fetchCodes();
  };

  return (
    <div className="space-y-6">
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pc-code">Code</Label>
            <Input id="pc-code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="LAUNCH30" className="uppercase" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pc-days">Days to extend trial</Label>
            <Input id="pc-days" required type="number" min="1" value={form.daysExtension} onChange={(e) => setForm({ ...form, daysExtension: e.target.value })} placeholder="30" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pc-max">Max redemptions (blank = unlimited)</Label>
            <Input id="pc-max" type="number" min="1" value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pc-expires">Code expires on (blank = never)</Label>
            <Input id="pc-expires" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="pc-note">Note (internal only)</Label>
            <Input id="pc-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. outbound sales campaign, Aug 2026" />
          </div>
          {createError && <p className="md:col-span-2 text-sm text-red-600 font-medium">{createError}</p>}
          <div className="md:col-span-2">
            <Button type="submit" disabled={isCreating} className="h-11">
              {isCreating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
              Create promo code
            </Button>
          </div>
        </form>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {error && <p className="p-6 text-sm text-red-600 font-medium">{error}</p>}
          {codes === null && !error && (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          )}
          {codes && codes.length === 0 && (
            <p className="p-6 text-sm text-slate-500">No promo codes yet.</p>
          )}
          {codes && codes.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Days</th>
                  <th className="text-left px-4 py-3">Redemptions</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-left px-4 py-3">Note</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {codes.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800">{c.code}</td>
                    <td className="px-4 py-3 text-slate-600">{c.days_extension}</td>
                    <td className="px-4 py-3 text-slate-600">{c.redemption_count}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}</td>
                    <td className="px-4 py-3 text-slate-600">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.note || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${c.is_active ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.is_active && (
                        <Button type="button" variant="outline" size="sm" onClick={() => handleDeactivate(c.id)}>
                          <Ban className="w-3.5 h-3.5 mr-1" /> Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
    </div>
  );
}

const TABS = { companies: 'Companies', promoCodes: 'Promo Codes' };

export default function PlatformAdmin() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('platformAdminKey') || '');
  const [tab, setTab] = useState('companies');

  if (!apiKey) {
    return <KeyPrompt onUnlocked={setApiKey} />;
  }

  const handleLogout = () => {
    sessionStorage.removeItem('platformAdminKey');
    setApiKey('');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <BrandHeader />
      <div className="p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Platform Admin</h1>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {Object.entries(TABS).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-3.5 h-3.5 mr-1.5" /> Sign Out
            </Button>
          </div>
        </div>

        {tab === 'companies' ? <CompaniesTable apiKey={apiKey} /> : <PromoCodeManager apiKey={apiKey} />}
      </div>
      </div>
    </div>
  );
}
