import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Crosshair,
  FlaskConical,
  Maximize2,
  Mountain,
  Radiation,
  Radio,
  ShieldCheck,
  Snowflake,
  Wind,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
} from 'lucide-react';
import { SUIT_STEEP_SLOPE_THRESHOLD_DEG } from '../data/marsZones';
import type {
  ComputedRoute,
  LandingZone,
  LavaTubeShelter,
  LayerId,
  MapClickMode,
  NormalizedCoord,
  RouteStrategy,
  ScienceTarget,
} from '../types/mars';
import {
  type HazardAlertState,
  normToMarsLatLon,
  sampleCellAt,
} from '../utils/pathfinding';

interface MarsMapCanvasProps {
  zone: LandingZone;
  activeLayers: Record<LayerId, boolean>;
  clickMode: MapClickMode;
  startCoord: NormalizedCoord;
  targetCoord: NormalizedCoord;
  routes: Record<'safest' | 'fastest' | 'science', ComputedRoute>;
  selectedStrategy: 'safest' | 'fastest' | 'science';
  emergencyRoute: ComputedRoute | null;
  hazardAlert: HazardAlertState | null;
  uhfShadowGrid: number[][];
  astronautPos: NormalizedCoord;
  astronautHeadingRad: number;
  scoutRover?: {
    active: boolean;
    x: number;
    y: number;
    headingRad: number;
    isClear: boolean;
  };
  isSimulating: boolean;
  visorHudActive?: boolean;
  remainingO2Pct?: number;
  heartRateBpm?: number;
  metabolicKcalHr?: number;
  onMapClick: (coord: NormalizedCoord) => void;
  onSelectTargetFromPoi: (coord: NormalizedCoord) => void;
  onPoiPing?: () => void;
}

type SelectedPoi =
  | { kind: 'science'; data: ScienceTarget }
  | { kind: 'shelter'; data: LavaTubeShelter }
  | null;

const ROUTE_COLORS: Record<RouteStrategy, string> = {
  safest: '#10B981', // Emerald
  fastest: '#06B6D4', // Cyan
  science: '#A78BFA', // Violet
  emergency: '#F59E0B', // Telemetry Amber
};

