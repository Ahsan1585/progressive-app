// Layout rules for the Overview dashboard's reorderable cards.
//
// DASHBOARD_CARD_KEYS must exactly match backend/src/controllers/
// dashboardController.js: the backend validates PUT /api/dashboard/layout
// against the same fixed set.
export const DASHBOARD_CARD_KEYS = [
  'billing_pipeline', 'action_queue', 'services_breakdown', 'documents_feed',
  'accuracy_table', 'eims_status', 'returned_logs', 'trajectory_chart', 'county_hours',
];

// The default is designed, not stacked: cards whose content is a short list or
// a small graphic sit in pairs, and the two that need width (a wide table and a
// chart) take the full row. Pairs are chosen so each row's cards share the same
// structure (heading above the card, or title inside it) and line up:
//   row 1  billing pipeline   | EIMS match status      (heading above the card)
//   row 2  what needs you     | returned logs          (lists needing attention)
//   row 3  services provided  | invoices & SEVF forms  (title inside the card)
//   row 4  practitioner accuracy (full: wide table)
//   row 5  trajectory chart      (full: wide chart)
export const DEFAULT_CARD_LAYOUT = [
  { key: 'billing_pipeline', width: 'half' },
  { key: 'eims_status', width: 'half' },
  { key: 'action_queue', width: 'half' },
  { key: 'returned_logs', width: 'half' },
  { key: 'services_breakdown', width: 'half' },
  { key: 'documents_feed', width: 'half' },
  { key: 'accuracy_table', width: 'full' },
  { key: 'trajectory_chart', width: 'full' },
  { key: 'county_hours', width: 'full' },
];

// A layout saved under an earlier card set (or a future one this build does not
// know about) must never be trusted blindly: rendering it would silently drop
// every card whose key is not known. Valid only when it is exactly a
// permutation of today's keys, each with a known width.
export function isValidCardLayout(cardLayout) {
  return Array.isArray(cardLayout)
    && cardLayout.length === DASHBOARD_CARD_KEYS.length
    && new Set(cardLayout.map((c) => c?.key)).size === DASHBOARD_CARD_KEYS.length
    && cardLayout.every((c) => DASHBOARD_CARD_KEYS.includes(c?.key) && (c.width === 'full' || c.width === 'half'));
}

// The old built-in default: every card full width, in key order. A saved layout
// that is exactly this was never a deliberate choice (it is what the dashboard
// itself produced), so it gives way to the new default instead of pinning the
// old stacked look forever. Any other saved layout is the user's own.
export function isUntouchedLegacyLayout(cardLayout) {
  return Array.isArray(cardLayout)
    && cardLayout.length === DASHBOARD_CARD_KEYS.length
    && cardLayout.every((c, i) => c?.key === DASHBOARD_CARD_KEYS[i] && c.width === 'full');
}

// What to render, given whatever the server had saved (or nothing).
export function resolveCardLayout(saved) {
  if (!isValidCardLayout(saved) || isUntouchedLegacyLayout(saved)) return DEFAULT_CARD_LAYOUT;
  return saved;
}

// Moves one card next to another, returning a NEW layout (the input is never
// changed). pos is 'before' or 'after' the target. With sideBySide, a full-width
// card dropped beside a half-width one becomes half width too, so it can actually
// sit next to it. Unknown keys, or dropping a card on itself, return the layout
// unchanged. Never loses or duplicates a card.
export function moveCard(layout, draggedKey, targetKey, pos, { sideBySide = false } = {}) {
  if (draggedKey === targetKey) return layout;
  const dragged = layout.find((c) => c.key === draggedKey);
  if (!dragged || !layout.some((c) => c.key === targetKey)) return layout;
  const rest = layout.filter((c) => c.key !== draggedKey);
  const idx = rest.findIndex((c) => c.key === targetKey);
  rest.splice(pos === 'after' ? idx + 1 : idx, 0, sideBySide ? { ...dragged, width: 'half' } : dragged);
  return rest;
}

// Moves one card to the very end (dropping on the empty zone below the cards).
export function moveCardToEnd(layout, draggedKey) {
  const dragged = layout.find((c) => c.key === draggedKey);
  if (!dragged || layout[layout.length - 1].key === draggedKey) return layout;
  return [...layout.filter((c) => c.key !== draggedKey), dragged];
}
