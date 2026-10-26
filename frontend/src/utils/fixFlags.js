// Fix flags: the decisions behind the one-flag-at-a-time review in Billing
// Batch Review. Plain functions (no React) so they can be tested with
// `node --test src/utils/__tests__/`.

// Already billed, or held for the parent's re-signature: nothing for billing to decide.
const ALREADY_BILLED = ['njeis_review', 'invoiced', 'completed', 'awaiting_resign'];

// One Compliance Analysis result -> what kind of problem it is, if any.
// Duplicate is checked first: a duplicate can show a clean match on its own
// (see ComplianceAnalysisPreview's isSessionDuplicate).
export function flagKind(result) {
  if (!result) return null;
  if (result.duplicateOfSessionId) return 'duplicate';
  if (!result.matched) return 'missing';
  if (result.flagged) return 'mismatch';
  return null;
}

// Flagged sessions in queue order; already-billed sessions have nothing left to decide.
export function buildFlagList(sessions, results) {
  return sessions
    .filter((s) => !ALREADY_BILLED.includes(s.billing_status))
    .map((s) => ({ id: s.id, kind: flagKind(results?.[s.id]) }))
    .filter((f) => f.kind);
}

// What has been decided for a flagged session, read from its real status so
// it survives a refresh: 'approved' | 'returned' | 'rejected' | 'held' | 'with_admin' | null.
export function flagOutcome(session, result, logActions = {}) {
  if (session.billing_status === 'rejected') return 'returned';
  if (session.billing_status === 'declined') return 'rejected';
  if (session.billing_status === 'on_hold') return 'held';
  const approved = logActions[session.id] === 'accept' || session.billing_review === 'accept';
  // A duplicate can carry a stale Approved from before it was known to be one.
  if (approved && !result?.duplicateOfSessionId) return 'approved';
  if (result?.eimsMissingStatus === 'sent_to_admin') return 'with_admin';
  return null;
}

// Next flag after `from` (wrapping) that isn't handled yet, or -1.
export function nextOpenIndex(list, from, isHandled) {
  for (let step = 1; step <= list.length; step += 1) {
    const i = (from + step) % list.length;
    if (!isHandled(list[i])) return i;
  }
  return -1;
}

// The problem in plain words, for the top of the fix view.
export function describeFlag(result) {
  const kind = flagKind(result);
  if (kind === 'duplicate') {
    return {
      title: 'Duplicate log',
      detail: result.duplicateOfInvoiced
        ? 'This session was already invoiced under another log. This one will not be paid. Return or reject it.'
        : 'Another log for this child, date and time matches the same EIMS record. Only one can be billed. Return or reject this one.',
    };
  }
  if (kind === 'missing') {
    return {
      title: 'Missing in EIMS',
      detail: result.missingReason || 'No EIMS record was found for this session. Check that it was entered in EIMS, or send it to an admin to decide.',
    };
  }
  const off = (result?.fields || []).filter((f) => f.match === false);
  if (off.length === 1) {
    return {
      title: `${off[0].label} doesn't match EIMS`,
      detail: `Your log says ${off[0].ours || '-'}. The EIMS record says ${off[0].state || '-'}.`,
    };
  }
  const labels = off.map((f) => f.label);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0] || 'Some fields';
  return { title: `${off.length} fields don't match EIMS`, detail: `${list} differ from the EIMS record.` };
}

// The queue's per-row tag, from the flags saved by the last Compliance
// Analysis run (eims_last_flagged / eims_last_missing): 'mismatch' | 'missing' | null.
export function isFlaggedInQueue(session, logActions = {}) {
  if (session.billing_status !== 'pending') return null;
  if (logActions[session.id] === 'accept' || session.billing_review === 'accept') return null;
  if (session.eims_last_missing) return 'missing';
  if (session.eims_last_flagged) return 'mismatch';
  return null;
}

// Mirrors complianceLearningController.js's hasWordOverlap — even when the
// reviewer ticks "remember this match", the server refuses to persist a
// reusable rule unless the two values share at least one word (a plausible
// labeling variant, not a genuinely different value like "Developmental
// Intervention" vs "Speech Therapy"). Used here to decide whether to even
// offer the "remember" checkbox, without a round-trip to ask the server.
export function hasWordOverlap(a, b) {
  const norm = (s) => (s || '').toString().toLowerCase().replace(/[,.()\-–—'"]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokensA = new Set(norm(a).split(' ').filter(Boolean));
  const tokensB = new Set(norm(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  for (const t of tokensA) if (tokensB.has(t)) return true;
  return false;
}

// --- Suggested note for Return / Hold / Reject, written from the flag so the
// biller only has to check it (they can edit or clear it). Return is
// addressed to the practitioner; Hold and Reject read as a record of why.
const pad2 = (n) => String(n).padStart(2, '0');
const time12 = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return t || '-';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${pad2(Number(m[2]))} ${h >= 12 ? 'PM' : 'AM'}`;
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const TIME_FIELD_KEYS = ['start_time', 'end_time'];

export function suggestNote(type, session, result) {
  const kind = flagKind(result);
  if (!kind) return '';
  const child = `${cap(session.patient_first_name)} ${cap(session.patient_last_name)}`.trim();
  const [y, mo, d] = (session.service_date || '').split('-').map(Number);
  const day = y ? new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'this date';
  const at = session.start_time ? ` at ${time12(session.start_time)}` : '';
  const when = `${child} on ${day}${at}`;

  if (kind === 'duplicate') {
    const why = result.duplicateOfInvoiced
      ? `This session (${when}) was already invoiced under another log, so this one will not be paid.`
      : `Another log for ${when} matches the same EIMS record, so only one can be billed.`;
    if (type === 'return') return `This log is a duplicate. ${why} Please delete this log, or correct it if it was a different session.`;
    if (type === 'hold') return `On hold: duplicate log. ${why}`;
    return `Rejected: duplicate log. ${why}`;
  }

  if (kind === 'missing') {
    if (type === 'return') return `No EIMS record was found for ${when}. Please check that this session was entered in EIMS, or correct the date and time if they're wrong, then resubmit.`;
    if (type === 'hold') return `On hold: no EIMS record found for ${when}. Waiting for it to be entered in EIMS.`;
    return `Rejected: no EIMS record exists for ${when}.`;
  }

  const show = (f, v) => (TIME_FIELD_KEYS.includes(f.key) ? time12(v) : v || '-');
  const lines = (result.fields || []).filter((f) => f.match === false)
    .map((f) => `- ${f.label}: your log says ${show(f, f.ours)}, EIMS says ${show(f, f.state)}`).join('\n');
  if (type === 'return') return `This log doesn't match the EIMS record for ${child} on ${day}:\n${lines}\nPlease correct the log and resubmit.`;
  if (type === 'hold') return `On hold: doesn't match the EIMS record for ${child} on ${day}.\n${lines}\nWaiting to confirm which is correct.`;
  return `Rejected: doesn't match the EIMS record for ${child} on ${day}.\n${lines}`;
}