function pointsToSvgPath(
  points: { x: number; y: number }[],
  w: number,
  h: number
): string {
  if (points.length === 0) return '';
  return points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${(p.x * w).toFixed(1)} ${(p.y * h).toFixed(1)}`)
    .join(' ');
}

export const MarsMapCanvas: React.FC<MarsMapCanvasProps> = ({
  zone,
  activeLayers,
  clickMode,
  startCoord,
  targetCoord,
  routes,
  selectedStrategy,
  emergencyRoute,
  hazardAlert,
  uhfShadowGrid,
  astronautPos,
  astronautHeadingRad,
  scoutRover,
  isSimulating,
  visorHudActive = false,
  remainingO2Pct = 100,
  heartRateBpm = 84,
  metabolicKcalHr = 245,
  onMapClick,
  onSelectTargetFromPoi,
  onPoiPing,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);

  const [hoverNorm, setHoverNorm] = useState<NormalizedCoord | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<SelectedPoi>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // Reset pan/zoom & POI when switching zone
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedPoi(null);
    setImgFailed(false);
  }, [zone.id]);

  // Draw multi-mission telemetry canvas overlay (Topography/Slope, Weather/Wind, Radiation/Solar)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    let animFrame = 0;
    let startTime = performance.now();

    const drawFrame = (now: number) => {
      const elapsedSec = (now - startTime) / 1000;
      ctx.clearRect(0, 0, width, height);

      const cols = zone.gridCols;
      const rows = zone.gridRows;
      const cellW = width / cols;
      const cellH = height / rows;

      // 1. TOPOGRAPHY, SLOPE & UHF RADIO SHADOW (MRO HiRISE + LOS Terrain Mask)
      if (activeLayers.topography) {
        // Soft UHF radio line-of-sight shadow zones blocked by crater rims & ridges
        if (uhfShadowGrid.length === rows) {
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const shadow = uhfShadowGrid[r]?.[c] ?? 0;
              if (shadow > 0.05) {
                const x = c * cellW;
                const y = r * cellH;
                ctx.fillStyle = `rgba(245, 158, 11, ${0.09 + shadow * 0.14})`;
                ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);

                ctx.fillStyle = `rgba(251, 191, 36, ${0.22 + shadow * 0.2})`;
                ctx.fillRect(x + cellW * 0.45, y + cellH * 0.45, 1.6, 1.6);
              }
            }
          }
        }

        // Steep slopes > 25 deg highlighted in crimson with subtle diagonal hatch
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cell = zone.grid[r][c];
            if (cell.slopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG) {
              const x = c * cellW;
              const y = r * cellH;
              const severity = Math.min(1, (cell.slopeDeg - 25) / 15);
              ctx.fillStyle = `rgba(239, 68, 68, ${0.22 + severity * 0.24})`;
              ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);

              // Hatch stripe for non-hue-only visual distinction
              ctx.strokeStyle = 'rgba(254, 202, 202, 0.42)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x, y + cellH);
              ctx.lineTo(x + cellW, y);
              ctx.stroke();
            } else if (cell.slopeDeg > 18) {
              ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
              ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
            }
          }
        }

        // Marching-squares elevation contour isolines every 35m
        let minElev = Infinity;
        let maxElev = -Infinity;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const e = zone.grid[r][c].elevationM;
            if (e < minElev) minElev = e;
            if (e > maxElev) maxElev = e;
          }
        }

        const step = 35;
        const firstLevel = Math.ceil(minElev / step) * step;
        ctx.lineWidth = 1;

        for (let level = firstLevel; level <= maxElev; level += step) {
          const isMajor = Math.abs(level % 70) < step;
          ctx.strokeStyle = isMajor
            ? 'rgba(56, 189, 248, 0.48)'
            : 'rgba(148, 163, 184, 0.22)';
          ctx.beginPath();

          for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
              const v0 = zone.grid[r][c].elevationM;
              const v1 = zone.grid[r][c + 1].elevationM;
              const v2 = zone.grid[r + 1][c + 1].elevationM;
              const v3 = zone.grid[r + 1][c].elevationM;

              const pts: [number, number][] = [];
              const cx = (c + 0.5) * cellW;
              const cy = (r + 0.5) * cellH;

              if ((v0 < level) !== (v1 < level)) {
                const t = (level - v0) / (v1 - v0);
                pts.push([cx + t * cellW, cy]);
              }
              if ((v1 < level) !== (v2 < level)) {
                const t = (level - v1) / (v2 - v1);
                pts.push([cx + cellW, cy + t * cellH]);
              }
              if ((v2 < level) !== (v3 < level)) {
                const t = (level - v2) / (v3 - v2);
                pts.push([cx + (1 - t) * cellW, cy + cellH]);
              }
              if ((v3 < level) !== (v0 < level)) {
                const t = (level - v3) / (v0 - v3);
                pts.push([cx, cy + (1 - t) * cellH]);
              }

              if (pts.length >= 2) {
                ctx.moveTo(pts[0][0], pts[0][1]);
                ctx.lineTo(pts[1][0], pts[1][1]);
              }
            }
          }
          ctx.stroke();
        }
      }

      // 2. RADIATION & SOLAR (DONKI / Curiosity RAD)
      if (activeLayers.radiation) {
        for (const rz of zone.radiationZones) {
          const cx = rz.centerX * width;
          const cy = rz.centerY * height;
          const radPx = rz.radius * width;
          const grad = ctx.createRadialGradient(cx, cy, radPx * 0.08, cx, cy, radPx);
          grad.addColorStop(0, 'rgba(245, 158, 11, 0.36)');
          grad.addColorStop(0.55, 'rgba(245, 158, 11, 0.16)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, radPx, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, radPx * 0.68, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Safe shelter shielding radius rings
        for (const shelter of zone.shelters) {
          const sx = shelter.x * width;
          const sy = shelter.y * height;
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
          ctx.fillStyle = 'rgba(16, 185, 129, 0.10)';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(sx, sy, 32, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Active Emergency Solar Flare / Dust Alert Overlay (Always visible when alert active!)
      if (hazardAlert?.active) {
        const hx = hazardAlert.stormCenter.x * width;
        const hy = hazardAlert.stormCenter.y * height;
        const hRad = hazardAlert.stormRadius * width;
        const pulse = 0.85 + 0.15 * Math.sin(elapsedSec * 3.5);

        const hGrad = ctx.createRadialGradient(hx, hy, hRad * 0.05, hx, hy, hRad * 1.25);
        hGrad.addColorStop(0, `rgba(239, 68, 68, ${0.46 * pulse})`);
        hGrad.addColorStop(0.55, 'rgba(245, 158, 11, 0.25)');
        hGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = hGrad;
        ctx.beginPath();
        ctx.arc(hx, hy, hRad * 1.25, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.arc(hx, hy, hRad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FECACA';
        ctx.textAlign = 'center';
        ctx.fillText(
          `DONKI ${hazardAlert.flareClass} SEP / DUST SQUALL`,
          hx,
          Math.max(20, hy - hRad - 8)
        );
      }

      // 3. WEATHER & DUST (InSight / MARCI)
      if (activeLayers.weather) {
        const df = zone.dustFront;
        const dx = df.centerX * width;
        const dy = df.centerY * height;
        const rx = df.radiusX * width;
        const ry = df.radiusY * height;

        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(df.angleRad);
        const dustGrad = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, Math.max(rx, ry));
        dustGrad.addColorStop(0, 'rgba(217, 119, 6, 0.34)');
        dustGrad.addColorStop(0.6, 'rgba(217, 119, 6, 0.16)');
        dustGrad.addColorStop(1, 'rgba(217, 119, 6, 0)');
        ctx.fillStyle = dustGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * 0.88, ry * 0.88, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Wind vectors every 4th grid cell
        for (let r = 2; r < rows; r += 4) {
          for (let c = 3; c < cols; c += 5) {
            const cell = zone.grid[r][c];
            const px = (c + 0.5) * cellW;
            const py = (r + 0.5) * cellH;
            const drift = (elapsedSec * cell.windSpeedMs * 1.4) % 14;

            const vx = Math.cos(cell.windDirRad);
            const vy = Math.sin(cell.windDirRad);
            const len = 12 + Math.min(18, cell.windSpeedMs * 1.1);

            const sx = px + vx * (drift - 7);
            const sy = py + vy * (drift - 7);
            const ex = sx + vx * len;
            const ey = sy + vy * len;

            const highWind = cell.windSpeedMs > 12;
            ctx.strokeStyle = highWind
              ? 'rgba(251, 191, 36, 0.85)'
              : 'rgba(125, 211, 252, 0.65)';
            ctx.lineWidth = highWind ? 1.7 : 1.25;

            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            // Arrowhead
            const headLen = 5;
            const angle = Math.atan2(vy, vx);
            ctx.lineTo(
              ex - headLen * Math.cos(angle - Math.PI / 6),
              ey - headLen * Math.sin(angle - Math.PI / 6)
            );
            ctx.moveTo(ex, ey);
            ctx.lineTo(
              ex - headLen * Math.cos(angle + Math.PI / 6),
              ey - headLen * Math.sin(angle + Math.PI / 6)
            );
            ctx.stroke();
          }
        }
      }

      if (activeLayers.weather || hazardAlert?.active) {
        animFrame = requestAnimationFrame(drawFrame);
      }
    };

    animFrame = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animFrame);
  }, [zone, activeLayers, hazardAlert, uhfShadowGrid]);

  const clientToNormalized = (clientX: number, clientY: number): NormalizedCoord | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    // Account for transform: translate(pan.x, pan.y) scale(zoom) from center
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const localX = (clientX - cx - pan.x) / zoom + rect.width / 2;
    const localY = (clientY - cy - pan.y) / zoom + rect.height / 2;

    const nx = Math.max(0.01, Math.min(0.99, localX / rect.width));
    const ny = Math.max(0.01, Math.min(0.99, localY / rect.height));
    return { x: nx, y: ny };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button[data-poi="true"]')) return;
    setIsDragging(true);
    dragOriginRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const norm = clientToNormalized(e.clientX, e.clientY);
    setHoverNorm(norm);

    if (isDragging && dragOriginRef.current) {
      const dx = e.clientX - dragOriginRef.current.x;
      const dy = e.clientY - dragOriginRef.current.y;
      if (Math.hypot(dx, dy) > 4) {
        dragOriginRef.current.moved = true;
      }
      if (zoom > 1 && dragOriginRef.current.moved) {
        const stage = stageRef.current;
        if (stage) {
          const maxPanX = ((zoom - 1) * stage.clientWidth) / 2;
          const maxPanY = ((zoom - 1) * stage.clientHeight) / 2;
          setPan({
            x: Math.max(-maxPanX, Math.min(maxPanX, dragOriginRef.current.panX + dx)),
            y: Math.max(-maxPanY, Math.min(maxPanY, dragOriginRef.current.panY + dy)),
          });
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasMoved = dragOriginRef.current?.moved ?? false;
    setIsDragging(false);
    dragOriginRef.current = null;

    if (!wasMoved) {
      if ((e.target as HTMLElement).closest('button[data-poi="true"]')) return;
      setSelectedPoi(null);
      const norm = clientToNormalized(e.clientX, e.clientY);
      if (norm && clickMode !== 'inspect') {
        onMapClick(norm);
      }
    }
  };

  const adjustZoom = (delta: number) => {
    setZoom((prev) => {
      const next = Math.max(1, Math.min(2.75, Number((prev + delta).toFixed(2))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const hoverTelemetry = useMemo(() => {
    if (!hoverNorm) return null;
    const cell = sampleCellAt(zone, hoverNorm, hazardAlert);
    const latLon = normToMarsLatLon(zone, hoverNorm);
    return {
      ...cell,
      ...latLon,
    };
  }, [zone, hoverNorm, hazardAlert]);

  const svgW = 1000;
  const svgH = 562.5;

  const showShelters = activeLayers.radiation || Boolean(hazardAlert?.active);

  return (
    <div className="relative flex flex-col w-full ares-panel !border-2 !border-black ring-1 ring-sky-400/20 shadow-[0_12px_36px_rgba(0,0,0,0.85)] rounded-lg overflow-hidden">
      {/* Map Header Utility Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3 px-2.5 sm:px-4 py-1.5 sm:py-2.5 bg-[#070B14]/85 border-b border-sky-500/20">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Compass className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-sky-400 shrink-0" />
          <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-slate-300 truncate">
            <span className="font-display font-bold text-xs sm:text-sm ares-text-metallic whitespace-nowrap">
              {zone.name}
            </span>
            <span className="text-slate-500 hidden sm:inline" aria-hidden="true">·</span>
            <span className="text-slate-300 truncate hidden sm:inline">{zone.regionSubtitle}</span>
            <span className="hidden xl:inline text-slate-600" aria-hidden="true">·</span>
            <span className="hidden xl:inline font-mono tabular-nums text-emerald-400 whitespace-nowrap">
              {zone.mapWidthKm.toFixed(1)} × {zone.mapHeightKm.toFixed(2)} km sector
            </span>
          </div>
        </div>

        {/* Zoom & Map Interaction Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <span className="text-[10px] sm:text-[11px] font-mono tabular-nums text-orange-300 mr-1 sm:mr-1.5">
            {zoom.toFixed(2)}×
          </span>
          <button
            type="button"
            onClick={() => adjustZoom(-0.35)}
            disabled={zoom <= 1}
            aria-label="Zoom out map"
            className="p-1.5 rounded-md border border-sky-500/35 bg-gradient-to-b from-slate-800/80 to-slate-950/90 text-sky-200 hover:text-white hover:border-sky-400 disabled:opacity-40 transition-all cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => adjustZoom(0.35)}
            disabled={zoom >= 2.75}
            aria-label="Zoom in map"
            className="p-1.5 rounded-md border border-sky-500/35 bg-gradient-to-b from-slate-800/80 to-slate-950/90 text-sky-200 hover:text-white hover:border-sky-400 disabled:opacity-40 transition-all cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            aria-label="Reset map view"
            className="px-2.5 py-1 rounded-md border border-orange-500/40 bg-gradient-to-b from-orange-950/50 to-slate-950/90 text-[11px] font-medium text-orange-200 hover:text-white hover:border-orange-400 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1"
          >
            <Maximize2 className="w-3 h-3 text-orange-300" />
            Reset View
          </button>
        </div>
      </div>

      {/* Emergency Re-Route Active Banner */}
      {hazardAlert?.active && (
        <div
          role="alert"
          className="flex flex-col gap-1.5 px-4 py-2.5 bg-gradient-to-r from-rose-950/95 via-orange-950/90 to-rose-950/95 border-b border-orange-500/60 text-rose-100 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="font-semibold text-orange-300 whitespace-nowrap">
                NASA DONKI {hazardAlert.flareClass} Solar Storm &amp; Dust Front Detected
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">·</span>
              <span className="text-rose-100/95">
                Target Shelter:{' '}
                <strong className="text-emerald-300 font-medium">
                  {emergencyRoute?.targetShelter?.name ?? 'Lava Tube Shelter'}
                </strong>
              </span>
            </div>
            {emergencyRoute && (
              <span className="font-mono tabular-nums text-orange-200 whitespace-nowrap">
                Shelter ETA: {emergencyRoute.walkTimeMinutes} min · {emergencyRoute.distanceKm} km
              </span>
            )}
          </div>
          <div className="pl-6 text-[11.5px] font-medium text-amber-200/95 leading-snug">
            Earth round-trip latency (28m 36s) exceeds safe response window — AresNav Onboard AI executing immediate autonomous re-route to nearest shelter.
          </div>
        </div>
      )}

      {/* 16:10 Interactive Map Stage (slightly taller to balance right column height) */}
      <div
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setIsDragging(false);
          setHoverNorm(null);
        }}
        className={`relative w-full aspect-[4/3] min-h-[290px] sm:min-h-0 sm:aspect-[16/10] bg-[#05070C] overflow-hidden select-none ${
          clickMode === 'inspect'
            ? zoom > 1
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-crosshair'
            : 'cursor-crosshair'
        }`}
      >
        <div
          className="relative w-full h-full transition-transform duration-100 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          {/* Base Satellite Layer */}
          {!imgFailed ? (
            <img
              src={zone.imageUrl}
              alt={`${zone.name} orthographic satellite terrain`}
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => setImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover brightness-95 contrast-105"
            />
          ) : (
            <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#2b1810] via-[#1c120e] to-[#0f131c] flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Mountain className="w-8 h-8 text-amber-500/60" />
                <span className="text-xs font-mono">
                  {zone.name} · Orbital Topographic Grid
                </span>
              </div>
            </div>
          )}

          {/* Subtle Dark Vignette for Telemetry Readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/25 pointer-events-none" />

          {/* Multi-Mission Telemetry Canvas Overlay */}
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

          {/* Vector Routes & Grid Overlay */}
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {/* Subtle Coordinate Graticule */}
            <g stroke="rgba(148, 163, 184, 0.14)" strokeWidth="0.7">
              {[0.2, 0.4, 0.6, 0.8].map((x) => (
                <line key={`vx-${x}`} x1={x * svgW} y1={0} x2={x * svgW} y2={svgH} />
              ))}
              {[0.25, 0.5, 0.75].map((y) => (
                <line key={`vy-${y}`} x1={0} y1={y * svgH} x2={svgW} y2={y * svgH} />
              ))}
            </g>

            {/* Non-selected comparative routes (dashed reference lines) */}
            {(['safest', 'fastest', 'science'] as const)
              .filter((s) => s !== selectedStrategy)
              .map((s) => {
                const route = routes[s];
                const d = pointsToSvgPath(route.points, svgW, svgH);
                return (
                  <path
                    key={`alt-${s}`}
                    d={d}
                    fill="none"
                    stroke={ROUTE_COLORS[s]}
                    strokeOpacity={hazardAlert?.active ? 0.25 : 0.48}
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}

            {/* Selected Primary Route */}
            {(() => {
              const route = routes[selectedStrategy];
              const d = pointsToSvgPath(route.points, svgW, svgH);
              const compromised = Boolean(hazardAlert?.active);
              return (
                <g>
                  <path
                    d={d}
                    fill="none"
                    stroke="#020617"
                    strokeOpacity={compromised ? 0.35 : 0.75}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={compromised ? '#EF4444' : ROUTE_COLORS[selectedStrategy]}
                    strokeOpacity={compromised ? 0.55 : 0.98}
                    strokeWidth={3.2}
                    strokeDasharray={compromised ? '7 6' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })()}

            {/* Emergency Shelter Re-Route Vector */}
            {hazardAlert?.active && emergencyRoute && (
              <g>
                <path
                  d={pointsToSvgPath(emergencyRoute.points, svgW, svgH)}
                  fill="none"
                  stroke="#020617"
                  strokeWidth={7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={pointsToSvgPath(emergencyRoute.points, svgW, svgH)}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth={3.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )}

            {/* Start Base Marker */}
            <g transform={`translate(${startCoord.x * svgW}, ${startCoord.y * svgH})`}>
              <circle r={11} fill="#0B1120" stroke="#38BDF8" strokeWidth={2.2} />
              <rect x={-4} y={-4} width={8} height={8} fill="#38BDF8" rx={1} />
              <text
                x={0}
                y={-16}
                textAnchor="middle"
                fill="#E0F2FE"
                fontSize="11"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
                style={{ paintOrder: 'stroke', stroke: '#020617', strokeWidth: 3 }}
              >
                START BASE
              </text>
            </g>

            {/* Target Waypoint Marker */}
            <g transform={`translate(${targetCoord.x * svgW}, ${targetCoord.y * svgH})`}>
              <circle r={11} fill="#0B1120" stroke="#F59E0B" strokeWidth={2.2} />
              <circle r={4} fill="#F59E0B" />
              <text
                x={0}
                y={-16}
                textAnchor="middle"
                fill="#FEF3C7"
                fontSize="11"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
                style={{ paintOrder: 'stroke', stroke: '#020617', strokeWidth: 3 }}
              >
                WAYPOINT
              </text>
            </g>

            {/* Companion Autonomous SCOUT ROVER (200m Ahead During Simulation) */}
            {scoutRover?.active && (
              <g>
                {/* Telemetry Sync Link Between EVA-1 and Scout Rover */}
                <line
                  x1={astronautPos.x * svgW}
                  y1={astronautPos.y * svgH}
                  x2={scoutRover.x * svgW}
                  y2={scoutRover.y * svgH}
                  stroke={scoutRover.isClear ? '#2DD4BF' : '#F59E0B'}
                  strokeWidth={1.6}
                  strokeDasharray="3 3"
                  strokeOpacity={0.85}
                />

                <g transform={`translate(${scoutRover.x * svgW}, ${scoutRover.y * svgH})`}>
                  {/* Forward Terrain Radar Scan Arc */}
                  <g transform={`rotate(${(scoutRover.headingRad * 180) / Math.PI})`}>
                    <path
                      d="M 0 0 L 28 -14 A 30 30 0 0 1 28 14 Z"
                      fill={
                        scoutRover.isClear
                          ? 'rgba(45, 212, 191, 0.24)'
                          : 'rgba(245, 158, 11, 0.30)'
                      }
                      stroke={
                        scoutRover.isClear
                          ? 'rgba(45, 212, 191, 0.55)'
                          : 'rgba(245, 158, 11, 0.65)'
                      }
                      strokeWidth={0.8}
                    />
                  </g>

                  {/* 4-Wheel Rover Chassis + Mast */}
                  <rect
                    x={-8}
                    y={-6}
                    width={16}
                    height={12}
                    rx={2.5}
                    fill="#09131F"
                    stroke={scoutRover.isClear ? '#2DD4BF' : '#F59E0B'}
                    strokeWidth={1.8}
                  />
                  <rect x={-9} y={-8} width={4} height={2.5} fill="#94A3B8" rx={0.6} />
                  <rect x={5} y={-8} width={4} height={2.5} fill="#94A3B8" rx={0.6} />
                  <rect x={-9} y={5.5} width={4} height={2.5} fill="#94A3B8" rx={0.6} />
                  <rect x={5} y={5.5} width={4} height={2.5} fill="#94A3B8" rx={0.6} />
                  <circle
                    cx={0}
                    cy={0}
                    r={2.5}
                    fill={scoutRover.isClear ? '#5EEAD4' : '#FBBF24'}
                  />

                  <text
                    x={0}
                    y={-13}
                    textAnchor="middle"
                    fill={scoutRover.isClear ? '#99F6E4' : '#FDE68A'}
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                    style={{ paintOrder: 'stroke', stroke: '#020617', strokeWidth: 3 }}
                  >
                    SCOUT ROVER
                  </text>
                </g>
              </g>
            )}

            {/* Live Astronaut EVA Marker */}
            <g
              transform={`translate(${astronautPos.x * svgW}, ${astronautPos.y * svgH})`}
            >
              {/* Directional Heading Cone */}
              <g transform={`rotate(${(astronautHeadingRad * 180) / Math.PI})`}>
                <path
                  d="M 0 0 L 26 -11 L 26 11 Z"
                  fill={hazardAlert?.active ? 'rgba(245,158,11,0.32)' : 'rgba(6,182,212,0.30)'}
                />
              </g>
              <circle
                r={10}
                fill={hazardAlert?.active ? '#F59E0B' : '#06B6D4'}
                stroke="#020617"
                strokeWidth={2.5}
              />
              <circle r={3.5} fill="#FFFFFF" />
              <text
                x={0}
                y={22}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="10.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
                style={{ paintOrder: 'stroke', stroke: '#020617', strokeWidth: 3 }}
              >
                {isSimulating ? 'EVA-1 LIVE' : 'EVA-1'}
              </text>
            </g>
          </svg>

          {/* Interactive Science & Ice Target Markers (Perseverance Layer) */}
          {activeLayers.science &&
            zone.scienceTargets.map((target) => {
              const isIce = target.kind === 'water_ice';
              const isSelected =
                selectedPoi?.kind === 'science' && selectedPoi.data.id === target.id;
              return (
                <button
                  key={target.id}
                  type="button"
                  data-poi="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPoiPing?.();
                    setSelectedPoi({ kind: 'science', data: target });
                  }}
                  style={{
                    left: `${target.x * 100}%`,
                    top: `${target.y * 100}%`,
                  }}
                  title={`${target.name} (${target.instrument})`}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 group flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-mono transition-transform cursor-pointer ${
                    isSelected
                      ? 'bg-slate-950/95 border-white text-white scale-105 z-20'
                      : isIce
                      ? 'bg-sky-950/90 border-sky-400/80 text-sky-100 hover:scale-105 z-10'
                      : 'bg-violet-950/90 border-violet-400/80 text-violet-100 hover:scale-105 z-10'
                  }`}
                >
                  {isIce ? (
                    <Snowflake className="w-3 h-3 text-sky-300 shrink-0" />
                  ) : (
                    <FlaskConical className="w-3 h-3 text-violet-300 shrink-0" />
                  )}
                  <span className="whitespace-nowrap font-medium">
                    {target.name.split(' ').slice(0, 2).join(' ')}
                  </span>
                </button>
              );
            })}

          {/* Interactive Lava-Tube Shelter Markers */}
          {showShelters &&
            zone.shelters.map((shelter) => {
              const isEmergencyDest =
                hazardAlert?.active && emergencyRoute?.targetShelter?.id === shelter.id;
              const isSelected =
                selectedPoi?.kind === 'shelter' && selectedPoi.data.id === shelter.id;
              return (
                <button
                  key={shelter.id}
                  type="button"
                  data-poi="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPoiPing?.();
                    setSelectedPoi({ kind: 'shelter', data: shelter });
                  }}
                  style={{
                    left: `${shelter.x * 100}%`,
                    top: `${shelter.y * 100}%`,
                  }}
                  title={`${shelter.name} (${(shelter.shieldingFactor * 100).toFixed(0)}% shielding)`}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-mono transition-transform cursor-pointer ${
                    isEmergencyDest
                      ? 'bg-emerald-950/95 border-amber-400 text-amber-200 scale-105 z-20'
                      : isSelected
                      ? 'bg-slate-950/95 border-emerald-300 text-white z-20'
                      : 'bg-emerald-950/90 border-emerald-500/80 text-emerald-100 hover:scale-105 z-10'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="whitespace-nowrap font-medium">{shelter.name}</span>
                </button>
              );
            })}
        </div>

        {/* Subtle Optical Reticle Corner Brackets */}
        <div className="pointer-events-none absolute top-2 left-2 w-3 h-3 border-t border-l border-sky-400/45" />
        <div className="pointer-events-none absolute top-2 right-2 w-3 h-3 border-t border-r border-sky-400/45" />
        <div className="pointer-events-none absolute bottom-2 left-2 w-3 h-3 border-b border-l border-orange-400/45" />
        <div className="pointer-events-none absolute bottom-2 right-2 w-3 h-3 border-b border-r border-orange-400/45" />

        {/* Top-Left Map Canvas HUD Stack (Click Mode + Visor Suit Pressure) */}
        <div className="absolute top-2.5 left-2.5 sm:top-3.5 sm:left-3.5 pointer-events-none flex flex-col items-start gap-1.5 z-20">
          <div className="flex items-center gap-1.5 sm:gap-2 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded bg-[#060910]/90 border border-slate-700/80 text-[10px] sm:text-[11px] font-mono text-slate-200 backdrop-blur-sm">
            <Crosshair className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-sky-400" />
            <span>
              {clickMode === 'set_start'
                ? 'Tap map to place Start Base'
                : clickMode === 'set_target'
                ? 'Tap map to place Waypoint'
                : 'Hover to probe · Tap POI'}
            </span>
          </div>

          {visorHudActive && (
            <div className="px-2.5 py-1 rounded bg-[#030712]/80 border border-sky-400/30 backdrop-blur-xs font-mono tabular-nums text-[10px] sm:text-[11px] text-sky-200 leading-tight shadow-[0_4px_14px_rgba(0,0,0,0.65)]">
              <div>
                Suit Pressure: <span className="text-emerald-300 font-semibold">4.3 PSI</span>
              </div>
              <div className="text-slate-300/90 text-[9.5px] sm:text-[10px]">
                O₂ Reserve: <span className="text-sky-300">{remainingO2Pct.toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Top-Right Map Canvas Visor HUD (Heart Rate / Metabolic) */}
        {visorHudActive && (
          <div className="absolute top-2.5 right-2.5 sm:top-3.5 sm:right-3.5 pointer-events-none z-20 px-2.5 py-1 rounded bg-[#030712]/80 border border-sky-400/30 backdrop-blur-xs font-mono tabular-nums text-[10px] sm:text-[11px] text-sky-200 text-right leading-tight shadow-[0_4px_14px_rgba(0,0,0,0.65)]">
            <div>
              Heart Rate: <span className="text-orange-300 font-semibold">{heartRateBpm} BPM</span>
            </div>
            <div className="text-slate-300/90 text-[9.5px] sm:text-[10px]">
              Metabolic: <span className="text-emerald-300">{metabolicKcalHr} kcal/h</span>
            </div>
          </div>
        )}

        {/* Live Terrain Crosshair Probe HUD (Bottom-Left) */}
        {hoverTelemetry && (
          <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:right-auto sm:bottom-3.5 sm:left-3.5 pointer-events-none flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-0.5 sm:gap-y-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded bg-[#060910]/92 border border-slate-700/85 text-[10px] sm:text-[11px] font-mono tabular-nums text-slate-200 backdrop-blur-sm">
            <span className="text-sky-300">
              {hoverTelemetry.latFormatted}, {hoverTelemetry.lonFormatted}
            </span>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <span>Elev {hoverTelemetry.elevationM} m</span>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <span
              className={
                hoverTelemetry.slopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG
                  ? 'text-rose-400 font-semibold'
                  : hoverTelemetry.slopeDeg > 18
                  ? 'text-orange-300'
                  : 'text-emerald-300'
              }
            >
              Slope {hoverTelemetry.slopeDeg.toFixed(1)}°
              {hoverTelemetry.slopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG
                ? ' (UNSAFE >25°)'
                : ''}
            </span>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <span>Wind {hoverTelemetry.windSpeedMs.toFixed(1)} m/s</span>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <span>Rad {hoverTelemetry.radiationMsVPerHr.toFixed(3)} mSv/h</span>
          </div>
        )}

        {/* Selected Science Target / Shelter Popover */}
        {selectedPoi && (
          <div className="absolute top-3.5 right-3.5 w-[calc(100%-1.75rem)] sm:w-72 p-3.5 rounded-lg bg-[#0A0F19]/95 border border-slate-700 text-xs shadow-xl backdrop-blur-sm z-30">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-white">
                {selectedPoi.kind === 'science' ? (
                  selectedPoi.data.kind === 'water_ice' ? (
                    <Snowflake className="w-4 h-4 text-sky-400 shrink-0" />
                  ) : (
                    <FlaskConical className="w-4 h-4 text-violet-400 shrink-0" />
                  )
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span>{selectedPoi.data.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPoi(null)}
                className="text-slate-400 hover:text-white px-1 cursor-pointer"
                aria-label="Close site details"
              >
                ✕
              </button>
            </div>

            {selectedPoi.kind === 'science' ? (
              <div className="space-y-1.5 text-slate-300">
                <div className="text-[11px] font-mono text-sky-300">
                  {selectedPoi.data.instrument} · {selectedPoi.data.priority} Priority
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {selectedPoi.data.composition}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onSelectTargetFromPoi({
                      x: selectedPoi.data.x,
                      y: selectedPoi.data.y,
                    });
                    setSelectedPoi(null);
                  }}
                  className="mt-2 w-full py-1.5 px-3 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors cursor-pointer"
                >
                  Set as Target Waypoint
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 text-slate-300">
                <div className="text-[11px] font-mono tabular-nums text-emerald-300">
                  {(selectedPoi.data.shieldingFactor * 100).toFixed(0)}% Radiation Shielding ·{' '}
                  {selectedPoi.data.depthMeters} m Basalt Cover
                </div>
                <p className="text-slate-400">
                  Pressurized EVA refuge capacity: {selectedPoi.data.capacityAstronauts}{' '}
                  astronauts.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onSelectTargetFromPoi({
                      x: selectedPoi.data.x,
                      y: selectedPoi.data.y,
                    });
                    setSelectedPoi(null);
                  }}
                  className="mt-2 w-full py-1.5 px-3 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors cursor-pointer"
                >
                  Route to Shelter
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compact Map Legend Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-[#0A0F19] border-t border-slate-800/90 text-[10px] sm:text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-emerald-300/90">
            <span className="inline-block w-3 h-0.5 bg-emerald-400" />
            Safest
          </span>
          <span className="flex items-center gap-1.5 text-sky-300/90">
            <span className="inline-block w-3 h-0.5 bg-sky-400" />
            Fastest
          </span>
          <span className="flex items-center gap-1.5 text-violet-300/90">
            <span className="inline-block w-3 h-0.5 bg-violet-400" />
            Max Science
          </span>
          {activeLayers.topography && (
            <>
              <span className="flex items-center gap-1.5 text-rose-300">
                <Mountain className="w-3.5 h-3.5 text-rose-400" />
                Slope &gt;25° Suit Limit
              </span>
              <span className="flex items-center gap-1.5 text-amber-300">
                <Radio className="w-3.5 h-3.5 text-amber-400" />
                UHF RF Shadow
              </span>
            </>
          )}
          {activeLayers.weather && (
            <span className="flex items-center gap-1.5 text-orange-300">
              <Wind className="w-3.5 h-3.5 text-orange-400" />
              InSight Wind &amp; Dust Front
            </span>
          )}
          {activeLayers.radiation && (
            <span className="flex items-center gap-1.5 text-emerald-300">
              <Radiation className="w-3.5 h-3.5 text-amber-400" />
              RAD Zones &amp; Shelters
            </span>
          )}
        </div>
        <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap">
          {zone.missionReference}
        </span>
      </div>
    </div>
  );
};
