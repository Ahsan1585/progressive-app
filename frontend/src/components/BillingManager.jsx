import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  Search, ChevronRight, Download, Check, X, Undo2,
  Ban, Clock, Lock, CheckCircle2, CircleAlert,
} from 'lucide-react';

// --- Review-badge resolution (kept separate: pending-queue and vault-history are genuinely different decision trees) ---
function getPendingReviewBadge(session, isLocked, isReturned, logActions) {
  if (isLocked && session.billing_status === 'njeis_review') return { variant: 'success', label: 'In SEVF' };
  if (isLocked && session.billing_status === 'declined') return { variant: 'danger', label: 'Rejected' };
  if (isReturned) return { variant: 'info', label: 'Returned' };
  if (session.billing_status === 'pending' && session.rejection_count > 0 && !logActions[session.id]) return { variant: 'override', label: 'Resubmitted' };
  const action = logActions[session.id] || session.billing_review || (session.billing_status === 'declined' ? 'reject' : null);
  if (action === 'accept') return { variant: 'success', label: 'Approved' };
  if (action === 'reject') return { variant: 'danger', label: 'Rejected' };
  if (action === 'return') return { variant: 'info', label: 'Returned' };
  return { variant: 'neutral', label: 'Pending' };
}

function getVaultReviewBadge(session, isDeclined, isReturned, isOverride) {
  const review = session.billing_review || (isDeclined ? 'reject' : isReturned ? 'return' : null);
  if (isOverride && review === 'accept') return { variant: 'override', label: 'Admin Override' };
  if (review === 'accept') return { variant: 'success', label: 'Approved' };
  if (review === 'reject') return { variant: 'danger', label: 'Rejected' };
  if (review === 'return') return { variant: 'info', label: 'Returned' };
  return { variant: 'neutral', label: '-' };
}

