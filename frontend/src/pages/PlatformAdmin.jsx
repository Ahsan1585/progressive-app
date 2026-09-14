import { useEffect, useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Loader2, Plus, Ban, LogOut, ChevronDown, ChevronRight, LogIn, ShieldAlert } from 'lucide-react';
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
const PLATFORM_ADMIN_TOKEN_KEY = 'platformAdminToken';

// Deliberately a bare axios instance, not the shared `api` client from
// axiosInstance.js — that client's response interceptor clears the TENANT
// session (localStorage 'token'/'role') and redirects to /login on any 401,
// which is the wrong failure mode here and would also nuke a concurrent
// tenant session (e.g. right after exiting an impersonation session) in the
// same browser. This instance's own 401 handling only ever touches
// `platformAdminToken` — the two auth domains stay fully decoupled.
function platformApi() {
  const instance = axios.create({ baseURL: API_BASE });
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem(PLATFORM_ADMIN_TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  return instance;
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setIsSubmitting(true);
    setError('');
    try {
      const { data } = await platformApi().post('/api/platform/auth/login', { email: email.trim(), password });
      localStorage.setItem(PLATFORM_ADMIN_TOKEN_KEY, data.token);
      onLoggedIn();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <BrandHeader />
      <div className="flex flex-1 items-center justify-center p-4">
        <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-lg p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-5 h-5 text-slate-600" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Platform Admin</h1>
          </div>
          <div className="space-y-2 mb-3">
            <Label htmlFor="pa-email">Email</Label>
            <Input id="pa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" />
          </div>
          <div className="space-y-2 mb-4">
            <Label htmlFor="pa-password">Password</Label>
            <Input id="pa-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-red-600 font-medium mb-3">{error}</p>}
          <Button type="submit" disabled={isSubmitting || !email.trim() || !password} className="w-full h-11">
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Log In
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

// Per-company subscription pricing (what this tenant pays Izaya). Reads
// from / writes to the tenant's own company_settings via the platform-admin
// cross-DB endpoints. A change only affects the current and future billing
// periods — closed invoices keep the rate they were generated with.
function PricingEditor({ slug, client }) {
  const [pricing, setPricing] = useState(null);
  const [form, setForm] = useState({ pricePerPractitioner: '', includedStaffSeats: '', extraStaffSeatPrice: '' });
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    client.get(`/api/platform/companies/${slug}/pricing`)
      .then(({ data }) => {
        setPricing(data.pricing);
        setForm({
          pricePerPractitioner: String(data.pricing.pricePerPractitioner),
          includedStaffSeats: String(data.pricing.includedStaffSeats),
          extraStaffSeatPrice: String(data.pricing.extraStaffSeatPrice),
        });
      })
      .catch((err) => setLoadError(err.response?.data?.error || 'Failed to load pricing.'));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError('');
    try {
      const { data } = await client.post(`/api/platform/companies/${slug}/pricing`, {
        pricePerPractitioner: Number(form.pricePerPractitioner),
        includedStaffSeats: Number(form.includedStaffSeats),
        extraStaffSeatPrice: Number(form.extraStaffSeatPrice),
      });
      setPricing(data.pricing);
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  };

  if (loadError) return <p className="text-sm text-red-600 font-medium">{loadError}</p>;
  if (!pricing) return <div className="flex py-3"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`pp-${slug}`}>$ / active practitioner / mo</Label>
          <Input id={`pp-${slug}`} type="number" min="0" step="0.01" value={form.pricePerPractitioner}
            onChange={(e) => setForm({ ...form, pricePerPractitioner: e.target.value })} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`is-${slug}`}>Included office-staff seats</Label>
          <Input id={`is-${slug}`} type="number" min="0" step="1" value={form.includedStaffSeats}
            onChange={(e) => setForm({ ...form, includedStaffSeats: e.target.value })} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`es-${slug}`}>$ / extra office-staff seat / mo</Label>
          <Input id={`es-${slug}`} type="number" min="0" step="0.01" value={form.extraStaffSeatPrice}
            onChange={(e) => setForm({ ...form, extraStaffSeatPrice: e.target.value })} className="h-9" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={isSaving} onClick={handleSave} className="h-8">
          {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
          Save pricing
        </Button>
        {savedAt && !saveError && <span className="text-xs font-semibold text-teal-700">Saved — applies to the current and future periods.</span>}
        {saveError && <span className="text-xs font-medium text-red-600">{saveError}</span>}
      </div>
    </div>
  );
}

