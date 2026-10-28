import { useState, useEffect, useMemo, useRef } from 'react';
import api from '@/api/axiosInstance';
import { formatTime12h } from '@/utils/formatTime';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { showAlert } from '@/utils/dialogStore';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Download, Undo2 } from 'lucide-react';
import { buildFlagList, describeFlag, flagOutcome, hasWordOverlap, nextOpenIndex, suggestNote } from '@/utils/fixFlags';

// --- Fix flags: the sessions Compliance Analysis flagged, one at a time.
// Same endpoints and rules as the Compliance Analysis tab (Allow each
// flagged field before approving, duplicates can't be approved, a
// missing-in-EIMS log is decided or sent to an admin); this only changes
// how a biller gets to them and moves through them. Each action moves on to
// the next open flag. ---

const OUTCOMES = {
  approved: { label: 'Approved', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  returned: { label: 'Returned to practitioner', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  held: { label: 'On hold', classes: 'bg-violet-50 text-violet-700 border-violet-200' },
  rejected: { label: 'Rejected', classes: 'bg-red-50 text-red-700 border-red-200' },
  with_admin: { label: 'Sent to admin', classes: 'bg-blue-50 text-blue-700 border-blue-200' },
  resolved: { label: 'Already resolved', classes: 'bg-slate-50 text-slate-600 border-slate-200' },
};
const NOTE_PROMPTS = {
  return: 'What should the practitioner fix?',
  hold: 'Why is it on hold? Whoever picks it back up will see this.',
  reject: 'Why is it rejected? It will never be billed.',
};
const ADVANCE_DELAY_MS = 450;
const TIME_KEYS = ['start_time', 'end_time'];

const longDate = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '-');
const formatMonthLabel = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

function ActionTile({ label, hint, shortcut, tone, onClick, disabled, active }) {
  const tones = {
    green: 'border-emerald-500 bg-emerald-50 text-emerald-700',
    blue: 'hover:border-blue-500 hover:bg-blue-50',
    orange: 'hover:border-orange-500 hover:bg-orange-50',
    red: 'hover:border-red-500 hover:bg-red-50',
  };
  const activeTones = { blue: 'border-blue-500 bg-blue-50', orange: 'border-orange-500 bg-orange-50', red: 'border-red-500 bg-red-50' };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[96px] flex-col items-start gap-1 rounded-2xl border-2 bg-white p-3.5 text-left transition-[transform,background-color,border-color] active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:opacity-50 ${
        active ? activeTones[tone] : 'border-slate-300'
      } ${tones[tone] || ''}`}
    >
      <span className="text-[15px] font-extrabold text-slate-900">{label}</span>
      <span className="text-[12px] font-medium leading-snug text-slate-500">{hint}</span>
      {shortcut && (
        <kbd className="mt-auto rounded border border-b-2 border-slate-300 bg-slate-50 px-1.5 font-mono text-[11px] font-bold text-slate-500">{shortcut}</kbd>
      )}
    </button>
  );
}

export function FixFlagsPanel({
  sessions, practitionerId, practitionerName, periodStart, periodEnd, logActions,
  startKind, currentId, onCurrentChange, onFlagsChange, onNotAFlag,
  handleAccept, handleResetToPending, handleHold, handleReleaseHold, handleInlineReturnReject,
  canGenerate, isGenerating, onGenerate,
  readyToComplete, onSendToCompleted, isSendingToCompleted, sevfDocuments, invoiceDocuments,
}) {
  const [analysis, setAnalysis] = useState(null); // { documentOnFile, results } | null
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Frozen membership: a flag stays in the list after it's handled (Allow
  // clears `flagged`, so recomputing would make it vanish mid-review).
  const [flagList, setFlagList] = useState([]);
  const [builtFor, setBuiltFor] = useState(null); // the analysis flagList was last built from
  // The billing handlers report their own errors and don't throw, so a flag
  // only counts as handled once its refreshed status says so; this holds
  // the id whose action just finished, to check on the next render.
  const [pendingAdvance, setPendingAdvance] = useState(null);
  const advanceTimer = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // 'return' | 'hold' | 'reject' | null
  const [noteText, setNoteText] = useState('');
  const [suggested, setSuggested] = useState(''); // the note last filled in for the biller
  const noteRef = useRef(null);
  const [onlyDifferent, setOnlyDifferent] = useState(false);
  const [remember, setRemember] = useState(false);
  const [reviewingAgain, setReviewingAgain] = useState(false);
  const autoRanFor = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    api.get('/api/billing/compliance-analysis', { params: { practitionerId, startDate: periodStart, endDate: periodEnd } })
      .then((res) => { if (!cancelled) setAnalysis(res.data); })
      .catch((error) => { if (!cancelled) setLoadError(error.response?.data?.error || 'Failed to load the EIMS comparison.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [practitionerId, periodStart, periodEnd]);

  const results = analysis?.documentOnFile ? analysis.results || {} : {};
  const sessionsById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  useEffect(() => {
    if (!analysis?.documentOnFile || sessions.length === 0) return;
    const fresh = buildFlagList(sessions, analysis.results || {});
    setFlagList((prev) => {
      const seen = new Set(prev.map((f) => f.id));
      const added = fresh.filter((f) => !seen.has(f.id));
      return added.length ? [...prev, ...added] : prev;
    });
    setBuiltFor(analysis);
  }, [analysis, sessions]);

  // The queue tags and filters rows from this same list.
  useEffect(() => {
    onFlagsChange?.(new Map(flagList.map((f) => [f.id, f.kind])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagList]);

  // Same two clean-ups the Compliance Analysis tab does when it loads, so
  // finishing here leaves the batch ready to generate: a clean match is
  // approved, and a duplicate's stale Approved is reset to Pending.
  useEffect(() => {
    if (!analysis?.documentOnFile || sessions.length === 0 || autoRanFor.current === analysis) return;
    autoRanFor.current = analysis;
    sessions.forEach((s) => {
      const r = analysis.results?.[s.id];
      if (!r || s.billing_status !== 'pending') return;
      const isApproved = logActions?.[s.id] === 'accept' || s.billing_review === 'accept';
      if (r.duplicateOfSessionId) {
        if (isApproved) handleResetToPending(s, practitionerId);
      } else if (r.matched && !r.flagged && !isApproved) {
        handleAccept(s, practitionerId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, sessions.length]);

  // A flag whose session has dropped out of the live list (e.g. rejected a
  // second time and reconciled, so getPractitionerLogs stops returning it)
  // is resolved, not stuck — without this, isHandled never returns true for
  // it, allHandled never fires, and the panel is stuck rendering the dead
  // "Loading…" fallback below with no way to advance past it.
  const outcomeOf = (flag) => {
    const s = sessionsById.get(flag.id);
    if (!s) return 'resolved';
    return flagOutcome(s, results[flag.id], logActions);
  };
  const isHandled = (flag) => !!outcomeOf(flag);
  const handledCount = flagList.filter(isHandled).length;
  const allHandled = flagList.length > 0 && handledCount === flagList.length;

  // Start on the first open flag of the chip that was clicked.
  const currentIndex = flagList.findIndex((f) => f.id === currentId);
  useEffect(() => {
    if (!analysis || builtFor !== analysis || currentIndex >= 0) return;
    // A specific session was clicked but it isn't flagged any more.
    if (currentId != null && onNotAFlag) { onNotAFlag(currentId); return; }
    if (flagList.length === 0) return;
    const ofKind = flagList.findIndex((f) => !isHandled(f) && (startKind === 'missing' ? f.kind === 'missing' : f.kind !== 'missing'));
    const firstOpen = flagList.findIndex((f) => !isHandled(f));
    const pick = ofKind >= 0 ? ofKind : firstOpen >= 0 ? firstOpen : 0;
    onCurrentChange(flagList[pick].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagList, currentIndex, builtFor]);

  const flag = currentIndex >= 0 ? flagList[currentIndex] : null;
  const session = flag ? sessionsById.get(flag.id) : null;
  const result = flag ? results[flag.id] : null;
  const outcome = flag ? outcomeOf(flag) : null;
  const firstName = (practitionerName || '').split(' ')[0] || 'this practitioner';

  const goTo = (index) => {
    if (!flagList.length) return;
    setNote(null);
    setNoteText('');
    setSuggested('');
    setRemember(false);
    onCurrentChange(flagList[(index + flagList.length) % flagList.length].id);
  };

  useEffect(() => () => clearTimeout(advanceTimer.current), []);
  useEffect(() => {
    if (pendingAdvance == null) return;
    const from = flagList.findIndex((f) => f.id === pendingAdvance);
    if (from < 0) { setPendingAdvance(null); return; }
    if (!isHandled(flagList[from])) return; // waiting for the refreshed status
    setPendingAdvance(null);
    setNote(null);
    setNoteText('');
    setSuggested('');
    setRemember(false);
    const next = nextOpenIndex(flagList, from, isHandled);
    advanceTimer.current = setTimeout(() => {
      if (next >= 0) onCurrentChange(flagList[next].id);
      else setReviewingAgain(false);
    }, ADVANCE_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAdvance, sessions, logActions, analysis]);

  const run = async (fn) => {
    if (busy || !session) return;
    setBusy(true);
    try {
      await fn();
      const id = session.id;
      setPendingAdvance(id);
      // If the status never changes, the handler already said why; stop waiting.
      setTimeout(() => setPendingAdvance((cur) => (cur === id ? null : cur)), 5000);
    } catch (error) {
      showAlert(error.response?.data?.error || 'That didn\'t go through. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const patchResult = (id, patch) => setAnalysis((prev) => (prev ? { ...prev, results: { ...prev.results, [id]: { ...prev.results[id], ...patch } } } : prev));

  // Approve anyway: Allow every flagged field (remembering the pairing only
  // where the server would accept a reusable rule), then approve.
  const approveMismatch = () => run(async () => {
    let fields = result.fields;
    for (const f of result.fields.filter((x) => x.match === false)) {
      const rememberThis = remember && !!f._learn && hasWordOverlap(f.ours, f.state);
      const res = await api.post('/api/billing/compliance-analysis/allow-field', { assessmentId: session.id, fieldKey: f.key, remember: rememberThis });
      fields = fields.map((x) => (x.key === f.key ? res.data.field : x));
      patchResult(session.id, { fields, flagged: res.data.flagged });
    }
    await handleAccept(session, practitionerId);
  });

  // Missing in EIMS, decided right here (anyone who can see Compliance
  // Analysis can do this today): record the decision, then approve.
  const approveMissing = () => run(async () => {
    if (result.eimsMissingStatus !== 'approved') {
      await api.post('/api/billing/action-required/decide', { assessmentId: session.id, decision: 'approved', comment: '' });
      patchResult(session.id, { eimsMissingStatus: 'approved' });
    }
    await handleAccept(session, practitionerId);
  });

  const sendToAdmin = () => run(async () => {
    await api.post('/api/billing/compliance-analysis/send-missing-to-admin', { assessmentId: session.id });
    patchResult(session.id, { eimsMissingStatus: 'sent_to_admin' });
  });

  const submitNote = () => {
    const text = noteText.trim();
    if (!text || !note) return;
    const type = note;
    run(async () => {
      if (type === 'hold') await handleHold(session, practitionerId, text);
      else await handleInlineReturnReject(session, practitionerId, type, text);
    });
  };

  const undo = async () => {
    if (busy || !session) return;
    setBusy(true);
    try {
      if (outcome === 'approved') await handleResetToPending(session, practitionerId);
      else if (outcome === 'held') await handleReleaseHold(session, practitionerId);
    } catch (error) {
      showAlert(error.response?.data?.error || 'Couldn\'t undo that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Opening Return / Hold / Reject fills in a note written from the flag.
  // Switching between them swaps the suggestion only if the biller hasn't
  // changed it; their own words are never overwritten.
  const openNote = (type) => {
    if (!session) return;
    const next = suggestNote(type, session, result);
    setNoteText((current) => (!current.trim() || current === suggested ? next : current));
    setSuggested(next);
    setNote(type);
  };
  const clearNote = () => {
    setNoteText('');
    noteRef.current?.focus();
  };

  const isMissing = flag?.kind === 'missing';
  const isDuplicate = flag?.kind === 'duplicate';
  const canSendToAdmin = isMissing && result?.eimsMissingStatus !== 'sent_to_admin';
  const approve = isMissing ? approveMissing : approveMismatch;
  const showRemember = flag?.kind === 'mismatch' && (result?.fields || []).some((f) => f.match === false && f._learn && hasWordOverlap(f.ours, f.state));

  // Keyboard: A approve, S send to admin, R return, H hold, arrows move.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Escape' && note) setNote(null);
        return;
      }
      if (!flag || busy) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowright') { e.preventDefault(); goTo(currentIndex + 1); return; }
      if (k === 'arrowleft') { e.preventDefault(); goTo(currentIndex - 1); return; }
      if (outcome) return;
      if (k === 'a' && !isDuplicate) approve();
      else if (k === 's' && canSendToAdmin) sendToAdmin();
      else if (k === 'r') { e.preventDefault(); openNote('return'); }
      else if (k === 'h') { e.preventDefault(); openNote('hold'); }
      else if (k === 'escape') setNote(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (isLoading) return <div className="py-16 text-center text-[15px] text-slate-500">Loading the EIMS comparison…</div>;
  if (loadError) return <div className="py-16 text-center text-[15px] font-semibold text-red-600">{loadError}</div>;
  if (!analysis?.documentOnFile) {
    return <div className="py-16 text-center text-[15px] text-slate-600">No confirmed EIMS records for this period yet, so there is nothing to compare against.</div>;
  }
  if (sessions.length === 0 || builtFor !== analysis) return <div className="py-16 text-center text-[15px] text-slate-500">Loading sessions…</div>;

  if (flagList.length === 0 || (allHandled && !reviewingAgain)) {
    const counts = flagList.reduce((acc, f) => { const o = outcomeOf(f) || 'approved'; acc[o] = (acc[o] || 0) + 1; return acc; }, {});
    return (
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <div className="flex size-[76px] items-center justify-center rounded-[22px] bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-10" />
        </div>
        <h2 className="text-[26px] font-extrabold tracking-tight text-slate-900">
          {flagList.length === 0 ? 'Nothing flagged' : `All ${flagList.length} flag${flagList.length === 1 ? '' : 's'} handled`}
        </h2>
        {flagList.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {Object.entries(counts).map(([o, n]) => (
              <span key={o} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-bold ${OUTCOMES[o].classes}`}>{n} {OUTCOMES[o].label.toLowerCase()}</span>
            ))}
          </div>
        )}
        <p className="max-w-[46ch] text-[14px] text-slate-600">
          {readyToComplete
            ? `The SEVF and invoice for ${firstName} are generated. Download them below, or send this batch to completed bills.`
            : canGenerate
              ? `Every session for ${firstName} in this period has a decision. You can generate the SEVF and invoice now.`
              : `Some of ${firstName}'s other sessions still need a decision before you can generate. Check the queue on the left.`}
        </p>
        {(sevfDocuments?.length > 0 || invoiceDocuments?.length > 0) && (
          <div className="flex flex-wrap justify-center gap-2">
            {sevfDocuments?.map((doc) => (
              <a
                key={`sevf-${doc.month}`}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-[14px] font-semibold hover:bg-blue-100 transition-colors cursor-pointer"
              >
                <Download className="size-3.5" /> SEVF · {formatMonthLabel(doc.month)}
              </a>
            ))}
            {invoiceDocuments?.map((doc) => (
              <a
                key={`inv-${doc.month}`}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-[14px] font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
              >
                <Download className="size-3.5" /> Invoice · {formatMonthLabel(doc.month)}
              </a>
            ))}
          </div>
        )}
        {readyToComplete ? (
          <Button
            onClick={onSendToCompleted}
            disabled={isSendingToCompleted}
            className="mt-1 h-auto rounded-2xl bg-emerald-600 px-7 py-4 text-[15px] font-extrabold text-white hover:bg-emerald-700 cursor-pointer"
          >
            <CheckCircle2 className="size-4" /> {isSendingToCompleted ? 'Sending...' : 'Send to Completed'}
          </Button>
        ) : (
          <Button
            onClick={onGenerate}
            disabled={!canGenerate || isGenerating}
            className="mt-1 h-auto rounded-2xl bg-slate-900 px-7 py-4 text-[15px] font-extrabold text-white hover:bg-slate-800 cursor-pointer"
          >
            {isGenerating ? 'Generating...' : `Generate & Issue for ${firstName}`}
          </Button>
        )}
        {flagList.length > 0 && !readyToComplete && (
          <button type="button" onClick={() => { setReviewingAgain(true); goTo(0); }} className="text-[13.5px] font-bold text-blue-600 hover:underline cursor-pointer">
            Review the flags again
          </button>
        )}
      </div>
    );
  }

  if (!flag || !session) return <div className="py-16 text-center text-[15px] text-slate-500">Loading…</div>;

  const problem = describeFlag(result);
  const fields = (result?.fields || []).filter((f) => !onlyDifferent || f.match === false);
  const hasSameFields = (result?.fields || []).some((f) => f.match !== false);
  const showValue = (f, v) => (TIME_KEYS.includes(f.key) && v ? formatTime12h(v) : v) || '-';

  return (
    <div key={flag.id} className="animate-in fade-in slide-in-from-right-2 duration-200">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="text-[12px] font-extrabold uppercase tracking-wider text-red-700">
          Flag {currentIndex + 1} of {flagList.length} · {handledCount} handled
        </span>
        <div className="flex min-w-[120px] flex-1 gap-1.5" aria-hidden="true">
          {flagList.map((f, i) => (
            <span key={f.id} className={`h-1.5 flex-1 rounded-full ${isHandled(f) ? 'bg-emerald-500' : i === currentIndex ? 'bg-red-500' : 'bg-slate-200'}`} />
          ))}
        </div>
        <div className="flex gap-1.5">
          <button type="button" aria-label="Previous flag" onClick={() => goTo(currentIndex - 1)} className="flex size-10 items-center justify-center rounded-[10px] border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"><ChevronLeft className="size-5" /></button>
          <button type="button" aria-label="Next flag" onClick={() => goTo(currentIndex + 1)} className="flex size-10 items-center justify-center rounded-[10px] border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"><ChevronRight className="size-5" /></button>
        </div>
      </div>

      <h2 className="mt-4 text-[24px] font-extrabold leading-tight tracking-tight text-slate-900 capitalize">{session.patient_first_name} {session.patient_last_name}</h2>
      <p className="text-[15px] font-semibold text-slate-500">
        {longDate(session.service_date)}
        {session.start_time && session.end_time && <> · {formatTime12h(session.start_time)} – {formatTime12h(session.end_time)}</>}
        {' · '}<span className="font-mono">S:{session.status || '-'} {session.type || '-'} L:{session.location || '-'}</span>
      </p>

      <div className={`mt-4 flex items-start gap-3 rounded-2xl border-2 px-4 py-3.5 ${isMissing ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
        <AlertCircle className="mt-0.5 size-5 flex-shrink-0" />
        <div>
          <div className="text-[15px] font-extrabold">{problem.title}</div>
          <div className="text-[13.5px] font-medium text-slate-700">{problem.detail}</div>
        </div>
      </div>

      {fields.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full table-fixed text-[14px]">
            <thead>
              <tr className="bg-slate-50 text-[12.5px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="w-[32%] px-4 py-2.5 text-left">Field</th>
                <th className="px-4 py-2.5 text-left">Our log</th>
                <th className="px-4 py-2.5 text-left">EIMS record</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const off = f.match === false;
                return (
                  <tr key={f.key} className={`border-t border-slate-100 ${off ? 'bg-red-50/70' : ''}`}>
                    <td className={`px-4 py-2.5 text-[13px] font-bold ${off ? 'text-red-700' : 'text-slate-500'}`}>{f.label}</td>
                    <td className={`px-4 py-2.5 break-words font-mono ${off ? 'text-[15px] font-extrabold text-slate-900' : 'font-medium text-slate-400'}`}>{showValue(f, f.ours)}</td>
                    <td className={`px-4 py-2.5 break-words font-mono ${off ? 'text-[15px] font-extrabold text-red-700' : 'font-medium text-slate-400'}`}>{showValue(f, f.state)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasSameFields && (result?.fields || []).some((f) => f.match === false) && (
        <button type="button" onClick={() => setOnlyDifferent((v) => !v)} className="mt-2 text-[13px] font-bold text-blue-600 hover:underline cursor-pointer">
          {onlyDifferent ? 'Show all fields' : 'Show only what\'s different'}
        </button>
      )}

      {outcome ? (
        <div className={`mt-5 flex flex-wrap items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-[15px] font-extrabold ${OUTCOMES[outcome].classes}`}>
          <CheckCircle2 className="size-5" /> {OUTCOMES[outcome].label}
          {(outcome === 'approved' || outcome === 'held') && (
            <button type="button" onClick={undo} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 text-[13.5px] font-bold underline cursor-pointer disabled:opacity-50">
              <Undo2 className="size-4" /> Undo
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            <ActionTile
              label={isMissing ? 'Approve' : 'Approve anyway'}
              hint={isDuplicate ? 'Duplicates can\'t be approved' : isMissing ? 'Bill it without an EIMS record' : 'Bill it as logged'}
              shortcut="A" tone="green" onClick={approve} disabled={busy || isDuplicate}
            />
            <ActionTile label="Return" hint="Practitioner fixes and resubmits" shortcut="R" tone="blue" active={note === 'return'} onClick={() => openNote('return')} disabled={busy} />
            <ActionTile label="Hold" hint="Park it, not billed yet" shortcut="H" tone="orange" active={note === 'hold'} onClick={() => openNote('hold')} disabled={busy} />
            <ActionTile label="Reject" hint="Never billed" tone="red" active={note === 'reject'} onClick={() => openNote('reject')} disabled={busy} />
          </div>

          {showRemember && (
            <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-[18px] accent-emerald-600" />
              Also remember this match for future logs (until removed in Compliance Matching)
            </label>
          )}
          {canSendToAdmin && (
            <button type="button" onClick={sendToAdmin} disabled={busy} className="mt-3 text-[13.5px] font-bold text-blue-600 hover:underline cursor-pointer disabled:opacity-50">
              Not sure? Send it to an admin to decide (S)
            </button>
          )}

          {note && (
            <div className="mt-4 rounded-2xl border-2 border-slate-300 bg-slate-50 p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor="fix-flag-note" className="text-[14px] font-extrabold text-slate-900">{NOTE_PROMPTS[note]}</label>
                {noteText && (
                  <button type="button" onClick={clearNote} className="text-[13px] font-bold text-slate-500 hover:text-slate-800 hover:underline cursor-pointer">Clear</button>
                )}
              </div>
              {noteText && noteText === suggested && (
                <p className="mb-2 text-[12.5px] font-semibold text-slate-500">Filled in from the flag. Edit it, add to it, or clear it.</p>
              )}
              <Textarea
                id="fix-flag-note"
                ref={noteRef}
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); }}
                placeholder="Required"
                rows={Math.min(8, Math.max(3, noteText.split(/\n/).length + 1))}
                className="min-h-[84px] bg-white text-[14px] leading-relaxed"
              />
              <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setNote(null)} className="cursor-pointer">Cancel</Button>
                <Button
                  type="button"
                  onClick={submitNote}
                  disabled={!noteText.trim() || busy}
                  className="bg-slate-900 font-extrabold text-white hover:bg-slate-800 cursor-pointer"
                >
                  {busy ? 'Saving...' : `Confirm ${note === 'return' ? 'Return' : note === 'hold' ? 'Hold' : 'Reject'} · next flag`}
                </Button>
              </div>
            </div>
          )}

          <p className="mt-4 text-[12px] font-semibold text-slate-400">
            Keys: A approve · R return · H hold{canSendToAdmin ? ' · S send to admin' : ''} · ← → move between flags
          </p>
        </>
      )}
      <p className="sr-only" aria-live="polite">{outcome ? `${session.patient_first_name}: ${OUTCOMES[outcome].label}` : ''}</p>
    </div>
  );
}