// --- Shared document-download control (used by both tabs so SEVF/Invoice links look identical everywhere) ---
function DownloadLink({ href, onClick, label, tone = 'blue', fixedWidth = false }) {
  const toneClasses = tone === 'emerald'
    ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
    : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100';
  const className = `inline-flex items-center justify-center gap-1.5 ${fixedWidth ? 'w-28' : ''} px-3 py-1.5 text-sm font-semibold rounded-md border transition-colors cursor-pointer ${toneClasses}`;

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        <Download className="size-4" />
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      <Download className="size-4" />
      {label}
    </button>
  );
}

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

  // --- TOAST STATE (replaces alert()) ---
  const [toasts, setToasts] = useState([]); // [{ id, type: 'success'|'error', message }]
  const pushToast = (type, message) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };
  const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

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

  const closeActionModal = () => {
    if (actionModal) setLogActions(prev => ({ ...prev, [actionModal.session.id]: '' }));
    setActionModal(null);
    setActionNote('');
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
      if (!njeisRes.data.success) throw new Error('SEVF generation failed');
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
      pushToast('error', 'Generation failed: ' + error.message);
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
        pushToast('success', res.data.message);
      }
    } catch (err) {
      console.error('Backfill failed', err);
      pushToast('error', 'Backfill failed: ' + (err.response?.data?.error || err.message));
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
    } catch (error) {
      pushToast('error', 'Failed to download file.');
    }
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

      {/* TAB NAVIGATION */}
      <div className="flex p-1 bg-slate-200/60 rounded-xl w-fit border border-slate-200 shadow-sm">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 cursor-pointer ${
            activeTab === 'pending'
              ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
          }`}
        >
          Pending Bills
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 cursor-pointer ${
            activeTab === 'history'
              ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
          }`}
        >
          Completed Bills
        </button>
      </div>

      {/* TAB 1: PENDING BILLS */}
      {activeTab === 'pending' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-7 py-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-6 items-end justify-between">
            <div className="flex-1 min-w-[250px] max-w-md space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Search Practitioners</Label>
              <div className="relative">
                <Search className="size-4 absolute left-3 top-2.5 text-slate-400" />
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
              <Button onClick={fetchLogs} variant="outline" size="lg" className="cursor-pointer text-slate-600">Refresh</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse tabular-nums">
              <caption className="sr-only">Pending practitioner billing queue</caption>
              <thead>
                <tr className="bg-white border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  <th scope="col" className="py-4 px-4">Practitioner</th>
                  <th scope="col" className="py-4 px-4 text-center">Logs</th>
                  <th scope="col" className="py-4 px-4 text-center">Children</th>
                  <th scope="col" className="py-4 px-4 text-center">Status</th>
                  <th scope="col" className="py-4 px-4 text-center">SEVF Form</th>
                  <th scope="col" className="py-4 px-4 text-center">Invoice</th>
                  <th scope="col" className="py-4 px-4 text-right">Action</th>
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
                          <td className="py-4 px-4 align-top">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleToggleExpand(log.practitioner_id)}
                                className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-400 flex-shrink-0 cursor-pointer"
                                aria-label={isExpanded ? 'Collapse logs' : 'Expand logs'}
                                aria-expanded={isExpanded}
                              >
                                <ChevronRight className={`size-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              <div>
                                <div className="font-bold text-slate-800 capitalize">{log.first_name} {log.last_name}</div>
                                <div className="text-xs text-slate-500 mt-0.5 font-mono">ID: {log.practitioner_id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center align-top">
                            <div className="font-bold text-slate-700">{log.total_interventions}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{log.total_hours.toFixed(1)} hrs</div>
                            {declinedCount > 0 && (
                              <div className="text-xs text-red-500 font-semibold mt-0.5">({declinedCount} rejected)</div>
                            )}
                          </td>
                          <td className="py-4 px-4 text-center align-top font-medium text-slate-600">
                            {log.unique_children_count}
                          </td>
                          <td className="py-4 px-4 text-center align-top">
                            {log.workflow_status === 'pending' && <Badge variant="warning">Awaiting Forms</Badge>}
                            {log.workflow_status === 'njeis_review' && <Badge variant="info">In Review</Badge>}
                            {log.workflow_status === 'complete' && <Badge variant="success">Complete</Badge>}
                          </td>
                          <td className="py-4 px-4 text-center align-top">
                            {log.njeis_url ? (
                              <DownloadLink href={log.njeis_url} label="SEVF" tone="blue" />
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="py-4 px-4 text-center align-top">
                            {log.invoice_url ? (
                              <DownloadLink href={log.invoice_url} label="Invoice" tone="emerald" />
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="py-4 px-4 text-right align-top">
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
                                <CheckCircle2 className="size-4 mr-1" />
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
                                  <table className="w-full text-left border-collapse text-sm tabular-nums">
                                    <caption className="sr-only">Individual session logs for {log.first_name} {log.last_name}</caption>
                                    <thead>
                                      <tr className="text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-300">
                                        <th scope="col" className="py-2.5 px-3">Patient Name</th>
                                        <th scope="col" className="py-2.5 px-3">Service Date</th>
                                        <th scope="col" className="py-2.5 px-3">Service Status</th>
                                        <th scope="col" className="py-2.5 px-3">Service Type</th>
                                        <th scope="col" className="py-2.5 px-3">Service Location</th>
                                        <th scope="col" className="py-2.5 px-3">Start Time</th>
                                        <th scope="col" className="py-2.5 px-3">End Time</th>
                                        <th scope="col" className="py-2.5 px-3">Total Time</th>
                                        <th scope="col" className="py-2.5 px-3 text-center">Review</th>
                                        <th scope="col" className="py-2.5 px-3 text-right">Billing Action</th>
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
                                        const reviewBadge = getPendingReviewBadge(session, isLocked, isReturned, logActions);

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
                                              <Badge variant={reviewBadge.variant}>{reviewBadge.label}</Badge>
                                            </td>

                                            {/* Action — locked (with tooltip) or Select dropdown */}
                                            <td className="py-2.5 px-3 text-right">
                                              {isProcessing ? (
                                                <span className="text-xs text-slate-400">Processing...</span>
                                              ) : isDeclined ? (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <div className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-medium select-none">
                                                      <Ban className="size-3.5 flex-shrink-0" />
                                                      Excluded
                                                    </div>
                                                  </TooltipTrigger>
                                                  <TooltipContent>Permanently rejected — not included in the generated report</TooltipContent>
                                                </Tooltip>
                                              ) : isReturned ? (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <div className="inline-flex items-center gap-1.5 text-amber-500 text-xs font-medium select-none">
                                                      <Clock className="size-3.5 flex-shrink-0" />
                                                      Awaiting Revision
                                                    </div>
                                                  </TooltipTrigger>
                                                  <TooltipContent>Returned to practitioner for revision — awaiting resubmission</TooltipContent>
                                                </Tooltip>
                                              ) : isLocked ? (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <div className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-medium select-none">
                                                      <Lock className="size-3.5 flex-shrink-0" />
                                                      Locked
                                                    </div>
                                                  </TooltipTrigger>
                                                  <TooltipContent>SEVF has been issued. This log is locked until it returns to pending.</TooltipContent>
                                                </Tooltip>
                                              ) : (
                                                <Select
                                                  value={logActions[session.id] || session.billing_review || undefined}
                                                  onValueChange={(action) => {
                                                    if (!action) return;
                                                    setLogActions(prev => ({ ...prev, [session.id]: action }));
                                                    if (action === 'accept') {
                                                      handleAccept(session, log.practitioner_id);
                                                    } else {
                                                      setActionModal({ session, practitionerId: log.practitioner_id, type: action });
                                                      setActionNote('');
                                                    }
                                                  }}
                                                >
                                                  <SelectTrigger size="sm" className="ml-auto w-[132px]">
                                                    <SelectValue placeholder="Select action" />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="accept">
                                                      <span className="inline-flex items-center gap-1.5">
                                                        <Check className="size-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                                                        Accept
                                                      </span>
                                                    </SelectItem>
                                                    <SelectItem value="reject">
                                                      <span className="inline-flex items-center gap-1.5">
                                                        <X className="size-3.5 text-red-600 shrink-0" aria-hidden="true" />
                                                        Reject
                                                      </span>
                                                    </SelectItem>
                                                    <SelectItem value="return">
                                                      <span className="inline-flex items-center gap-1.5">
                                                        <Undo2 className="size-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                                                        Return
                                                      </span>
                                                    </SelectItem>
                                                  </SelectContent>
                                                </Select>
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
      <Dialog open={!!actionModal} onOpenChange={(open) => { if (!open) closeActionModal(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionModal?.type === 'return' ? 'Return Log to Practitioner' : 'Reject Log'}</DialogTitle>
            <DialogDescription>
              {actionModal?.type === 'return'
                ? 'This log will be sent back to the practitioner for revision. They must correct and resubmit it before it can be billed.'
                : 'This log will be permanently rejected from billing. The practitioner will be notified — no further action is required from them.'}
            </DialogDescription>
          </DialogHeader>

          {actionModal && (
            <>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm space-y-1">
                <div className="font-semibold text-slate-800">
                  {actionModal.session.patient_first_name} {actionModal.session.patient_last_name}
                </div>
                <div className="text-slate-500 tabular-nums">
                  {actionModal.session.service_date
                    ? new Date(actionModal.session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : '-'}
                  {' · '}{actionModal.session.type || '-'}
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  {actionModal.type === 'return' ? 'Return Note' : 'Rejection Reason'}
                  <span className="text-red-500 ml-1">*</span>
                </Label>
                <Textarea
                  className={
                    actionModal.type === 'return'
                      ? 'focus-visible:ring-blue-500/30 focus-visible:border-blue-400'
                      : 'focus-visible:ring-red-500/30 focus-visible:border-red-400'
                  }
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
            </>
          )}

          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={closeActionModal} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              className={`text-white cursor-pointer disabled:opacity-50 ${
                actionModal?.type === 'return' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'
              }`}
              onClick={handleActionSubmit}
              disabled={!actionNote.trim() || isSubmitting}
            >
              {isSubmitting
                ? 'Sending...'
                : actionModal?.type === 'return'
                  ? 'Return to Practitioner'
                  : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TAB 2: COMPLETED BILLS */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-7 py-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-6 items-end justify-between">
            <div className="flex-1 min-w-[250px] max-w-md space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Search Documents</Label>
              <div className="relative">
                <Search className="size-4 absolute left-3 top-2.5 text-slate-400" />
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
              <Button onClick={fetchHistory} variant="outline" size="lg" className="cursor-pointer text-slate-600">Refresh Bills</Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleBackfill}
                    disabled={isBackfilling}
                    variant="outline"
                    size="lg"
                    className="cursor-pointer text-amber-700 border-amber-300 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {isBackfilling ? 'Fixing…' : 'Fix Bills'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Link existing storage files to their billing batches — fixes duplicate logs in older bill entries</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse tabular-nums">
              <caption className="sr-only">Completed billing documents</caption>
              <thead>
                <tr className="bg-white border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  <th scope="col" className="py-4 px-6">Period / Date</th>
                  <th scope="col" className="py-4 px-6">Practitioner</th>
                  <th scope="col" className="py-4 px-6 text-center">SEVF Form</th>
                  <th scope="col" className="py-4 px-6 text-center">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isHistoryLoading ? (
                  <tr><td colSpan="4" className="py-12 text-center text-slate-500">Accessing secure records...</td></tr>
                ) : groupedHistory.length === 0 ? (
                  <tr><td colSpan="4" className="py-12 text-center text-slate-500">No matching documents found.</td></tr>
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
                                aria-label={isVaultExpanded ? 'Collapse logs' : 'Expand logs'}
                                aria-expanded={isVaultExpanded}
                              >
                                <ChevronRight className={`size-4 transition-transform duration-200 ${isVaultExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              <span className="font-bold text-slate-800 capitalize">{group.practitionerName}</span>
                            </div>
                          </td>

                          {/* SEVF FORM COLUMN */}
                          <td className="py-4 px-6 text-center">
                            {group.njeisFile ? (
                              <DownloadLink onClick={() => handleDownloadHistory(group.njeisFile.name)} label="SEVF" tone="blue" fixedWidth />
                            ) : group.isOverride ? (
                              <Badge variant="override">Override</Badge>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>

                          {/* INVOICE COLUMN */}
                          <td className="py-4 px-6 text-center">
                            {group.invoiceFile ? (
                              <DownloadLink onClick={() => handleDownloadHistory(group.invoiceFile.name)} label="Invoice" tone="emerald" fixedWidth />
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
                                  <table className="w-full text-left border-collapse text-sm tabular-nums">
                                    <caption className="sr-only">Individual session logs for {group.practitionerName}, {group.dateRange}</caption>
                                    <thead>
                                      <tr className="text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-300">
                                        <th scope="col" className="py-2.5 px-3">Patient Name</th>
                                        <th scope="col" className="py-2.5 px-3">Service Date</th>
                                        <th scope="col" className="py-2.5 px-3">Service Status</th>
                                        <th scope="col" className="py-2.5 px-3">Service Type</th>
                                        <th scope="col" className="py-2.5 px-3">Service Location</th>
                                        <th scope="col" className="py-2.5 px-3">Start Time</th>
                                        <th scope="col" className="py-2.5 px-3">End Time</th>
                                        <th scope="col" className="py-2.5 px-3">Total Time</th>
                                        <th scope="col" className="py-2.5 px-3 text-center">Review</th>
                                        <th scope="col" className="py-2.5 px-3 text-center">Billing Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                      {vaultLogs.map((session) => {
                                        const isDeclined = session.billing_status === 'declined';
                                        const isReturned = session.billing_status === 'rejected';
                                        // Only genuinely inactive (excluded/awaiting-revision) rows are muted —
                                        // successfully invoiced/approved rows read at full contrast.
                                        const isInactive = isDeclined || isReturned;
                                        const reviewBadge = getVaultReviewBadge(session, isDeclined, isReturned, group.isOverride);
                                        return (
                                          <tr key={session.id} className={
                                            isReturned ? 'bg-blue-50/40' :
                                            isDeclined ? 'bg-red-50/40' :
                                            ''
                                          }>
                                            <td className={`py-3 px-3 font-semibold ${isInactive ? 'text-slate-400' : 'text-slate-800'}`}>
                                              {session.patient_first_name} {session.patient_last_name}
                                            </td>
                                            <td className={`py-3 px-3 ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.service_date ? new Date(session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}
                                            </td>
                                            <td className={`py-3 px-3 capitalize font-medium ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.status || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.type || '-'}
                                            </td>
                                            <td className={`py-3 px-3 capitalize ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.location || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.start_time || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.end_time || '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {formatTime(session.total_time)}
                                            </td>
                                            <td className="py-3 px-3 text-center">
                                              <Badge variant={reviewBadge.variant}>{reviewBadge.label}</Badge>
                                            </td>
                                            <td className="py-3 px-3 text-center">
                                              {session.billing_status === 'invoiced' && <Badge variant="success">Invoiced</Badge>}
                                              {session.billing_status === 'declined' && <Badge variant="danger">Rejected</Badge>}
                                              {session.billing_status === 'rejected' && <Badge variant="info">Returned</Badge>}
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

      {/* TOASTS (replaces alert()) */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg ${
              t.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            {t.type === 'error' ? (
              <CircleAlert className="size-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} className="text-current/60 hover:text-current cursor-pointer" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
