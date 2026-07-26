import React, { useState, useEffect, useRef } from 'react';
import api from '@/api/axiosInstance';
import { formatTime12h } from '@/utils/formatTime';
import { Button } from '@/components/ui/button';
import {
  Search, ChevronDown, Lock, PlayCircle, Check, X, Undo2,
  Ban, Clock, MessageSquareText, CheckCircle2, Sparkles, Download,
  Users, ClipboardList, MousePointerClick, CalendarDays, RefreshCw,
} from 'lucide-react';

// Matches BillingManager.jsx's own formatMonthLabel — batches are keyed by
// "YYYY-MM" (batch.start_date sliced), shown here as e.g. "Jun 2026".
const formatMonthLabel = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

// --- Billing period rules (beta only, per explicit request): a specialist
// can only run Biweekly 1 (1st–15th), Biweekly 2 (16th–last day), or the
// full Month — never an arbitrary custom range — and never a period that
// hasn't fully elapsed yet, so nothing gets billed before all of that
// window's sessions could plausibly have been logged. Biweekly 2's end
// (and the Monthly end) is computed from the real number of days in that
// month, so Feb/30-day months aren't hardcoded to day 30.
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = new Date().toISOString().slice(0, 10);

function getMonthPeriods(monthValue) {
  if (!monthValue) return [];
  const [year, month] = monthValue.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const mm = pad2(month);
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  const periods = [
    { key: 'bw1', label: 'Biweekly 1', sub: `${monthName} 1–15`, start: `${year}-${mm}-01`, end: `${year}-${mm}-15` },
    { key: 'bw2', label: 'Biweekly 2', sub: `${monthName} 16–${daysInMonth}`, start: `${year}-${mm}-16`, end: `${year}-${mm}-${pad2(daysInMonth)}` },
    { key: 'monthly', label: 'Monthly', sub: `${monthName} 1–${daysInMonth}`, start: `${year}-${mm}-01`, end: `${year}-${mm}-${pad2(daysInMonth)}` },
  ];
  // A period unlocks the day after it ends — e.g. Biweekly 1 (…-15) becomes
  // selectable on the 16th, Monthly becomes selectable on the 1st of next month.
  return periods.map(p => ({ ...p, elapsed: todayStr > p.end }));
}

