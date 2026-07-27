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

export function showAlert(message, opts = {}) {
  return new Promise((resolve) => {
    if (!listener) { window.alert(message); resolve(); return; }
    listener({ type: 'alert', message, title: opts.title, confirmLabel: opts.confirmLabel, onResolve: () => resolve() });
  });
}

export function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    if (!listener) { resolve(window.confirm(message)); return; }
    listener({
      type: 'confirm',
      message,
      title: opts.title,
      danger: opts.danger,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      onResolve: (result) => resolve(result),
    });
  });
}
