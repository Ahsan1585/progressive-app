import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, CheckCircle2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CANVAS_HEIGHT = 200;

// Signature pad for the public, unauthenticated telepractice-signing page
// (TelepracticeSign.jsx) — a parent could be on any device (desktop
// trackpad, phone touchscreen), so this needs the same DPR-aware sizing and
// resize handling as mobile/src/components/SignatureCapture.tsx, which this
// ports the drawing model from. Not a reuse of the existing, simpler
// frontend/src/components/SignaturePad.jsx (mouse/touch-only, no DPR
// scaling, fixed canvas size) — that component is used inside the
// authenticated office app (LogInterventionModal.jsx) where the practitioner
// is always on a known desktop browser; a parent's device is unpredictable.
export function ParentSignaturePad({ value, onChange, error }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [justCaptured, setJustCaptured] = useState(false);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrapper.clientWidth;
    canvas.width = width * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, []);

  useEffect(() => {
    if (value) return; // canvas isn't mounted while showing a committed value
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, [setupCanvas, value]);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    const { x, y } = getPos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    drawingRef.current = true;
    hasStrokeRef.current = true;
    setHasStroke(true);
  };

  const onPointerMove = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { x, y } = getPos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
  };

  // Lifting a finger/mouse mid-signature is normal (crossing a "t", a
  // multi-stroke name) — must not finalize. Only Done commits it.
  const onPointerUp = () => {
    drawingRef.current = false;
  };

  const handleDone = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokeRef.current) return;
    onChange(canvas.toDataURL('image/png'));
    setJustCaptured(true);
    window.setTimeout(() => setJustCaptured(false), 260);
  };

  const handleClear = () => {
    hasStrokeRef.current = false;
    setHasStroke(false);
    onChange(null);
  };

  const showCaptured = !!value;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium leading-[18px] text-slate-700">Your signature</span>
        {showCaptured && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Captured
          </span>
        )}
      </div>

      {showCaptured ? (
        <div
          className={cn(
            'relative flex h-[200px] w-full items-center justify-center overflow-hidden rounded-lg border bg-white',
            justCaptured ? 'border-emerald-600 ring-1 ring-emerald-600' : 'border-slate-200'
          )}
        >
          <img src={value} alt="Your signature preview" className="max-h-[85%] max-w-[90%] object-contain" />
        </div>
      ) : (
        <div
          ref={wrapperRef}
          className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white"
          style={{ height: CANVAS_HEIGHT }}
        >
          <div className="pointer-events-none absolute inset-x-4 bottom-8 h-px bg-slate-200" aria-hidden="true" />
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Signature — draw with your finger, stylus, or mouse"
            className="h-full w-full cursor-crosshair"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {!hasStroke && (
            <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-slate-400">
              <PenLine className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
              Sign with your finger, stylus, or mouse
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Clear
        </Button>
        {!showCaptured && (
          <Button type="button" variant="secondary" size="sm" onClick={handleDone} disabled={!hasStroke}>
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Done
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
