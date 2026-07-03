import React, { useState } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MODULES = [
  { id: 'practitioner', title: 'Practitioner Logs',  desc: 'Audit hours & submissions'    },
  { id: 'child',        title: 'Patient History',     desc: 'Track child interventions'    },
  { id: 'financial',    title: 'Financial Audit',     desc: 'Revenue & invoice tracking'   },
  { id: 'compliance',   title: 'Compliance Flags',    desc: 'Missing forms & signatures'   },
];

const STATUS_LABELS = {
  pending:      'Pending',
  njeis_review: 'In Review',
  invoiced:     'Invoiced',
  declined:     'Rejected',
  rejected:     'Returned',
};

const STATUS_STYLES = {
  pending:      'bg-amber-50 text-amber-700 border-amber-200',
  njeis_review: 'bg-blue-50 text-blue-700 border-blue-200',
  invoiced:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  declined:     'bg-red-50 text-red-700 border-red-200',
  rejected:     'bg-violet-50 text-violet-700 border-violet-200',
};

const MODULE_TITLES = {
  practitioner: 'Practitioner Utilization Audit',
  child:        'Patient Service History Report',
  financial:    'Financial Reconciliation Audit',
  compliance:   'Compliance & Exception Monitor',
};

export const MasterReports = () => {
  const [activeModule, setActiveModule] = useState('practitioner');

  // Filters
  const [practitionerSearch, setPractitionerSearch] = useState('');
  const [patientSearch, setPatientSearch]           = useState('');
  const [dateRange, setDateRange]                   = useState({ start: '', end: '' });
  const [billingStatus, setBillingStatus]           = useState('all');

  // Results
  const [logs, setLogs]                             = useState(null);
  const [isLoading, setIsLoading]                   = useState(false);

  // Actions
  const [isGeneratingNJEIS, setIsGeneratingNJEIS]   = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF]       = useState(false);
  const [njeisUrl, setNjeisUrl]                     = useState(null);

  // Invoice override selection
  const [selectedIds, setSelectedIds]               = useState(new Set());
  const [isIssuing, setIsIssuing]                   = useState(false);
  const [overrideUrls, setOverrideUrls]             = useState({});

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const formatTime = (minutes) => {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(m)}/${parseInt(d)}/${y.slice(-2)}`;
  };

  const StatusBadge = ({ status }) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
      {STATUS_LABELS[status] || status || '-'}
    </span>
  );

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleRunReport = async () => {
    setIsLoading(true);
    setLogs(null);
    setNjeisUrl(null);
    setSelectedIds(new Set());
    try {
      const params = {};
      if (practitionerSearch.trim()) params.practitionerSearch = practitionerSearch.trim();
      if (patientSearch.trim())       params.patientSearch      = patientSearch.trim();
      if (dateRange.start)            params.startDate          = dateRange.start;
      if (dateRange.end)              params.endDate            = dateRange.end;

      if (activeModule === 'compliance') {
        params.compliance = 'true';
      } else if (activeModule === 'financial') {
        params.billingStatus = billingStatus !== 'all' ? billingStatus : 'invoiced';
      } else if (billingStatus !== 'all') {
        params.billingStatus = billingStatus;
      }

      const response = await api.get('/api/reports/audit-logs', { params });
      setLogs(response.data.logs || []);
    } catch (error) {
      console.error('Failed to fetch audit logs', error);
      alert('Failed to fetch logs: ' + (error.response?.data?.error || error.message));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateNJEIS = async () => {
    if (!logs || logs.length === 0) return;
    setIsGeneratingNJEIS(true);
    setNjeisUrl(null);
    try {
      const body = {};
      if (practitionerSearch.trim()) body.practitionerSearch = practitionerSearch.trim();
      if (patientSearch.trim())       body.patientSearch      = patientSearch.trim();
      if (dateRange.start)            body.startDate          = dateRange.start;
      if (dateRange.end)              body.endDate            = dateRange.end;
      if (billingStatus !== 'all')    body.billingStatus      = billingStatus;

      const response = await api.post('/api/reports/audit-njeis', body);
      if (response.data.success) {
        setNjeisUrl(response.data.downloadUrl);
        window.open(response.data.downloadUrl, '_blank');
      }
    } catch (error) {
      console.error('Failed to generate audit NJEIS', error);
      alert('NJEIS generation failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setIsGeneratingNJEIS(false);
    }
  };

  const handleGenerateReportPDF = async () => {
    if (!logs || logs.length === 0) return;
    setIsGeneratingPDF(true);
    try {
      const filters = {
        practitionerSearch: practitionerSearch || null,
        patientSearch:      patientSearch || null,
        startDate:          dateRange.start || null,
        endDate:            dateRange.end || null,
        billingStatus:      billingStatus !== 'all' ? billingStatus : null,
      };
      const response = await api.post('/api/reports/audit-report-pdf', { logs, filters }, { responseType: 'blob' });
      const url  = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit-report-${new Date().toISOString().slice(0,10)}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to generate report PDF', error);
      alert('PDF generation failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handlePrint = () => window.print();

  const handleReset = () => {
    setPractitionerSearch('');
    setPatientSearch('');
    setDateRange({ start: '', end: '' });
    setBillingStatus('all');
    setLogs(null);
    setNjeisUrl(null);
    setSelectedIds(new Set());
  };

  const handleModuleSwitch = (id) => {
    setActiveModule(id);
    setLogs(null);
    setNjeisUrl(null);
    setBillingStatus(id === 'financial' ? 'invoiced' : 'all');
    setSelectedIds(new Set());
  };

  const eligibleLogs = logs ? logs.filter(l => l.billing_status === 'declined' || l.billing_status === 'rejected') : [];

  const handleSelectToggle = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === eligibleLogs.length && eligibleLogs.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleLogs.map(l => l.id)));
    }
  };

  const handleIssueOverride = async () => {
    if (selectedIds.size === 0 || isIssuing) return;
    setIsIssuing(true);
    try {
      const assessmentIds = Array.from(selectedIds);
      const response = await api.post('/api/reports/issue-override', { assessmentIds });
      if (response.data.downloadUrls) {
        setOverrideUrls(prev => ({ ...prev, ...response.data.downloadUrls }));
      }
      setLogs(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, billing_status: 'invoiced', billing_review: 'accept' } : l));
      setSelectedIds(new Set());
    } catch (error) {
      alert('Failed to issue invoice: ' + (error.response?.data?.error || error.message));
    } finally {
      setIsIssuing(false);
    }
  };

  // ─── Summary stats ────────────────────────────────────────────────────────

  const stats = logs
    ? {
        total:              logs.length,
        totalHours:         logs.reduce((s, l) => s + (l.total_time || 0), 0) / 60,
        uniqueChildren:     new Set(logs.map(l => l.patient_id || `${l.patient_first_name}_${l.patient_last_name}`)).size,
        uniquePractitioners: new Set(logs.map(l => l.practitioner_id)).size,
      }
    : null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col space-y-6 max-w-7xl mx-auto pb-12">

      {/* HEADER */}
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-slate-800">System Audit & Reports</h1>
        <p className="text-sm text-slate-500 mt-1">Generate comprehensive system exports for compliance, billing, and staff utilization.</p>
      </div>

      {/* MODULE TABS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:hidden">
        {MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => handleModuleSwitch(mod.id)}
            className={`text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
              activeModule === mod.id
                ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-500 shadow-sm'
                : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
            }`}
          >
            <div className={`font-bold text-sm ${activeModule === mod.id ? 'text-blue-900' : 'text-slate-700'}`}>
              {mod.title}
            </div>
            <div className={`text-xs mt-1 ${activeModule === mod.id ? 'text-blue-600' : 'text-slate-500'}`}>
              {mod.desc}
            </div>
          </button>
        ))}
      </div>

      {/* FILTER PANEL */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:hidden">
        <div className="px-7 py-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-800">{MODULE_TITLES[activeModule]}</h2>
          {activeModule === 'compliance' && (
            <p className="text-xs text-amber-600 font-medium mt-1">
              Auto-filters to logs with service date &gt; 30 days ago still in Pending or In-Review status.
            </p>
          )}
        </div>

        <div className="p-7 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">

            {/* Practitioner Search — all modules except patient-only */}
            <div className={activeModule === 'child' ? 'hidden' : 'space-y-2'}>
              <Label className="text-sm font-semibold text-slate-700">Search Practitioner (Name or ID)</Label>
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <Input type="text" placeholder="Type to search..." className="pl-9" value={practitionerSearch} onChange={(e) => setPractitionerSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRunReport()} />
              </div>
            </div>

            {/* Patient Search */}
            <div className={activeModule === 'practitioner' ? 'hidden' : 'space-y-2'}>
              <Label className="text-sm font-semibold text-slate-700">Search Patient (Name)</Label>
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <Input type="text" placeholder="First or last name..." className="pl-9" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRunReport()} />
              </div>
            </div>

            {/* Practitioner Logs: show both searches in a 2-col span */}
            {activeModule === 'practitioner' && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Search Patient (optional)</Label>
                <div className="relative">
                  <svg className="w-4 h-4 absolute left-3 top-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <Input type="text" placeholder="Filter by patient..." className="pl-9" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRunReport()} />
                </div>
              </div>
            )}

            {/* Billing Status — financial module */}
            {activeModule === 'financial' && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Billing Status</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={billingStatus}
                  onChange={(e) => setBillingStatus(e.target.value)}
                >
                  <option value="invoiced">Invoiced</option>
                  <option value="pending">Pending</option>
                  <option value="njeis_review">In NJEIS Review</option>
                  <option value="declined">Rejected</option>
                  <option value="all">All Statuses</option>
                </select>
              </div>
            )}

            {/* Date Range */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Date Range Start</Label>
              <Input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Date Range End</Label>
              <Input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={handleReset} className="text-slate-600 cursor-pointer">Reset Filters</Button>
            <Button
              onClick={handleRunReport}
              disabled={isLoading}
              className="bg-slate-800 hover:bg-slate-900 text-white min-w-[160px] cursor-pointer"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Compiling Audit...
                </span>
              ) : 'Run Master Report'}
            </Button>
          </div>
        </div>
      </div>

      {/* RESULTS */}
      {logs !== null && (
        <>
          {/* Summary stat cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:hidden">
              {[
                { label: 'Total Logs',      value: stats.total                          },
                { label: 'Total Hours',     value: `${stats.totalHours.toFixed(1)} hrs` },
                { label: 'Unique Patients', value: stats.uniqueChildren                 },
                { label: 'Practitioners',   value: stats.uniquePractitioners            },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{s.label}</div>
                  <div className="text-2xl font-bold text-slate-800 mt-1">{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Results table */}
          <div id="audit-print-area" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

            {/* Table header / action bar */}
            <div className="px-7 py-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-3 bg-slate-50/30 print:hidden">
              <div>
                <h3 className="font-bold text-slate-800">Audit Results</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {logs.length} log{logs.length !== 1 ? 's' : ''} found
                  {activeModule === 'compliance' && logs.length > 0 && (
                    <span className="ml-2 text-amber-600 font-semibold">— {logs.length} compliance concern{logs.length !== 1 ? 's' : ''}</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedIds.size > 0 && (
                  <Button
                    size="sm"
                    onClick={handleIssueOverride}
                    disabled={isIssuing}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer gap-1.5 disabled:opacity-50"
                  >
                    {isIssuing ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        Issuing…
                      </span>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Issue Invoice ({selectedIds.size})
                      </>
                    )}
                  </Button>
                )}
                {njeisUrl && (
                  <a href={njeisUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Re-Download NJEIS
                    </Button>
                  </a>
                )}
                <Button
                  size="sm"
                  onClick={handleGenerateNJEIS}
                  disabled={isGeneratingNJEIS || logs.length === 0}
                  className="bg-blue-700 hover:bg-blue-800 text-white cursor-pointer gap-1.5 disabled:opacity-50"
                >
                  {isGeneratingNJEIS ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Generating…
                    </span>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Generate NJEIS Forms
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateReportPDF}
                  disabled={isGeneratingPDF || logs.length === 0}
                  className="text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer gap-1.5 disabled:opacity-50"
                >
                  {isGeneratingPDF ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Exporting…
                    </span>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Export PDF Report
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePrint}
                  className="text-slate-600 border-slate-200 hover:bg-slate-50 cursor-pointer gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  Print
                </Button>
              </div>
            </div>

            {/* Print-only header */}
            <div className="hidden print:block px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Progressive Steps NJ — Audit Report</h2>
              <p className="text-xs text-slate-500 mt-1">
                {MODULE_TITLES[activeModule]} · {logs.length} records
                {dateRange.start && ` · ${dateRange.start} → ${dateRange.end || 'present'}`}
                {practitionerSearch && ` · Practitioner: ${practitionerSearch}`}
                {patientSearch && ` · Patient: ${patientSearch}`}
              </p>
            </div>

            {logs.length === 0 ? (
              <div className="py-20 text-center text-slate-500">
                <svg className="w-12 h-12 mx-auto text-slate-200 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm font-medium">No logs found for the selected filters.</p>
                <p className="text-xs text-slate-400 mt-1">Try adjusting your date range or search terms.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                      <th className="py-3.5 px-3 w-10 print:hidden">
                        {eligibleLogs.length > 0 && (
                          <input
                            type="checkbox"
                            className="cursor-pointer"
                            checked={selectedIds.size === eligibleLogs.length && eligibleLogs.length > 0}
                            onChange={handleSelectAll}
                          />
                        )}
                      </th>
                      <th className="py-3.5 px-4">Patient Name</th>
                      <th className="py-3.5 px-4">Practitioner</th>
                      <th className="py-3.5 px-4">Service Date</th>
                      <th className="py-3.5 px-4">Service Type</th>
                      <th className="py-3.5 px-4">Location</th>
                      <th className="py-3.5 px-4">Start</th>
                      <th className="py-3.5 px-4">End</th>
                      <th className="py-3.5 px-4">Total Time</th>
                      <th className="py-3.5 px-4">Billing Status</th>
                      {activeModule === 'compliance' && <th className="py-3.5 px-4">Days Old</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((log) => {
                      const daysOld = log.service_date
                        ? Math.floor((Date.now() - new Date(log.service_date + 'T00:00:00').getTime()) / 86400000)
                        : null;
                      return (
                        <tr key={log.id} className={`transition-colors ${activeModule === 'compliance' && daysOld > 45 ? 'bg-red-50/30' : 'hover:bg-slate-50'}`}>
                          <td className="py-3 px-3 print:hidden">
                            {(log.billing_status === 'declined' || log.billing_status === 'rejected') && (
                              <input
                                type="checkbox"
                                className="cursor-pointer"
                                checked={selectedIds.has(log.id)}
                                onChange={() => handleSelectToggle(log.id)}
                              />
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-800">
                            {log.patient_first_name} {log.patient_last_name}
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {log.practitioners?.first_name} {log.practitioners?.last_name}
                          </td>
                          <td className="py-3 px-4 text-slate-600 font-mono text-xs">
                            {formatDate(log.service_date)}
                          </td>
                          <td className="py-3 px-4 text-slate-600">{log.type || '-'}</td>
                          <td className="py-3 px-4 capitalize text-slate-600">{log.location || '-'}</td>
                          <td className="py-3 px-4 text-slate-600 text-xs">{log.start_time || '-'}</td>
                          <td className="py-3 px-4 text-slate-600 text-xs">{log.end_time || '-'}</td>
                          <td className="py-3 px-4 text-slate-600 font-mono text-xs">{formatTime(log.total_time)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <StatusBadge status={log.billing_status} />
                              {log.acknowledged_at && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md whitespace-nowrap">
                                  ✓ Acknowledged
                                </span>
                              )}
                              {overrideUrls[log.id] && (
                                <a
                                  href={overrideUrls[log.id]}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Download override invoice"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  Invoice
                                </a>
                              )}
                            </div>
                          </td>
                          {activeModule === 'compliance' && (
                            <td className="py-3 px-4">
                              <span className={`font-bold text-xs ${daysOld > 45 ? 'text-red-600' : 'text-amber-600'}`}>
                                {daysOld !== null ? `${daysOld}d` : '-'}
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50">
                      <td colSpan={activeModule === 'compliance' ? 11 : 10} className="py-3 px-4 text-xs text-slate-500 font-medium">
                        {logs.length} records · {stats?.totalHours.toFixed(1)} total hrs · {stats?.uniqueChildren} patient{stats?.uniqueChildren !== 1 ? 's' : ''} · {stats?.uniquePractitioners} practitioner{stats?.uniquePractitioners !== 1 ? 's' : ''}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* NJEIS generation note */}
          {njeisUrl && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3.5 flex items-center gap-3 print:hidden">
              <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-800">NJEIS forms generated successfully.</p>
                <p className="text-xs text-emerald-600 mt-0.5">One form per (practitioner × child) pair · 10 sessions per page · overflow pages carry same header.</p>
              </div>
              <a href={njeisUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-emerald-700 underline underline-offset-2 hover:text-emerald-900 whitespace-nowrap">
                Open PDF ↗
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
};