// --- Beta "Batch Review" view for Pending Bills: a master-detail layout
// (a scrollable list of ALL practitioners with pending logs on the left —
// same as the legacy table, just laid out as collapsible/lockable groups —
// and session detail with one-click actions on the right) over the exact
// same data/handlers the legacy table already uses. Every action here calls
// the same functions passed down from BillingManager, which call the same
// backend endpoints either way — this is a presentation layer, not a
// second workflow.
export const BillingBatchReview = ({
  practitioners,
  currentUserId, isAdmin, processingLogId, processingId,
  logActions, setLogActions,
  handleLock, handleRelease, handleAccept, handleResetToPending, handleHold, handleReleaseHold, handleReconcile,
  handleInlineReturnReject,
  handleGenerateAndIssue, handleSendToCompleted, pushToast, formatTime,
}) => {
  const [practitionerSearch, setPractitionerSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [detail, setDetail] = useState(null); // { practitionerId, sessionId } | null
  const [detailTab, setDetailTab] = useState('session'); // 'session' | 'analysis'

  // --- Billing period (Biweekly 1 / Biweekly 2 / Monthly, see getMonthPeriods) ---
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const periods = getMonthPeriods(selectedMonth);

  // Session data is fetched locally, scoped to the selected period — kept
  // separate from BillingManager's own expandedLogs (which the legacy table
  // still drives off the shared top-of-page date filter), so switching
  // periods here can never bleed a different date range into that view.
  const [periodLogs, setPeriodLogs] = useState({}); // { [practitionerId]: sessions[] }
  const [periodLoading, setPeriodLoading] = useState(new Set());

  const fetchPeriodLogs = async (practitionerId, { silent = false } = {}) => {
    if (!selectedPeriod) return;
    if (!silent) setPeriodLoading(prev => new Set(prev).add(practitionerId));
    try {
      const res = await api.get('/api/billing/practitioner-logs', {
        params: { practitionerId, startDate: selectedPeriod.start, endDate: selectedPeriod.end }
      });
      if (res.data.success) setPeriodLogs(prev => ({ ...prev, [practitionerId]: res.data.logs }));
    } catch (error) {
      console.error('Failed to fetch period logs', error);
    } finally {
      if (!silent) setPeriodLoading(prev => { const n = new Set(prev); n.delete(practitionerId); return n; });
    }
  };

  // The practitioner list itself also needs to be scoped to the selected
  // period — otherwise a practitioner whose only pending logs fall outside
  // this period (e.g. later in the month) still shows up here with an
  // empty, confusing "No individual logs found" once locked/expanded.
  // Fetched fresh per period from the same endpoint the legacy table uses,
  // just with startDate/endDate set to the period's bounds.
  const [periodPractitioners, setPeriodPractitioners] = useState([]);
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);

  const fetchPeriodPractitioners = async ({ silent = false } = {}) => {
    if (!selectedPeriod) return;
    if (!silent) setIsLoadingPractitioners(true);
    try {
      const res = await api.get('/api/billing/pending-logs', {
        params: { startDate: selectedPeriod.start, endDate: selectedPeriod.end }
      });
      if (res.data.success) setPeriodPractitioners(res.data.logs);
    } catch (error) {
      console.error('Failed to fetch period practitioners', error);
    } finally {
      if (!silent) setIsLoadingPractitioners(false);
    }
  };

  // Changing the period invalidates every previously-fetched session list
  // and practitioner list — start clean rather than show stale data.
  useEffect(() => {
    setPeriodLogs({});
    setPeriodPractitioners([]);
    setExpandedGroups(new Set());
    setDetail(null);
    fetchPeriodPractitioners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod]);

  const filteredPractitioners = periodPractitioners.filter(p =>
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(practitionerSearch.toLowerCase()) ||
    p.practitioner_id?.toString().includes(practitionerSearch)
  );

  // A practitioner already locked to the current user (from a previous
  // visit, a page refresh mid-review, etc.) should show open and populated
  // without requiring a manual click — otherwise the queue silently looks
  // empty even though real sessions exist. Auto-expand + fetch each one
  // exactly once per period (autoHandledRef prevents re-forcing a group
  // back open after the user deliberately collapses it).
  const autoHandledRef = useRef(new Set());
  useEffect(() => {
    if (!selectedPeriod) return;
    periodPractitioners.forEach(p => {
      const isLockedByMe = p.locked_by_id && p.locked_by_id === currentUserId;
      const key = `${selectedPeriod.key}:${p.practitioner_id}`;
      if (!isLockedByMe || autoHandledRef.current.has(key)) return;
      autoHandledRef.current.add(key);
      setExpandedGroups(prev => new Set(prev).add(p.practitioner_id));
      fetchPeriodLogs(p.practitioner_id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPractitioners, selectedPeriod]);

  // Keep the queue live — e.g. a practitioner resubmitting a returned log
  // from the mobile app should show up here without the biller having to
  // leave and re-enter the tab. Mirrors the legacy table's 20s silent poll.
  // expandedGroupsRef avoids resubscribing the interval every time a group
  // is expanded/collapsed, which would otherwise reset the timer.
  const expandedGroupsRef = useRef(expandedGroups);
  useEffect(() => { expandedGroupsRef.current = expandedGroups; }, [expandedGroups]);
  useEffect(() => {
    if (!selectedPeriod) return;
    const interval = setInterval(() => {
      fetchPeriodPractitioners({ silent: true });
      expandedGroupsRef.current.forEach(practitionerId => fetchPeriodLogs(practitionerId, { silent: true }));
    }, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod]);

  const toggleGroup = (practitionerId) => {
    const willExpand = !expandedGroups.has(practitionerId);
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(practitionerId) ? next.delete(practitionerId) : next.add(practitionerId);
      return next;
    });
    if (willExpand && periodLogs[practitionerId] === undefined) fetchPeriodLogs(practitionerId);
  };

  const onLock = async (practitionerId) => {
    await handleLock(practitionerId);
    setExpandedGroups(prev => new Set(prev).add(practitionerId));
    // handleLock only updates BillingManager's own (unscoped) practitioner
    // list — periodPractitioners is a separate local copy, so without this
    // the lock chip here never updates and Lock to Review looks like it did
    // nothing.
    await fetchPeriodPractitioners();
    await fetchPeriodLogs(practitionerId);
  };

  const onRelease = async (practitionerId) => {
    await handleRelease(practitionerId);
    await fetchPeriodPractitioners();
  };

  const selectSession = (practitionerId, sessionId) => {
    setDetail({ practitionerId, sessionId });
    setDetailTab('session');
  };

  // Wrap every session-mutating action so the local period-scoped cache
  // (not just BillingManager's own state) reflects the result — otherwise
  // Approve/Hold/Return/Reject/Reconcile would update the wrong cache and
  // appear to do nothing here.
  const withRefetch = (fn) => async (session, practitionerId, ...rest) => {
    await fn(session, practitionerId, ...rest);
    await fetchPeriodLogs(practitionerId);
  };
  const wrappedAccept = withRefetch(handleAccept);
  const wrappedResetToPending = withRefetch(handleResetToPending);
  const wrappedHold = withRefetch(handleHold);
  const wrappedReleaseHold = withRefetch(handleReleaseHold);
  const wrappedReconcile = withRefetch(handleReconcile);
  const wrappedInlineReturnReject = async (session, practitionerId, type, note) => {
    await handleInlineReturnReject(session, practitionerId, type, note);
    await fetchPeriodLogs(practitionerId);
  };
  const wrappedGenerateAndIssue = async (practitionerId) => {
    if (!selectedPeriod) return;
    await handleGenerateAndIssue(practitionerId, { startDate: selectedPeriod.start, endDate: selectedPeriod.end });
    await fetchPeriodLogs(practitionerId);
    await fetchPeriodPractitioners();
  };
  const wrappedSendToCompleted = async (practitionerId) => {
    await handleSendToCompleted(practitionerId);
    await fetchPeriodLogs(practitionerId);
    await fetchPeriodPractitioners();
  };

  const detailPractitioner = detail ? periodPractitioners.find(p => p.practitioner_id === detail.practitionerId) : null;
  const detailSessions = detail ? (periodLogs[detail.practitionerId] || []) : [];
  const detailSession = detail ? detailSessions.find(s => s.id === detail.sessionId) || null : null;

  return (
    <div className="flex flex-col">
      {/* PERIOD PICKER: Biweekly 1 / Biweekly 2 / Monthly only, never custom,
          never a period that hasn't fully elapsed yet. */}
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-200 bg-white flex-wrap">
        <div className="flex items-center gap-2 flex-shrink-0">
          <CalendarDays className="size-4 text-slate-500" />
          <span className="text-sm font-bold text-slate-700">Billing Period</span>
        </div>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => { setSelectedMonth(e.target.value); setSelectedPeriod(null); }}
          className="text-sm font-semibold text-slate-800 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <div className="flex gap-2 flex-wrap">
          {periods.map(p => {
            const isActive = selectedPeriod?.key === p.key;
            return (
              <button
                key={p.key}
                type="button"
                disabled={!p.elapsed}
                onClick={() => setSelectedPeriod(p)}
                title={p.elapsed ? '' : `Not available until ${new Date(new Date(p.end + 'T00:00:00').getTime() + 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                className={`text-left px-3.5 py-2 rounded-lg border transition-colors ${
                  !p.elapsed ? 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed'
                    : isActive ? 'border-blue-500 bg-blue-600 text-white cursor-pointer'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 cursor-pointer'
                }`}
              >
                <div className="text-sm font-bold flex items-center gap-1.5">
                  {p.label}
                  {!p.elapsed && <Lock className="size-3" />}
                </div>
                <div className={`text-xs ${isActive ? 'text-blue-100' : 'text-slate-400'}`}>{p.sub}</div>
              </button>
            );
          })}
        </div>
        {selectedPeriod && (
          <span className="text-xs text-slate-400 ml-auto">
            Reviewing <b className="text-slate-600">{selectedPeriod.label}</b> ({selectedPeriod.start} – {selectedPeriod.end})
          </span>
        )}
      </div>

      {!selectedPeriod ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 bg-slate-50">
          <CalendarDays className="size-10 text-slate-300" />
          <p className="text-lg font-bold text-slate-600">Select a completed billing period above to begin</p>
          <p className="text-sm text-slate-400 max-w-md text-center">Only fully-elapsed Biweekly or Monthly periods can be selected — you can't generate bills mid-period.</p>
        </div>
      ) : (
      <div className="flex h-[80vh] min-h-[720px] shadow-inner bg-slate-100">
      {/* LEFT: every practitioner with pending logs, as collapsible/lockable groups */}
      <div className="w-[480px] flex-shrink-0 border-r-2 border-slate-300 flex flex-col bg-slate-50/40 shadow-[4px_0_12px_-6px_rgba(15,23,42,0.15)] z-10">
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-800 text-white">
          <Users className="size-4" />
          <span className="text-sm font-bold uppercase tracking-wide">Practitioner Queue</span>
        </div>
        <div className="p-4 border-b border-slate-200">
          <div className="relative">
            <Search className="size-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search practitioner..."
              className="w-full pl-10 pr-3 py-2.5 text-base rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              value={practitionerSearch}
              onChange={(e) => setPractitionerSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoadingPractitioners ? (
            <div className="p-6 text-center text-base text-slate-400">Loading practitioners for this period...</div>
          ) : filteredPractitioners.length === 0 ? (
            <div className="p-6 text-center text-base text-slate-400">
              {periodPractitioners.length === 0 ? 'No pending logs in this period.' : 'No practitioner matches your search.'}
            </div>
          ) : filteredPractitioners.map(p => (
            <PractitionerGroup
              key={p.practitioner_id}
              practitioner={p}
              isExpanded={expandedGroups.has(p.practitioner_id)}
              onToggle={() => toggleGroup(p.practitioner_id)}
              sessions={periodLogs[p.practitioner_id] || []}
              isLoadingSessions={periodLoading.has(p.practitioner_id)}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onLock={() => onLock(p.practitioner_id)}
              onRelease={() => onRelease(p.practitioner_id)}
              logActions={logActions}
              formatTime={formatTime}
              detailSessionId={detail?.practitionerId === p.practitioner_id ? detail.sessionId : null}
              onSelectSession={(sessionId) => selectSession(p.practitioner_id, sessionId)}
              processingId={processingId}
              handleGenerateAndIssue={wrappedGenerateAndIssue}
              handleSendToCompleted={wrappedSendToCompleted}
            />
          ))}
        </div>
      </div>

      {/* RIGHT: detail panel for whichever session was last clicked */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="flex items-center gap-2 px-6 py-3 bg-slate-800 text-white">
          <ClipboardList className="size-4" />
          <span className="text-sm font-bold uppercase tracking-wide">Review Panel</span>
        </div>
        {!detailSession ? (
          <div className="flex-1 flex flex-col items-center gap-4 pt-20 px-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center">
              <MousePointerClick className="size-8" />
            </div>
            <p className="text-xl font-bold text-slate-700">
              {periodPractitioners.length === 0 ? 'No pending logs in this period.' : 'Select a session from the queue on the left'}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-8">
            <div className="flex gap-2 border-b border-slate-200 mb-6">
              <button
                onClick={() => setDetailTab('session')}
                className={`px-3 pb-3 text-base font-bold border-b-2 -mb-px cursor-pointer transition-colors ${
                  detailTab === 'session' ? 'border-blue-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Session Detail
              </button>
              <button
                onClick={() => setDetailTab('analysis')}
                className={`px-3 pb-3 text-base font-bold border-b-2 -mb-px cursor-pointer transition-colors flex items-center gap-1.5 ${
                  detailTab === 'analysis' ? 'border-violet-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Sparkles className="size-4" /> Compliance Analysis
              </button>
            </div>

            {detailTab === 'analysis' ? (
              <ComplianceAnalysisPreview
                sessions={detailSessions}
                practitioner={detailPractitioner}
                practitionerId={detail.practitionerId}
                periodStart={selectedPeriod?.start}
                periodEnd={selectedPeriod?.end}
                logActions={logActions}
              />
            ) : (
              <SessionDetailPanel
                session={detailSession}
                practitionerId={detail.practitionerId}
                practitionerName={detailPractitioner ? `${detailPractitioner.first_name} ${detailPractitioner.last_name}` : ''}
                logActions={logActions}
                setLogActions={setLogActions}
                processingLogId={processingLogId}
                handleAccept={wrappedAccept}
                handleResetToPending={wrappedResetToPending}
                handleHold={wrappedHold}
                handleReleaseHold={wrappedReleaseHold}
                handleReconcile={wrappedReconcile}
                handleInlineReturnReject={wrappedInlineReturnReject}
                formatTime={formatTime}
              />
            )}
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
};

// --- One practitioner's group in the left list: header (avatar/name/count),
// lock state, and — once locked to you and expanded — its session queue
// plus a per-practitioner Generate & Issue / Send to Completed Bills bar,
// mirroring the legacy table's per-row action column. ---
function PractitionerGroup({
  practitioner, isExpanded, onToggle, sessions, isLoadingSessions,
  currentUserId, isAdmin, onLock, onRelease, logActions, formatTime,
  detailSessionId, onSelectSession,
  processingId, handleGenerateAndIssue, handleSendToCompleted,
}) {
  const isLockedByMe = !!practitioner.locked_by_id && practitioner.locked_by_id === currentUserId;
  const isLockedByOther = !!practitioner.locked_by_id && practitioner.locked_by_id !== currentUserId;
  const readyToComplete = practitioner.sevf_documents?.length > 0 && practitioner.invoice_documents?.length > 0;
  const allLogsReviewed = sessions.length > 0 &&
    sessions.some(s => !['rejected', 'declined', 'on_hold'].includes(s.billing_status)) &&
    sessions.every(s => logActions[s.id] || s.billing_review);
  const routingCounts = sessions.reduce((acc, s) => {
    if (s.billing_status === 'declined') acc.excluded += 1;
    else if (s.billing_status === 'rejected' || s.billing_status === 'on_hold') acc.heldReturned += 1;
    else acc.billable += 1;
    return acc;
  }, { billable: 0, heldReturned: 0, excluded: 0 });

  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-4 bg-white hover:bg-slate-50 transition-colors cursor-pointer text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-600 to-sky-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
          {`${practitioner.first_name?.[0] || ''}${practitioner.last_name?.[0] || ''}`.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base text-slate-900 capitalize truncate">{practitioner.first_name} {practitioner.last_name}</div>
          <div className="text-sm text-slate-500">{practitioner.total_interventions} sessions</div>
        </div>
        {isLockedByMe && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1.5 flex-shrink-0">
            <Lock className="size-3.5" /> Locked to you
          </span>
        )}
        {isLockedByOther && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 flex-shrink-0">
            <Lock className="size-3.5" /> Locked by {practitioner.locked_by_name}
          </span>
        )}
        <ChevronDown className={`size-5 text-slate-500 transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
      </button>

      {isExpanded && (
        <>
          <div className="px-4 py-3 bg-white border-t border-slate-100">
            {isLockedByOther ? (
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
                  <Lock className="size-3.5" /> Locked by {practitioner.locked_by_name}
                </span>
                {isAdmin && (
                  <button onClick={onRelease} className="text-sm font-semibold text-red-600 hover:underline cursor-pointer">Force Release</button>
                )}
              </div>
            ) : isLockedByMe ? (
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1.5">
                  <Lock className="size-3.5" /> Locked to you
                </span>
                <button onClick={onRelease} className="text-sm font-semibold text-red-600 hover:underline cursor-pointer">Release</button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={onLock} className="w-full gap-1.5 cursor-pointer text-sm">
                <Lock className="size-4" /> Lock to Review
              </Button>
            )}
          </div>

          {isLockedByMe && (
            isLoadingSessions ? (
              <div className="p-4 text-center text-sm text-slate-500">Loading sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">No individual logs found.</div>
            ) : sessions.map(s => {
              const isDeclined = s.billing_status === 'declined';
              const isReturned = s.billing_status === 'rejected';
              const isOnHold = s.billing_status === 'on_hold';
              const isApproved = logActions[s.id] === 'accept' || s.billing_review === 'accept';
              const dotColor = isDeclined ? 'bg-red-400' : isReturned ? 'bg-amber-400' : isOnHold ? 'bg-violet-400'
                : isApproved ? 'bg-emerald-400' : 'bg-slate-300';
              const statusLabel = isDeclined ? 'Declined' : isReturned ? 'Returned' : isOnHold ? 'On Hold' : isApproved ? 'Approved' : 'Pending';
              const statusLabelClasses = isDeclined ? 'bg-red-50 text-red-600'
                : isReturned ? 'bg-amber-50 text-amber-600'
                : isOnHold ? 'bg-violet-50 text-violet-600'
                : isApproved ? 'bg-emerald-50 text-emerald-600'
                : 'bg-slate-100 text-slate-500';
              const isSelected = detailSessionId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => onSelectSession(s.id)}
                  className={`grid grid-cols-3 items-center gap-3 px-4 py-3.5 border-t border-slate-100 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  {/* Column 1: patient + date */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
                    <div className="min-w-0">
                      <div className="text-base font-bold text-slate-900 truncate">{s.patient_first_name} {s.patient_last_name}</div>
                      <div className="text-sm text-slate-500">
                        {s.service_date ? new Date(s.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}
                      </div>
                    </div>
                  </div>

                  {/* Column 2: service codes, centered */}
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="font-mono text-sm font-semibold bg-slate-100 border border-slate-200 rounded px-2 py-1 text-slate-700" title="Service Status">S:{s.status || '-'}</span>
                    <span className="font-mono text-sm font-semibold bg-slate-100 border border-slate-200 rounded px-2 py-1 text-slate-700" title="Service Type">{s.type || '-'}</span>
                    <span className="font-mono text-sm font-semibold bg-slate-100 border border-slate-200 rounded px-2 py-1 text-slate-700" title="Service Location">L:{s.location || '-'}</span>
                  </div>

                  {/* Column 3: status + duration, centered */}
                  <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                    <span className={`text-sm font-bold uppercase rounded px-2 py-1 ${statusLabelClasses}`}>{statusLabel}</span>
                    <span className="text-sm font-bold text-slate-600">{formatTime(s.total_time)}</span>
                    {s.notes_count > 0 && <MessageSquareText className="size-3.5 text-slate-400" />}
                  </div>
                </div>
              );
            })
          )}

          {/* Generated documents and the Generate & Issue / Send to Completed
              action bar are intentionally NOT gated on isLockedByMe — the
              lock auto-releases right after a successful generate (so the
              row doesn't stay checked out), and "Send to Completed Bills"
              must stay available afterward even though nothing is locked
              anymore, matching the legacy table's always-visible columns. */}
          {(practitioner.sevf_documents?.length > 0 || practitioner.invoice_documents?.length > 0) && (
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Generated documents</div>
              <div className="flex flex-wrap gap-2">
                {practitioner.sevf_documents?.map(doc => (
                  <a
                    key={`sevf-${doc.month}`}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100 transition-colors cursor-pointer"
                  >
                    <Download className="size-3.5" /> SEVF · {formatMonthLabel(doc.month)}
                  </a>
                ))}
                {practitioner.invoice_documents?.map(doc => (
                  <a
                    key={`inv-${doc.month}`}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
                  >
                    <Download className="size-3.5" /> Invoice · {formatMonthLabel(doc.month)}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-800 text-white flex-wrap">
            <div className="flex gap-3 text-xs text-white/70 flex-wrap">
              <span><b className="text-white">{routingCounts.billable}</b> billable</span>
              <span><b className="text-white">{routingCounts.heldReturned}</b> held/returned</span>
              <span><b className="text-white">{routingCounts.excluded}</b> excluded</span>
            </div>
            {readyToComplete ? (
              <Button
                size="sm"
                onClick={() => handleSendToCompleted(practitioner.practitioner_id)}
                disabled={processingId === practitioner.practitioner_id}
                className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-sm"
              >
                <CheckCircle2 className="size-4" /> {processingId === practitioner.practitioner_id ? 'Sending...' : 'Send to Completed'}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => handleGenerateAndIssue(practitioner.practitioner_id)}
                disabled={!isLockedByMe || !allLogsReviewed || processingId === practitioner.practitioner_id}
                title={!isLockedByMe ? 'Lock this practitioner to review logs first' : ''}
                className={`cursor-pointer gap-1.5 text-sm ${isLockedByMe && allLogsReviewed ? 'bg-white text-slate-900 hover:bg-slate-100' : 'bg-white/10 text-white/40 cursor-not-allowed'}`}
              >
                {processingId === practitioner.practitioner_id ? 'Generating...' : 'Generate & Issue'}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --- Session Detail: fields + one-click actions, same status logic as the
// legacy table's expanded row (isDeclined/isReturned/isOnHold/isLocked). ---
function SessionDetailPanel({
  session, practitionerId, practitionerName, logActions, setLogActions, processingLogId,
  handleAccept, handleResetToPending, handleHold, handleReleaseHold, handleReconcile, handleInlineReturnReject, formatTime,
}) {
  const isDeclined = session.billing_status === 'declined';
  const isReturned = session.billing_status === 'rejected';
  const isOnHold = session.billing_status === 'on_hold';
  const isProcessing = processingLogId === session.id;
  const isLocked = session.billing_status === 'njeis_review';

  const [pendingAction, setPendingAction] = useState(null); // 'return' | 'reject' | null
  useEffect(() => { setPendingAction(null); }, [session.id]);

  return (
    <div className="max-w-2xl">
      <div className="text-sm font-bold uppercase tracking-wide text-blue-600 mb-1.5">
        {session.service_date ? new Date(session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '-'}
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-1.5">{session.patient_first_name} {session.patient_last_name}</h2>
      <p className="text-base text-slate-600 mb-6">{session.type || '-'} session</p>

      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2.5">Service Codes</div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-slate-500">Status</div>
          <div className="text-base font-bold font-mono text-slate-900">{session.status || '-'}</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-slate-500">Type</div>
          <div className="text-base font-bold font-mono text-slate-900">{session.type || '-'}</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-slate-500">Location</div>
          <div className="text-base font-bold font-mono text-slate-900">{session.location || '-'}</div>
        </div>
      </div>

      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2.5">Session Time</div>
      <div className="grid grid-cols-3 gap-3 mb-7">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-slate-500">Start</div>
          <div className="text-base font-bold text-slate-900">{session.start_time ? formatTime12h(session.start_time) : '-'}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-slate-500">End</div>
          <div className="text-base font-bold text-slate-900">{session.end_time ? formatTime12h(session.end_time) : '-'}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-slate-500">Total</div>
          <div className="text-base font-bold text-slate-900">{formatTime(session.total_time)}</div>
        </div>
      </div>

      {isProcessing ? (
        <div className="text-base text-slate-500">Processing...</div>
      ) : isDeclined || isReturned ? (
        <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 mb-4 ${isDeclined ? 'bg-slate-100' : 'bg-amber-50 border border-amber-200'}`}>
          <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${isDeclined ? 'text-slate-600' : 'text-amber-800'}`}>
            {isDeclined ? <Ban className="size-4" /> : <Clock className="size-4" />}
            {isDeclined ? 'Permanently rejected — excluded from report' : 'Returned to practitioner — awaiting resubmission'}
          </span>
          <Button size="sm" variant="outline" onClick={() => handleReconcile(session, practitionerId)} className="cursor-pointer gap-1 flex-shrink-0">
            Store Log
          </Button>
        </div>
      ) : isLocked ? (
        <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 mb-4">
          <Ban className="size-4" /> SEVF has been issued — locked until it returns to pending.
        </div>
      ) : isOnHold ? (
        <Button onClick={() => handleReleaseHold(session, practitionerId)} className="cursor-pointer gap-1.5 bg-orange-600 hover:bg-orange-700 text-white mb-4">
          <PlayCircle className="size-4" /> Release from Hold
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <ActionButton
            label={logActions[session.id] === 'accept' ? 'Approved' : 'Approve'} active={logActions[session.id] === 'accept'} tone="emerald"
            icon={<Check className="size-4" />}
            onClick={() => {
              if (logActions[session.id] === 'accept') {
                setLogActions(prev => ({ ...prev, [session.id]: '' }));
                handleResetToPending(session, practitionerId);
              } else {
                setLogActions(prev => ({ ...prev, [session.id]: 'accept' }));
                handleAccept(session, practitionerId);
              }
            }}
          />
          <ActionButton
            label="Return" active={pendingAction === 'return'} tone="blue"
            icon={<Undo2 className="size-4" />}
            onClick={() => setPendingAction(prev => prev === 'return' ? null : 'return')}
          />
          <ActionButton
            label="Reject" active={pendingAction === 'reject'} tone="red"
            icon={<X className="size-4" />}
            onClick={() => setPendingAction(prev => prev === 'reject' ? null : 'reject')}
          />
          <ActionButton
            label="Hold" active={false} tone="orange"
            icon={<Clock className="size-4" />}
            onClick={() => handleHold(session, practitionerId)}
          />
        </div>
      )}

      <CommentThread
        key={session.id}
        session={session}
        practitionerId={practitionerId}
        practitionerName={practitionerName}
        pendingAction={pendingAction}
        setPendingAction={setPendingAction}
        handleInlineReturnReject={handleInlineReturnReject}
      />
    </div>
  );
}

// --- Inline comment thread, replacing the old Return/Reject popup modal.
// Always visible for the selected session — shows the full note history
// (assessment_notes, same data the legacy table's notes-history Dialog
// used) and lets billing add a plain comment at any time via the new
// /api/billing/log-comment endpoint. When a Return/Reject action is
// pending (set by the buttons above), the same input instead requires a
// note and submits through /api/billing/reject-log via
// handleInlineReturnReject — so the required "why" for a status change
// and a free-form comment share one inline box instead of a popup. ---
function CommentThread({ session, practitionerId, practitionerName, pendingAction, setPendingAction, handleInlineReturnReject }) {
  const [notes, setNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchNotes = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/api/billing/log-notes', { params: { assessmentId: session.id } });
      if (res.data.success) setNotes(res.data.notes);
    } catch (error) {
      console.error('Failed to fetch log notes', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchNotes(); }, [session.id]);

  const handleSend = async () => {
    if (!text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (pendingAction) {
        await handleInlineReturnReject(session, practitionerId, pendingAction, text);
        setPendingAction(null);
      } else {
        await api.post('/api/billing/log-comment', { assessmentId: session.id, note: text });
      }
      setText('');
      await fetchNotes();
    } catch (error) {
      console.error('Failed to send comment', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mt-2">
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <MessageSquareText className="size-4 text-slate-500" />
        <span className="text-sm font-bold text-slate-700">Comment thread{practitionerName ? ` with ${practitionerName}` : ''}</span>
      </div>

      <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-3 bg-white">
        {isLoading ? (
          <div className="text-sm text-slate-400 text-center py-3">Loading comments...</div>
        ) : notes.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-3">No comments yet — add one below.</div>
        ) : notes.map((n, i) => {
          const isBilling = n.author_role !== 'practitioner';
          return (
            <div key={i} className={`flex ${isBilling ? '' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-xl px-3.5 py-2.5 border text-sm ${
                isBilling ? 'bg-blue-50 border-blue-200' : 'bg-violet-50 border-violet-200'
              }`}>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className={`font-bold text-xs ${isBilling ? 'text-blue-700' : 'text-violet-700'}`}>
                    {isBilling ? 'Billing' : 'Practitioner'}{n.first_name ? ` · ${n.first_name} ${n.last_name}` : ''}
                  </span>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-slate-700 whitespace-pre-wrap">{n.note}</p>
              </div>
            </div>
          );
        })}
      </div>

      {pendingAction && (
        <div className={`flex items-center justify-between gap-2 px-4 py-2 text-xs font-semibold ${
          pendingAction === 'return' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'
        }`}>
          <span>{pendingAction === 'return' ? 'Returning this log — describe what needs to be corrected below.' : 'Rejecting this log — explain why below.'}</span>
          <button type="button" onClick={() => setPendingAction(null)} className="underline cursor-pointer">Cancel</button>
        </div>
      )}

      <div className="flex gap-2 px-4 py-3 border-t border-slate-200 bg-white">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          placeholder={pendingAction === 'return' ? 'Describe what needs to be corrected...' : pendingAction === 'reject' ? 'Explain the reason for rejection...' : 'Add a note for the practitioner...'}
          className={`flex-1 text-sm rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${
            pendingAction ? 'border-red-300 focus:ring-red-500/30' : 'border-slate-300 focus:ring-blue-500/30'
          }`}
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!text.trim() || isSubmitting}
          className={`cursor-pointer text-sm ${pendingAction ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'} text-white`}
        >
          {isSubmitting ? 'Sending...' : pendingAction === 'return' ? 'Confirm Return' : pendingAction === 'reject' ? 'Confirm Reject' : 'Send'}
        </Button>
      </div>
    </div>
  );
}

function ActionButton({ label, icon, onClick, active, tone }) {
  const toneClasses = {
    emerald: active ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50',
    blue: active ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-blue-600 hover:border-blue-300 hover:bg-blue-50',
    red: active ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200 text-red-600 hover:border-red-300 hover:bg-red-50',
    orange: active ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-orange-600 hover:border-orange-300 hover:bg-orange-50',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-2.5 py-7 px-4 rounded-2xl border-2 bg-white cursor-pointer transition-colors shadow-sm ${toneClasses}`}
    >
      {icon}
      <span className="text-sm font-bold">{label}</span>
    </button>
  );
}

// --- Compliance Analysis: compares this practitioner's logged sessions
// against the state reference document (parsed on Company Information into
// compliance_state_logs, matched by patient + service date — see
// backend/src/controllers/billingController.js getComplianceAnalysis).
// Falls back to an explicit "no document on file" state rather than ever
// fabricating a comparison when nothing real exists to compare against.
function ComplianceAnalysisPreview({ sessions, practitioner, practitionerId, periodStart, periodEnd, logActions }) {
  const practitionerName = practitioner ? `${practitioner.first_name} ${practitioner.last_name}` : '-';
  const [complianceDoc, setComplianceDoc] = useState(null); // { filename, uploaded_at } | null
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [analysis, setAnalysis] = useState(null); // { documentOnFile, results, unmatchedStateLogs } | null
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(true);
  const [analysisError, setAnalysisError] = useState(null);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  useEffect(() => {
    api.get('/api/company')
      .then(res => {
        const settings = res.data?.settings;
        setComplianceDoc(settings?.compliance_doc_filename ? {
          filename: settings.compliance_doc_filename,
          uploaded_at: settings.compliance_doc_uploaded_at,
        } : null);
      })
      .catch(() => {})
      .finally(() => setIsLoadingDoc(false));
  }, []);

  const fetchAnalysis = () => {
    if (!practitionerId || !periodStart || !periodEnd) { setIsLoadingAnalysis(false); return; }
    setIsLoadingAnalysis(true);
    setAnalysisError(null);
    return api.get('/api/billing/compliance-analysis', { params: { practitionerId, startDate: periodStart, endDate: periodEnd } })
      .then(res => setAnalysis(res.data))
      .catch(error => { setAnalysis(null); setAnalysisError(error.response?.data?.error || 'Failed to load compliance comparison.'); })
      .finally(() => setIsLoadingAnalysis(false));
  };

  useEffect(() => { fetchAnalysis(); }, [practitionerId, periodStart, periodEnd]);

  const openComplianceDoc = () => {
    api.get('/api/company/compliance-doc/download')
      .then(res => window.open(res.data.url, '_blank', 'noopener'))
      .catch(() => {});
  };

  const documentReady = analysis?.documentOnFile;

  // "Flagged" covers both a real field mismatch and no state record found
  // at all — both need a biller's eyes, just for different reasons.
  const isSessionFlagged = (s) => {
    const r = analysis?.results?.[s.id];
    if (!r) return false;
    return !r.matched || r.flagged;
  };
  const flaggedCount = documentReady ? sessions.filter(isSessionFlagged).length : 0;
  const matchedCount = documentReady ? sessions.length - flaggedCount : 0;
  const visibleSessions = showFlaggedOnly ? sessions.filter(isSessionFlagged) : sessions;

  return (
    <div>
      <div className="flex items-start gap-4 bg-gradient-to-br from-slate-50 to-violet-50 border border-slate-200 rounded-xl p-5 mb-6">
        <div className="w-10 h-10 rounded-lg bg-slate-800 text-white flex items-center justify-center flex-shrink-0">
          <Sparkles className="size-5" />
        </div>
        <div>
          <div className="text-base font-bold text-slate-900 mb-1.5">Compliance Analysis</div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Each session below is matched to the state's reference document by child + service date, then compared field by field: Service Type, Location, Group Size Category, Start Time, and End Time.
          </p>
        </div>
      </div>

      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Reference document (from Company Information)</div>
      {isLoadingDoc ? (
        <div className="text-sm text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg px-4 py-3 mb-6">Checking…</div>
      ) : complianceDoc ? (
        <button
          type="button"
          onClick={openComplianceDoc}
          className="w-full flex items-center gap-3 text-left text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-6 cursor-pointer hover:bg-emerald-100 transition-colors"
        >
          <Download className="size-4 text-emerald-700 flex-shrink-0" />
          <span className="text-emerald-800 font-semibold">{complianceDoc.filename}</span>
          <span className="text-emerald-600 text-xs">on file — click to download</span>
        </button>
      ) : (
        <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-lg px-4 py-3 mb-6">
          No state document on file yet — attach one on the Company Information page.
        </div>
      )}

      <button
        type="button"
        onClick={fetchAnalysis}
        disabled={isLoadingAnalysis}
        className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white text-sm font-bold rounded-lg px-4 py-2.5 mb-6 cursor-pointer transition-colors"
      >
        <RefreshCw className={`size-3.5 ${isLoadingAnalysis ? 'animate-spin' : ''}`} />
        Re-run analysis
      </button>

      {!isLoadingAnalysis && analysisError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6">
          Couldn't load the comparison: {analysisError}
        </div>
      )}

      {!isLoadingDoc && complianceDoc && !isLoadingAnalysis && !analysisError && !documentReady && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
          A document is attached but its column matching hasn't been confirmed yet — finish that on the Company Information page before this runs.
        </div>
      )}

      {documentReady && sessions.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="border border-slate-200 rounded-xl px-3 py-3 text-center">
            <div className="text-2xl font-black text-slate-900">{sessions.length}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">Sessions Checked</div>
          </div>
          <div className="border border-slate-200 rounded-xl px-3 py-3 text-center">
            <div className="text-2xl font-black text-emerald-600">{matchedCount}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">Match State Codes</div>
          </div>
          <button
            type="button"
            onClick={() => setShowFlaggedOnly(v => !v)}
            className={`border rounded-xl px-3 py-3 text-center cursor-pointer transition-colors ${showFlaggedOnly ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-red-200 hover:bg-red-50/40'}`}
          >
            <div className="text-2xl font-black text-red-600">{flaggedCount}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">
              {showFlaggedOnly ? 'Flagged — showing only these' : 'Flagged — click to filter'}
            </div>
          </button>
        </div>
      )}

      {analysis?.unmatchedStateLogs?.length > 0 && (
        <div className="text-sm bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-6">
          <div className="font-bold text-orange-800 mb-1">{analysis.unmatchedStateLogs.length} session{analysis.unmatchedStateLogs.length === 1 ? '' : 's'} in the state document for this practitioner's patients aren't reflected in this period's logs</div>
          <ul className="text-orange-700 text-xs space-y-0.5">
            {analysis.unmatchedStateLogs.map(l => (
              <li key={l.id}>{l.child_name || 'Unknown child'} — {l.service_date ? new Date(l.service_date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }) : '-'} {l.service_label ? `(${l.service_label})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Side-by-side comparison &middot; {practitionerName}
        </div>
        {showFlaggedOnly && (
          <button type="button" onClick={() => setShowFlaggedOnly(false)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer">
            Showing {visibleSessions.length} flagged only · Show all {sessions.length} &rarr;
          </button>
        )}
      </div>
      <div className="space-y-3">
        {visibleSessions.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-6">{showFlaggedOnly ? 'No flagged sessions.' : 'No sessions to compare.'}</div>
        ) : visibleSessions.map(s => {
          const sessionResult = analysis?.results?.[s.id];
          const compareFields = sessionResult?.fields || [];
          const flagged = documentReady && sessionResult?.matched && sessionResult.flagged;
          const flaggedFieldCount = compareFields.filter(f => f.match === false).length;

          // Same status computation as the practitioner queue rows — the
          // flagged badge here reflects this session's REAL billing status
          // (Approve/Return/Reject/Hold), not a separate review concept.
          const isDeclined = s.billing_status === 'declined';
          const isReturned = s.billing_status === 'rejected';
          const isOnHold = s.billing_status === 'on_hold';
          const isApproved = logActions?.[s.id] === 'accept' || s.billing_review === 'accept';
          const statusLabel = isDeclined ? 'Declined' : isReturned ? 'Returned' : isOnHold ? 'On Hold' : isApproved ? 'Approved' : 'Pending';
          const statusBadgeClasses = isDeclined ? 'text-red-600'
            : isReturned ? 'text-amber-600'
            : isOnHold ? 'text-violet-600'
            : isApproved ? 'text-emerald-600'
            : 'text-slate-500';

          return (
            <div key={s.id} className={`border rounded-xl overflow-hidden ${flagged ? 'border-red-200' : 'border-slate-200'}`}>
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${flagged ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                <div>
                  <span className="text-sm font-bold text-slate-800">{s.patient_first_name} {s.patient_last_name}</span>
                  <span className="text-xs text-slate-500 ml-2">{s.service_date ? new Date(s.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}</span>
                </div>
                {documentReady && sessionResult && (
                  sessionResult.matched ? (
                    flagged ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-xs font-bold text-red-700">
                          <X className="size-3.5" /> {flaggedFieldCount} field{flaggedFieldCount === 1 ? '' : 's'} flagged
                        </span>
                        <span className={`text-xs font-bold uppercase ${statusBadgeClasses}`}>{statusLabel}</span>
                      </div>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                        <CheckCircle2 className="size-3.5" /> Match
                      </span>
                    )
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold text-orange-600">
                      <X className="size-3.5" /> Not found
                    </span>
                  )
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase text-slate-500">
                    <th className="text-left px-4 py-2 w-1/3"></th>
                    <th className="px-4 py-2">
                      <span className="text-sky-700 bg-sky-50 rounded px-2 py-0.5">Our Log</span>
                    </th>
                    <th className="px-4 py-2">
                      <span className="text-amber-700 bg-amber-50 rounded px-2 py-0.5">State Record</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingAnalysis ? (
                    <tr>
                      <td className="px-4 py-3 text-center text-slate-400 text-xs" colSpan={3}>Loading comparison…</td>
                    </tr>
                  ) : !documentReady ? (
                    <tr>
                      <td className="px-4 py-3 text-center text-slate-400 text-xs italic" colSpan={3}>No confirmed state document to compare against</td>
                    </tr>
                  ) : !sessionResult?.matched ? (
                    <tr>
                      <td className="px-4 py-3 text-center text-orange-600 text-xs font-semibold" colSpan={3}>No matching record found in the state document for this session</td>
                    </tr>
                  ) : compareFields.map(f => {
                    const rowClass = f.match === false ? 'bg-red-50/60' : '';
                    const icon = f.match === true ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                      : f.match === false ? <X className="size-3.5 text-red-500" /> : null;
                    const stateColor = f.match === false ? 'text-red-700' : 'text-slate-800';
                    return (
                      <tr key={f.key} className={`border-t border-slate-100 ${rowClass}`}>
                        <td className="px-4 py-2 font-semibold text-slate-600 flex items-center gap-1.5">
                          {icon}
                          {f.label}
                        </td>
                        <td className="px-4 py-2 text-center font-mono font-bold text-slate-800">{f.ours || '-'}</td>
                        <td className={`px-4 py-2 text-center font-mono font-bold ${stateColor}`}>{f.state || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
