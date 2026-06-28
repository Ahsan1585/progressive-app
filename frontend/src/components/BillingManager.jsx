import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const BillingManager = () => {
  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'history'

  // --- PENDING QUEUE STATE ---
  const [practitionerLogs, setPractitionerLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // --- EXPAND / DECLINE STATE ---
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [expandedLogs, setExpandedLogs] = useState({});
  const [loadingExpand, setLoadingExpand] = useState(new Set());
  const [processingLogId, setProcessingLogId] = useState(null);

  // --- ACTION MODAL STATE (Reject / Return) ---
  const [actionModal, setActionModal] = useState(null); // { session, practitionerId, type: 'reject'|'return' }
  const [actionNote, setActionNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- PER-LOG ACTION STATE (controls dropdown value + Review badge) ---
  const [logActions, setLogActions] = useState({}); // { [sessionId]: 'accept'|'reject'|'return' }

  // --- HISTORICAL VAULT STATE ---
  const [historyFiles, setHistoryFiles] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState({ start: '', end: '' });
  const [batchMap, setBatchMap] = useState({}); // njeis_path → batch_id
  const [isBackfilling, setIsBackfilling] = useState(false);

  // --- VAULT EXPAND STATE ---
  const [vaultExpandedRows, setVaultExpandedRows] = useState(new Set());
  const [vaultRowLogs, setVaultRowLogs] = useState({});
  const [loadingVaultRow, setLoadingVaultRow] = useState(new Set());

  // ==========================================
  // PENDING QUEUE LOGIC
  // ==========================================
  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/billing/pending-logs', {
        params: { search: searchTerm, startDate: dateRange.start, endDate: dateRange.end }
      });
      if (response.data.success) setPractitionerLogs(response.data.logs);
    } catch (error) {
      console.error("Failed to fetch billing logs", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'pending') {
      fetchLogs();
      setExpandedLogs({});
      setLogActions({});
    }
  }, [dateRange, activeTab]);

  const filteredLogs = practitionerLogs.filter(log => {
    const term = searchTerm.toLowerCase();
    return `${log.first_name} ${log.last_name}`.toLowerCase().includes(term) ||
           log.practitioner_id?.toString().includes(term);
  });

  const formatTime = (minutes) => {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const handleToggleExpand = async (practitionerId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(practitionerId)) {
      newExpanded.delete(practitionerId);
      setExpandedRows(newExpanded);
      return;
    }
    newExpanded.add(practitionerId);
    setExpandedRows(newExpanded);

    if (!expandedLogs[practitionerId]) {
      setLoadingExpand(prev => new Set(prev).add(practitionerId));
      try {
        const response = await api.get('/api/billing/practitioner-logs', {
          params: { practitionerId, startDate: dateRange.start, endDate: dateRange.end }
        });
        if (response.data.success) {
          setExpandedLogs(prev => ({ ...prev, [practitionerId]: response.data.logs }));
        }
      } catch (error) {
        console.error('Failed to fetch practitioner logs', error);
      } finally {
        setLoadingExpand(prev => {
          const n = new Set(prev);
          n.delete(practitionerId);
          return n;
        });
      }
    }
  };

  const handleAccept = async (session, practitionerId) => {
    setLogActions(prev => ({ ...prev, [session.id]: 'accept' }));
    setProcessingLogId(session.id);
    try {
      await api.patch('/api/billing/log-status', { assessmentId: session.id, status: 'pending' });
      setExpandedLogs(prev => ({
        ...prev,
        [practitionerId]: (prev[practitionerId] || []).map(l =>
          l.id === session.id ? { ...l, billing_status: 'pending', billing_review: 'accept' } : l
        )
      }));
      if (session.billing_status !== 'pending') fetchLogs();
    } catch (error) {
      setLogActions(prev => ({ ...prev, [session.id]: '' }));
      console.error('Failed to accept log', error);
    } finally {
      setProcessingLogId(null);
    }
  };

  const handleActionSubmit = async () => {
    if (!actionModal || !actionNote.trim()) return;
    setIsSubmitting(true);
    try {
      await api.post('/api/billing/reject-log', {
        assessmentId: actionModal.session.id,
        note: actionNote,
        type: actionModal.type
      });
      if (actionModal.type === 'return') {
        // Stay in list as grayed-out "Awaiting Revision" — practitioner must correct and resubmit
        setExpandedLogs(prev => ({
          ...prev,
          [actionModal.practitionerId]: (prev[actionModal.practitionerId] || []).map(l =>
            l.id === actionModal.session.id ? { ...l, billing_status: 'rejected', billing_review: 'return' } : l
          )
        }));
      } else {
        // Stay in list as grayed-out "Excluded" — permanently rejected, not included in report
        setExpandedLogs(prev => ({
          ...prev,
          [actionModal.practitionerId]: (prev[actionModal.practitionerId] || []).map(l =>
            l.id === actionModal.session.id ? { ...l, billing_status: 'declined', billing_review: 'reject' } : l
          )
        }));
      }
      setLogActions(prev => ({ ...prev, [actionModal.session.id]: actionModal.type }));
      fetchLogs();
      setActionModal(null);
      setActionNote('');
    } catch (error) {
      setLogActions(prev => ({ ...prev, [actionModal.session.id]: '' }));
      console.error('Failed to process action', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateAndIssue = async (practitionerId) => {
    setProcessingId(practitionerId);
    try {
      // Step 1: Generate NJEIS
      const njeisRes = await api.post('/api/billing/generate-njeis', { practitionerId, startDate: dateRange.start, endDate: dateRange.end });
      if (!njeisRes.data.success) throw new Error('NJEIS generation failed');
      setPractitionerLogs(prev => prev.map(log =>
        log.practitioner_id === practitionerId
          ? { ...log, workflow_status: 'njeis_review', njeis_url: njeisRes.data.downloadUrl }
          : log
      ));

      // Step 2: Generate Invoice
      const invoiceRes = await api.post('/api/billing/generate-invoice', { practitionerId, startDate: dateRange.start, endDate: dateRange.end });
      if (!invoiceRes.data.success) throw new Error('Invoice generation failed');
      setPractitionerLogs(prev => prev.map(log =>
        log.practitioner_id === practitionerId
          ? { ...log, workflow_status: 'complete', invoice_url: invoiceRes.data.downloadUrl }
          : log
      ));
    } catch (error) {
      alert('Generation failed: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  // ==========================================
  // HISTORICAL VAULT LOGIC
  // ==========================================
  const fetchHistory = async () => {
    setIsHistoryLoading(true);
    try {
      const [histResult, batchResult] = await Promise.allSettled([
        api.get('/api/billing/history'),
        api.get('/api/billing/batches'),
      ]);
      if (histResult.status === 'fulfilled' && histResult.value.data.success) {
        setHistoryFiles(histResult.value.data.invoices);
      }
      if (batchResult.status === 'fulfilled' && batchResult.value.data.success) {
        const map = {};
        batchResult.value.data.batches.forEach(b => {
          if (b.njeis_path) {
            map[b.njeis_path] = b.id;
            map[b.njeis_path.split('/').pop()] = b.id;
          }
        });
        setBatchMap(map);
      } else if (batchResult.status === 'rejected') {
        console.warn('billing/batches fetch failed (non-fatal):', batchResult.reason?.message);
      }
    } catch (error) {
      console.error("Failed to fetch vault history", error);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleBackfill = async () => {
    setIsBackfilling(true);
    try {
      const res = await api.post('/api/billing/backfill-batches');
      if (res.data.success) {
        await fetchHistory();
        alert(res.data.message);
      }
    } catch (err) {
      console.error('Backfill failed', err);
      alert('Backfill failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsBackfilling(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
  }, [activeTab]);

  // Parse each file into structured metadata
  const parsedHistoryFiles = historyFiles.map(file => {
    const parts = file.name.split('/');
    if (parts.length < 3) return null;
    const practFolder = parts[1];
    const fileName = parts[parts.length - 1];
    const match = fileName.match(/^(NJEIS|Override_Invoice|Invoice)_(\d{8})_(\d{8})_(\d{6})\.pdf$/);
    if (!match) return null;
    const [, type, min, max, ts] = match;
    const fmt = s => `${s.slice(4,6)}/${s.slice(6,8)}/${s.slice(0,4)}`;
    return {
      file,
      type,
      practFolder,
      practName: practFolder.replace(/_/g, ' '),
      minDate: min,
      maxDate: max,
      timestamp: ts,
      dateRange: `${fmt(min)} – ${fmt(max)}`,
      serviceMinDate: `${min.slice(0,4)}-${min.slice(4,6)}-${min.slice(6,8)}`,
      serviceMaxDate: `${max.slice(0,4)}-${max.slice(4,6)}-${max.slice(6,8)}`
    };
  }).filter(Boolean);

  // Group by practitioner + date range, then pair NJEIS[i] with Invoice[i] by timestamp order
  // Override_Invoice files are standalone (no NJEIS pairing required)
  const byGroup = {};
  parsedHistoryFiles.forEach(parsed => {
    const key = `${parsed.practFolder}|${parsed.minDate}|${parsed.maxDate}`;
    if (!byGroup[key]) byGroup[key] = { meta: parsed, njeis: [], invoices: [], overrides: [] };
    if (parsed.type === 'NJEIS') byGroup[key].njeis.push(parsed);
    else if (parsed.type === 'Override_Invoice') byGroup[key].overrides.push(parsed);
    else byGroup[key].invoices.push(parsed);
  });

  const vaultRows = [];
  Object.values(byGroup).forEach(({ meta, njeis, invoices, overrides }) => {
    const term = historySearch.toLowerCase();
    if (term && !meta.practName.toLowerCase().includes(term)) return;
    if (historyDate.start && meta.serviceMaxDate < historyDate.start) return;
    if (historyDate.end && meta.serviceMinDate > historyDate.end) return;

    // Standard paired NJEIS + Invoice rows
    njeis.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    invoices.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const len = Math.min(njeis.length, invoices.length);
    for (let i = 0; i < len; i++) {
      const n = njeis[i] || null;
      const inv = invoices[i] || null;
      const batchId = n?.file?.name
        ? (batchMap[n.file.name] || batchMap[n.file.name.split('/').pop()] || null)
        : null;
      vaultRows.push({
        id: `${meta.practFolder}|${meta.minDate}|${meta.maxDate}|${i}`,
        dateRange: meta.dateRange,
        serviceMinDate: meta.serviceMinDate,
        serviceMaxDate: meta.serviceMaxDate,
        practitionerName: meta.practName,
        practitionerFolder: meta.practFolder,
        njeisFile: n ? n.file : null,
        invoiceFile: inv ? inv.file : null,
        isOverride: false,
        batchId,
        sortTs: (n || inv).timestamp
      });
    }

    // Override-only rows — show only the latest override per practitioner+date group
    if (overrides.length > 0) {
      overrides.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const latestOverride = overrides[overrides.length - 1];
      vaultRows.push({
        id: `${meta.practFolder}|${meta.minDate}|${meta.maxDate}|override`,
        dateRange: meta.dateRange,
        serviceMinDate: meta.serviceMinDate,
        serviceMaxDate: meta.serviceMaxDate,
        practitionerName: meta.practName,
        practitionerFolder: meta.practFolder,
        njeisFile: null,
        invoiceFile: latestOverride.file,
        isOverride: true,
        batchId: null,
        sortTs: latestOverride.timestamp
      });
    }
  });

  const groupedHistory = vaultRows.sort((a, b) => {
    const d = b.serviceMaxDate.localeCompare(a.serviceMaxDate);
    return d !== 0 ? d : b.sortTs.localeCompare(a.sortTs);
  });

  const handleDownloadHistory = async (fileName) => {
    try {
      const response = await api.get(`/api/billing/download?fileName=${fileName}`);
      if (response.data.success) window.open(response.data.signedUrl, '_blank');
    } catch (error) { alert("Failed to download file."); }
  };

  const handleVaultToggleExpand = async (groupId, practitionerFolder, serviceMinDate, serviceMaxDate, isOverride, batchId) => {
    const newExpanded = new Set(vaultExpandedRows);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
      setVaultExpandedRows(newExpanded);
      return;
    }
    newExpanded.add(groupId);
    setVaultExpandedRows(newExpanded);

    if (!vaultRowLogs[groupId]) {
      setLoadingVaultRow(prev => new Set(prev).add(groupId));
      try {
        const params = { practitionerFolder, startDate: serviceMinDate, endDate: serviceMaxDate, isOverride: isOverride ? 'true' : 'false' };
        if (batchId) params.batchId = batchId;
        const response = await api.get('/api/billing/vault-logs', { params });
        if (response.data.success) {
          setVaultRowLogs(prev => ({ ...prev, [groupId]: response.data.logs }));
        }
      } catch (error) {
        console.error('Failed to fetch vault logs', error);
      } finally {
        setLoadingVaultRow(prev => {
          const n = new Set(prev);
          n.delete(groupId);
          return n;
        });
      }
    }
  };

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="flex flex-col space-y-6">
      
      {/* 🌟 TAB NAVIGATION 🌟 */}
      <div className="flex p-1 bg-slate-200/60 rounded-xl w-fit border border-slate-200 shadow-sm">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 cursor-pointer ${
            activeTab === 'pending' 
              ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' 
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
          }`}
        >
          Pending Workflow
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 cursor-pointer ${
            activeTab === 'history' 
              ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' 
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
          }`}
        >
          Completed Vault
        </button>
      </div>

      {/* 🌟 TAB 1: PENDING WORKFLOW 🌟 */}
      {activeTab === 'pending' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-7 py-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-6 items-end justify-between">
            <div className="flex-1 min-w-[250px] max-w-md space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Search Practitioners</Label>
              <div className="relative">
                <svg className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <Input type="text" placeholder="Search by name or ID..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-4 items-end">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Start Date</Label>
                <Input type="date" value={dateRange.start} onChange={(e) => setDateRange({...dateRange, start: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">End Date</Label>
                <Input type="date" value={dateRange.end} onChange={(e) => setDateRange({...dateRange, end: e.target.value})} />
              </div>
              <Button onClick={fetchLogs} variant="outline" className="h-10 cursor-pointer text-slate-600">Refresh</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="py-4 px-4">Practitioner</th>
                  <th className="py-4 px-4 text-center">Logs</th>
                  <th className="py-4 px-4 text-center">Children</th>
                  <th className="py-4 px-4 text-center">Status</th>
                  <th className="py-4 px-4 text-center">NJEIS Form</th>
                  <th className="py-4 px-4 text-center">Invoice</th>
                  <th className="py-4 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan="7" className="py-12 text-center text-slate-500">Loading billing pipeline...</td></tr>
                ) : filteredLogs.length === 0 ? (
                  <tr><td colSpan="7" className="py-12 text-center text-slate-500">No active workflows pending.</td></tr>
                ) : (
                  filteredLogs.map((log) => {
                    const isExpanded = expandedRows.has(log.practitioner_id);
                    const logsForRow = expandedLogs[log.practitioner_id] || [];
                    const declinedCount = logsForRow.filter(l => l.billing_status === 'declined').length;
                    const isLoadingThisRow = loadingExpand.has(log.practitioner_id);
                    // Gate: every individual log must have a billing review decision before generating
                    const allLogsReviewed = isExpanded && logsForRow.length > 0 &&
                      logsForRow.every(s => logActions[s.id] || s.billing_review);

                    return (
                      <React.Fragment key={log.practitioner_id}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleToggleExpand(log.practitioner_id)}
                                className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-400 flex-shrink-0 cursor-pointer"
                              >
                                <svg className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                              <div>
                                <div className="font-bold text-slate-800 capitalize">{log.first_name} {log.last_name}</div>
                                <div className="text-xs text-slate-500 mt-0.5 font-mono">ID: {log.practitioner_id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <div className="font-bold text-slate-700">{log.total_interventions}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{log.total_hours.toFixed(1)} hrs</div>
                            {declinedCount > 0 && (
                              <div className="text-xs text-red-500 font-semibold mt-0.5">({declinedCount} rejected)</div>
                            )}
                          </td>
                          <td className="py-4 px-4 text-center font-medium text-slate-600">
                            {log.unique_children_count}
                          </td>
                          <td className="py-4 px-4 text-center">
                            {log.workflow_status === 'pending' && <span className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 rounded-full text-xs font-bold">Awaiting Forms</span>}
                            {log.workflow_status === 'njeis_review' && <span className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full text-xs font-bold">In Review</span>}
                            {log.workflow_status === 'complete' && <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-xs font-bold">Complete</span>}
                          </td>
                          <td className="py-4 px-4 text-center">
                            {log.njeis_url ? (
                              <a
                                href={log.njeis_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                NJEIS
                              </a>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="py-4 px-4 text-center">
                            {log.invoice_url ? (
                              <a
                                href={log.invoice_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                Invoice
                              </a>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="py-4 px-4 text-right">
                            {(log.workflow_status === 'pending' || log.workflow_status === 'njeis_review') && (
                              <div className="flex flex-col items-end gap-1">
                                <Button
                                  onClick={() => handleGenerateAndIssue(log.practitioner_id)}
                                  disabled={!allLogsReviewed || processingId === log.practitioner_id}
                                  className={`ml-auto w-44 text-white transition-colors ${
                                    allLogsReviewed && processingId !== log.practitioner_id
                                      ? 'bg-slate-800 hover:bg-slate-900 cursor-pointer'
                                      : 'bg-slate-300 cursor-not-allowed'
                                  }`}
                                >
                                  {processingId === log.practitioner_id ? 'Generating...' : 'Generate & Issue'}
                                </Button>
                                {!isExpanded && (
                                  <span className="text-xs text-slate-400">Expand to review logs</span>
                                )}
                                {isExpanded && logsForRow.length > 0 && !allLogsReviewed && (
                                  <span className="text-xs text-amber-600 font-medium">Review all logs to enable</span>
                                )}
                              </div>
                            )}
                            {log.workflow_status === 'complete' && (
                              <Button disabled className="bg-emerald-100 text-emerald-700 border border-emerald-200 ml-auto w-44 opacity-100 cursor-default">
                                <svg className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Issued & Complete
                              </Button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan="7" className="bg-white px-0 py-0 border-b border-slate-200">
                              <div className="px-8 py-4 border-t border-slate-100">
                                {isLoadingThisRow ? (
                                  <div className="text-center py-4 text-slate-500 text-sm">Loading logs...</div>
                                ) : logsForRow.length === 0 ? (
                                  <div className="text-center py-4 text-slate-500 text-sm">No individual logs found.</div>
                                ) : (
                                  <table className="w-full text-left border-collapse text-sm">
                                    <thead>
                                      <tr className="text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-300">
                                        <th className="py-2.5 px-3">Patient Name</th>
                                        <th className="py-2.5 px-3">Service Date</th>
                                        <th className="py-2.5 px-3">Service Status</th>
                                        <th className="py-2.5 px-3">Service Type</th>
                                        <th className="py-2.5 px-3">Service Location</th>
                                        <th className="py-2.5 px-3">Start Time</th>
                                        <th className="py-2.5 px-3">End Time</th>
                                        <th className="py-2.5 px-3">Total Time</th>
                                        <th className="py-2.5 px-3 text-center">Review</th>
                                        <th className="py-2.5 px-3 text-right">Billing Action</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                      {logsForRow.map((session) => {
                                        const isDeclined = session.billing_status === 'declined';
                                        const isReturned = session.billing_status === 'rejected';
                                        const isProcessing = processingLogId === session.id;
                                        // Declined/returned logs are locked (excluded from report); NJEIS-issued logs are also locked
                                        const isLocked =
                                          (log.workflow_status === 'njeis_review' && session.billing_status !== 'pending') ||
                                          isReturned ||
                                          isDeclined;

                                        return (
                                          <tr key={session.id} className={`transition-colors ${
                                            isDeclined ? 'bg-slate-100/80' :
                                            isReturned ? 'bg-amber-50/40' :
                                            isLocked ? 'bg-slate-50' :
                                            'hover:bg-slate-50'
                                          }`}>
                                            <td className={`py-3 px-3 font-semibold ${isLocked ? 'text-slate-400' : 'text-slate-800'}`}>
                                              {session.patient_first_name} {session.patient_last_name}
                                            </td>
                                            <td className={`py-3 px-3 ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.service_date ? new Date(session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}
                                            </td>
                                            <td className={`py-3 px-3 capitalize font-medium ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.status || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.type || '-'}
                                            </td>
                                            <td className={`py-3 px-3 capitalize ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.location || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.start_time || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.end_time || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {formatTime(session.total_time)}
                                            </td>

                                            {/* Review status badge */}
                                            <td className="py-3 px-3 text-center">
                                              {(() => {
                                                // Locked njeis_review sessions are implicitly included in the NJEIS batch
                                                if (isLocked && session.billing_status === 'njeis_review') return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">In NJEIS</span>
                                                );
                                                if (isLocked && session.billing_status === 'declined') return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">Rejected</span>
                                                );
                                                if (isReturned) return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">Returned</span>
                                                );
                                                if (session.billing_status === 'pending' && session.rejection_count > 0 && !logActions[session.id]) return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700 border border-violet-200 whitespace-nowrap">Resubmitted</span>
                                                );
                                                // Use in-session logActions first, then fall back to persisted DB value
                                                const action = logActions[session.id] || session.billing_review || (session.billing_status === 'declined' ? 'reject' : null);
                                                if (action === 'accept') return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">Approved</span>
                                                );
                                                if (action === 'reject') return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">Rejected</span>
                                                );
                                                if (action === 'return') return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">Returned</span>
                                                );
                                                return (
                                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">Pending</span>
                                                );
                                              })()}
                                            </td>

                                            {/* Action — locked or dropdown */}
                                            <td className="py-2.5 px-3 text-right">
                                              {isProcessing ? (
                                                <span className="text-xs text-slate-400">Processing...</span>
                                              ) : isDeclined ? (
                                                <div className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-medium select-none" title="Permanently rejected — not included in the generated report">
                                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                                  </svg>
                                                  Excluded
                                                </div>
                                              ) : isReturned ? (
                                                <div className="inline-flex items-center gap-1.5 text-amber-500 text-xs font-medium select-none" title="Returned to practitioner for revision — awaiting resubmission">
                                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                  </svg>
                                                  Awaiting Revision
                                                </div>
                                              ) : isLocked ? (
                                                <div className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-medium select-none" title="NJEIS has been issued. This log is locked until it returns to pending.">
                                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                                  </svg>
                                                  Locked
                                                </div>
                                              ) : (
                                                <select
                                                  value={logActions[session.id] || session.billing_review || ''}
                                                  onChange={(e) => {
                                                    const action = e.target.value;
                                                    if (!action) return;
                                                    setLogActions(prev => ({ ...prev, [session.id]: action }));
                                                    if (action === 'accept') {
                                                      handleAccept(session, log.practitioner_id);
                                                    } else {
                                                      setActionModal({ session, practitionerId: log.practitioner_id, type: action });
                                                      setActionNote('');
                                                    }
                                                  }}
                                                  className="text-xs font-semibold border rounded-md px-2 py-1.5 bg-white text-slate-700 border-slate-300 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 cursor-pointer"
                                                >
                                                  <option value="" disabled>Select Action</option>
                                                  <option value="accept">✓ Accept</option>
                                                  <option value="reject">✕ Reject</option>
                                                  <option value="return">↩ Return</option>
                                                </select>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ACTION MODAL (Reject / Return) */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div>
              {actionModal.type === 'return' ? (
                <>
                  <h3 className="text-lg font-bold text-slate-900">Return Log to Practitioner</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    This log will be sent back to the practitioner for revision. They must correct and resubmit it before it can be billed.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-slate-900">Reject Log</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    This log will be permanently rejected from billing. The practitioner will be notified — no further action is required from them.
                  </p>
                </>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm space-y-1">
              <div className="font-semibold text-slate-800">
                {actionModal.session.patient_first_name} {actionModal.session.patient_last_name}
              </div>
              <div className="text-slate-500">
                {actionModal.session.service_date
                  ? new Date(actionModal.session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                  : '-'}
                {' · '}{actionModal.session.type || '-'}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">
                {actionModal.type === 'return' ? 'Return Note' : 'Rejection Reason'}
                <span className="text-red-500 ml-1">*</span>
              </label>
              <textarea
                className={`w-full border rounded-xl p-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 resize-none ${
                  actionModal.type === 'return'
                    ? 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-400'
                    : 'border-slate-200 focus:ring-red-500/20 focus:border-red-400'
                }`}
                rows={4}
                placeholder={
                  actionModal.type === 'return'
                    ? 'Describe what needs to be corrected (e.g., incorrect service type, wrong start time)...'
                    : 'Explain the reason for rejection (e.g., duplicate entry, service not covered)...'
                }
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 cursor-pointer"
                onClick={() => {
                  setLogActions(prev => ({ ...prev, [actionModal.session.id]: '' }));
                  setActionModal(null);
                  setActionNote('');
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                className={`flex-1 text-white cursor-pointer disabled:opacity-50 ${
                  actionModal.type === 'return'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
                onClick={handleActionSubmit}
                disabled={!actionNote.trim() || isSubmitting}
              >
                {isSubmitting
                  ? 'Sending...'
                  : actionModal.type === 'return'
                    ? 'Return to Practitioner'
                    : 'Confirm Rejection'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 TAB 2: HISTORICAL VAULT 🌟 */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-7 py-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-6 items-end justify-between">
            <div className="flex-1 min-w-[250px] max-w-md space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Search Documents</Label>
              <div className="relative">
                <svg className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <Input type="text" placeholder="Search by practitioner name..." className="pl-10" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-4 items-end">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Service Date From</Label>
                <Input type="date" value={historyDate.start} onChange={(e) => setHistoryDate({...historyDate, start: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Service Date To</Label>
                <Input type="date" value={historyDate.end} onChange={(e) => setHistoryDate({...historyDate, end: e.target.value})} />
              </div>
              <Button onClick={fetchHistory} variant="outline" className="h-10 cursor-pointer text-slate-600">Refresh Vault</Button>
              <Button
                onClick={handleBackfill}
                disabled={isBackfilling}
                variant="outline"
                className="h-10 cursor-pointer text-amber-700 border-amber-300 hover:bg-amber-50 disabled:opacity-50"
                title="Link existing storage files to their billing batches — fixes duplicate logs in older vault entries"
              >
                {isBackfilling ? 'Fixing…' : 'Fix Vault'}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="py-4 px-6">Period / Date</th>
                  <th className="py-4 px-6">Practitioner</th>
                  <th className="py-4 px-6 text-center">NJEIS Form</th>
                  <th className="py-4 px-6 text-center">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isHistoryLoading ? (
                  <tr><td colSpan="4" className="py-12 text-center text-slate-500">Accessing secure vault...</td></tr>
                ) : groupedHistory.length === 0 ? (
                  <tr><td colSpan="4" className="py-12 text-center text-slate-500">No matching documents found in the vault.</td></tr>
                ) : (
                  groupedHistory.map((group) => {
                    const isVaultExpanded = vaultExpandedRows.has(group.id);
                    const isLoadingVault = loadingVaultRow.has(group.id);
                    const vaultLogs = vaultRowLogs[group.id] || [];
                    return (
                      <React.Fragment key={group.id}>
                        <tr className="hover:bg-slate-50 transition-colors">

                          {/* DATE / FOLDER */}
                          <td className="py-4 px-6 text-sm font-medium">
                            {group.dateRange
                              ? <span className="text-slate-800">{group.dateRange}</span>
                              : <span className="text-slate-400 italic">Regenerate to update</span>
                            }
                          </td>

                          {/* PRACTITIONER NAME + EXPAND CHEVRON */}
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleVaultToggleExpand(group.id, group.practitionerFolder, group.serviceMinDate, group.serviceMaxDate, group.isOverride, group.batchId)}
                                className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-400 flex-shrink-0 cursor-pointer"
                              >
                                <svg className={`w-4 h-4 transition-transform duration-200 ${isVaultExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                              <span className="font-bold text-slate-800 capitalize">{group.practitionerName}</span>
                            </div>
                          </td>

                          {/* NJEIS FORM COLUMN */}
                          <td className="py-4 px-6 text-center">
                            {group.njeisFile ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDownloadHistory(group.njeisFile.name)}
                                className="cursor-pointer text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 flex items-center justify-center gap-2 mx-auto w-28"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                NJEIS
                              </Button>
                            ) : group.isOverride ? (
                              <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-violet-50 text-violet-700 border border-violet-200">Override</span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>

                          {/* INVOICE COLUMN */}
                          <td className="py-4 px-6 text-center">
                            {group.invoiceFile ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDownloadHistory(group.invoiceFile.name)}
                                className="cursor-pointer text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 flex items-center justify-center gap-2 mx-auto w-28"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                Invoice
                              </Button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        </tr>

                        {/* EXPANDED SUB-TABLE */}
                        {isVaultExpanded && (
                          <tr>
                            <td colSpan="4" className="bg-white px-0 py-0 border-b border-slate-200">
                              <div className="px-8 py-4 border-t border-slate-100">
                                {isLoadingVault ? (
                                  <div className="text-center py-4 text-slate-500 text-sm">Loading logs...</div>
                                ) : vaultLogs.length === 0 ? (
                                  <div className="text-center py-4 text-slate-500 text-sm">No logs found for this period.</div>
                                ) : (
                                  <table className="w-full text-left border-collapse text-sm">
                                    <thead>
                                      <tr className="text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-300">
                                        <th className="py-2.5 px-3">Patient Name</th>
                                        <th className="py-2.5 px-3">Service Date</th>
                                        <th className="py-2.5 px-3">Service Status</th>
                                        <th className="py-2.5 px-3">Service Type</th>
                                        <th className="py-2.5 px-3">Service Location</th>
                                        <th className="py-2.5 px-3">Start Time</th>
                                        <th className="py-2.5 px-3">End Time</th>
                                        <th className="py-2.5 px-3">Total Time</th>
                                        <th className="py-2.5 px-3 text-center">Review</th>
                                        <th className="py-2.5 px-3 text-center">Billing Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                      {vaultLogs.map((session) => {
                                        const isDeclined = session.billing_status === 'declined';
                                        const isReturned = session.billing_status === 'rejected';
                                        return (
                                          <tr key={session.id} className={`${
                                            isReturned ? 'bg-blue-50/40' :
                                            isDeclined ? 'bg-red-50/40' :
                                            'bg-slate-50'
                                          }`}>
                                            <td className="py-3 px-3 font-semibold text-slate-500">
                                              {session.patient_first_name} {session.patient_last_name}
                                            </td>
                                            <td className="py-3 px-3 text-slate-500">
                                              {session.service_date ? new Date(session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}
                                            </td>
                                            <td className="py-3 px-3 capitalize font-medium text-slate-500">
                                              {session.status || '-'}
                                            </td>
                                            <td className="py-3 px-3 text-slate-500">
                                              {session.type || '-'}
                                            </td>
                                            <td className="py-3 px-3 capitalize text-slate-500">
                                              {session.location || '-'}
                                            </td>
                                            <td className="py-3 px-3 text-slate-500">
                                              {session.start_time || '-'}
                                            </td>
                                            <td className="py-3 px-3 text-slate-500">
                                              {session.end_time || '-'}
                                            </td>
                                            <td className="py-3 px-3 text-slate-500">
                                              {formatTime(session.total_time)}
                                            </td>
                                            <td className="py-3 px-3 text-center">
                                              {(() => {
                                                const review = session.billing_review || (isDeclined ? 'reject' : isReturned ? 'return' : null);
                                                if (group.isOverride && review === 'accept') return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700 border border-violet-200 whitespace-nowrap">Admin Override</span>;
                                                if (review === 'accept') return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">Approved</span>;
                                                if (review === 'reject') return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">Rejected</span>;
                                                if (review === 'return') return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">Returned</span>;
                                                return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">-</span>;
                                              })()}
                                            </td>
                                            <td className="py-3 px-3 text-center">
                                              {session.billing_status === 'invoiced' && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">Invoiced</span>}
                                              {session.billing_status === 'declined' && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">Rejected</span>}
                                              {session.billing_status === 'rejected' && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">Returned</span>}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};