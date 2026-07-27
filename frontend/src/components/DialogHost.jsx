import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { registerDialogListener } from '@/utils/dialogStore';

// Mounted once at the app root (App.jsx) — renders whatever showAlert()/
// showConfirm() (utils/dialogStore.js) most recently requested, as a
// centered Dialog instead of a native top-of-viewport browser popup.
export const DialogHost = () => {
  const [request, setRequest] = useState(null);

  useEffect(() => registerDialogListener(setRequest), []);

  const resolve = (result) => {
    request?.onResolve(result);
    setRequest(null);
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) resolve(request?.type === 'confirm' ? false : undefined); }}>
      <DialogContent className="sm:max-w-sm bg-white" showCloseButton={false}>
        {request?.title && (
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
          </DialogHeader>
        )}
        <DialogDescription className="text-sm text-slate-600 -mt-2 whitespace-pre-line">
          {request?.message}
        </DialogDescription>
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
