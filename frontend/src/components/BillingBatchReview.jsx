import React, { useState, useEffect, useRef } from 'react';
import api from '@/api/axiosInstance';
import { formatTime12h } from '@/utils/formatTime';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { showAlert, showConfirm } from '@/utils/dialogStore';
import { useDropdownOptions, buildCodeLabelMap } from '@/hooks/useDropdownOptions';
import {
  Search, ChevronDown, Lock, PlayCircle, Check, X, Undo2,
  Ban, Clock, MessageSquareText, CheckCircle2, Sparkles, Download,
  Users, ClipboardList, MousePointerClick, CalendarDays, RefreshCw, Copy,
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
  // DOM node per practitioner group (registered via PractitionerGroup's
  // containerRef below), used to scroll a just-locked practitioner's row to
  // the very top of the queue so as many of their logs as possible are
  // visible without the biller having to scroll past whatever was above them.
  // queueScrollRef is the actual scrollable list container — scrolling it
  // directly via a computed offset (rather than element.scrollIntoView,
  // which depends on the browser correctly walking up to find the nearest
  // scrollable ancestor in this nested flex layout) is deterministic
  // regardless of how many overflow contexts sit in between.
  const groupRefs = useRef({});
  const queueScrollRef = useRef(null);
  const scrollGroupToTop = (practitionerId) => {
    const container = queueScrollRef.current;
    const target = groupRefs.current[practitionerId];
    if (!container || !target) return;
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offset = targetRect.top - containerRect.top + container.scrollTop;
    container.scrollTo({ top: offset, behavior: 'smooth' });
  };
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
    // Scroll their row to the very top of the queue so as many of their logs
    // as possible are visible below, instead of leaving it wherever it was
    // in the list (often mid-scroll, with most of their logs off-screen).
    // Confirmed via diagnostic logging: fetchPeriodLogs resolving doesn't
    // mean the browser has actually painted the newly-expanded session list
    // yet — measuring immediately saw a scrollHeight matching only the
    // collapsed rows, not the ~24 session rows about to be added. Deferring
    // two animation frames guarantees the DOM has actually been laid out
    // and painted before we measure/scroll against it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollGroupToTop(practitionerId));
    });
  };

  const onRelease = async (practitionerId) => {
    await handleRelease(practitionerId);
    // The review panel on the right isn't gated by lock ownership on its
    // own — close it here so a released session can't keep sitting open
    // (and editable) after the biller no longer holds the lock on it.
    setDetail(prev => (prev?.practitionerId === practitionerId ? null : prev));
    // Mirror onLock's auto-expand: a released group should collapse back to
    // the minimized row, not linger open showing "Lock to Review" and the
    // Generate & Issue footer for a practitioner no one is actively reviewing.
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.delete(practitionerId);
      return next;
    });
    await fetchPeriodPractitioners();
  };

  const selectSession = (practitionerId, sessionId) => {
    setDetail({ practitionerId, sessionId });
    setDetailTab('session');
  };

  // Wrap every session-mutating action so the local period-scoped cache
  // (not just BillingManager's own state) reflects the result — otherwise
  // Approve/Hold/Return/Reject/Reconcile would update the wrong cache and
  // appear to do nothing here. Silent: the click already updates logActions
  // synchronously (see SessionDetailPanel/PractitionerGroup's isApproved),
  // so the left-hand queue already shows the right status instantly — a
  // non-silent refetch here would flip isLoadingSessions and replace the
  // whole session list with "Loading sessions..." for a moment, which reads
  // as the group collapsing and reopening even though it never actually did.
  const withRefetch = (fn) => async (session, practitionerId, ...rest) => {
    await fn(session, practitionerId, ...rest);
    await fetchPeriodLogs(practitionerId, { silent: true });
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

  // A ceo reviewing a "Missing in EIMS" log directly in Session Detail
  // doesn't need to send it to themselves and go find it in Action
  // Required — they decide it right there. Approving also immediately
  // moves the log to Approved (one action, not two), since that's the
  // whole point of an admin acting on their own review.
  const handleAdminDecideMissing = async (session, practitionerId, decision, comment) => {
    await api.post('/api/billing/action-required/decide', { assessmentId: session.id, decision, comment });
    if (decision === 'approved') {
      await handleAccept(session, practitionerId);
    }
    await fetchPeriodLogs(practitionerId, { silent: true });
  };

  // Billing hands a "Missing in EIMS" log off to an admin — same action
  // available from Compliance Analysis, wired up here too so Session Detail
  // isn't just a dead-end banner for non-admins.
  const handleSendMissingToAdmin = async (session, practitionerId) => {
    await api.post('/api/billing/compliance-analysis/send-missing-to-admin', { assessmentId: session.id });
    await fetchPeriodLogs(practitionerId, { silent: true });
  };

  const detailPractitioner = detail ? periodPractitioners.find(p => p.practitioner_id === detail.practitionerId) : null;
  const detailSessions = detail ? (periodLogs[detail.practitionerId] || []) : [];
  const detailSession = detail ? detailSessions.find(s => s.id === detail.sessionId) || null : null;

  // Belt-and-suspenders: if the lock on the open session's practitioner is
  // lost any other way (force-released by an admin, released from another
  // tab, the 20s poll catching a stale lock), close the panel too — not
  // just on the direct Release click above.
  useEffect(() => {
    if (!detail) return;
    const stillLockedByMe = detailPractitioner?.locked_by_id === currentUserId;
    if (!stillLockedByMe) setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPractitioners]);

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

        <div ref={queueScrollRef} className="flex-1 overflow-y-auto">
          {isLoadingPractitioners ? (
            <div className="p-6 text-center text-base text-slate-400">Loading practitioners for this period...</div>
          ) : filteredPractitioners.length === 0 ? (
            <div className="p-6 text-center text-base text-slate-400">
              {periodPractitioners.length === 0 ? 'No pending logs in this period.' : 'No practitioner matches your search.'}
            </div>
          ) : filteredPractitioners.map(p => (
            <PractitionerGroup
              key={p.practitioner_id}
              containerRef={(el) => { groupRefs.current[p.practitioner_id] = el; }}
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
              <button
                onClick={() => setDetailTab('matching')}
                className={`px-3 pb-3 text-base font-bold border-b-2 -mb-px cursor-pointer transition-colors flex items-center gap-1.5 ${
                  detailTab === 'matching' ? 'border-emerald-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Sparkles className="size-4" /> Compliance Matching
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
                handleAccept={wrappedAccept}
                handleResetToPending={wrappedResetToPending}
                handleHold={wrappedHold}
                handleReleaseHold={wrappedReleaseHold}
                handleInlineReturnReject={wrappedInlineReturnReject}
                isAdmin={isAdmin}
              />
            ) : detailTab === 'matching' ? (
              <ComplianceMatchingSettings isAdmin={isAdmin} />
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
                isAdmin={isAdmin}
                onAdminDecideMissing={handleAdminDecideMissing}
                onSendMissingToAdmin={handleSendMissingToAdmin}
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
  containerRef, practitioner, isExpanded, onToggle, sessions, isLoadingSessions,
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
    <div ref={containerRef} className="border-b border-slate-200">
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
                  className={`grid grid-cols-3 items-center gap-3 pl-3 pr-4 py-3.5 border-t border-slate-100 border-l-4 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-200 border-l-blue-600' : 'border-l-transparent hover:bg-slate-50'
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
  isAdmin, onAdminDecideMissing, onSendMissingToAdmin,
}) {
  const isDeclined = session.billing_status === 'declined';
  const isReturned = session.billing_status === 'rejected';
  const isOnHold = session.billing_status === 'on_hold';
  const isProcessing = processingLogId === session.id;
  const isLocked = session.billing_status === 'njeis_review';
  const { options: dropdownOptions, categories } = useDropdownOptions();
  const customCategories = categories.filter((c) => c.is_custom && c.is_active);
  // Same isApproved pattern used everywhere else in this file (PractitionerGroup,
  // handleStatusChange) — must fall back to the persisted billing_review, not
  // just local logActions, or a log that's already Approved on the server
  // renders as unselected until the FIRST click merely catches logActions up
  // to reality (a redundant re-approve) and only the second click actually toggles it.
  const isApproved = logActions[session.id] === 'accept' || session.billing_review === 'accept';

  const [pendingAction, setPendingAction] = useState(null); // 'return' | 'reject' | null
  useEffect(() => { setPendingAction(null); }, [session.id]);

  // Mirrors the Compliance Analysis tab's Approve gate here too, since this
  // panel has its own independent Approve button — fetched per-session
  // rather than lifting the whole batch's `analysis` state, since this
  // panel only ever needs one session's status at a time.
  const [complianceStatus, setComplianceStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get('/api/billing/compliance-analysis/session-status', { params: { assessmentId: session.id } })
      .then((res) => { if (!cancelled) setComplianceStatus(res.data); })
      .catch(() => { if (!cancelled) setComplianceStatus(null); });
    return () => { cancelled = true; };
  }, [session.id]);
  const isFlaggedBlock = !!complianceStatus?.documentOnFile && complianceStatus.flagged;
  const isMissingBlock = !!complianceStatus?.documentOnFile && !complianceStatus.matched && complianceStatus.eimsMissingStatus !== 'approved';
  const complianceBlockReason = isFlaggedBlock
    ? 'This log has flagged compliance fields — resolve them under Compliance Analysis before approving.'
    : null;

  const [adminComment, setAdminComment] = useState('');
  const [isDecidingMissing, setIsDecidingMissing] = useState(false);
  const handleAdminDecide = async (decision) => {
    if (!adminComment.trim()) { showAlert('A comment is required to approve or reject this log.'); return; }
    setIsDecidingMissing(true);
    try {
      await onAdminDecideMissing(session, practitionerId, decision, adminComment.trim());
      setAdminComment('');
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to record your decision.');
    } finally {
      setIsDecidingMissing(false);
    }
  };

  const [isSendingToAdmin, setIsSendingToAdmin] = useState(false);
  const handleSendToAdmin = async () => {
    if (!(await showConfirm('Send this log to an admin for approval? It has no matching record in the state document.'))) return;
    setIsSendingToAdmin(true);
    try {
      await onSendMissingToAdmin(session, practitionerId);
      setComplianceStatus((prev) => (prev ? { ...prev, eimsMissingStatus: 'sent_to_admin' } : prev));
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to send this log to an admin.');
    } finally {
      setIsSendingToAdmin(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="text-sm font-bold uppercase tracking-wide text-blue-600 mb-1.5">
        {session.service_date ? new Date(session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '-'}
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-1.5">{session.patient_first_name} {session.patient_last_name}</h2>
      <p className="text-base text-slate-600 mb-6">{session.type || '-'} session</p>

      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2.5">Service Codes</div>
      <div className="grid grid-cols-4 gap-3 mb-5">
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
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-slate-500">Group Size</div>
          <div className="text-base font-bold font-mono text-slate-900">{session.group_size_category || '-'}</div>
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

      {customCategories.length > 0 && (
        <>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2.5">Additional Fields</div>
          <div className="grid grid-cols-4 gap-3 mb-7">
            {customCategories.map((cat) => {
              const codeLabelMap = buildCodeLabelMap(dropdownOptions[cat.key] || []);
              const code = session.form_data?.custom_fields?.[cat.key];
              return (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3" key={cat.key}>
                  <div className="text-[11px] font-bold uppercase text-slate-500">{cat.display_name}</div>
                  <div className="text-base font-bold text-slate-900">{code ? (codeLabelMap[code] || code) : '-'}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {isProcessing ? (
        <div className="text-base text-slate-500">Processing...</div>
      ) : isDeclined || isReturned ? (
        <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 mb-4 ${isDeclined ? 'bg-slate-100' : 'bg-amber-50 border border-amber-200'}`}>
          <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${isDeclined ? 'text-slate-600' : 'text-amber-800'}`}>
            {isDeclined ? <Ban className="size-4" /> : <Clock className="size-4" />}
            {isDeclined ? 'Permanently rejected — excluded from report' : 'Returned to practitioner — awaiting resubmission'}
          </span>
          {isDeclined && (
            <Button size="sm" variant="outline" onClick={() => handleReconcile(session, practitionerId)} className="cursor-pointer gap-1 flex-shrink-0">
              Store Log
            </Button>
          )}
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
        <>
        {!isApproved && complianceBlockReason && (
          <div className="flex items-center gap-2 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-3">
            <Ban className="size-3.5 flex-shrink-0" /> {complianceBlockReason}
          </div>
        )}
        {!isApproved && isMissingBlock && isAdmin && (
          <div className="rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-3 mb-3 space-y-2">
            <p className="text-xs font-semibold text-orange-700 flex items-center gap-2">
              <Ban className="size-3.5 flex-shrink-0" /> This log has no matching record in the state document. As the admin, you can decide it right here — a comment is required either way.
            </p>
            <Textarea
              placeholder="Explain your decision — this will be added to the log's notes."
              value={adminComment}
              onChange={(e) => setAdminComment(e.target.value)}
              className="bg-white min-h-[70px]"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" onClick={() => handleAdminDecide('rejected')} disabled={isDecidingMissing} className="cursor-pointer text-white bg-red-600 hover:bg-red-700">
                Reject
              </Button>
              <Button type="button" size="sm" onClick={() => handleAdminDecide('approved')} disabled={isDecidingMissing} className="cursor-pointer text-white bg-emerald-600 hover:bg-emerald-700">
                {isDecidingMissing ? 'Saving...' : 'Approve'}
              </Button>
            </div>
          </div>
        )}
        {!isApproved && isMissingBlock && !isAdmin && (
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-3">
            <span className="flex items-center gap-2">
              <Ban className="size-3.5 flex-shrink-0" />
              {complianceStatus.eimsMissingStatus === 'sent_to_admin' ? 'This log has no matching record in the state document — awaiting admin review.' : 'This log has no matching record in the state document.'}
            </span>
            {complianceStatus.eimsMissingStatus !== 'sent_to_admin' && (
              <Button type="button" size="sm" onClick={handleSendToAdmin} disabled={isSendingToAdmin} className="cursor-pointer text-white bg-amber-600 hover:bg-amber-700 flex-shrink-0">
                {isSendingToAdmin ? 'Sending...' : 'Send to Admin'}
              </Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <ActionButton
            label={isApproved ? 'Approved' : 'Approve'} active={isApproved} tone="emerald"
            icon={<Check className="size-4" />}
            onClick={() => {
              if (isApproved) {
                setLogActions(prev => ({ ...prev, [session.id]: '' }));
                handleResetToPending(session, practitionerId);
              } else if (isMissingBlock && isAdmin) {
                showAlert('Use the comment box above to approve or reject this log.');
              } else if (isMissingBlock) {
                showAlert('This log has no matching record in the state document — click "Send to Admin" above before it can be approved.');
              } else if (complianceBlockReason) {
                showAlert(complianceBlockReason);
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
        </>
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

// Mirrors backend/src/controllers/billingController.js's
// LEARNABLE_COMPLIANCE_FIELDS — used only to tailor the confirmation
// message before Allow, since a learnable field's Allow persists a reusable
// rule while everything else is a one-off allow for this log only.
const LEARNABLE_COMPLIANCE_FIELD_KEYS = ['service_type', 'location', 'group_size', 'child_name', 'practitioner_name'];

// Mirrors complianceLearningController.js's hasWordOverlap — a learnable
// field only actually becomes a reusable rule server-side if the two values
// share at least one word (a plausible labeling variant, not a genuinely
// different value like "Developmental Intervention" vs "Speech Therapy").
// Used here purely so the confirmation dialog warns accurately about what
// Allow is about to do, without a round-trip to ask the server first.
function hasWordOverlap(a, b) {
  const norm = (s) => (s || '').toString().toLowerCase().replace(/[,.()\-–—'"]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokensA = new Set(norm(a).split(' ').filter(Boolean));
  const tokensB = new Set(norm(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  for (const t of tokensA) if (tokensB.has(t)) return true;
  return false;
}

const STRICTNESS_LABELS = {
  strict: 'Strict — every word/minute must match exactly',
  moderate: 'Moderate — tolerates minor wording/timing differences (recommended)',
  lenient: 'Lenient — tolerates larger wording/timing differences',
};
const FIELD_LABELS = {
  service_type: 'Service Type', location: 'Location', group_size: 'Group Size Category',
  child_name: 'Child Name', practitioner_name: 'Practitioner',
};

// --- Compliance Matching: the strictness profile that controls how
// forgiving the baseline field comparison is (see resolveStrictnessProfile,
// backend/src/constants/njeis.js), plus every learned rule the feedback
// loop has picked up from billing clicking "Allow" on a flagged field (see
// compliance_match_overrides, backend/src/controllers/complianceLearningController.js).
// Strictness is ceo-only to change; both are visible to any billing user.
function ComplianceMatchingSettings({ isAdmin }) {
  const [strictness, setStrictness] = useState('moderate');
  const [isLoadingStrictness, setIsLoadingStrictness] = useState(true);
  const [isSavingStrictness, setIsSavingStrictness] = useState(false);
  const [overrides, setOverrides] = useState([]);
  const [isLoadingOverrides, setIsLoadingOverrides] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const fetchStrictness = () => {
    setIsLoadingStrictness(true);
    api.get('/api/company')
      .then((res) => setStrictness(res.data?.settings?.compliance_strictness || 'moderate'))
      .catch(() => {})
      .finally(() => setIsLoadingStrictness(false));
  };

  const fetchOverrides = () => {
    setIsLoadingOverrides(true);
    api.get('/api/billing/compliance-learned-matches')
      .then((res) => setOverrides(res.data.overrides || []))
      .catch(() => {})
      .finally(() => setIsLoadingOverrides(false));
  };

  useEffect(() => { fetchStrictness(); fetchOverrides(); }, []);

  const handleStrictnessChange = async (e) => {
    const value = e.target.value;
    const previous = strictness;
    setStrictness(value);
    setIsSavingStrictness(true);
    try {
      await api.put('/api/billing/compliance-strictness', { strictness: value });
    } catch (error) {
      setStrictness(previous);
      showAlert(error.response?.data?.error || 'Failed to update strictness.');
    } finally {
      setIsSavingStrictness(false);
    }
  };

  const handleDeleteOverride = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/api/billing/compliance-learned-matches/${id}`);
      setOverrides((prev) => prev.filter((o) => o.id !== id));
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to remove this learned match.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Matching Strictness</h2>
          <p className="text-sm text-slate-500 mt-1">
            Sets the starting tolerance for wording and timing differences before a field is flagged. Learned matches below always apply regardless of this setting.
          </p>
        </div>
        {isLoadingStrictness ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : (
          <select
            value={strictness}
            onChange={handleStrictnessChange}
            disabled={!isAdmin || isSavingStrictness}
            className="w-full max-w-md h-10 rounded-md border border-slate-300 bg-white px-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {Object.entries(STRICTNESS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}
        {!isAdmin && <p className="text-xs text-slate-400">Only an Admin can change this setting.</p>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Learned Matches</h2>
          <p className="text-sm text-slate-500 mt-1">
            Every pairing billing has confirmed by clicking "Allow" on a flagged field — these auto-match on every future analysis. Remove one to go back to strictness-only matching for that pairing.
          </p>
        </div>
        {isLoadingOverrides ? (
          <div className="text-sm text-slate-400 py-4 text-center">Loading…</div>
        ) : overrides.length === 0 ? (
          <div className="text-sm text-slate-400 py-4 text-center">No learned matches yet — they appear here once billing clicks "Allow" on a flagged field.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="text-left px-3 py-2">Field</th>
                  <th className="text-left px-3 py-2">State's Text</th>
                  <th className="text-left px-3 py-2">Our Value</th>
                  <th className="text-left px-3 py-2">Confirmed By</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id} className="border-t border-slate-200 bg-white">
                    <td className="px-3 py-2 font-semibold text-slate-700">{FIELD_LABELS[o.field_key] || o.field_key}</td>
                    <td className="px-3 py-2 font-mono text-amber-700">{o.state_value_raw}</td>
                    <td className="px-3 py-2 font-mono text-slate-800">{o.our_value}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {o.first_name ? `${o.first_name} ${o.last_name}` : '—'}
                      <span className="block text-[11px] text-slate-400">
                        {new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteOverride(o.id)}
                        disabled={deletingId === o.id}
                        title="Remove this learned match"
                        className="w-8 h-8 rounded-md border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors mx-auto"
                      >
                        <X className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Compliance Analysis: compares this practitioner's logged sessions
// against the state reference document (parsed on Company Information into
// compliance_state_logs, matched by patient + service date — see
// backend/src/controllers/billingController.js getComplianceAnalysis).
// Falls back to an explicit "no document on file" state rather than ever
// fabricating a comparison when nothing real exists to compare against.
function ComplianceAnalysisPreview({
  sessions, practitioner, practitionerId, periodStart, periodEnd, logActions,
  handleAccept, handleResetToPending, handleHold, handleReleaseHold, handleInlineReturnReject,
  isAdmin,
}) {
  const practitionerName = practitioner ? `${practitioner.first_name} ${practitioner.last_name}` : '-';
  // { session, practitionerId, type: 'return'|'reject' } | null — the popup
  // for entering the required note before a Return/Reject goes through.
  const [pendingNoteAction, setPendingNoteAction] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [statusChangingId, setStatusChangingId] = useState(null);
  const [complianceDoc, setComplianceDoc] = useState(null); // { filename, uploaded_at } | null
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [analysis, setAnalysis] = useState(null); // { documentOnFile, results } | null
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(true);
  const [analysisError, setAnalysisError] = useState(null);
  const [statFilter, setStatFilter] = useState('all'); // 'all' | 'matched' | 'flagged' | 'missing'
  const [allowingKey, setAllowingKey] = useState(null); // `${sessionId}:${fieldKey}` currently in flight
  const [isSendingToAdmin, setIsSendingToAdmin] = useState(null); // sessionId currently in flight
  const [adminDecideTarget, setAdminDecideTarget] = useState(null); // sessionId with its admin decide box open
  const [adminDecideComment, setAdminDecideComment] = useState('');
  const [isDecidingMissing, setIsDecidingMissing] = useState(false);

  // Billing confirms a flagged field is actually fine — clears it for this
  // log (and, for the 5 learnable fields, teaches the system the pairing so
  // it stops flagging it for every future log too). Updates `analysis` in
  // place so the row flips from flagged to allowed without a full re-fetch.
  // Requires an explicit confirmation first — for a learnable field this is
  // a standing rule applied to every future log, not just this one, so it's
  // worth a real "are you sure" rather than a single accidental click.
  const handleAllowField = async (sessionId, field) => {
    const isLearnable = LEARNABLE_COMPLIANCE_FIELD_KEYS.includes(field.key) && hasWordOverlap(field.ours, field.state);
    const confirmMessage = isLearnable
      ? `Allow "${field.label}"? Our value "${field.ours || '-'}" will be remembered as matching the state's "${field.state || '-'}" — every future log with this same mismatch will auto-match too, until removed from Compliance Matching.`
      : `You are only allowing "${field.label}" as a one-time allow for this log, based on your review — this will not be used to teach the system for future logs.`;
    if (!(await showConfirm(confirmMessage))) return;

    const fieldKey = field.key;
    const requestKey = `${sessionId}:${fieldKey}`;
    setAllowingKey(requestKey);
    try {
      const res = await api.post('/api/billing/compliance-analysis/allow-field', { assessmentId: sessionId, fieldKey });
      setAnalysis((prev) => {
        if (!prev) return prev;
        const prevResult = prev.results[sessionId];
        if (!prevResult) return prev;
        const fields = prevResult.fields.map((f) => (f.key === fieldKey ? res.data.field : f));
        return {
          ...prev,
          results: { ...prev.results, [sessionId]: { ...prevResult, fields, flagged: res.data.flagged } },
        };
      });
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to allow this field.');
    } finally {
      setAllowingKey(null);
    }
  };

  // Step 1 of the send-to-admin workflow for a log with no matching state
  // record at all ("Missing in EIMS") — billing can't approve this
  // themselves (there's nothing to "Allow" against), so they hand it off to
  // an admin instead. Single click + confirm, not a two-step "open a note
  // box, then click a second Send button" flow — that shape read as one
  // action but silently required a second click nobody noticed, so the
  // request never fired. Billing can still leave context via the log's
  // regular comment thread below if they want to.
  const handleSendMissingToAdmin = async (sessionId) => {
    if (!(await showConfirm('Send this log to an admin for approval? It has no matching record in the state document.'))) return;
    setIsSendingToAdmin(sessionId);
    try {
      await api.post('/api/billing/compliance-analysis/send-missing-to-admin', { assessmentId: sessionId });
      setAnalysis((prev) => {
        if (!prev) return prev;
        const prevResult = prev.results[sessionId];
        if (!prevResult) return prev;
        return {
          ...prev,
          results: { ...prev.results, [sessionId]: { ...prevResult, eimsMissingStatus: 'sent_to_admin' } },
        };
      });
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to send this log to an admin.');
    } finally {
      setIsSendingToAdmin(null);
    }
  };

  // A ceo reviewing a "Missing in EIMS" log here doesn't need to send it to
  // themselves and go find it in Action Required — they decide it right in
  // this same view. Approving also immediately calls handleAccept so the
  // log moves straight to Approved in one action.
  const handleAdminDecideInline = async (sessionId, decision) => {
    if (!adminDecideComment.trim()) { showAlert('A comment is required to approve or reject this log.'); return; }
    setIsDecidingMissing(true);
    try {
      await api.post('/api/billing/action-required/decide', { assessmentId: sessionId, decision, comment: adminDecideComment.trim() });
      setAnalysis((prev) => {
        if (!prev) return prev;
        const prevResult = prev.results[sessionId];
        if (!prevResult) return prev;
        return {
          ...prev,
          results: { ...prev.results, [sessionId]: { ...prevResult, eimsMissingStatus: decision } },
        };
      });
      setAdminDecideTarget(null);
      setAdminDecideComment('');
      if (decision === 'approved') {
        const session = sessions.find((s) => s.id === sessionId);
        if (session) await handleAccept(session, practitionerId);
      }
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to record your decision.');
    } finally {
      setIsDecidingMissing(false);
    }
  };

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

  // Return/Reject need a note, collected via the popup below — everything
  // else (Approve, reset to Pending, Hold, Release Hold) applies immediately.
  const handleStatusChange = async (session, value) => {
    if (value === 'accept' && analysis?.results?.[session.id]?.duplicateOfSessionId) {
      showAlert("This is a duplicate log — it can't be approved for billing. Return or Reject it instead so only the original stays billable.");
      return;
    }
    if (value === 'accept' && analysis?.results?.[session.id]?.flagged) {
      showAlert("This log has flagged compliance fields — click \"Allow\" on each flagged field below before approving.");
      return;
    }
    if (value === 'accept' && analysis?.documentOnFile && !analysis?.results?.[session.id]?.matched && !analysis?.results?.[session.id]?.duplicateOfSessionId && analysis?.results?.[session.id]?.eimsMissingStatus !== 'approved') {
      showAlert(isAdmin
        ? "This log has no matching record in the state document — click the \"Review & Decide\" button to approve or reject it."
        : "This log has no matching record in the state document — click \"Send to Admin for Approval\" before it can be approved.");
      return;
    }
    if (value === 'return' || value === 'reject') {
      setPendingNoteAction({ session, practitionerId, type: value });
      setNoteText('');
      return;
    }
    setStatusChangingId(session.id);
    try {
      if (value === 'accept') await handleAccept(session, practitionerId);
      else if (value === 'pending') {
        const isApproved = logActions?.[session.id] === 'accept' || session.billing_review === 'accept';
        if (isApproved) await handleResetToPending(session, practitionerId);
        else await handleReleaseHold(session, practitionerId);
      } else if (value === 'hold') await handleHold(session, practitionerId);
    } finally {
      setStatusChangingId(null);
    }
  };

  const submitNoteAction = async () => {
    if (!pendingNoteAction || !noteText.trim()) return;
    setIsSubmittingNote(true);
    try {
      await handleInlineReturnReject(pendingNoteAction.session, pendingNoteAction.practitionerId, pendingNoteAction.type, noteText.trim());
      setPendingNoteAction(null);
      setNoteText('');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const documentReady = analysis?.documentOnFile;

  // "Missing in EIMS" (no matching state record at all), "Flagged" (a real
  // field mismatch OR a duplicate log competing for the same single state
  // record), and duplicates specifically are different problems with
  // different fixes, so they're tracked and counted separately.
  const isSessionDuplicate = (s) => !!analysis?.results?.[s.id]?.duplicateOfSessionId;
  const isSessionMissing = (s) => {
    const r = analysis?.results?.[s.id];
    return !!r && !r.matched && !isSessionDuplicate(s);
  };
  const isSessionFlagged = (s) => {
    const r = analysis?.results?.[s.id];
    if (!r) return false;
    if (isSessionDuplicate(s)) return true;
    return r.matched && !!r.flagged;
  };
  const missingCount = documentReady ? sessions.filter(isSessionMissing).length : 0;
  const flaggedCount = documentReady ? sessions.filter(isSessionFlagged).length : 0;
  const matchedCount = documentReady ? sessions.length - flaggedCount - missingCount : 0;
  const visibleSessions = statFilter === 'flagged' ? sessions.filter(isSessionFlagged)
    : statFilter === 'missing' ? sessions.filter(isSessionMissing)
    : statFilter === 'matched' ? sessions.filter(s => !isSessionFlagged(s) && !isSessionMissing(s))
    : sessions;

  // Once a session's fields match the state record cleanly (matched, not
  // flagged), there's nothing left for a biller to review — auto-approve it
  // so it moves straight to Approved / awaiting report generation, same as
  // if the biller had clicked Approve themselves.
  useEffect(() => {
    if (!analysis?.documentOnFile) return;
    sessions.forEach(s => {
      const r = analysis.results?.[s.id];
      if (!r?.matched || r.flagged) return;
      const isDeclined = s.billing_status === 'declined';
      const isReturned = s.billing_status === 'rejected';
      const isOnHold = s.billing_status === 'on_hold';
      const isLockedStatus = s.billing_status === 'njeis_review';
      const isApproved = logActions?.[s.id] === 'accept' || s.billing_review === 'accept';
      if (isDeclined || isReturned || isOnHold || isLockedStatus || isApproved) return;
      handleAccept(s, practitionerId);
    });
  }, [analysis]);

  // A duplicate log can carry a stale "Approved" from before it was known
  // to be a duplicate (e.g. it briefly matched cleanly on an earlier run,
  // or the biller approved it before its twin showed up). The dropdown
  // already forces Pending in its display for a duplicate — but that was
  // only cosmetic: the real stored status stayed Approved underneath, so
  // the practitioner queue on the left (which reads the real status) kept
  // showing "APPROVED" while this panel showed "PENDING". Actually reset
  // it here so both sides agree, and it stays out of billing until a
  // biller explicitly Returns/Rejects it.
  useEffect(() => {
    if (!analysis?.documentOnFile) return;
    sessions.forEach(s => {
      const r = analysis.results?.[s.id];
      if (!r?.duplicateOfSessionId) return;
      const isDeclined = s.billing_status === 'declined';
      const isReturned = s.billing_status === 'rejected';
      const isLockedStatus = s.billing_status === 'njeis_review';
      const isApproved = logActions?.[s.id] === 'accept' || s.billing_review === 'accept';
      if (isDeclined || isReturned || isLockedStatus || !isApproved) return;
      handleResetToPending(s, practitionerId);
    });
  }, [analysis]);

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setStatFilter('all')}
            className={`border rounded-xl px-3 py-3 text-center cursor-pointer transition-colors ${statFilter === 'all' ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'}`}
          >
            <div className="text-2xl font-black text-slate-900">{sessions.length}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">
              Sessions Checked
            </div>
          </button>
          <button
            type="button"
            onClick={() => setStatFilter(v => v === 'matched' ? 'all' : 'matched')}
            className={`border rounded-xl px-3 py-3 text-center cursor-pointer transition-colors ${statFilter === 'matched' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/40'}`}
          >
            <div className="text-2xl font-black text-emerald-600">{matchedCount}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">
              Match with State
            </div>
          </button>
          <button
            type="button"
            onClick={() => setStatFilter(v => v === 'flagged' ? 'all' : 'flagged')}
            className={`border rounded-xl px-3 py-3 text-center cursor-pointer transition-colors ${statFilter === 'flagged' ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-red-200 hover:bg-red-50/40'}`}
          >
            <div className="text-2xl font-black text-red-600">{flaggedCount}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">
              Flagged
            </div>
          </button>
          <button
            type="button"
            onClick={() => setStatFilter(v => v === 'missing' ? 'all' : 'missing')}
            className={`border rounded-xl px-3 py-3 text-center cursor-pointer transition-colors ${statFilter === 'missing' ? 'border-orange-400 bg-orange-50' : 'border-slate-200 hover:border-orange-200 hover:bg-orange-50/40'}`}
          >
            <div className="text-2xl font-black text-orange-600">{missingCount}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">
              Missing in EIMS
            </div>
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Side-by-side comparison &middot; {practitionerName}
        </div>
        {statFilter !== 'all' && (
          <button type="button" onClick={() => setStatFilter('all')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer">
            Showing {visibleSessions.length} {statFilter === 'missing' ? 'missing in EIMS' : statFilter} only · Show all {sessions.length} &rarr;
          </button>
        )}
      </div>
      <div className="space-y-3">
        {visibleSessions.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-6">
            {statFilter === 'flagged' ? 'No flagged sessions.' : statFilter === 'matched' ? 'No matched sessions.' : statFilter === 'missing' ? 'No sessions missing in EIMS.' : 'No sessions to compare.'}
          </div>
        ) : visibleSessions.map(s => {
          const sessionResult = analysis?.results?.[s.id];
          const compareFields = sessionResult?.fields || [];
          const isDuplicate = !!sessionResult?.duplicateOfSessionId;
          const isMissing = documentReady && !!sessionResult && !sessionResult.matched && !isDuplicate;
          const flagged = documentReady && !!sessionResult && ((sessionResult.matched && sessionResult.flagged) || isDuplicate);
          const flaggedFieldCount = compareFields.filter(f => f.match === false).length;

          // Same status computation as the practitioner queue rows — the
          // flagged badge here reflects this session's REAL billing status
          // (Approve/Return/Reject/Hold), not a separate review concept.
          const isDeclined = s.billing_status === 'declined';
          const isReturned = s.billing_status === 'rejected';
          const isOnHold = s.billing_status === 'on_hold';
          const isLockedStatus = s.billing_status === 'njeis_review';
          const isApproved = logActions?.[s.id] === 'accept' || s.billing_review === 'accept';
          const statusLabel = isDeclined ? 'Declined' : isReturned ? 'Returned' : isOnHold ? 'On Hold' : isApproved ? 'Approved' : 'Pending';
          const statusBadgeClasses = isDeclined ? 'text-red-600'
            : isReturned ? 'text-amber-600'
            : isOnHold ? 'text-violet-600'
            : isApproved ? 'text-emerald-600'
            : 'text-slate-500';
          // Once Returned/Declined, action only happens via the practitioner's
          // resubmission or Session Detail's Store Log — same rule as there.
          const canChangeStatus = !isDeclined && !isReturned && !isLockedStatus;
          // A duplicate may already carry a stale "Approved" from before it
          // was known to be a duplicate (e.g. it briefly matched cleanly on
          // an earlier run). Once flagged as a duplicate, don't pre-select
          // that inherited status — show Pending so the biller makes a
          // fresh, informed call now that they can see it's a duplicate.
          const currentStatusValue = isOnHold ? 'hold' : (isApproved && !isDuplicate) ? 'accept' : 'pending';

          // Duplicate / Missing in EIMS are special cases that need a
          // biller's own judgment call (not just a field-level mismatch),
          // so they get a bolder, distinctly-colored rectangle around the
          // whole card to stand out from a routine flagged field mismatch.
          const cardBorderClass = (isDuplicate || isMissing) ? 'border-2 border-orange-400'
            : flagged ? 'border border-red-200'
            : 'border border-slate-200';
          const cardHeaderClass = (isDuplicate || isMissing) ? 'bg-orange-50 border-orange-300'
            : flagged ? 'bg-red-50 border-red-200'
            : 'bg-slate-50 border-slate-200';

          return (
            <div key={s.id} className={`rounded-xl overflow-hidden ${cardBorderClass}`}>
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${cardHeaderClass}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">{s.patient_first_name} {s.patient_last_name}</span>
                  <span className="text-xs text-slate-500">{s.service_date ? new Date(s.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}</span>
                  {documentReady && sessionResult && (
                    sessionResult.matched ? (
                      flagged ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-red-700">
                          <X className="size-3.5" /> {flaggedFieldCount} field{flaggedFieldCount === 1 ? '' : 's'} flagged
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                          <CheckCircle2 className="size-3.5" /> Match
                        </span>
                      )
                    ) : isDuplicate ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-orange-700">
                        <Copy className="size-3.5" /> Duplicate log
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-orange-600">
                        <X className="size-3.5" /> Missing in EIMS
                      </span>
                    )
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isMissing && (
                    sessionResult.eimsMissingStatus === 'approved' ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-amber-700">
                        <CheckCircle2 className="size-3.5" /> Admin Approved
                      </span>
                    ) : sessionResult.eimsMissingStatus === 'rejected' ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-red-700">
                        <X className="size-3.5" /> Admin Rejected
                      </span>
                    ) : isAdmin ? (
                      <button
                        type="button"
                        onClick={() => { setAdminDecideTarget(s.id); setAdminDecideComment(''); }}
                        className="text-xs font-bold text-amber-700 border border-amber-300 bg-amber-50 rounded-md px-2.5 py-1 cursor-pointer hover:bg-amber-100 transition-colors"
                      >
                        Review &amp; Decide
                      </button>
                    ) : sessionResult.eimsMissingStatus === 'sent_to_admin' ? (
                      <span className="text-xs font-semibold text-slate-500">Awaiting Admin Review</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendMissingToAdmin(s.id)}
                        disabled={isSendingToAdmin === s.id}
                        className="text-xs font-bold text-amber-700 border border-amber-300 bg-amber-50 rounded-md px-2.5 py-1 cursor-pointer hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSendingToAdmin === s.id ? 'Sending...' : 'Send to Admin for Approval'}
                      </button>
                    )
                  )}
                {documentReady && !!sessionResult && (
                  canChangeStatus ? (
                    <select
                      className={`text-xs font-bold uppercase border border-slate-300 rounded-md px-2 py-1 bg-white cursor-pointer disabled:opacity-60 ${statusBadgeClasses}`}
                      value={currentStatusValue}
                      disabled={statusChangingId === s.id}
                      onChange={(e) => { if (e.target.value !== currentStatusValue) handleStatusChange(s, e.target.value); }}
                    >
                      {currentStatusValue === 'hold' ? (
                        <>
                          <option value="hold">On Hold</option>
                          <option value="pending">Release to Pending</option>
                        </>
                      ) : currentStatusValue === 'accept' ? (
                        <>
                          <option value="accept">Approved</option>
                          <option value="pending">Reset to Pending</option>
                          <option value="return">Return...</option>
                          <option value="reject">Reject...</option>
                          <option value="hold">Hold</option>
                        </>
                      ) : (
                        <>
                          <option value="pending">Pending</option>
                          <option value="accept">Approve</option>
                          <option value="return">Return...</option>
                          <option value="reject">Reject...</option>
                          <option value="hold">Hold</option>
                        </>
                      )}
                    </select>
                  ) : (
                    <span className={`text-xs font-bold uppercase ${statusBadgeClasses}`}>{statusLabel}</span>
                  )
                )}
                </div>
              </div>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase text-slate-500">
                    <th className="text-left px-4 py-2 w-[28%]"></th>
                    <th className="px-4 py-2 w-[30%]">
                      <span className="text-sky-700 bg-sky-50 rounded px-2 py-0.5">Our Log</span>
                    </th>
                    <th className="px-4 py-2 w-[26%]">
                      <span className="text-amber-700 bg-amber-50 rounded px-2 py-0.5">State Record</span>
                    </th>
                    <th className="px-4 py-2 w-[16%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingAnalysis ? (
                    <tr>
                      <td className="px-4 py-3 text-center text-slate-400 text-xs" colSpan={4}>Loading comparison…</td>
                    </tr>
                  ) : !documentReady ? (
                    <tr>
                      <td className="px-4 py-3 text-center text-slate-400 text-xs italic" colSpan={4}>No confirmed state document to compare against</td>
                    </tr>
                  ) : isDuplicate ? (
                    <tr>
                      <td className="px-4 py-3 text-center text-orange-700 text-xs font-semibold" colSpan={4}>Duplicate of another log for this patient on this date/time — only one can match the state's single record for it</td>
                    </tr>
                  ) : (
                    <>
                      {!sessionResult?.matched && (
                        <tr>
                          <td className="px-4 py-3 text-center text-orange-600 text-xs font-semibold" colSpan={4}>No matching record found in the state document for this session — showing our own logged values below</td>
                        </tr>
                      )}
                      {compareFields.map(f => {
                    // A field allowed via feedback (learned rule or a one-off
                    // acknowledgment) still shows as resolved, not plain-green
                    // "Match" — an amber badge distinguishes "billing signed off
                    // on this" from "the data genuinely lines up."
                    const isResolvedByFeedback = f.match === true && (f.learnedMatch || f.acknowledged);
                    const rowClass = f.match === false ? 'bg-red-50/60' : isResolvedByFeedback ? 'bg-amber-50/60' : '';
                    const icon = f.match === false ? <X className="size-3.5 text-red-500" />
                      : isResolvedByFeedback ? <CheckCircle2 className="size-3.5 text-amber-500" />
                      : f.match === true ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : null;
                    const stateColor = f.match === false ? 'text-red-700' : 'text-slate-800';
                    const requestKey = `${s.id}:${f.key}`;
                    const isTimeField = f.key === 'start_time' || f.key === 'end_time';
                    const displayOurs = isTimeField && f.ours ? formatTime12h(f.ours) : f.ours;
                    const displayState = isTimeField && f.state ? formatTime12h(f.state) : f.state;
                    return (
                      <tr key={f.key} className={`border-t border-slate-100 ${rowClass}`}>
                        <td className="px-4 py-2 font-semibold text-slate-600">
                          <div className="flex items-center gap-1.5">
                            {icon}
                            {f.label}
                          </div>
                          {f.withinTolerance && (
                            <span className="block text-[10px] font-bold text-amber-600 mt-0.5">Within tolerance</span>
                          )}
                          {f.learnedMatch && (
                            <span className="block text-[10px] font-bold text-amber-600 mt-0.5">Learned match</span>
                          )}
                          {f.acknowledged && !f.learnedMatch && (
                            <span className="block text-[10px] font-bold text-amber-600 mt-0.5">Allowed for this log</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center font-mono font-bold text-slate-800 break-words">{displayOurs || '-'}</td>
                        <td className={`px-4 py-2 text-center font-mono font-bold break-words ${stateColor}`}>{displayState || '-'}</td>
                        <td className="px-4 py-2 text-center">
                          {f.match === false && (
                            <button
                              type="button"
                              onClick={() => handleAllowField(s.id, f)}
                              disabled={allowingKey === requestKey || isReturned || isDeclined}
                              title={isReturned ? "This log has been returned to the practitioner — it can't be allowed until it's resubmitted." : isDeclined ? 'This log has been permanently rejected.' : undefined}
                              className="text-xs font-bold text-amber-700 border border-amber-300 bg-amber-50 rounded-md px-2.5 py-1 cursor-pointer hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            >
                              {allowingKey === requestKey ? 'Allowing…' : 'Allow'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                      })}
                    </>
                  )}
                </tbody>
              </table>

              {pendingNoteAction?.session?.id === s.id && (
                <div className={`border-t px-4 py-3 space-y-2 ${pendingNoteAction.type === 'reject' ? 'bg-red-50/60 border-red-200' : 'bg-amber-50/60 border-amber-200'}`}>
                  <p className={`text-xs font-semibold ${pendingNoteAction.type === 'reject' ? 'text-red-700' : 'text-amber-700'}`}>
                    {pendingNoteAction.type === 'reject'
                      ? 'Rejecting this log — it will be permanently excluded from billing. Explain why below.'
                      : 'Returning this log — describe what needs to be corrected below.'}
                  </p>
                  <Textarea
                    autoFocus
                    placeholder="Explain what needs to change..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    className="bg-white min-h-[80px]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setPendingNoteAction(null)} className="cursor-pointer">
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitNoteAction}
                      disabled={!noteText.trim() || isSubmittingNote}
                      className={`cursor-pointer text-white ${pendingNoteAction.type === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                    >
                      {isSubmittingNote ? 'Sending...' : pendingNoteAction.type === 'reject' ? 'Confirm Reject' : 'Confirm Return'}
                    </Button>
                  </div>
                </div>
              )}


              {adminDecideTarget === s.id && (
                <div className="border-t px-4 py-3 space-y-2 bg-orange-50/60 border-orange-200">
                  <p className="text-xs font-semibold text-orange-700">
                    This log has no matching record in the state document. A comment is required either way.
                  </p>
                  <Textarea
                    autoFocus
                    placeholder="Explain your decision — this will be added to the log's notes."
                    value={adminDecideComment}
                    onChange={(e) => setAdminDecideComment(e.target.value)}
                    className="bg-white min-h-[80px]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setAdminDecideTarget(null)} className="cursor-pointer">
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleAdminDecideInline(s.id, 'rejected')}
                      disabled={isDecidingMissing}
                      className="cursor-pointer text-white bg-red-600 hover:bg-red-700"
                    >
                      Reject
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleAdminDecideInline(s.id, 'approved')}
                      disabled={isDecidingMissing}
                      className="cursor-pointer text-white bg-emerald-600 hover:bg-emerald-700"
                    >
                      {isDecidingMissing ? 'Saving...' : 'Approve'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
