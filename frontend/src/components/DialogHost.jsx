import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { registerDialogListener } from '@/utils/dialogStore';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

// One consistent look for a "what happened, broken down by outcome"
// section — every multi-result dialog in the app (bulk runs, batch
// operations, etc.) renders through this instead of a hand-formatted text
// blob, so they all read the same way.
const SECTION_TONES = {
  success: { icon: CheckCircle2, iconClass: 'text-emerald-600', barClass: 'bg-emerald-500', headingClass: 'text-emerald-900', bgClass: 'bg-emerald-50/60' },
  warning: { icon: AlertTriangle, iconClass: 'text-amber-600', barClass: 'bg-amber-500', headingClass: 'text-amber-900', bgClass: 'bg-amber-50/60' },
  danger: { icon: XCircle, iconClass: 'text-red-600', barClass: 'bg-red-500', headingClass: 'text-red-900', bgClass: 'bg-red-50/60' },
  neutral: { icon: Info, iconClass: 'text-slate-500', barClass: 'bg-slate-300', headingClass: 'text-slate-700', bgClass: 'bg-slate-50' },
};

const ResultSection = ({ tone = 'neutral', heading, description, items }) => {
  const { icon: Icon, iconClass, barClass, headingClass, bgClass } = SECTION_TONES[tone] || SECTION_TONES.neutral;
  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 ${bgClass}`}>
      <div className={`absolute inset-y-0 left-0 w-1 ${barClass}`} />
      <div className="px-4 py-3 pl-5">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 shrink-0 ${iconClass}`} />
          <span className={`text-sm font-bold ${headingClass}`}>{heading}</span>
        </div>
        {description && <p className="mt-1 text-xs text-slate-600">{description}</p>}
        {items?.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {items.map((item, i) => (
              <li key={i} className="text-sm text-slate-700 leading-snug">
                <span className="font-semibold text-slate-800">{item.primary}</span>
                {item.secondary && <span className="text-slate-500"> — {item.secondary}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

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

  const hasSections = request?.sections?.length > 0;

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) resolve(false); }}>
      <DialogContent
        className={`bg-white ${hasSections ? 'sm:max-w-lg max-h-[85vh] overflow-y-auto' : 'sm:max-w-sm'}`}
        showCloseButton={false}
      >
        {request?.title && (
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
          </DialogHeader>
        )}
        {hasSections ? (
          <div className="-mt-1 space-y-2.5">
            {request.sections.map((section, i) => <ResultSection key={i} {...section} />)}
          </div>
        ) : (
          <DialogDescription className="text-sm text-slate-600 -mt-2 whitespace-pre-line">
            {request?.message}
          </DialogDescription>
        )}
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
