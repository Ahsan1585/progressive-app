import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const STATE_OPTIONS = ['New Jersey', 'New York', 'Pennsylvania', 'Connecticut'];
const TIMEZONE_OPTIONS = ['Eastern (ET)', 'Central (CT)', 'Mountain (MT)', 'Pacific (PT)'];

const EMPTY_FORM = {
  display_name: '',
  legal_entity_name: '',
  state: '',
  timezone: '',
  address: '',
  phone: '',
  billing_email: '',
};

// Admin-only ('ceo', labeled "Admin" in this app) settings for the single
// organization this app serves — not multi-tenant, so there's exactly one
// row (company_settings.id = 1). onSettingsChange lets AdminDashboard keep
// the sidebar's logo/name in sync without a second fetch.
export const CompanySettings = ({ onSettingsChange }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [logo, setLogo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/company');
      const settings = response.data.settings;
      if (settings) {
        setForm({
          display_name: settings.display_name || '',
          legal_entity_name: settings.legal_entity_name || '',
          state: settings.state || '',
          timezone: settings.timezone || '',
          address: settings.address || '',
          phone: settings.phone || '',
          billing_email: settings.billing_email || '',
        });
        setLogo(settings.logo || null);
      }
    } catch (error) {
      console.error('Failed to fetch company settings', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchSettings(); }, []);

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setIsSaving(true);
    setToast(null);
    try {
      const response = await api.put('/api/company', form);
      onSettingsChange?.(response.data.settings);
      setToast({ type: 'success', message: 'Company information saved.' });
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to save. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setIsUploadingLogo(true);
      setToast(null);
      try {
        const response = await api.put('/api/company/logo', { logo: dataUrl });
        setLogo(response.data.settings.logo);
        onSettingsChange?.(response.data.settings);
        setToast({ type: 'success', message: 'Logo updated.' });
      } catch (error) {
        setToast({ type: 'error', message: error.response?.data?.error || 'Failed to upload logo.' });
      } finally {
        setIsUploadingLogo(false);
      }
    };
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return <div className="py-20 text-center text-slate-500">Loading company information...</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Company Information</h1>
        <p className="text-sm text-slate-500 mt-1">
          This is the one place your practice details live. Update it here and it flows everywhere else — the dashboard header, generated forms, and every new practitioner you add in Staff Directory.
        </p>
      </div>

      {toast && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
          toast.type === 'success'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7 space-y-6">
        <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
          {logo ? (
            <img src={logo} alt="Company logo" className="w-16 h-16 rounded-2xl object-cover flex-shrink-0 border border-slate-200" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-600 to-sky-600 flex items-center justify-center flex-shrink-0 text-white text-xl font-bold">
              {(form.display_name || 'PS').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg cursor-pointer w-fit hover:bg-teal-100 transition-colors">
              {isUploadingLogo ? 'Uploading...' : 'Upload logo'}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} disabled={isUploadingLogo} />
            </label>
            <p className="text-xs text-slate-400">PNG or SVG, shown in your dashboard header and on generated PDFs</p>
          </div>
        </div>

        <h2 className="text-base font-bold text-slate-800">Practice Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2 space-y-2">
            <Label>Practice / Display Name</Label>
            <Input value={form.display_name} onChange={(e) => setField('display_name', e.target.value)} />
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Legal Entity Name <span className="text-slate-400 font-normal">(shown on invoices &amp; state forms)</span></Label>
            <Input value={form.legal_entity_name} onChange={(e) => setField('legal_entity_name', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>State</Label>
            <Select value={form.state} onValueChange={(v) => setField('state', v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {STATE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Time Zone</Label>
            <Select value={form.timezone} onValueChange={(v) => setField('timezone', v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select time zone" /></SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Practice Address</Label>
            <Input value={form.address} onChange={(e) => setField('address', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input type="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Billing / Support Email</Label>
            <Input type="email" value={form.billing_email} onChange={(e) => setField('billing_email', e.target.value)} />
          </div>
        </div>

        <div className="flex items-start gap-2.5 bg-sky-50 border border-sky-200 rounded-xl px-3.5 py-3 text-xs font-semibold text-sky-700">
          <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
          Your State determines which compliance form and billing codes are used when generating forms — currently New Jersey (NJEIS). This is locked to prevent mid-cycle billing mismatches; contact support to change it.
        </div>

        <div className="flex justify-end pt-1">
          <Button onClick={handleSave} disabled={isSaving} className="bg-slate-800 hover:bg-slate-900 text-white cursor-pointer">
            {isSaving ? 'Saving...' : 'Save Company Information'}
          </Button>
        </div>
      </div>
    </div>
  );
};
