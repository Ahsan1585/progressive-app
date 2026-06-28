import React, { useRef, useState, useEffect } from 'react';

const SignaturePad = ({ label, subtext, onUpdate, onSave }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  
  // 🌟 Track if the user actually touched the canvas
  const [hasDrawn, setHasDrawn] = useState(false); 

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0a0a0a';
    }
  }, []);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    
    // 🌟 The moment they touch it, mark it as drawn
    setHasDrawn(true); 
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.closePath();
    setIsDrawing(false);
    
    // 🌟 Only update if they actually drew something
    if (onUpdate && hasDrawn) {
      onUpdate(canvas.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 🌟 Reset the tracker to false so it's blank again
    setHasDrawn(false); 
    
    if (onUpdate) onUpdate(null);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (onSave) {
      // 🌟 If the pad is blank, send null instead of a transparent PNG
      if (!hasDrawn) {
        onSave(null);
      } else {
        onSave(canvas.toDataURL('image/png'));
      }
    }
  };

  return (
    <div className="space-y-2 flex flex-col items-center">
      {label && <label className="text-neutral-700 font-semibold">{label}</label>}
      <div className="border border-neutral-300 rounded-lg bg-white overflow-hidden relative">
        <canvas
          ref={canvasRef}
          width={350}
          height={120}
          className="w-full h-[120px] cursor-crosshair touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={clearSignature}
          className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded"
        >
          Clear
        </button>
        {onSave && (
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded"
          >
            Save Signature
          </button>
        )}
      </div>
      {subtext && <p className="text-xs text-neutral-500 mt-1">{subtext}</p>}
    </div>
  );
};

export default SignaturePad;