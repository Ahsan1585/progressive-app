import React, { useState, useEffect } from 'react';
import { formatTime12h } from '@/utils/formatTime';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Search, ChevronDown, Lock, PlayCircle, Check, X, Undo2,
  Ban, Clock, MessageSquareText, CheckCircle2, Sparkles,
} from 'lucide-react';

// --- Beta "Batch Review" view for Pending Bills: a master-detail layout
// (practitioner search + session queue on the left, session detail with
// one-click actions on the right) over the exact same data/handlers the
// legacy table already uses — this is a presentation layer, not a second
// workflow. Every action here calls the same functions passed down from
// BillingManager, which call the same backend endpoints either way.
export const BillingBatchReview = ({
  practitioners, expandedLogs, loadingExpand, fetchExpandedLogsFor,
  currentUserId, isAdmin, processingLogId, processingId,
  logActions, setLogActions,
  handleLock, handleRelease, handleAccept, handleHold, handleReleaseHold, handleReconcile,
  setActionModal, setActionNote, openNotesModal,
  handleGenerateAndIssue, handleSendToCompleted, pushToast, formatTime,
}) => {
  const [practitionerSearch, setPractitionerSearch] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [multiSelected, setMultiSelected] = useState(new Set());
  const [groupExpanded, setGroupExpanded] = useState(true);
  const [detailTab, setDetailTab] = useState('session'); // 'session' | 'analysis'

  // Keep a valid practitioner selected as the (filtered) list changes.
  useEffect(() => {
    if (practitioners.length === 0) { setSelectedPractitionerId(null); return; }
    if (!practitioners.some(p => p.practitioner_id === selectedPractitionerId)) {
      setSelectedPractitionerId(practitioners[0].practitioner_id);
    }
  }, [practitioners]);

  const selectedPractitioner = practitioners.find(p => p.practitioner_id === selectedPractitionerId) || null;
  const sessions = selectedPractitionerId ? (expandedLogs[selectedPractitionerId] || []) : [];
  const isLockedByMe = !!selectedPractitioner?.locked_by_id && selectedPractitioner.locked_by_id === currentUserId;
  const isLockedByOther = !!selectedPractitioner?.locked_by_id && selectedPractitioner.locked_by_id !== currentUserId;
  const isLoadingSessions = selectedPractitionerId ? loadingExpand.has(selectedPractitionerId) : false;
  const readyToComplete = selectedPractitioner?.sevf_documents?.length > 0 && selectedPractitioner?.invoice_documents?.length > 0;

  // The legacy table only ever fetches a practitioner's session queue in
  // response to a click (Lock or the expand chevron). That leaves a gap
  // here: if a practitioner is *already* locked to the current user when
  // this view loads (e.g. a page refresh mid-review, or they lock via the
  // search result before the effect below runs), nothing ever triggers the
  // fetch and the queue silently shows "No individual logs found." even
  // though real sessions exist. Cover that case explicitly.
  useEffect(() => {
    if (isLockedByMe && selectedPractitionerId && expandedLogs[selectedPractitionerId] === undefined && !loadingExpand.has(selectedPractitionerId)) {
      fetchExpandedLogsFor(selectedPractitionerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLockedByMe, selectedPractitionerId, expandedLogs]);

  // Keep a valid session selected as this practitioner's queue changes.
  useEffect(() => {
    setMultiSelected(new Set());
    if (sessions.length === 0) { setSelectedSessionId(null); return; }
    if (!sessions.some(s => s.id === selectedSessionId)) setSelectedSessionId(sessions[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPractitionerId, sessions.length]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) || null;

  const filteredPractitioners = practitioners.filter(p =>
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(practitionerSearch.toLowerCase()) ||
    p.practitioner_id?.toString().includes(practitionerSearch)
  );

  const selectPractitioner = (id) => {
    setSelectedPractitionerId(id);
    setSelectedSessionId(null);
    setMultiSelected(new Set());
    setDetailTab('session');
    setPractitionerSearch('');
    setShowResults(false);
  };

  const toggleMulti = (id) => {
    setMultiSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedSessionObjs = sessions.filter(s => multiSelected.has(s.id));

  const bulkHold = async () => {
    const targets = selectedSessionObjs.filter(s => s.billing_status === 'pending');
    if (targets.length === 0) return;
    setMultiSelected(new Set());
    for (const s of targets) {
      // eslint-disable-next-line no-await-in-loop
      await handleHold(s, selectedPractitionerId);
    }
  };

  const bulkOpenActionModal = (type) => {
    const targets = selectedSessionObjs.filter(s => s.billing_status === 'pending');
    if (targets.length === 0) return;
    setActionModal({ session: targets[0], sessions: targets, practitionerId: selectedPractitionerId, type });
    setActionNote('');
    setMultiSelected(new Set());
  };

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
    <div className="flex h-[640px] max-h-[70vh]">
      {/* LEFT: practitioner search + session queue */}
      <div className="w-80 flex-shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/40">
        <div className="p-3 border-b border-slate-200 relative">
          <div className="relative">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search practitioner..."
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              value={practitionerSearch}
              onChange={(e) => { setPractitionerSearch(e.target.value); setShowResults(true); }}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
            />
          </div>
          {showResults && practitionerSearch && (
            <div className="absolute left-3 right-3 top-14 z-20 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {filteredPractitioners.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-400 text-center">No practitioner matches</div>
              ) : filteredPractitioners.map(p => (
                <button
                  key={p.practitioner_id}
                  type="button"
                  onMouseDown={() => selectPractitioner(p.practitioner_id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="font-semibold text-slate-800 capitalize">{p.first_name} {p.last_name}</span>
                  <span className="text-xs text-slate-400">{p.total_interventions} logs</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {!selectedPractitioner ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400 px-6 text-center">No active workflows pending.</div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setGroupExpanded(v => !v)}
              className="flex items-center gap-2.5 px-3 py-3 border-b border-slate-200 bg-white hover:bg-slate-50 transition-colors cursor-pointer text-left"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-600 to-sky-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                {`${selectedPractitioner.first_name?.[0] || ''}${selectedPractitioner.last_name?.[0] || ''}`.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-slate-800 capitalize truncate">{selectedPractitioner.first_name} {selectedPractitioner.last_name}</div>
                <div className="text-xs text-slate-400">{selectedPractitioner.total_interventions} sessions</div>
              </div>
              <ChevronDown className={`size-4 text-slate-400 transition-transform flex-shrink-0 ${groupExpanded ? '' : '-rotate-90'}`} />
            </button>

            <div className="px-3 py-2.5 border-b border-slate-200 bg-white">
              {isLockedByOther ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                    <Lock className="size-3" /> Locked by {selectedPractitioner.locked_by_name}
                  </span>
                  {isAdmin && (
                    <button onClick={() => handleRelease(selectedPractitionerId)} className="text-xs font-semibold text-red-600 hover:underline cursor-pointer">Force Release</button>
                  )}
                </div>
              ) : isLockedByMe ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1">
                    <Lock className="size-3" /> Locked to you
                  </span>
                  <button onClick={() => handleRelease(selectedPractitionerId)} className="text-xs font-semibold text-red-600 hover:underline cursor-pointer">Release</button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => handleLock(selectedPractitionerId)} className="w-full gap-1.5 cursor-pointer">
                  <Lock className="size-3.5" /> Lock to Review
                </Button>
              )}
            </div>

            {isLockedByMe && groupExpanded && (
              <div className="flex-1 overflow-y-auto">
                {isLoadingSessions ? (
                  <div className="p-4 text-center text-xs text-slate-400">Loading sessions...</div>
                ) : sessions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">No individual logs found.</div>
                ) : sessions.map(s => {
                  const isDeclined = s.billing_status === 'declined';
                  const isReturned = s.billing_status === 'rejected';
                  const isOnHold = s.billing_status === 'on_hold';
                  const dotColor = isDeclined ? 'bg-red-400' : isReturned ? 'bg-amber-400' : isOnHold ? 'bg-violet-400'
                    : (logActions[s.id] === 'accept' || s.billing_review === 'accept') ? 'bg-emerald-400' : 'bg-slate-300';
                  return (
                    <div
                      key={s.id}
                      onClick={() => { setSelectedSessionId(s.id); setDetailTab('session'); }}
                      className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-slate-100 cursor-pointer transition-colors ${
                        selectedSessionId === s.id && multiSelected.size === 0 ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={multiSelected.has(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleMulti(s.id)}
                        className="cursor-pointer flex-shrink-0"
                      />
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-800 truncate">{s.patient_first_name} {s.patient_last_name}</div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                          {s.service_date ? new Date(s.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '-'}
                          <span className="font-mono bg-slate-100 border border-slate-200 rounded px-1">{s.type || '-'}</span>
                        </div>
                      </div>
                      {s.notes_count > 0 && <MessageSquareText className="size-3 text-slate-400 flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* RIGHT: detail panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {multiSelected.size > 0 ? (
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-slate-800 text-white">
              <span className="text-sm font-bold">{multiSelected.size} selected</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={bulkOpenActionModal.bind(null, 'return')} className="cursor-pointer bg-transparent border-white/25 text-white hover:bg-white/10 gap-1.5">
                  <Undo2 className="size-3.5" /> Return
                </Button>
                <Button size="sm" variant="outline" onClick={bulkOpenActionModal.bind(null, 'reject')} className="cursor-pointer bg-transparent border-white/25 text-white hover:bg-white/10 gap-1.5">
                  <X className="size-3.5" /> Reject
                </Button>
                <Button size="sm" variant="outline" onClick={bulkHold} className="cursor-pointer bg-transparent border-white/25 text-white hover:bg-white/10 gap-1.5">
                  <Clock className="size-3.5" /> Hold
                </Button>
                <button onClick={() => setMultiSelected(new Set())} className="text-xs underline text-white/70 hover:text-white cursor-pointer ml-1">Clear</button>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 px-8 text-center">
              Approve isn't available in bulk — review and approve each log individually from the queue.
            </div>
          </div>
        ) : !isLockedByMe ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400 px-8 text-center">
            {isLockedByOther ? `Locked by ${selectedPractitioner?.locked_by_name} — wait for them to finish or release it.` : 'Lock this practitioner to begin reviewing their logs.'}
          </div>
        ) : !selectedSession ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400 px-8 text-center">Select a session from the queue.</div>
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
              <ComplianceAnalysisPreview sessions={sessions} practitioner={selectedPractitioner} />
            ) : (
              <SessionDetailPanel
                session={selectedSession}
                practitionerId={selectedPractitionerId}
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

        {isLockedByMe && sessions.length > 0 && (
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-slate-200 bg-slate-800 text-white flex-wrap">
            <div className="flex gap-4 text-[11px] text-white/60 flex-wrap">
              <span><b className="text-white">{routingCounts.billable}</b> billable → Completed Bills</span>
              <span><b className="text-white">{routingCounts.heldReturned}</b> held/returned → stays in Pending</span>
              <span><b className="text-white">{routingCounts.excluded}</b> excluded (rejected)</span>
            </div>
            {readyToComplete ? (
              <Button
                size="sm"
                onClick={() => handleSendToCompleted(selectedPractitionerId)}
                disabled={processingId === selectedPractitionerId}
                className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              >
                <CheckCircle2 className="size-4" /> {processingId === selectedPractitionerId ? 'Sending...' : 'Send to Completed Bills'}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => handleGenerateAndIssue(selectedPractitionerId)}
                disabled={!allLogsReviewed || processingId === selectedPractitionerId}
                className={`cursor-pointer gap-1.5 ${allLogsReviewed ? 'bg-white text-slate-800 hover:bg-slate-100' : 'bg-white/10 text-white/40 cursor-not-allowed'}`}
              >
                {processingId === selectedPractitionerId ? 'Generating...' : 'Generate & Issue'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

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
        <div className="grid grid-cols-4 gap-2.5 mb-4">
          <ActionButton
            label="Approve" active={logActions[session.id] === 'accept'} tone="emerald"
            icon={<Check className="size-4" />}
            onClick={() => { setLogActions(prev => ({ ...prev, [session.id]: 'accept' })); handleAccept(session, practitionerId); }}
          />
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
