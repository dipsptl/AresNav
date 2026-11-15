import React, { useMemo, useState } from 'react';
import { SUIT_STEEP_SLOPE_THRESHOLD_DEG } from '../data/marsZones';
import type { ComputedRoute } from '../types/mars';

interface ElevationProfileChartProps {
  route: ComputedRoute;
  progressRatio: number;
  isEmergency: boolean;
}

export const ElevationProfileChart: React.FC<ElevationProfileChartProps> = ({
  route,
  progressRatio,
  isEmergency,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 580;
  const height = 168;
  const padL = 46;
  const padR = 36;
  const padT = 14;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const { elevPath, areaPath, slopePath, minElev, maxElev, limitY } = useMemo(() => {
    const pts = route.points;
    if (pts.length === 0) {
      return {
        elevPath: '',
        areaPath: '',
        slopePath: '',
        minElev: -3000,
        maxElev: -2000,
        limitY: padT + plotH * 0.35,
      };
    }

    let minE = Infinity;
    let maxE = -Infinity;
    for (const p of pts) {
      if (p.elevationM < minE) minE = p.elevationM;
      if (p.elevationM > maxE) maxE = p.elevationM;
    }
    const spanE = Math.max(40, maxE - minE);
    const totalD = Math.max(0.01, route.distanceKm);

    const elevCoords = pts.map((p) => {
      const x = padL + (p.distanceKm / totalD) * plotW;
      const y = padT + plotH - ((p.elevationM - minE) / spanE) * plotH;
      return { x, y };
    });

    const slopeCoords = pts.map((p) => {
      const x = padL + (p.distanceKm / totalD) * plotW;
      const clampedS = Math.min(40, p.slopeDeg);
      const y = padT + plotH - (clampedS / 40) * plotH;
      return { x, y };
    });

    const ePath = elevCoords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const aPath = `${ePath} L ${elevCoords[elevCoords.length - 1].x.toFixed(1)} ${
      padT + plotH
    } L ${elevCoords[0].x.toFixed(1)} ${padT + plotH} Z`;

    const sPath = slopeCoords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');

    const limY = padT + plotH - (SUIT_STEEP_SLOPE_THRESHOLD_DEG / 40) * plotH;

    return {
      elevPath: ePath,
      areaPath: aPath,
      slopePath: sPath,
      minElev: minE,
      maxElev: maxE,
      limitY: limY,
    };
  }, [route, plotW, plotH]);

  const activePoint =
    hoverIdx !== null && route.points[hoverIdx] ? route.points[hoverIdx] : null;

  const progressX = padL + Math.max(0, Math.min(1, progressRatio)) * plotW;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const ratio = (relX - padL) / plotW;
    if (ratio < 0 || ratio > 1 || route.points.length === 0) {
      setHoverIdx(null);
      return;
    }
    const targetDist = ratio * route.distanceKm;
    let closestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < route.points.length; i++) {
      const diff = Math.abs(route.points[i].distanceKm - targetDist);
      if (diff < bestDiff) {
        bestDiff = diff;
        closestIdx = i;
      }
    }
    setHoverIdx(closestIdx);
  };

  return (
    <div className="flex flex-col h-full justify-between gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-display font-bold text-sm ares-text-metallic">
            Traverse Elevation &amp; Slope Profile
          </span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-sky-400">
            <span className="inline-block w-2.5 h-0.5 bg-sky-400" />
            Elev (m)
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-orange-400">
            <span className="inline-block w-2.5 h-0.5 bg-orange-400" />
            Slope (°)
          </span>
        </div>

        {activePoint ? (
          <div className="text-[11px] font-mono tabular-nums text-slate-200">
            {activePoint.distanceKm.toFixed(2)} km · {activePoint.elevationM} m ·{' '}
            <span
              className={
                activePoint.slopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG
                  ? 'text-rose-400 font-semibold'
                  : 'text-orange-300'
              }
            >
              {activePoint.slopeDeg.toFixed(1)}°
            </span>
          </div>
        ) : (
          <div className="text-[11px] font-mono tabular-nums text-slate-400">
            Peak {route.peakSlopeDeg.toFixed(1)}° · Avg {route.avgSlopeDeg.toFixed(1)}°
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        className="w-full h-[164px] select-none cursor-crosshair bg-[#060910]/90 rounded-md border border-slate-800/80"
        role="img"
        aria-label="Route elevation and slope profile chart"
      >
        <defs>
          <linearGradient id="elevFillGrad" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={isEmergency ? '#F97316' : '#38BDF8'}
              stopOpacity="0.34"
            />
            <stop
              offset="100%"
              stopColor={isEmergency ? '#F97316' : '#38BDF8'}
              stopOpacity="0.03"
            />
          </linearGradient>
        </defs>

        {/* Subtle Vertical & Horizontal Grid Lines */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={`vg-${t}`}
            x1={padL + t * plotW}
            y1={padT}
            x2={padL + t * plotW}
            y2={padT + plotH}
            stroke="#141C2B"
            strokeWidth={1}
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + t * plotH;
          return (
            <line
              key={`hg-${t}`}
              x1={padL}
              y1={y}
              x2={padL + plotW}
              y2={y}
              stroke="#1E293B"
              strokeWidth={1}
            />
          );
        })}

        {/* 25° Suit Slope Safety Limit */}
        <line
          x1={padL}
          y1={limitY}
          x2={padL + plotW}
          y2={limitY}
          stroke="#F43F5E"
          strokeOpacity={0.65}
          strokeWidth={1.1}
          strokeDasharray="4 4"
        />
        <text
          x={padL + plotW + 5}
          y={limitY + 3}
          fill="#FB7185"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          25°
        </text>

        {/* Elevation Area & Curve */}
        {areaPath && <path d={areaPath} fill="url(#elevFillGrad)" />}
        {elevPath && (
          <path
            d={elevPath}
            fill="none"
            stroke={isEmergency ? '#F97316' : '#38BDF8'}
            strokeWidth={2.2}
          />
        )}

        {/* Slope Dashed Line */}
        {slopePath && (
          <path
            d={slopePath}
            fill="none"
            stroke="#FB923C"
            strokeOpacity={0.92}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}

        {/* Live Astronaut Progress Indicator */}
        {progressRatio > 0 && (
          <g>
            <line
              x1={progressX}
              y1={padT}
              x2={progressX}
              y2={padT + plotH}
              stroke="#22C55E"
              strokeWidth={2}
            />
            <circle cx={progressX} cy={padT + 5} r={3.5} fill="#22C55E" />
          </g>
        )}

        {/* Hover Crosshair */}
        {activePoint && route.distanceKm > 0 && (
          <line
            x1={padL + (activePoint.distanceKm / route.distanceKm) * plotW}
            y1={padT}
            x2={padL + (activePoint.distanceKm / route.distanceKm) * plotW}
            y2={padT + plotH}
            stroke="#E2E8F0"
            strokeOpacity={0.75}
            strokeWidth={1}
          />
        )}

        {/* Left Y-axis Labels (Elevation m) */}
        <text
          x={padL - 6}
          y={padT + 10}
          textAnchor="end"
          fill="#94A3B8"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          {maxElev}m
        </text>
        <text
          x={padL - 6}
          y={padT + plotH / 2 + 3}
          textAnchor="end"
          fill="#64748B"
          fontSize="9.5"
          fontFamily="JetBrains Mono, monospace"
        >
          {Math.round((minElev + maxElev) / 2)}m
        </text>
        <text
          x={padL - 6}
          y={padT + plotH}
          textAnchor="end"
          fill="#94A3B8"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          {minElev}m
        </text>

        {/* Right Y-axis Labels (Slope °) */}
        <text
          x={padL + plotW + 5}
          y={padT + 10}
          fill="#FDBA74"
          fontSize="9.5"
          fontFamily="JetBrains Mono, monospace"
        >
          40°
        </text>
        <text
          x={padL + plotW + 5}
          y={padT + plotH}
          fill="#FDBA74"
          fontSize="9.5"
          fontFamily="JetBrains Mono, monospace"
        >
          0°
        </text>

        {/* X-axis Labels (Distance km) */}
        <text
          x={padL}
          y={height - 8}
          fill="#64748B"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          0.0 km
        </text>
        <text
          x={padL + plotW / 2}
          y={height - 8}
          textAnchor="middle"
          fill="#64748B"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          {(route.distanceKm / 2).toFixed(2)} km
        </text>
        <text
          x={padL + plotW}
          y={height - 8}
          textAnchor="end"
          fill="#64748B"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          {route.distanceKm.toFixed(2)} km
        </text>
      </svg>
    </div>
  );
};
