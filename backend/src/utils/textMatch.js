// Shared normalization for comparing free-text values (labels, headers,
// names) coming from a state Excel export against our own stored values,
// where the underlying words are the same but formatting isn't guaranteed
// to be identical (case, extra whitespace, punctuation, dash variants).

function normalizeForMatch(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(/[,.()\-–—'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Order-independent comparison for person names — handles "Last, First" vs
// "First Last" formatting differences in addition to case/punctuation/
// whitespace, since both sides normalize to the same sorted token set.
function namesMatch(a, b) {
  if (!a || !b) return null;
  const tokensA = normalizeForMatch(a).split(' ').filter(Boolean).sort();
  const tokensB = normalizeForMatch(b).split(' ').filter(Boolean).sort();
  if (tokensA.length === 0 || tokensB.length === 0) return null;
  if (tokensA.length !== tokensB.length) return false;
  return tokensA.every((t, i) => t === tokensB[i]);
}

module.exports = { normalizeForMatch, namesMatch };
