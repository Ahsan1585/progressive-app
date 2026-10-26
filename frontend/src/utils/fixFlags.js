// Fix flags: the decisions behind the one-flag-at-a-time review in Billing
// Batch Review. Plain functions (no React) so they can be tested with
// `node --test src/utils/__tests__/`.

const ALREADY_BILLED = ['njeis_review', 'invoiced', 'completed'];

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
