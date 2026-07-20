// Downscales/compresses a picked image file client-side before it's ever
// sent over the network — phone camera originals can be several MB, but a
// profile photo only ever renders at avatar size, so there's no reason to
// store (or pay Cloud SQL storage for) more than a small square JPEG.
const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.82;

export function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the selected file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read the selected image."));
      img.onload = () => {
        // Center-crop to a square, then scale down to MAX_DIMENSION.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const outSide = Math.min(side, MAX_DIMENSION);

        const canvas = document.createElement("canvas");
        canvas.width = outSide;
        canvas.height = outSide;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported."));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, outSide, outSide);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
