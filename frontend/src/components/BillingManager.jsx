import React, { useState, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import api from '@/api/axiosInstance';
import { formatTime12h } from '@/utils/formatTime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  Search, ChevronRight, ChevronDown, Download, Check, X, Undo2,
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

// --- Click-to-sort table header (used by the Completed Bills vault table) ---
function SortableHeader({ label, field, sort, onSort, className = '' }) {
  const isActive = sort.field === field;
  return (
    <th scope="col" className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-700 transition-colors"
        aria-sort={isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <ChevronDown className={`size-3 transition-transform ${isActive ? 'text-slate-600' : 'opacity-30'} ${isActive && sort.dir === 'asc' ? 'rotate-180' : ''}`} />
      </button>
    </th>
  );
}

export const BillingManager = () => {
  // Billing Specialists get Pending Bills + Completed Bills only — Invoice Status
  // (mark printed / mark paid) is restricted to CEO + Account Specialist, mirroring
  // the backend's invoiceStatusWriteGuard in billingRoutes.js.
  const currentUserRole = localStorage.getItem('role');
  const canSeeInvoiceStatus = currentUserRole !== 'billing';

  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'history' | 'status'

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

  // --- REVERT BATCH MODAL STATE (Completed Bills → Send Back to Pending) ---
  const [revertModal, setRevertModal] = useState(null); // { group } or null
  const [isReverting, setIsReverting] = useState(false);

  // --- PER-LOG ACTION STATE (controls dropdown value + Review badge) ---
  const [logActions, setLogActions] = useState({}); // { [sessionId]: 'accept'|'reject'|'return' }

  // --- HISTORICAL VAULT STATE ---
  const [historyFiles, setHistoryFiles] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState({ start: '', end: '' });
  const [batchMap, setBatchMap] = useState({}); // njeis_path → batch_id
  const [vaultSort, setVaultSort] = useState({ field: 'month', dir: 'desc' }); // matches prior fixed default

  // --- VAULT EXPAND STATE ---
  const [vaultExpandedRows, setVaultExpandedRows] = useState(new Set());
  const [vaultRowLogs, setVaultRowLogs] = useState({});
  const [loadingVaultRow, setLoadingVaultRow] = useState(new Set());

  // --- INVOICE STATUS TAB STATE ---
  const [batches, setBatches] = useState([]);
  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [statusSearch, setStatusSearch] = useState('');
  const [statusDateRange, setStatusDateRange] = useState({ start: '', end: '' });
  const [paidFilter, setPaidFilter] = useState('all'); // 'all' | 'paid' | 'unpaid'
  const [printingBatchId, setPrintingBatchId] = useState(null);
  const [updatingPaidId, setUpdatingPaidId] = useState(null);

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

  const formatMonthLabel = (monthKey) => {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  // Returns YYYY-MM-DD bounds for a "YYYY-MM" key without any Date/ISO timezone conversion
  const getMonthBounds = (monthKey) => {
    const [y, m] = monthKey.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${monthKey}-01`, end: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
  };

  const handleGenerateAndIssue = async (practitionerId) => {
    setProcessingId(practitionerId);
    try {
      // Generation is always scoped to a single calendar month per call, so a practitioner
      // with a multi-month backlog gets one correctly-scoped SEVF + Invoice PER month
      // instead of one merged document spanning all of them.
      const logsForPractitioner = (expandedLogs[practitionerId] || [])
        .filter(l => !['rejected', 'declined'].includes(l.billing_status));
      const months = Array.from(new Set(
        logsForPractitioner.map(l => l.service_date?.slice(0, 7)).filter(Boolean)
      )).sort();
      if (months.length === 0) throw new Error('No billable logs remain — all logs were rejected or returned.');

      const sevfDocuments = [];
      const invoiceDocuments = [];

      for (const month of months) {
        const { start, end } = getMonthBounds(month);

        const njeisRes = await api.post('/api/billing/generate-njeis', { practitionerId, startDate: start, endDate: end });
        if (!njeisRes.data.success) throw new Error(`SEVF generation failed for ${formatMonthLabel(month)}`);
        sevfDocuments.push({ month, url: njeisRes.data.downloadUrl });

        const invoiceRes = await api.post('/api/billing/generate-invoice', { practitionerId, startDate: start, endDate: end });
        if (!invoiceRes.data.success) throw new Error(`Invoice generation failed for ${formatMonthLabel(month)}`);
        invoiceDocuments.push({ month, url: invoiceRes.data.downloadUrl });
      }

      setPractitionerLogs(prev => prev.map(log =>
        log.practitioner_id === practitionerId
          ? { ...log, workflow_status: 'complete', sevf_documents: sevfDocuments, invoice_documents: invoiceDocuments }
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

  const handleRevertBatch = async () => {
    if (!revertModal?.group?.batchId) return;
    setIsReverting(true);
    try {
      const res = await api.post('/api/billing/revert-batch', { batchId: revertModal.group.batchId });
      if (res.data.success) {
        pushToast('success', res.data.message || 'Batch sent back to Pending Bills.');
        setRevertModal(null);
        await fetchHistory();
      }
    } catch (err) {
      if (err.response?.status === 404) {
        pushToast('error', 'This batch was already reverted.');
        setRevertModal(null);
        await fetchHistory();
      } else {
        pushToast('error', 'Failed to send batch back: ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setIsReverting(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
    if (activeTab === 'status') fetchBatches();
  }, [activeTab]);

  // ==========================================
  // INVOICE STATUS TAB LOGIC
  // ==========================================
  const fetchBatches = async () => {
    setIsStatusLoading(true);
    try {
      const res = await api.get('/api/billing/batches');
      if (res.data.success) setBatches(res.data.batches);
    } catch (error) {
      console.error('Failed to fetch billing batches', error);
      pushToast('error', 'Failed to load invoice status list.');
    } finally {
      setIsStatusLoading(false);
    }
  };

  const filteredBatches = batches.filter(b => {
    const practName = `${b.practitioners?.first_name || ''} ${b.practitioners?.last_name || ''}`.trim();
    const term = statusSearch.toLowerCase();
    if (term && !practName.toLowerCase().includes(term)) return false;
    if (statusDateRange.start && (!b.end_date || b.end_date < statusDateRange.start)) return false;
    if (statusDateRange.end && (!b.start_date || b.start_date > statusDateRange.end)) return false;
    if (paidFilter === 'paid' && !b.paid_at) return false;
    if (paidFilter === 'unpaid' && b.paid_at) return false;
    return true;
  });

  const handleTogglePaid = async (batch) => {
    const nextPaid = !batch.paid_at;
    setUpdatingPaidId(batch.id);
    try {
      const res = await api.patch(`/api/billing/batch/${batch.id}/paid`, { paid: nextPaid });
      setBatches(prev => prev.map(b => b.id === batch.id
        ? { ...b, paid_at: nextPaid ? (res.data.paid_at || new Date().toISOString()) : null, stamped_invoice_path: nextPaid ? res.data.stamped_invoice_path : null }
        : b
      ));
      pushToast('success', nextPaid ? 'Invoice marked as paid.' : 'Invoice marked as unpaid.');
    } catch (error) {
      pushToast('error', 'Failed to update paid status: ' + (error.response?.data?.error || error.message));
    } finally {
      setUpdatingPaidId(null);
    }
  };

  const handleUndoPrinted = async (batch) => {
    try {
      await api.patch(`/api/billing/batch/${batch.id}/printed`, { printed: false });
      setBatches(prev => prev.map(b => b.id === batch.id ? { ...b, printed_at: null } : b));
      pushToast('success', 'Printed status cleared.');
    } catch (error) {
      pushToast('error', 'Failed to clear printed status: ' + (error.response?.data?.error || error.message));
    }
  };

  // Opens the browser's real print dialog for the invoice and marks the batch printed when that
  // dialog closes. `afterprint` fires whether the user actually printed or hit Cancel — there is
  // no browser API that distinguishes the two, so this is the practical ceiling of "auto-detect
  // printed."
  //
  // We render the PDF's pages onto <canvas> elements in our own DOM (via pdfjs-dist) rather than
  // embedding the PDF in an <iframe> and calling print() on it — Chrome renders iframe'd PDFs with
  // its native PDF-viewer plugin (a separate guest view), and print() on that iframe's
  // contentWindow does not reliably scope printing to just the iframe; it can silently print the
  // parent page instead (blank, since most of this app's chrome is marked print:hidden). Canvases
  // are genuine same-document content, so window.print()/afterprint behave correctly.
  const handlePrintInvoice = async (batch) => {
    const path = batch.stamped_invoice_path || batch.invoice_path;
    if (!path) return;
    setPrintingBatchId(batch.id);

    const overlay = document.createElement('div');
    overlay.id = 'invoice-print-overlay';
    const style = document.createElement('style');
    style.textContent = `
      @media print {
        body > *:not(#invoice-print-overlay) { display: none !important; }
        #invoice-print-overlay { display: block !important; }
        #invoice-print-overlay canvas { width: 100%; display: block; page-break-after: always; }
      }
    `;

    const cleanup = () => {
      window.removeEventListener('afterprint', onAfterPrint);
      overlay.remove();
      style.remove();
      setPrintingBatchId(null);
    };

    const onAfterPrint = async () => {
      try {
        await api.patch(`/api/billing/batch/${batch.id}/printed`, { printed: true });
        setBatches(prev => prev.map(b => b.id === batch.id ? { ...b, printed_at: new Date().toISOString() } : b));
        pushToast('success', 'Invoice marked as printed.');
      } catch (error) {
        pushToast('error', 'Print dialog closed, but failed to record printed status.');
      } finally {
        cleanup();
      }
    };

    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

      const signedRes = await api.get('/api/billing/download', { params: { fileName: path } });
      if (!signedRes.data.success) throw new Error('Could not get download link');
      const pdfRes = await fetch(signedRes.data.signedUrl);
      if (!pdfRes.ok) throw new Error('Could not fetch PDF');
      const arrayBuffer = await pdfRes.arrayBuffer();

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        overlay.appendChild(canvas);
      }

      document.head.appendChild(style);
      document.body.appendChild(overlay);
      window.addEventListener('afterprint', onAfterPrint, { once: true });
      window.print();
    } catch (error) {
      pushToast('error', 'Failed to open invoice for printing: ' + (error.response?.data?.error || error.message));
      cleanup();
    }
  };

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

  const toggleVaultSort = (field) => {
    setVaultSort(prev => prev.field === field ? { field, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { field, dir: 'desc' });
  };

  const groupedHistory = [...vaultRows].sort((a, b) => {
    let cmp = vaultSort.field === 'practitioner'
      ? a.practitionerName.localeCompare(b.practitionerName)
      : a.serviceMaxDate.localeCompare(b.serviceMaxDate);
    if (vaultSort.dir === 'desc') cmp = -cmp;
    if (cmp !== 0) return cmp;
    return vaultSort.dir === 'desc' ? b.sortTs.localeCompare(a.sortTs) : a.sortTs.localeCompare(b.sortTs);
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
        {canSeeInvoiceStatus && (
          <button
            onClick={() => setActiveTab('status')}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 cursor-pointer ${
              activeTab === 'status'
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
            }`}
          >
            Invoice Status
          </button>
        )}
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
                    const hasBillableLog = logsForRow.some(s => !['rejected', 'declined'].includes(s.billing_status));
                    // Gate: every individual log must have a billing review decision before generating,
                    // and at least one log must still be billable (not rejected/declined) — otherwise
                    // there's nothing left to issue a SEVF/invoice for.
                    const allLogsReviewed = isExpanded && logsForRow.length > 0 && hasBillableLog &&
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
                            {log.sevf_documents?.length > 0 ? (
                              <div className="flex flex-col gap-1.5 items-center">
                                {log.sevf_documents.map(doc => (
                                  <DownloadLink key={doc.month} href={doc.url} label={formatMonthLabel(doc.month)} tone="blue" />
                                ))}
                              </div>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="py-4 px-4 text-center align-top">
                            {log.invoice_documents?.length > 0 ? (
                              <div className="flex flex-col gap-1.5 items-center">
                                {log.invoice_documents.map(doc => (
                                  <DownloadLink key={doc.month} href={doc.url} label={formatMonthLabel(doc.month)} tone="emerald" />
                                ))}
                              </div>
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
                                              {session.start_time ? formatTime12h(session.start_time) : '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.end_time ? formatTime12h(session.end_time) : '-'}
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

      {/* REVERT BATCH MODAL (Completed Bills → Send Back to Pending) */}
      <Dialog open={!!revertModal} onOpenChange={(open) => { if (!open && !isReverting) setRevertModal(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Batch Back to Pending</DialogTitle>
            <DialogDescription>
              This will permanently delete the SEVF form and Invoice PDF for this batch, and move every log in it back to Pending Bills. This cannot be undone — the batch will need to be regenerated from scratch.
            </DialogDescription>
          </DialogHeader>

          {revertModal && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm space-y-1">
              <div className="font-semibold text-slate-800 capitalize">
                {revertModal.group.practitionerName}
              </div>
              <div className="text-slate-500 tabular-nums">
                {revertModal.group.dateRange || '-'}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setRevertModal(null)} disabled={isReverting}>
              Cancel
            </Button>
            <Button
              className="text-white cursor-pointer disabled:opacity-50 bg-amber-600 hover:bg-amber-700"
              onClick={handleRevertBatch}
              disabled={isReverting}
            >
              {isReverting ? 'Sending Back...' : 'Send Back to Pending'}
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
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse tabular-nums">
              <caption className="sr-only">Completed billing documents</caption>
              <thead>
                <tr className="bg-white border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  <SortableHeader label="Period / Date" field="month" sort={vaultSort} onSort={toggleVaultSort} className="py-4 px-6" />
                  <SortableHeader label="Practitioner" field="practitioner" sort={vaultSort} onSort={toggleVaultSort} className="py-4 px-6" />
                  <th scope="col" className="py-4 px-6 text-center">SEVF Form</th>
                  <th scope="col" className="py-4 px-6 text-center">Invoice</th>
                  <th scope="col" className="py-4 px-6 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isHistoryLoading ? (
                  <tr><td colSpan="5" className="py-12 text-center text-slate-500">Accessing secure records...</td></tr>
                ) : groupedHistory.length === 0 ? (
                  <tr><td colSpan="5" className="py-12 text-center text-slate-500">No matching documents found.</td></tr>
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

                          {/* ACTIONS COLUMN */}
                          <td className="py-4 px-6 text-center">
                            {group.batchId && group.invoiceFile ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="cursor-pointer text-amber-700 border-amber-300 hover:bg-amber-50"
                                onClick={() => setRevertModal({ group })}
                              >
                                <Undo2 className="size-3.5 mr-1.5" />
                                Send Back to Pending
                              </Button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        </tr>

                        {/* EXPANDED SUB-TABLE */}
                        {isVaultExpanded && (
                          <tr>
                            <td colSpan="5" className="bg-white px-0 py-0 border-b border-slate-200">
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
                                              {session.start_time ? formatTime12h(session.start_time) : '-'}
                                            </td>
                                            <td className={`py-3 px-3 ${isInactive ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {session.end_time ? formatTime12h(session.end_time) : '-'}
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

      {/* TAB 3: INVOICE STATUS */}
      {activeTab === 'status' && canSeeInvoiceStatus && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-7 py-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-6 items-end justify-between">
            <div className="flex-1 min-w-[250px] max-w-md space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Search Practitioner</Label>
              <div className="relative">
                <Search className="size-4 absolute left-3 top-2.5 text-slate-400" />
                <Input type="text" placeholder="Search by practitioner name..." className="pl-10" value={statusSearch} onChange={(e) => setStatusSearch(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-4 items-end">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Service Date From</Label>
                <Input type="date" value={statusDateRange.start} onChange={(e) => setStatusDateRange({ ...statusDateRange, start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Service Date To</Label>
                <Input type="date" value={statusDateRange.end} onChange={(e) => setStatusDateRange({ ...statusDateRange, end: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Payment Status</Label>
                <Select value={paidFilter} onValueChange={setPaidFilter}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={fetchBatches} variant="outline" size="lg" className="cursor-pointer text-slate-600">Refresh</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse tabular-nums">
              <caption className="sr-only">Invoice printed and paid status</caption>
              <thead>
                <tr className="bg-white border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  <th scope="col" className="py-4 px-6">Period</th>
                  <th scope="col" className="py-4 px-6">Practitioner</th>
                  <th scope="col" className="py-4 px-6 text-center">Invoice</th>
                  <th scope="col" className="py-4 px-6 text-center">Printed</th>
                  <th scope="col" className="py-4 px-6 text-center">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isStatusLoading ? (
                  <tr><td colSpan="5" className="py-12 text-center text-slate-500">Loading invoices...</td></tr>
                ) : filteredBatches.length === 0 ? (
                  <tr><td colSpan="5" className="py-12 text-center text-slate-500">No matching invoices found.</td></tr>
                ) : (
                  filteredBatches.map((batch) => {
                    const practName = `${batch.practitioners?.first_name || ''} ${batch.practitioners?.last_name || ''}`.trim() || 'Unknown';
                    const dateRange = batch.start_date && batch.end_date
                      ? `${new Date(batch.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })} – ${new Date(batch.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}`
                      : '-';
                    const isPrinting = printingBatchId === batch.id;
                    const isUpdatingPaid = updatingPaidId === batch.id;
                    return (
                      <tr key={batch.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-4 px-6 text-sm font-medium text-slate-800">{dateRange}</td>
                        <td className="py-4 px-6 font-bold text-slate-800 capitalize">{practName}</td>
                        <td className="py-4 px-6 text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            className="cursor-pointer text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50"
                            onClick={() => handlePrintInvoice(batch)}
                            disabled={isPrinting || !batch.invoice_path}
                          >
                            {isPrinting ? 'Opening…' : 'Print Invoice'}
                          </Button>
                        </td>
                        <td className="py-4 px-6 text-center">
                          {batch.printed_at ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" onClick={() => handleUndoPrinted(batch)} className="cursor-pointer">
                                  <Badge variant="success">Printed</Badge>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Printed {new Date(batch.printed_at).toLocaleString()} — click to undo
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge variant="neutral">Not Printed</Badge>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <button
                            type="button"
                            onClick={() => handleTogglePaid(batch)}
                            disabled={isUpdatingPaid}
                            className="cursor-pointer disabled:opacity-50"
                          >
                            <Badge variant={batch.paid_at ? 'success' : 'warning'}>
                              {isUpdatingPaid ? 'Updating…' : batch.paid_at ? `Paid ${new Date(batch.paid_at).toLocaleDateString()}` : 'Unpaid'}
                            </Badge>
                          </button>
                        </td>
                      </tr>
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
