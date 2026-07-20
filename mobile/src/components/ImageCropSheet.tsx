import * as React from "react";

interface ImageCropSheetProps {
  file: File;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

const VIEWPORT = 300; // css px, square crop viewport
const OUTPUT = 480; // exported image resolution
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

interface LoadedImage {
  src: string;
  width: number;
  height: number;
}

// Lets the user pick which part of a larger photo becomes their avatar —
// drag to reposition, slider to zoom — then bakes the selection down to a
// fixed-size square JPEG via canvas. No pinch-gesture handling (a slider is
// far more reliable across browsers/devices than hand-rolled multitouch).
export function ImageCropSheet({ file, onCancel, onConfirm }: ImageCropSheetProps) {
  const [image, setImage] = React.useState<LoadedImage | null>(null);
  const [baseScale, setBaseScale] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.max(VIEWPORT / img.naturalWidth, VIEWPORT / img.naturalHeight);
      const rw = img.naturalWidth * scale;
      const rh = img.naturalHeight * scale;
      setBaseScale(scale);
      setImage({ src: url, width: img.naturalWidth, height: img.naturalHeight });
      setPan({ x: (VIEWPORT - rw) / 2, y: (VIEWPORT - rh) / 2 });
      setZoom(1);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const clampPan = React.useCallback(
    (nx: number, ny: number, z: number) => {
      if (!image) return { x: nx, y: ny };
      const effScale = baseScale * z;
      const rw = image.width * effScale;
      const rh = image.height * effScale;
      const minX = Math.min(0, VIEWPORT - rw);
      const minY = Math.min(0, VIEWPORT - rh);
      return { x: Math.min(0, Math.max(minX, nx)), y: Math.min(0, Math.max(minY, ny)) };
    },
    [image, baseScale]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan(clampPan(dragRef.current.panX + dx, dragRef.current.panY + dy, zoom));
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleZoomChange = (z: number) => {
    setZoom(z);
    setPan((prev) => clampPan(prev.x, prev.y, z));
  };

  const handleConfirm = () => {
    if (!image) return;
    const effScale = baseScale * zoom;
    const sx = -pan.x / effScale;
    const sy = -pan.y / effScale;
    const sSize = VIEWPORT / effScale;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new window.Image();
    img.onload = () => {
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT);
      onConfirm(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = image.src;
  };

  const effScale = baseScale * zoom;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="safe-top flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onCancel} className="press-scale text-sm font-medium text-white/80">
          Cancel
        </button>
        <p className="text-sm font-semibold text-white">Adjust photo</p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!image}
          className="press-scale text-sm font-semibold text-primary disabled:opacity-50"
        >
          Done
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div
          className="relative touch-none select-none overflow-hidden rounded-full border-2 border-white/70"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {image && (
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="absolute left-0 top-0 max-w-none"
              style={{
                width: image.width * effScale,
                height: image.height * effScale,
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
            />
          )}
        </div>

        <div className="flex w-full max-w-xs items-center gap-3">
          <span className="text-xs text-white/70">Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
            className="flex-1"
            aria-label="Zoom"
          />
        </div>
        <p className="text-center text-xs text-white/60">Drag the photo to reposition, use the slider to zoom</p>
      </div>
    </div>
  );
}
