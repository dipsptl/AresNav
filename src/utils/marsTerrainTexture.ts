import { SUIT_STEEP_SLOPE_THRESHOLD_DEG } from '../data/marsZones';
import type { LandingZone } from '../types/mars';

function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);

  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * (smoothNoise(x * freq, y * freq, seed + i * 31) - 0.5);
    freq *= 2.08;
    amp *= 0.5;
  }
  return value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function sampleBilinearGrid(
  grid: number[][],
  rows: number,
  cols: number,
  nx: number,
  ny: number
): number {
  const gx = Math.max(0, Math.min(cols - 1.0001, nx * cols - 0.5));
  const gy = Math.max(0, Math.min(rows - 1.0001, ny * rows - 0.5));
  const c0 = Math.floor(gx);
  const r0 = Math.floor(gy);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tx = gx - c0;
  const ty = gy - r0;

  const v00 = grid[r0][c0];
  const v10 = grid[r0][c1];
  const v01 = grid[r1][c0];
  const v11 = grid[r1][c1];

  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

/**
 * Generates a smooth, high-resolution procedural NASA HiRISE-style Martian orbital
 * satellite terrain canvas (shaded relief, ochre craters, delta channels, canyon ridges)
 * with zero external network dependencies.
 */
export function renderProceduralMarsTerrain(
  canvas: HTMLCanvasElement,
  zone: LandingZone
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const texW = 640;
  const texH = 360;
  const offscreen = document.createElement('canvas');
  offscreen.width = texW;
  offscreen.height = texH;
  const octx = offscreen.getContext('2d');
  if (!octx) return;

  const rows = zone.gridRows;
  const cols = zone.gridCols;
  const elevGrid: number[][] = zone.grid.map((row) => row.map((c) => c.elevationM));

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = elevGrid[r][c];
      if (e < minElev) minElev = e;
      if (e > maxElev) maxElev = e;
    }
  }
  const elevSpan = Math.max(40, maxElev - minElev);

  const seed =
    zone.id === 'jezero' ? 19 : zone.id === 'gale' ? 53 : zone.id === 'arcadia' ? 89 : 131;

  // Precompute fine heightfield with procedural micro-craters & braided channels
  const heightField = new Float32Array(texW * texH);
  const craterSeeds = Array.from({ length: 18 }, (_, i) => ({
    x: hash2D(i * 3.1, 1.7, seed),
    y: hash2D(2.9, i * 4.3, seed),
    r: 0.012 + hash2D(i * 1.9, i * 2.7, seed + 7) * 0.036,
    depth: 12 + hash2D(i * 5.3, 4.1, seed + 13) * 28,
  }));

  for (let y = 0; y < texH; y++) {
    const ny = (y + 0.5) / texH;
    for (let x = 0; x < texW; x++) {
      const nx = (x + 0.5) / texW;
      let h = sampleBilinearGrid(elevGrid, rows, cols, nx, ny);

      // Multi-octave rocky ridges & aeolian dust ripples
      const macroNoise = fbm(nx * 14, ny * 8.5, seed, 4) * 32;
      const microGrain = fbm(nx * 56, ny * 32, seed + 71, 3) * 11;
      const aeolian = Math.sin((nx * 45 + ny * 18 + fbm(nx * 8, ny * 6, seed + 19, 2) * 3.2)) * 2.2;
      h += macroNoise + microGrain + aeolian;

      // Sinuous delta / river channel carving for Jezero & Gale, tectonic rilles for Arcadia/Valles
      if (zone.id === 'jezero' || zone.id === 'gale') {
        const branch1 = Math.abs(
          ny - (0.48 - 0.16 * Math.sin(nx * 5.2 + 0.4) + fbm(nx * 9, ny * 9, seed + 5, 2) * 0.07)
        );
        const branch2 = Math.abs(
          ny - (0.52 + 0.14 * Math.cos(nx * 4.6 - 0.3) + fbm(nx * 11, ny * 11, seed + 11, 2) * 0.06)
        );
        const fanMask = Math.exp(-Math.pow((nx - 0.48) / 0.28, 2));
        h -= (Math.exp(-Math.pow(branch1 / 0.016, 2)) + Math.exp(-Math.pow(branch2 / 0.013, 2))) * 22 * fanMask;
      }

      // Micro-impact craters with crisp raised rims
      for (let k = 0; k < craterSeeds.length; k++) {
        const cr = craterSeeds[k];
        const dx = nx - cr.x;
        const dy = (ny - cr.y) * (texH / texW);
        const d = Math.sqrt(dx * dx + dy * dy) / cr.r;
        if (d < 1.65) {
          const bowl = -cr.depth * Math.exp(-Math.pow(d / 0.72, 2.4));
          const rim = cr.depth * 0.38 * Math.exp(-Math.pow((d - 0.96) / 0.19, 2));
          h += bowl + rim;
        }
      }

      heightField[y * texW + x] = h;
    }
  }

  // Zone-calibrated orbital mineral palette (rusty red-ochre, basalt darks, bright dust)
  const palette =
    zone.id === 'jezero'
      ? { dark: [58, 39, 31], mid: [158, 91, 56], high: [212, 146, 98] }
      : zone.id === 'gale'
      ? { dark: [54, 42, 36], mid: [148, 92, 62], high: [204, 142, 99] }
      : zone.id === 'arcadia'
      ? { dark: [64, 45, 38], mid: [164, 102, 68], high: [216, 162, 122] }
      : { dark: [46, 28, 23], mid: [144, 72, 46], high: [198, 121, 78] };

  const imgData = octx.createImageData(texW, texH);
  const data = imgData.data;

  // Sun illumination vector from upper-left NW
  const lx = -0.68;
  const ly = -0.58;
  const lz = 0.45;

  for (let y = 0; y < texH; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(texH - 1, y + 1);
    for (let x = 0; x < texW; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(texW - 1, x + 1);

      const h = heightField[y * texW + x];
      const dzdx = (heightField[y * texW + xp] - heightField[y * texW + xm]) * 0.19;
      const dzdy = (heightField[yp * texW + x] - heightField[ym * texW + x]) * 0.19;

      // Surface normal N = normalize(-dzdx, -dzdy, 1)
      const invLen = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const dot = Math.max(0.14, Math.min(1.38, (-dzdx * lx - dzdy * ly + lz) * invLen + 0.36));

      const elevNorm = Math.max(0, Math.min(1, (h - minElev) / elevSpan));
      const regolithVar = smoothNoise((x / texW) * 18, (y / texH) * 10, seed + 101);
      const t = Math.max(0, Math.min(1, elevNorm * 0.78 + regolithVar * 0.22));

      let r: number;
      let g: number;
      let b: number;
      if (t < 0.48) {
        const k = t / 0.48;
        r = palette.dark[0] + (palette.mid[0] - palette.dark[0]) * k;
        g = palette.dark[1] + (palette.mid[1] - palette.dark[1]) * k;
        b = palette.dark[2] + (palette.mid[2] - palette.dark[2]) * k;
      } else {
        const k = (t - 0.48) / 0.52;
        r = palette.mid[0] + (palette.high[0] - palette.mid[0]) * k;
        g = palette.mid[1] + (palette.high[1] - palette.mid[1]) * k;
        b = palette.mid[2] + (palette.high[2] - palette.mid[2]) * k;
      }

      // Subtle fine contour ring hint every ~30m
      const contourFrac = Math.abs(((h % 30) + 30) % 30);
      const contourShade = contourFrac < 1.3 ? 0.91 : 1.0;

      const idx = (y * texW + x) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(r * dot * contourShade)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g * dot * contourShade)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b * dot * contourShade)));
      data[idx + 3] = 255;
    }
  }

  octx.putImageData(imgData, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/**
 * Builds a smooth bilinearly-interpolated offscreen canvas for slope hazards (>18° / >25°)
 * and UHF RF terrain shadows, completely eliminating blocky 20x20px grid squares.
 */
export function buildSmoothTopographyOverlay(
  zone: LandingZone,
  uhfShadowGrid: number[][]
): HTMLCanvasElement {
  const outW = 320;
  const outH = 180;
  const offscreen = document.createElement('canvas');
  offscreen.width = outW;
  offscreen.height = outH;
  const octx = offscreen.getContext('2d');
  if (!octx) return offscreen;

  const rows = zone.gridRows;
  const cols = zone.gridCols;
  const slopeGrid: number[][] = zone.grid.map((row) => row.map((c) => c.slopeDeg));
  const hasShadow = uhfShadowGrid.length === rows;

  const imgData = octx.createImageData(outW, outH);
  const data = imgData.data;

  for (let y = 0; y < outH; y++) {
    const ny = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const nx = (x + 0.5) / outW;
      const slope = sampleBilinearGrid(slopeGrid, rows, cols, nx, ny);
      const shadow = hasShadow ? sampleBilinearGrid(uhfShadowGrid, rows, cols, nx, ny) : 0;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      // Smooth UHF RF shadow layer
      if (shadow > 0.06) {
        const sa = Math.min(0.28, shadow * 0.24);
        r = 245;
        g = 158;
        b = 11;
        a = sa;
      }

      // Smooth slope transitions (>18 deg caution amber, >25 deg crimson hazard)
      if (slope > 17.5) {
        const warnT = smoothstep(17.5, 23.5, slope);
        const dangerT = smoothstep(
          SUIT_STEEP_SLOPE_THRESHOLD_DEG - 1.2,
          SUIT_STEEP_SLOPE_THRESHOLD_DEG + 4.5,
          slope
        );

        const sr = Math.round(245 + (239 - 245) * dangerT);
        const sg = Math.round(158 + (68 - 158) * dangerT);
        const sb = Math.round(11 + (68 - 11) * dangerT);
        const sa = warnT * 0.13 + dangerT * 0.30;

        // Blend over shadow if present
        const inv = 1 - sa;
        const totalA = sa + a * inv;
        if (totalA > 0) {
          r = (sr * sa + r * a * inv) / totalA;
          g = (sg * sa + g * a * inv) / totalA;
          b = (sb * sa + b * a * inv) / totalA;
          a = totalA;
        }
      }

      const idx = (y * outW + x) * 4;
      data[idx] = Math.round(r);
      data[idx + 1] = Math.round(g);
      data[idx + 2] = Math.round(b);
      data[idx + 3] = Math.min(255, Math.round(a * 255));
    }
  }

  octx.putImageData(imgData, 0, 0);
  return offscreen;
}
