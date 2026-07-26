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
  const [complianceDoc, setComplianceDoc] = useState(null); // { filename, size, uploaded_at } | null
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingComplianceDoc, setIsUploadingComplianceDoc] = useState(false);
  const [isRemovingComplianceDoc, setIsRemovingComplianceDoc] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }

  const applySettings = (settings) => {
    if (!settings) return;
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
    setComplianceDoc(settings.compliance_doc_filename ? {
      filename: settings.compliance_doc_filename,
      size: settings.compliance_doc_size,
      uploaded_at: settings.compliance_doc_uploaded_at,
    } : null);
  };

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/company');
      applySettings(response.data.settings);
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

  const handleComplianceDocSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setToast({ type: 'error', message: 'Please select an Excel file (.xlsx or .xls).' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setToast({ type: 'error', message: 'File is too large — please use a file under 5MB.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setIsUploadingComplianceDoc(true);
      setToast(null);
      try {
        const response = await api.put('/api/company/compliance-doc', { filename: file.name, fileBase64: dataUrl });
        applySettings(response.data.settings);
        setToast({ type: 'success', message: 'State compliance document attached.' });
      } catch (error) {
        setToast({ type: 'error', message: error.response?.data?.error || 'Failed to upload document.' });
      } finally {
        setIsUploadingComplianceDoc(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleComplianceDocRemove = async () => {
    setIsRemovingComplianceDoc(true);
    setToast(null);
    try {
      const response = await api.delete('/api/company/compliance-doc');
      applySettings(response.data.settings);
      setToast({ type: 'success', message: 'Compliance document removed.' });
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to remove document.' });
    } finally {
      setIsRemovingComplianceDoc(false);
    }
  };

  const handleComplianceDocDownload = async () => {
    try {
      const response = await api.get('/api/company/compliance-doc/download');
      window.open(response.data.url, '_blank', 'noopener');
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to open document.' });
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-800">State Compliance Reference</h2>
          <p className="text-sm text-slate-500 mt-1">
            Attach the state's required-documentation Excel file. Billing & Invoices uses this on file to run Compliance Analysis against practitioner-logged sessions in the Batch Review beta.
          </p>
        </div>

        {complianceDoc ? (
          <div className="flex items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{complianceDoc.filename}</p>
                <p className="text-xs text-slate-500">
                  {formatFileSize(complianceDoc.size)}
                  {complianceDoc.uploaded_at && ` · Uploaded ${new Date(complianceDoc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button onClick={handleComplianceDocDownload} variant="outline" size="sm" className="cursor-pointer border-slate-300 bg-white text-slate-700 font-semibold">
                Download
              </Button>
              <label className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-2 rounded-lg cursor-pointer hover:bg-teal-100 transition-colors">
                {isUploadingComplianceDoc ? 'Uploading...' : 'Replace'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleComplianceDocSelect} disabled={isUploadingComplianceDoc} />
              </label>
              <Button onClick={handleComplianceDocRemove} disabled={isRemovingComplianceDoc} variant="outline" size="sm" className="cursor-pointer border-red-200 bg-white text-red-600 font-semibold hover:bg-red-50">
                {isRemovingComplianceDoc ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl px-4 py-8 cursor-pointer hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
            <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <span className="text-sm font-semibold text-teal-700">{isUploadingComplianceDoc ? 'Uploading...' : 'Click to attach an Excel file'}</span>
            <span className="text-xs text-slate-400">.xlsx or .xls, up to 5MB</span>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleComplianceDocSelect} disabled={isUploadingComplianceDoc} />
          </label>
        )}
      </div>
    </div>
  );
};
