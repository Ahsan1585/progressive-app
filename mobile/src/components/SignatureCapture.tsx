import * as React from "react";
import { CheckCircle2, RotateCcw, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SignatureCaptureProps {
  /** Visible label above the whole control. */
  label: string;
  /** Accessible name/instruction for the canvas itself (a11y notes). */
  instructions: string;
  value: string | null;
  onChange: (base64: string | null) => void;
  /** Practitioner slot only — offers reuse of a previously saved default. */
  savedSignature?: string | null;
  isUsingSaved?: boolean;
  onUseSaved?: () => void;
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (checked: boolean) => void;
  error?: string | null;
}

// Touch-optimized signature canvas — ~200px tall, full width, touch-action:
// none (no scroll-while-signing), explicit "captured" confirmation state
// (never silent), Clear control outside the drawing surface's hit area.
// Art-direction §7.1 + design's Signature Capture a11y notes.
export function SignatureCapture({
  label,
  instructions,
  value,
  onChange,
  savedSignature,
  isUsingSaved,
  onUseSaved,
  showSaveAsDefault,
  saveAsDefault,
  onSaveAsDefaultChange,
  error,
}: SignatureCaptureProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const drawingRef = React.useRef(false);
  const hasStrokeRef = React.useRef(false);
  const [justCaptured, setJustCaptured] = React.useState(false);

  const CANVAS_HEIGHT = 200;

  const setupCanvas = React.useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrapper.clientWidth;
    canvas.width = width * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const inkVar = getComputedStyle(document.documentElement).getPropertyValue("--signature-ink").trim();
      ctx.strokeStyle = inkVar || "#0a0a0a";
    }
  }, []);

  React.useEffect(() => {
    setupCanvas();
    window.addEventListener("resize", setupCanvas);
    return () => window.removeEventListener("resize", setupCanvas);
  }, [setupCanvas]);

  // Redrawing the canvas is skipped when showing a committed value/preview —
  // the <canvas> is only mounted while actively drawing (empty state).

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext("2d");
    const { x, y } = getPos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    drawingRef.current = true;
    hasStrokeRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const { x, y } = getPos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
  };

  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasStrokeRef.current) {
      onChange(canvas.toDataURL("image/png"));
      setJustCaptured(true);
      window.setTimeout(() => setJustCaptured(false), 260);
    }
  };

  const handleClear = () => {
    hasStrokeRef.current = false;
    onChange(null);
    setupCanvas();
  };

  const showCaptured = !!value;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium leading-[18px] text-ink-body">{label}</span>
        {showCaptured && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold text-success",
              justCaptured && "signature-captured-badge"
            )}
          >
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Captured
          </span>
        )}
      </div>

      {!showCaptured && savedSignature && onUseSaved && (
        <Button type="button" variant="subtle" className="mb-2 w-full" onClick={onUseSaved}>
          Use my saved signature
        </Button>
      )}

      {showCaptured ? (
        <div
          className={cn(
            "relative flex h-[200px] w-full items-center justify-center overflow-hidden rounded-control border bg-white",
            justCaptured ? "border-success ring-1 ring-success" : "border-border"
          )}
        >
          {/* Signature stays a white "paper" surface in both light and dark modes — a legal artifact, not a themed component. */}
          <img src={value ?? undefined} alt={`${label} preview`} className="max-h-[85%] max-w-[90%] object-contain" />
        </div>
      ) : (
        <div
          ref={wrapperRef}
          className="relative w-full overflow-hidden rounded-control border border-border bg-white"
          style={{ height: CANVAS_HEIGHT }}
        >
          {/* Faint baseline guide */}
          <div className="pointer-events-none absolute inset-x-4 bottom-8 h-px bg-slate-200" aria-hidden="true" />
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={instructions}
            className="h-full w-full cursor-crosshair"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {!hasStrokeRef.current && (
            <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-ink-faint">
              <PenLine className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
              Sign with your finger or stylus
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {isUsingSaved ? "Draw a new signature" : "Clear"}
        </Button>

        {showSaveAsDefault && !isUsingSaved && showCaptured && onSaveAsDefaultChange && (
          <label className="flex items-center gap-2 text-sm text-ink-body">
            <input
              type="checkbox"
              checked={!!saveAsDefault}
              onChange={(e) => onSaveAsDefaultChange(e.target.checked)}
              className="size-4 accent-primary"
            />
            Save as new default
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
