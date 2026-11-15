import React, { useEffect, useState } from 'react';

interface TransparentLogoProps {
  src: string;
  alt: string;
  className?: string;
}

export const TransparentLogo: React.FC<TransparentLogoProps> = ({
  src,
  alt,
  className = 'h-15 w-auto object-contain select-none',
}) => {
  const [processedSrc, setProcessedSrc] = useState<string>(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        let minX = w;
        let minY = h;
        let maxX = 0;
        let maxY = 0;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const maxCh = Math.max(r, g, b);

            let alpha = 255;
            if (maxCh <= 18) {
              alpha = 0;
            } else if (maxCh < 52) {
              alpha = Math.round(((maxCh - 18) / 34) * 255);
            }
            data[idx + 3] = alpha;

            if (alpha > 16) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);

        // Tightly crop transparent bounding box so the text fills the logo slot cleanly
        if (maxX > minX && maxY > minY) {
          const pad = 4;
          const sx = Math.max(0, minX - pad);
          const sy = Math.max(0, minY - pad);
          const sw = Math.min(w - sx, maxX - minX + 1 + pad * 2);
          const sh = Math.min(h - sy, maxY - minY + 1 + pad * 2);

          const cropped = document.createElement('canvas');
          cropped.width = sw;
          cropped.height = sh;
          const cCtx = cropped.getContext('2d');
          if (cCtx) {
            cCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            const url = cropped.toDataURL('image/png');
            if (!cancelled) setProcessedSrc(url);
            return;
          }
        }

        const url = canvas.toDataURL('image/png');
        if (!cancelled) setProcessedSrc(url);
      } catch {
        // Fallback to original image if canvas read is restricted
      }
    };
    img.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (failed) {
    return (
      <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap">
        <span className="ares-text-metallic">ARES</span>
        <span className="ares-text-solar">Nav</span>
      </span>
    );
  }

  return (
    <img
      src={processedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