// New-company creation. Deliberately does NOT pre-accept the BAA — the
// customer's own admin must accept it themselves on first login. Until
// they do, "Enter" (below) refuses with BAA_NOT_ACCEPTED.
function NewCompanyForm({ client, onCreated }) {
  const empty = { displayName: '', legalEntityName: '', address: '', phone: '', email: '', slug: '', adminFirstName: '', adminLastName: '', adminEmail: '' };
  const [form, setForm] = useState(empty);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await client.post('/api/platform/companies', {
        ...form,
        slug: form.slug.trim().toLowerCase(),
      });
      setSuccess(data.message || `Company "${data.slug}" created.`);
      setForm(empty);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create company.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-3">Company</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="nc-display">Display name</Label>
            <Input id="nc-display" required value={form.displayName} onChange={set('displayName')} placeholder="Progressive Steps" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-slug">Company code (slug)</Label>
            <Input id="nc-slug" required value={form.slug} onChange={set('slug')} placeholder="progressive-steps" className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-legal">Legal entity name</Label>
            <Input id="nc-legal" value={form.legalEntityName} onChange={set('legalEntityName')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-email">Company contact email</Label>
            <Input id="nc-email" type="email" required value={form.email} onChange={set('email')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-address">Address</Label>
            <Input id="nc-address" value={form.address} onChange={set('address')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-phone">Phone</Label>
            <Input id="nc-phone" value={form.phone} onChange={set('phone')} />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-3">Customer's admin</h2>
        <p className="text-xs text-slate-500 mb-3">
          They'll receive an activation email to set their own password, and must accept the BAA themselves on first login — Izaya Support cannot enter this company until they do.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="nc-afn">First name</Label>
            <Input id="nc-afn" required value={form.adminFirstName} onChange={set('adminFirstName')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-aln">Last name</Label>
            <Input id="nc-aln" required value={form.adminLastName} onChange={set('adminLastName')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-aem">Email</Label>
            <Input id="nc-aem" type="email" required value={form.adminEmail} onChange={set('adminEmail')} />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      {success && <p className="text-sm text-teal-700 font-medium">{success}</p>}
      <Button type="submit" disabled={isSubmitting} className="h-11">
        {isSubmitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
        Create company
      </Button>
    </form>
  );
}

function CompaniesTable({ client }) {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState('');
  const [expandedSlug, setExpandedSlug] = useState(null);
  const [rowState, setRowState] = useState({}); // { [slug]: { entering, backfilling, error, notice } }

  const fetchCompanies = () => {
    client.get('/api/platform/companies')
      .then(({ data }) => setCompanies(data.companies))
      .catch(() => setError('Failed to load companies.'));
  };

  useEffect(() => { fetchCompanies(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (slug, patch) => setRowState((prev) => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));

  const daysLeft = (trialEndsAt) => {
    if (!trialEndsAt) return null;
    return Math.ceil((new Date(trialEndsAt) - new Date()) / (24 * 60 * 60 * 1000));
  };

  const handleEnter = async (slug) => {
    setRow(slug, { entering: true, error: '', notice: '' });
    try {
      const { data } = await client.post(`/api/platform/companies/${slug}/impersonate`);
      // Tenant session keys — deliberately the SAME keys Login.jsx sets, so
      // every existing tenant-session mechanism (ProtectedRoute, the
      // MessagingProvider socket, etc.) treats this exactly like a normal
      // login. platformAdminToken is untouched — that session stays alive.
      localStorage.setItem('token', data.token);
      localStorage.setItem('role', 'ceo');
      localStorage.setItem('companySlug', data.slug);
      window.dispatchEvent(new Event('auth-changed'));
      navigate('/admin-dashboard');
    } catch (err) {
      const code = err.response?.data?.code;
      const message = code === 'BAA_NOT_ACCEPTED'
        ? "Awaiting BAA acceptance from the customer's admin — cannot enter yet."
        : code === 'NO_SUPPORT_ACCOUNT'
          ? 'No Izaya Support account for this company yet — use Backfill first.'
          : (err.response?.data?.error || 'Failed to enter company.');
      setRow(slug, { error: message });
    } finally {
      setRow(slug, { entering: false });
    }
  };

  const handleBackfill = async (slug) => {
    setRow(slug, { backfilling: true, error: '', notice: '' });
    try {
      const { data } = await client.post(`/api/platform/companies/${slug}/ensure-support-account`);
      setRow(slug, { notice: data.created ? 'Support account created.' : 'Already had a support account.' });
    } catch (err) {
      setRow(slug, { error: err.response?.data?.error || 'Failed to backfill support account.' });
    } finally {
      setRow(slug, { backfilling: false });
    }
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="text-left px-4 py-3">Company</th>
              <th className="text-left px-4 py-3">Company code</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Trial ends</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-left px-4 py-3">Set trial end date</th>
              <th className="text-left px-4 py-3 whitespace-nowrap">Remote support</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {companies.map((c) => {
              const left = c.status === 'trial' ? daysLeft(c.trial_ends_at) : null;
              const expanded = expandedSlug === c.slug;
              const rs = rowState[c.slug] || {};
              return (
                <Fragment key={c.slug}>
                <tr className={expanded ? 'bg-slate-50/60' : ''}>
                  <td className="px-2 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setExpandedSlug(expanded ? null : c.slug)}
                      aria-label={expanded ? 'Hide pricing' : 'Edit pricing'}
                      title="Subscription pricing"
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </td>
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
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Button type="button" size="sm" variant="outline" disabled={rs.entering} onClick={() => handleEnter(c.slug)} className="h-8">
                          {rs.entering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5 mr-1" />}
                          Enter
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={rs.backfilling} onClick={() => handleBackfill(c.slug)} className="h-8 text-xs">
                          {rs.backfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Backfill support acct'}
                        </Button>
                      </div>
                      {rs.error && <p className="text-xs font-medium text-red-600 max-w-[220px]">{rs.error}</p>}
                      {rs.notice && <p className="text-xs font-medium text-teal-700">{rs.notice}</p>}
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-slate-50/60">
                    <td />
                    <td colSpan={7} className="px-4 pb-4 pt-1">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Subscription pricing</div>
                      <PricingEditor slug={c.slug} client={client} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function PromoCodeManager({ client }) {
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

const TABS = { companies: 'Companies', newCompany: 'New Company', promoCodes: 'Promo Codes' };

export default function PlatformAdmin() {
  const [loggedIn, setLoggedIn] = useState(() => !!localStorage.getItem(PLATFORM_ADMIN_TOKEN_KEY));
  const [tab, setTab] = useState('companies');
  const [refreshKey, setRefreshKey] = useState(0);

  if (!loggedIn) {
    return <LoginScreen onLoggedIn={() => setLoggedIn(true)} />;
  }

  const client = platformApi();
  // A wrong/expired token surfaces as a normal per-request error message
  // rather than a global redirect (see platformApi's comment) — but a 401
  // here specifically means the session is dead, so drop back to the login
  // screen instead of leaving a broken dashboard up.
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        localStorage.removeItem(PLATFORM_ADMIN_TOKEN_KEY);
        setLoggedIn(false);
      }
      return Promise.reject(error);
    }
  );

  const handleLogout = () => {
    localStorage.removeItem(PLATFORM_ADMIN_TOKEN_KEY);
    setLoggedIn(false);
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
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors cursor-pointer ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
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

        {tab === 'companies' && <CompaniesTable key={refreshKey} client={client} />}
        {tab === 'newCompany' && (
          <NewCompanyForm client={client} onCreated={() => { setTab('companies'); setRefreshKey((k) => k + 1); }} />
        )}
        {tab === 'promoCodes' && <PromoCodeManager client={client} />}
      </div>
      </div>
    </div>
  );
}
