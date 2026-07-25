import React, { useState, useEffect, useRef } from 'react';
import { formatTime12h } from '@/utils/formatTime';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Search, ChevronDown, Lock, PlayCircle, X, Undo2,
  Ban, Clock, MessageSquareText, CheckCircle2, Sparkles,
} from 'lucide-react';

// --- Beta "Batch Review" view for Pending Bills: a master-detail layout
// (a scrollable list of ALL practitioners with pending logs on the left —
// same as the legacy table, just laid out as collapsible/lockable groups —
// and session detail with one-click actions on the right) over the exact
// same data/handlers the legacy table already uses. Every action here calls
// the same functions passed down from BillingManager, which call the same
// backend endpoints either way — this is a presentation layer, not a
// second workflow.
export const BillingBatchReview = ({
  practitioners, expandedLogs, loadingExpand, fetchExpandedLogsFor,
  currentUserId, isAdmin, processingLogId, processingId,
  logActions, setLogActions,
  handleLock, handleRelease, handleAccept, handleHold, handleReleaseHold, handleReconcile,
  setActionModal, setActionNote, openNotesModal,
  handleGenerateAndIssue, handleSendToCompleted, pushToast, formatTime,
}) => {
  const [practitionerSearch, setPractitionerSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [detail, setDetail] = useState(null); // { practitionerId, sessionId } | null
  const [detailTab, setDetailTab] = useState('session'); // 'session' | 'analysis'

  const filteredPractitioners = practitioners.filter(p =>
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(practitionerSearch.toLowerCase()) ||
    p.practitioner_id?.toString().includes(practitionerSearch)
  );

  // A practitioner already locked to the current user (from a previous
  // visit, a page refresh mid-review, etc.) should show open and populated
  // without requiring a manual click — otherwise the queue silently looks
  // empty even though real sessions exist. Auto-expand + fetch each one
  // exactly once (autoHandledRef prevents re-forcing a group back open
  // after the user deliberately collapses it).
  const autoHandledRef = useRef(new Set());
  useEffect(() => {
    practitioners.forEach(p => {
      const isLockedByMe = p.locked_by_id && p.locked_by_id === currentUserId;
      if (!isLockedByMe || autoHandledRef.current.has(p.practitioner_id)) return;
      autoHandledRef.current.add(p.practitioner_id);
      setExpandedGroups(prev => new Set(prev).add(p.practitioner_id));
      if (expandedLogs[p.practitioner_id] === undefined && !loadingExpand.has(p.practitioner_id)) {
        fetchExpandedLogsFor(p.practitioner_id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practitioners]);

  const toggleGroup = (practitionerId) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(practitionerId) ? next.delete(practitionerId) : next.add(practitionerId);
      return next;
    });
  };

  const onLock = async (practitionerId) => {
    await handleLock(practitionerId);
    setExpandedGroups(prev => new Set(prev).add(practitionerId));
  };

  const selectSession = (practitionerId, sessionId) => {
    setDetail({ practitionerId, sessionId });
    setDetailTab('session');
  };

  const detailPractitioner = detail ? practitioners.find(p => p.practitioner_id === detail.practitionerId) : null;
  const detailSessions = detail ? (expandedLogs[detail.practitionerId] || []) : [];
  const detailSession = detail ? detailSessions.find(s => s.id === detail.sessionId) || null : null;

  return (
    <div className="flex h-[640px] max-h-[70vh]">
      {/* LEFT: every practitioner with pending logs, as collapsible/lockable groups */}
      <div className="w-80 flex-shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/40">
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search practitioner..."
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              value={practitionerSearch}
              onChange={(e) => setPractitionerSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredPractitioners.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              {practitioners.length === 0 ? 'No active workflows pending.' : 'No practitioner matches your search.'}
            </div>
          ) : filteredPractitioners.map(p => (
            <PractitionerGroup
              key={p.practitioner_id}
              practitioner={p}
              isExpanded={expandedGroups.has(p.practitioner_id)}
              onToggle={() => toggleGroup(p.practitioner_id)}
              sessions={expandedLogs[p.practitioner_id] || []}
              isLoadingSessions={loadingExpand.has(p.practitioner_id)}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onLock={() => onLock(p.practitioner_id)}
              onRelease={() => handleRelease(p.practitioner_id)}
              logActions={logActions}
              formatTime={formatTime}
              detailSessionId={detail?.practitionerId === p.practitioner_id ? detail.sessionId : null}
              onSelectSession={(sessionId) => selectSession(p.practitioner_id, sessionId)}
              processingId={processingId}
              handleGenerateAndIssue={handleGenerateAndIssue}
              handleSendToCompleted={handleSendToCompleted}
            />
          ))}
        </div>
      </div>

      {/* RIGHT: detail panel for whichever session was last clicked */}
      <div className="flex-1 flex flex-col min-w-0">
        {!detailSession ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400 px-8 text-center">
            {practitioners.length === 0 ? 'No active workflows pending.' : 'Select a session from the queue on the left.'}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex gap-1 border-b border-slate-200 mb-5">
              <button
                onClick={() => setDetailTab('session')}
                className={`px-3 pb-2.5 text-sm font-bold border-b-2 -mb-px cursor-pointer transition-colors ${
                  detailTab === 'session' ? 'border-blue-500 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Session Detail
              </button>
              <button
                onClick={() => setDetailTab('analysis')}
                className={`px-3 pb-2.5 text-sm font-bold border-b-2 -mb-px cursor-pointer transition-colors flex items-center gap-1.5 ${
                  detailTab === 'analysis' ? 'border-violet-500 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Sparkles className="size-3.5" /> Compliance Analysis
              </button>
            </div>

            {detailTab === 'analysis' ? (
              <ComplianceAnalysisPreview sessions={detailSessions} practitioner={detailPractitioner} />
            ) : (
              <SessionDetailPanel
                session={detailSession}
                practitionerId={detail.practitionerId}
                logActions={logActions}
                setLogActions={setLogActions}
                processingLogId={processingLogId}
                handleAccept={handleAccept}
                handleHold={handleHold}
                handleReleaseHold={handleReleaseHold}
                handleReconcile={handleReconcile}
                setActionModal={setActionModal}
                setActionNote={setActionNote}
                openNotesModal={openNotesModal}
                formatTime={formatTime}
              />
            )}
          </div>
        )}
      </div>
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
        className="w-full flex items-center gap-2.5 px-3 py-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer text-left"
      >
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-sky-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
          {`${practitioner.first_name?.[0] || ''}${practitioner.last_name?.[0] || ''}`.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-slate-800 capitalize truncate">{practitioner.first_name} {practitioner.last_name}</div>
          <div className="text-xs text-slate-400">{practitioner.total_interventions} sessions</div>
        </div>
        {isLockedByMe && <Lock className="size-3 text-teal-500 flex-shrink-0" />}
        {isLockedByOther && <Lock className="size-3 text-amber-500 flex-shrink-0" />}
        <ChevronDown className={`size-4 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
      </button>

      {isExpanded && (
        <>
          <div className="px-3 py-2.5 bg-white border-t border-slate-100">
            {isLockedByOther ? (
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                  <Lock className="size-3" /> Locked by {practitioner.locked_by_name}
                </span>
                {isAdmin && (
                  <button onClick={onRelease} className="text-xs font-semibold text-red-600 hover:underline cursor-pointer">Force Release</button>
                )}
              </div>
            ) : isLockedByMe ? (
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1">
                  <Lock className="size-3" /> Locked to you
                </span>
                <button onClick={onRelease} className="text-xs font-semibold text-red-600 hover:underline cursor-pointer">Release</button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={onLock} className="w-full gap-1.5 cursor-pointer">
                <Lock className="size-3.5" /> Lock to Review
              </Button>
            )}
          </div>

          {isLockedByMe && (
            isLoadingSessions ? (
              <div className="p-4 text-center text-xs text-slate-400">Loading sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">No individual logs found.</div>
            ) : (
              <>
                {sessions.map(s => {
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
                      className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5 border-t border-slate-100 cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Column 1: patient + date */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-800 truncate">{s.patient_first_name} {s.patient_last_name}</div>
                          <div className="text-[10px] text-slate-400">
                            {s.service_date ? new Date(s.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}
                          </div>
                        </div>
                      </div>

                      {/* Column 2: service codes */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="font-mono text-[10px] bg-slate-100 border border-slate-200 rounded px-1" title="Service Status">S:{s.status || '-'}</span>
                        <span className="font-mono text-[10px] bg-slate-100 border border-slate-200 rounded px-1" title="Service Type">{s.type || '-'}</span>
                        <span className="font-mono text-[10px] bg-slate-100 border border-slate-200 rounded px-1" title="Service Location">L:{s.location || '-'}</span>
                      </div>

                      {/* Column 3: status + duration, same line */}
                      <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
                        <span className={`text-[10px] font-bold uppercase rounded px-1 ${statusLabelClasses}`}>{statusLabel}</span>
                        <span className="text-[10px] font-bold text-slate-500">{formatTime(s.total_time)}</span>
                        {s.notes_count > 0 && <MessageSquareText className="size-3 text-slate-400" />}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-800 text-white flex-wrap">
                  <div className="flex gap-3 text-[10px] text-white/60 flex-wrap">
                    <span><b className="text-white">{routingCounts.billable}</b> billable</span>
                    <span><b className="text-white">{routingCounts.heldReturned}</b> held/returned</span>
                    <span><b className="text-white">{routingCounts.excluded}</b> excluded</span>
                  </div>
                  {readyToComplete ? (
                    <Button
                      size="sm"
                      onClick={() => handleSendToCompleted(practitioner.practitioner_id)}
                      disabled={processingId === practitioner.practitioner_id}
                      className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                    >
                      <CheckCircle2 className="size-3.5" /> {processingId === practitioner.practitioner_id ? 'Sending...' : 'Send to Completed'}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleGenerateAndIssue(practitioner.practitioner_id)}
                      disabled={!allLogsReviewed || processingId === practitioner.practitioner_id}
                      className={`cursor-pointer gap-1.5 ${allLogsReviewed ? 'bg-white text-slate-800 hover:bg-slate-100' : 'bg-white/10 text-white/40 cursor-not-allowed'}`}
                    >
                      {processingId === practitioner.practitioner_id ? 'Generating...' : 'Generate & Issue'}
                    </Button>
                  )}
                </div>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}

// --- Session Detail: fields + one-click actions, same status logic as the
// legacy table's expanded row (isDeclined/isReturned/isOnHold/isLocked). ---
function SessionDetailPanel({
  session, practitionerId, logActions, setLogActions, processingLogId,
  handleAccept, handleHold, handleReleaseHold, handleReconcile,
  setActionModal, setActionNote, openNotesModal, formatTime,
}) {
  const isDeclined = session.billing_status === 'declined';
  const isReturned = session.billing_status === 'rejected';
  const isOnHold = session.billing_status === 'on_hold';
  const isProcessing = processingLogId === session.id;
  const isLocked = session.billing_status === 'njeis_review';

  const openModal = (type) => {
    setActionModal({ session, practitionerId, type });
    setActionNote('');
  };

  return (
    <div className="max-w-xl">
      <div className="text-xs font-bold uppercase tracking-wide text-blue-500 mb-1">
        {session.service_date ? new Date(session.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '-'}
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-1">{session.patient_first_name} {session.patient_last_name}</h2>
      <div className="flex items-center gap-2 mb-5">
        <p className="text-sm text-slate-500">{session.type || '-'} session</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => openNotesModal(session)} className={`cursor-pointer ${session.notes_count > 0 ? 'text-slate-500 hover:text-slate-700' : 'text-slate-300 hover:text-slate-400'}`}>
              <MessageSquareText className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{session.notes_count > 0 ? 'View return/resubmit notes' : 'No notes recorded yet'}</TooltipContent>
        </Tooltip>
      </div>

      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Service Codes</div>
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase text-slate-400">Status</div>
          <div className="text-sm font-bold font-mono text-slate-800">{session.status || '-'}</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase text-slate-400">Type</div>
          <div className="text-sm font-bold font-mono text-slate-800">{session.type || '-'}</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase text-slate-400">Location</div>
          <div className="text-sm font-bold font-mono text-slate-800">{session.location || '-'}</div>
        </div>
      </div>

      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Session Time</div>
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase text-slate-400">Start</div>
          <div className="text-sm font-bold text-slate-800">{session.start_time ? formatTime12h(session.start_time) : '-'}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase text-slate-400">End</div>
          <div className="text-sm font-bold text-slate-800">{session.end_time ? formatTime12h(session.end_time) : '-'}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase text-slate-400">Total</div>
          <div className="text-sm font-bold text-slate-800">{formatTime(session.total_time)}</div>
        </div>
      </div>

      {isProcessing ? (
        <div className="text-sm text-slate-400">Processing...</div>
      ) : isDeclined || isReturned ? (
        <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-4 ${isDeclined ? 'bg-slate-100' : 'bg-amber-50 border border-amber-200'}`}>
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isDeclined ? 'text-slate-500' : 'text-amber-700'}`}>
            {isDeclined ? <Ban className="size-3.5" /> : <Clock className="size-3.5" />}
            {isDeclined ? 'Permanently rejected — excluded from report' : 'Returned to practitioner — awaiting resubmission'}
          </span>
          <Button size="sm" variant="outline" onClick={() => handleReconcile(session, practitionerId)} className="cursor-pointer gap-1 flex-shrink-0">
            Reconcile
          </Button>
        </div>
      ) : isLocked ? (
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-4">
          <Ban className="size-3.5" /> SEVF has been issued — locked until it returns to pending.
        </div>
      ) : isOnHold ? (
        <Button onClick={() => handleReleaseHold(session, practitionerId)} className="cursor-pointer gap-1.5 bg-orange-600 hover:bg-orange-700 text-white mb-4">
          <PlayCircle className="size-4" /> Release from Hold
        </Button>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <ActionButton
            label="Return" active={logActions[session.id] === 'return'} tone="blue"
            icon={<Undo2 className="size-4" />}
            onClick={() => openModal('return')}
          />
          <ActionButton
            label="Reject" active={logActions[session.id] === 'reject'} tone="red"
            icon={<X className="size-4" />}
            onClick={() => openModal('reject')}
          />
          <ActionButton
            label="Hold" active={false} tone="orange"
            icon={<Clock className="size-4" />}
            onClick={() => handleHold(session, practitionerId)}
          />
        </div>
      )}
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
      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-1.5 bg-white cursor-pointer transition-colors ${toneClasses}`}
    >
      {icon}
      <span className="text-xs font-bold">{label}</span>
    </button>
  );
}

// --- Compliance Analysis preview: shows the intended side-by-side layout
// using this practitioner's REAL logged sessions on the left, but the
// state-document upload feature doesn't exist yet (Company Information has
// no document storage), so there is nothing real to compare against on the
// right. Rather than fabricating "state required" values that would look
// like a genuine pass/fail check on real patient billing data, every right-
// hand cell is an explicit "no document on file" placeholder and no
// match/mismatch verdict is computed — this previews the intended UI shape
// without ever asserting a false compliance result.
const COMPARISON_FIELDS = [
  { key: 'service_date', label: 'Service Date', format: (s) => s.service_date ? new Date(s.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-' },
  { key: 'type', label: 'Service Type', format: (s) => s.type || '-' },
  { key: 'start_time', label: 'Start Time', format: (s) => s.start_time ? formatTime12h(s.start_time) : '-' },
  { key: 'end_time', label: 'End Time', format: (s) => s.end_time ? formatTime12h(s.end_time) : '-' },
  { key: 'location', label: 'Location', format: (s) => s.location || '-' },
  { key: 'patient', label: 'Child Name', format: (s) => `${s.patient_first_name || ''} ${s.patient_last_name || ''}`.trim() || '-' },
  { key: 'status', label: 'Service Status', format: (s) => s.status || '-' },
];

function ComplianceAnalysisPreview({ sessions, practitioner }) {
  const practitionerName = practitioner ? `${practitioner.first_name} ${practitioner.last_name}` : '-';

  return (
    <div>
      <div className="flex items-start gap-3 bg-gradient-to-br from-slate-50 to-violet-50 border border-slate-200 rounded-xl p-4 mb-5">
        <div className="w-9 h-9 rounded-lg bg-slate-800 text-white flex items-center justify-center flex-shrink-0">
          <Sparkles className="size-4" />
        </div>
        <div>
          <div className="text-sm font-bold text-slate-800 mb-1">Compliance Analysis — preview</div>
          <p className="text-xs text-slate-500 leading-relaxed">
            This will lay every session's Service Date, Type, Start/End Time, Location, Child Name, Service Status, and Practitioner Name side by side against state-required documents, field by field. Document upload isn't built yet (coming to Company Information), so the "State Req." column below is a placeholder — no comparison has actually run and nothing here reflects a real compliance result.
          </p>
        </div>
      </div>

      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Reference documents (from Company Information)</div>
      <div className="text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg px-3 py-2.5 mb-5">
        No state documents on file yet — this feature isn't available in Company Information yet.
      </div>

      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
        Side-by-side preview &middot; {practitionerName}
      </div>
      <div className="space-y-2.5">
        {sessions.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-6">No sessions to preview.</div>
        ) : sessions.map(s => (
          <div key={s.id} className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between bg-slate-50 px-3 py-2 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-700">{s.patient_first_name} {s.patient_last_name}</span>
              <span className="text-[10px] text-slate-400">{s.service_date ? new Date(s.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] font-bold uppercase text-slate-400">
                  <th className="text-left px-3 py-1.5 w-1/3"></th>
                  <th className="px-3 py-1.5">
                    <span className="text-sky-600 bg-sky-50 rounded px-1.5 py-0.5">Practitioner</span>
                  </th>
                  <th className="px-3 py-1.5">
                    <span className="text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">State Req.</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FIELDS.map(f => (
                  <tr key={f.key} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-semibold text-slate-500">{f.label}</td>
                    <td className="px-3 py-1.5 text-center font-mono font-bold text-slate-700">{f.format(s)}</td>
                    <td className="px-3 py-1.5 text-center text-slate-300 italic">no document</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
