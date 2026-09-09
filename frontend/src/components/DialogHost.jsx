import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { registerDialogListener } from '@/utils/dialogStore';

// Mounted once at the app root (App.jsx) — renders whatever showAlert()/
// showConfirm() (utils/dialogStore.js) most recently requested, as a
// centered Dialog instead of a native top-of-viewport browser popup.
export const DialogHost = () => {
  const [request, setRequest] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => registerDialogListener(setRequest), []);

  // Reset the checkbox to its default whenever a new request comes in.
  useEffect(() => {
    setChecked(request?.checkbox ? !!request.checkbox.defaultChecked : false);
  }, [request]);

  // A confirm with a checkbox resolves to { confirmed, checked }; every
  // other dialog keeps its original bare-value contract.
  const resolve = (confirmed) => {
    const isConfirm = request?.type === 'confirm';
    const result = request?.checkbox
      ? { confirmed: !!confirmed, checked }
      : (isConfirm ? !!confirmed : undefined);
    request?.onResolve(result);
    setRequest(null);
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) resolve(false); }}>
      <DialogContent className="sm:max-w-sm bg-white" showCloseButton={false}>
        {request?.title && (
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
          </DialogHeader>
        )}
        <DialogDescription className="text-sm text-slate-600 -mt-2 whitespace-pre-line">
          {request?.message}
        </DialogDescription>
        {request?.checkbox && (
          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 size-4 cursor-pointer accent-slate-800"
            />
            <span>{request.checkbox.label}</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          {request?.type === 'confirm' && (
            <Button type="button" variant="outline" onClick={() => resolve(false)} className="cursor-pointer">
              {request.cancelLabel || 'Cancel'}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => resolve(request?.type === 'confirm' ? true : undefined)}
            className={`cursor-pointer text-white ${request?.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'}`}
          >
            {request?.confirmLabel || (request?.type === 'confirm' ? 'Confirm' : 'OK')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
