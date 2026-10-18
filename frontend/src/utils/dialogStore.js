// Promise-based replacement for window.alert()/window.confirm() — native
// browser dialogs render pinned to the top of the viewport with no way to
// reposition them via CSS/JS, which looks jarring against an otherwise
// centered app UI. showAlert()/showConfirm() render through DialogHost
// (mounted once at the app root in App.jsx) as a centered Dialog instead,
// with the same call-site shape as the native versions (await the result).
//
// Single-listener pub/sub: DialogHost is the only consumer, registered once
// on mount. If it's somehow unmounted, callers fall back to the native
// dialog rather than hanging forever on an unresolved promise.
let listener = null;

export function registerDialogListener(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

// opts.sections, when given, renders a structured, consistently-styled
// result list instead of a plain text blob — each section is
// { tone: 'success'|'warning'|'danger'|'neutral', heading, description?,
// items: [{ primary, secondary? }] }. Used for any "here's what happened,
// broken down by outcome" result (e.g. a bulk operation's per-item
// results) so every such dialog across the app looks and reads the same
// way, instead of each call site hand-formatting its own text dump.
export function showAlert(message, opts = {}) {
  return new Promise((resolve) => {
    if (!listener) { window.alert(message); resolve(); return; }
    listener({
      type: 'alert', message, title: opts.title, confirmLabel: opts.confirmLabel,
      sections: opts.sections, onResolve: () => resolve(),
    });
  });
}

// showConfirm(message) resolves to a bare boolean, as before.
// showConfirm(message, { checkbox: { label, defaultChecked } }) instead
// resolves to { confirmed, checked } — the extra opt-in used by the
// compliance "Allow" flow to let the reviewer also teach a reusable match.
export function showConfirm(message, opts = {}) {
  const hasCheckbox = !!opts.checkbox;
  return new Promise((resolve) => {
    if (!listener) {
      const confirmed = window.confirm(message);
      resolve(hasCheckbox ? { confirmed, checked: false } : confirmed);
      return;
    }
    listener({
      type: 'confirm',
      message,
      title: opts.title,
      danger: opts.danger,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      checkbox: opts.checkbox || null,
      onResolve: (result) => resolve(result),
    });
  });
}
