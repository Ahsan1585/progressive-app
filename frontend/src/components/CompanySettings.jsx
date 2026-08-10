import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { showAlert, showConfirm } from '@/utils/dialogStore';
import { DropdownOptionsManager } from '@/components/DropdownOptionsManager';

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
  const [activeTab, setActiveTab] = useState('info'); // 'info' | 'compliance' | 'dropdowns'
  const [form, setForm] = useState(EMPTY_FORM);
  const [logo, setLogo] = useState(null);
  const [complianceDoc, setComplianceDoc] = useState(null); // { filename, size, uploaded_at, hasMapping } | null
  const [complianceAnalysis, setComplianceAnalysis] = useState(null); // { generatedAt, months: [{month, recordCount, earliestDate, latestDate}] } | null
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingComplianceDoc, setIsUploadingComplianceDoc] = useState(false);
  const [isRemovingComplianceDoc, setIsRemovingComplianceDoc] = useState(false);
  const [isRefreshingAnalysis, setIsRefreshingAnalysis] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }

  // Column-mapping screen: shown right after an upload (or reopened via
  // "Review column mapping") so the user confirms which Excel header feeds
  // each field before we parse the whole file into compliance_state_logs.
  const [mappingInfo, setMappingInfo] = useState(null); // { headers, targetFields, suggestedMapping, previousMapping } | null
  const [mapping, setMapping] = useState({});
  const [removedFields, setRemovedFields] = useState(new Set());
  const [customFields, setCustomFields] = useState([]); // [{ label, header }] — state-only extra fields beyond the fixed 11
  const [customCategories, setCustomCategories] = useState([]); // active company-defined dropdown categories, for the compareTo picker
  const [isLoadingMapping, setIsLoadingMapping] = useState(false);
  const [isApplyingMapping, setIsApplyingMapping] = useState(false);

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
      // Only "confirmed" once THIS exact uploaded file has had its mapping
      // applied — a replacement file keeps the old mapping around to prefill
      // the review screen, but isn't actually feeding Compliance Analysis
      // until Confirm & Run Analysis is clicked again for it.
      hasMapping: !!settings.compliance_doc_column_mapping
        && !!settings.compliance_doc_applied_path
        && settings.compliance_doc_applied_path === settings.compliance_doc_path,
    } : null);
    // Frozen snapshot from the last successful upload+apply — see the
    // compliance_doc_analysis column comment in schema.sql for why this
    // doesn't live-update between uploads.
    setComplianceAnalysis(settings.compliance_doc_analysis || null);
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

  // Fetched independently of the main dropdowns manager (which only mounts
  // once its own tab is active) — this component needs the list any time
  // the compliance-mapping screen is open, regardless of which tab that is.
  useEffect(() => {
    api.get('/api/dropdown-options/categories')
      .then((res) => setCustomCategories((res.data.categories || []).filter((c) => c.is_custom && c.is_active)))
      .catch(() => setCustomCategories([]));
  }, []);

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
    if (file.size > 10 * 1024 * 1024) {
      setToast({ type: 'error', message: 'File is too large — please use a file under 10MB.' });
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
        openMappingScreen(response.data);
        setToast({ type: 'success', message: 'File uploaded — review the column matching below before it’s used in Compliance Analysis.' });
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
      setMappingInfo(null);
      setShowRemoveConfirm(false);
      setToast({ type: 'success', message: 'Compliance document removed — all state compliance data has been cleared.' });
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to remove document.' });
    } finally {
      setIsRemovingComplianceDoc(false);
    }
  };

  // Pre-fills each target field with: this upload's auto-detected header,
  // else the header that was confirmed last time, else blank — so an
  // unchanged file needs zero edits and a changed one only highlights what moved.
  const openMappingScreen = (data) => {
    setMappingInfo(data);
    const initial = {};
    for (const field of data.targetFields) {
      initial[field.key] = data.suggestedMapping[field.key] || data.previousMapping?.[field.key] || '';
    }
    setMapping(initial);
    setRemovedFields(new Set(data.removedFields || []));
    setCustomFields((data.previousCustomFields || []).map((cf) => ({ ...cf })));
  };

  const handleRemoveField = async (field) => {
    if (field.required) {
      showAlert(`${field.label} is required for Compliance Analysis and can't be removed.`);
      return;
    }
    if (!(await showConfirm(`Remove "${field.label}" from column matching? It won't be compared in Compliance Analysis, and stays removed until you add it back (e.g. as a custom field).`))) {
      return;
    }
    setRemovedFields((prev) => new Set(prev).add(field.key));
    setMapping((prev) => ({ ...prev, [field.key]: '' }));
  };

  const handleAddCustomField = () => {
    setCustomFields((prev) => [...prev, { label: '', header: '', compareTo: '' }]);
  };

  const handleCustomFieldChange = (index, key, value) => {
    setCustomFields((prev) => prev.map((cf, i) => (i === index ? { ...cf, [key]: value } : cf)));
  };

  const handleRemoveCustomField = (index) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleReviewMapping = async () => {
    setIsLoadingMapping(true);
    setToast(null);
    try {
      const response = await api.get('/api/company/compliance-doc/mapping');
      openMappingScreen(response.data);
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to read the document.' });
    } finally {
      setIsLoadingMapping(false);
    }
  };

  const handleApplyMapping = async () => {
    const incompleteCustom = customFields.some((cf) => (cf.label && !cf.header) || (!cf.label && cf.header));
    if (incompleteCustom) {
      setToast({ type: 'error', message: 'Every custom field needs both a name and a column — remove any unfinished ones before confirming.' });
      return;
    }
    setIsApplyingMapping(true);
    setToast(null);
    try {
      const cleanCustomFields = customFields.filter((cf) => cf.label && cf.header);
      const response = await api.post('/api/company/compliance-doc/apply-mapping', { mapping, customFields: cleanCustomFields, removedFields: [...removedFields] });
      const { rowsParsed, matchedPatients, unmatchedCount } = response.data;
      setToast({
        type: 'success',
        message: `Compliance data updated: ${rowsParsed} state row${rowsParsed === 1 ? '' : 's'} parsed, ${matchedPatients} matched to a patient in our system${unmatchedCount > 0 ? `, ${unmatchedCount} unmatched (Child ID not found)` : ''}.`,
      });
      setMappingInfo(null);
      fetchSettings();
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to apply column mapping.' });
    } finally {
      setIsApplyingMapping(false);
    }
  };

  const handleRefreshAnalysis = async () => {
    setIsRefreshingAnalysis(true);
    setToast(null);
    try {
      const response = await api.post('/api/company/compliance-doc/refresh-analysis');
      applySettings(response.data.settings);
      setToast({ type: 'success', message: 'Data summary refreshed.' });
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to refresh data summary.' });
    } finally {
      setIsRefreshingAnalysis(false);
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
          {activeTab === 'info'
            ? 'This is the one place your practice details live. Update it here and it flows everywhere else — the dashboard header, generated forms, and every new practitioner you add in Staff Directory.'
            : activeTab === 'compliance'
            ? "Attach and manage the state's required-documentation Excel file used to run Compliance Analysis against practitioner-logged sessions."
            : 'Control the Service Type, Service Status, Location, and Group Size options practitioners choose from when logging a session.'}
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('info')}
          className={`px-4 py-2.5 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
            activeTab === 'info' ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Company Information
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('compliance')}
          className={`px-4 py-2.5 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
            activeTab === 'compliance' ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          State Compliance Reference
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('dropdowns')}
          className={`px-4 py-2.5 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
            activeTab === 'dropdowns' ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Dropdown Options
        </button>
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

      {activeTab === 'info' && (
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
      )}

      {activeTab === 'compliance' && (
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
                {!complianceDoc.hasMapping && !mappingInfo && (
                  <p className="text-xs font-semibold text-amber-600 mt-0.5">Column matching not confirmed yet — not used in Compliance Analysis</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button onClick={handleComplianceDocDownload} variant="outline" size="sm" className="cursor-pointer border-slate-300 bg-white text-slate-700 font-semibold">
                Download
              </Button>
              <Button onClick={handleReviewMapping} disabled={isLoadingMapping} variant="outline" size="sm" className="cursor-pointer border-slate-300 bg-white text-slate-700 font-semibold">
                {isLoadingMapping ? 'Loading...' : 'Review column matching'}
              </Button>
              <label className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-2 rounded-lg cursor-pointer hover:bg-teal-100 transition-colors">
                {isUploadingComplianceDoc ? 'Uploading...' : 'Replace'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleComplianceDocSelect} disabled={isUploadingComplianceDoc} />
              </label>
              <Button onClick={() => setShowRemoveConfirm(true)} disabled={isRemovingComplianceDoc} variant="outline" size="sm" className="cursor-pointer border-red-200 bg-white text-red-600 font-semibold hover:bg-red-50">
                {isRemovingComplianceDoc ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          </div>
        ) : null}

        {complianceDoc && (
          <div className="flex items-start gap-2.5 bg-sky-50 border border-sky-200 rounded-xl px-3.5 py-3 text-xs text-sky-700">
            <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <span>
              <span className="font-bold">Each month, use Replace</span> to attach the new state file — it keeps everything from the last 90 days on file and only adds this file's data, so nothing needs to be cleared out first. Compliance data older than 90 days (by service date) drops off automatically. <span className="font-bold">Remove</span> is only for starting over completely — it clears all state compliance data, not just this file.
            </span>
          </div>
        )}

        {complianceDoc?.hasMapping && !complianceAnalysis?.months?.length && (
          <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5">
            <p className="text-xs text-slate-500">
              No data summary on file yet for this document — generate one from what's currently loaded.
            </p>
            <Button onClick={handleRefreshAnalysis} disabled={isRefreshingAnalysis} variant="outline" size="sm" className="cursor-pointer border-slate-300 bg-white text-slate-700 font-semibold flex-shrink-0">
              {isRefreshingAnalysis ? 'Generating...' : 'Generate data summary'}
            </Button>
          </div>
        )}

        {complianceAnalysis?.months?.length > 0 && (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Data currently on file</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  From the last confirmed upload — updates the next time a file is applied, or when refreshed.
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {complianceAnalysis.generatedAt && (
                  <span className="text-[11px] text-slate-400">
                    As of {new Date(complianceAnalysis.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
                <Button onClick={handleRefreshAnalysis} disabled={isRefreshingAnalysis} variant="outline" size="sm" className="cursor-pointer border-slate-300 bg-white text-slate-700 font-semibold">
                  {isRefreshingAnalysis ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2">Month</th>
                  <th className="px-4 py-2">Records</th>
                  <th className="px-4 py-2">Earliest service date</th>
                  <th className="px-4 py-2">Latest service date</th>
                </tr>
              </thead>
              <tbody>
                {complianceAnalysis.months.map((row) => (
                  <tr key={row.month} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">
                      {new Date(`${row.month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.record_count}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {row.earliest_date && new Date(row.earliest_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {row.latest_date && new Date(row.latest_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!complianceDoc && (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl px-4 py-8 cursor-pointer hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
            <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <span className="text-sm font-semibold text-teal-700">{isUploadingComplianceDoc ? 'Uploading...' : 'Click to attach an Excel file'}</span>
            <span className="text-xs text-slate-400">.xlsx or .xls, up to 10MB</span>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleComplianceDocSelect} disabled={isUploadingComplianceDoc} />
          </label>
        )}

        {mappingInfo && (
          <div className="border-t border-slate-100 pt-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Match columns</h3>
              <p className="text-xs text-slate-500 mt-1">
                Confirm which column in the Excel file feeds each field below. We pre-fill these from the file's headers — review anything highlighted before confirming.
              </p>
            </div>

            <div className="space-y-2.5">
              {mappingInfo.targetFields.filter((field) => !removedFields.has(field.key)).map((field) => {
                const suggested = mappingInfo.suggestedMapping[field.key];
                const previous = mappingInfo.previousMapping?.[field.key];
                const needsInput = field.required && !suggested;
                const changed = !needsInput && previous && suggested && previous !== suggested;
                const status = needsInput
                  ? { text: 'Not found in this file — pick manually', className: 'text-red-600 bg-red-50 border-red-200' }
                  : changed
                  ? { text: `Changed since last upload (was "${previous}")`, className: 'text-amber-700 bg-amber-50 border-amber-200' }
                  : suggested
                  ? { text: 'Auto-detected', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
                  : { text: 'Not in this file', className: 'text-slate-500 bg-slate-50 border-slate-200' };

                return (
                  <div key={field.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${needsInput ? 'border-red-200 bg-red-50/40' : changed ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
                    <div className="w-48 flex-shrink-0">
                      <p className="text-sm font-semibold text-slate-800">{field.label}{field.required && <span className="text-red-500"> *</span>}</p>
                      <span className={`inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${status.className}`}>{status.text}</span>
                    </div>
                    <select
                      className="flex-1 h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm"
                      value={mapping[field.key] || ''}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      <option value="">— Not in this file —</option>
                      {mappingInfo.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemoveField(field)}
                      title="Remove this field from column matching"
                      aria-label={`Remove column match for ${field.label}`}
                      className="flex-shrink-0 w-9 h-9 rounded-md border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-2.5">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Custom fields</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Track additional data points beyond the fields above. Tie a category to a real state document column to get an actual match/mismatch check in Compliance Analysis — or leave it as informational-only to just display the state's value.
                </p>
              </div>
              {customFields.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        <th className="text-left px-3 py-2">Category Name</th>
                        <th className="text-left px-3 py-2">Our Data Point</th>
                        <th className="text-left px-3 py-2">State Document Column</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {customFields.map((cf, index) => (
                        <tr key={index} className="border-t border-slate-200 bg-white">
                          <td className="px-3 py-2">
                            <Input
                              placeholder="e.g. Comments"
                              value={cf.label}
                              onChange={(e) => handleCustomFieldChange(index, 'label', e.target.value)}
                              className="h-9 min-w-[10rem]"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="w-full h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm"
                              value={cf.compareTo || ''}
                              onChange={(e) => handleCustomFieldChange(index, 'compareTo', e.target.value)}
                            >
                              <option value="">— Informational only —</option>
                              <optgroup label="Categories">
                                <option value="service_type">Service Type</option>
                                <option value="location">Location</option>
                                <option value="group_size">Group Size Category</option>
                                <option value="service_status">Service Status</option>
                                <option value="total_time">Total Time</option>
                                <option value="practitioner_discipline">Practitioner Discipline</option>
                                <option value="patient_dob">Patient DOB</option>
                                <option value="patient_county">Patient County</option>
                              </optgroup>
                              {customCategories.length > 0 && (
                                <optgroup label="Custom Categories">
                                  {customCategories.map((cat) => (
                                    <option key={cat.key} value={`custom_category:${cat.key}`}>{cat.display_name}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="w-full h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm"
                              value={cf.header}
                              onChange={(e) => handleCustomFieldChange(index, 'header', e.target.value)}
                            >
                              <option value="">Select a column...</option>
                              {mappingInfo.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomField(index)}
                              title="Remove this custom field"
                              aria-label={`Remove custom field ${cf.label || index + 1}`}
                              className="w-9 h-9 rounded-md border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                type="button"
                onClick={handleAddCustomField}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-teal-700 border border-dashed border-teal-200 rounded-lg py-2 hover:bg-teal-50/40 cursor-pointer transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add custom field
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-slate-400">{mappingInfo.rowCount} data row{mappingInfo.rowCount === 1 ? '' : 's'} found in this file.</p>
              <div className="flex gap-2">
                <Button onClick={() => setMappingInfo(null)} variant="outline" size="sm" className="cursor-pointer border-slate-300 bg-white text-slate-700 font-semibold">
                  Cancel
                </Button>
                <Button onClick={handleApplyMapping} disabled={isApplyingMapping} size="sm" className="cursor-pointer bg-teal-700 hover:bg-teal-800 text-white font-semibold">
                  {isApplyingMapping ? 'Applying...' : 'Confirm & Run Analysis'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {activeTab === 'dropdowns' && <DropdownOptionsManager />}

      <Dialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Remove the state compliance document?</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-sm text-slate-600 -mt-2 space-y-3">
            <p>
              This deletes <span className="font-semibold text-slate-800">{complianceDoc?.filename}</span>, clears its column matching, and wipes <span className="font-semibold text-slate-800">all</span> state compliance data on file — not just this file's data. Compliance Analysis will show every session as "Missing in EIMS" until a new file is uploaded and confirmed.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 text-xs text-slate-600 space-y-1.5">
              <p className="font-bold text-slate-700">If you're just uploading next month's file, use Replace instead</p>
              <p>Replace keeps a rolling 90 days of compliance data on file. Each time you replace, it only swaps out that file's own dates and automatically drops anything older than 90 days — nothing needs to be cleared manually. Remove is only for a full reset (e.g. the wrong file was uploaded).</p>
            </div>
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowRemoveConfirm(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleComplianceDocRemove}
              disabled={isRemovingComplianceDoc}
              className="cursor-pointer text-white bg-red-600 hover:bg-red-700"
            >
              {isRemovingComplianceDoc ? 'Removing...' : 'Remove Everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
