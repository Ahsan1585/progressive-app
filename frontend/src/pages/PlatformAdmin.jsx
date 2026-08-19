import { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, Plus, Ban, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
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
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <h1 className="text-xl font-bold text-slate-900">Promo Codes</h1>

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
    </div>
  );
}

export default function PlatformAdmin() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('platformAdminKey') || '');

  if (!apiKey) {
    return <KeyPrompt onUnlocked={setApiKey} />;
  }

  return <PromoCodeManager apiKey={apiKey} />;
}
