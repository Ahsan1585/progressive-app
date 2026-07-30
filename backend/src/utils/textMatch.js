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

// Threshold-scored variant of namesMatch — tolerates some of the words
// differing (or one side having an extra/missing word, e.g. a middle name)
// instead of requiring an identical token set. At threshold 1 this reduces
// to namesMatch's exact behavior (same word count, every word present).
// Scored against the LONGER token list so a length mismatch alone can't
// inflate the score past what it should be.
function scoredNamesMatch(a, b, threshold = 1) {
  if (!a || !b) return null;
  const tokensA = normalizeForMatch(a).split(' ').filter(Boolean);
  const tokensB = normalizeForMatch(b).split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return null;
  const setB = new Set(tokensB);
  const matchingCount = tokensA.filter((t) => setB.has(t)).length;
  const score = matchingCount / Math.max(tokensA.length, tokensB.length);
  return score >= threshold;
}

module.exports = { normalizeForMatch, namesMatch, scoredNamesMatch };
