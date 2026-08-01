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
//
// Scored as true Jaccard similarity (intersection / union of the two token
// sets), NOT intersection / max(lenA, lenB) — dividing by max() alone
// overstates similarity whenever BOTH sides have their own non-overlapping
// word(s): e.g. "James Cole" vs "James Miller" (two different children who
// only share a first name) scores 1/2 = 0.5 against max() — a false match
// at Lenient — but only 1/3 = 0.33 against the true union, correctly
// failing at every strictness level. A person's name is close enough to an
// identity check that this field should err toward under-matching, not
// over-matching.
function scoredNamesMatch(a, b, threshold = 1) {
  if (!a || !b) return null;
  const tokensA = normalizeForMatch(a).split(' ').filter(Boolean);
  const tokensB = normalizeForMatch(b).split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return null;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersectionCount = [...setA].filter((t) => setB.has(t)).length;
  const unionCount = new Set([...setA, ...setB]).size;
  const score = intersectionCount / unionCount;
  return score >= threshold;
}

module.exports = { normalizeForMatch, namesMatch, scoredNamesMatch };
