import React from 'react';

interface HelmetVisorOverlayProps {
  active: boolean;
  elevationM: number;
  scoutStatusLabel: string;
  isHazardActive: boolean;
}

export const HelmetVisorOverlay: React.FC<HelmetVisorOverlayProps> = ({
  active,
  elevationM,
  scoutStatusLabel,
  isHazardActive,
}) => {
  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden select-none"
    >
      {/* Subtle Astronaut Gold-Blue Polarized Visor Tint & Peripheral Helmet Vignette */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          isHazardActive
            ? 'bg-[radial-gradient(ellipse_at_center,transparent_56%,rgba(245,158,11,0.10)_80%,rgba(2,6,23,0.82)_100%)]'
            : 'bg-[radial-gradient(ellipse_at_center,transparent_58%,rgba(56,189,248,0.08)_82%,rgba(2,6,23,0.78)_100%)]'
        }`}
      />

      {/* Curved xEMU Helmet Visor Rim Frame */}
      <div className="absolute inset-2 sm:inset-3.5 lg:inset-5 rounded-[38px] sm:rounded-[68px] lg:rounded-[92px] border border-sky-300/25 shadow-[inset_0_0_60px_rgba(2,6,23,0.88),inset_0_0_22px_rgba(56,189,248,0.14)]" />

      {/* Subtle Curved Visor HUD Alignment Arcs (Left & Right) */}
      <svg
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full opacity-45"
      >
        <path
          d="M 48 160 Q 22 300 48 440"
          fill="none"
          stroke="rgba(56, 189, 248, 0.42)"
          strokeWidth="1.2"
          strokeDasharray="6 6"
        />
        <path
          d="M 952 160 Q 978 300 952 440"
          fill="none"
          stroke="rgba(56, 189, 248, 0.42)"
          strokeWidth="1.2"
          strokeDasharray="6 6"
        />
        <path
          d="M 320 20 Q 500 8 680 20"
          fill="none"
          stroke="rgba(251, 191, 36, 0.32)"
          strokeWidth="1"
        />
      </svg>

      {/* Top-Left (Suit Pressure) & Top-Right (Heart Rate) Visor telemetry are anchored cleanly inside MarsMapCanvas corners */}

      {/* Bottom-Left Visor Corner Telemetry */}
      <div className="absolute bottom-4 left-5 sm:bottom-6 sm:left-10 px-2.5 py-1 rounded bg-[#030712]/70 border border-amber-400/25 backdrop-blur-xs font-mono tabular-nums text-[10px] sm:text-[11px] text-amber-200 leading-tight">
        <div>
          Helmet Visor Tint: <span className="text-emerald-300 font-semibold">Active</span>
        </div>
        <div className="text-slate-300/90 text-[9.5px] sm:text-[10px]">
          Au Polarized Shield · UV/IR Lock
        </div>
      </div>

      {/* Bottom-Right Visor Corner Telemetry */}
      <div className="absolute bottom-4 right-5 sm:bottom-6 sm:right-10 px-2.5 py-1 rounded bg-[#030712]/70 border border-sky-400/25 backdrop-blur-xs font-mono tabular-nums text-[10px] sm:text-[11px] text-slate-200 text-right leading-tight">
        <div>
          Scout Sync:{' '}
          <span
            className={
              scoutStatusLabel === 'SCOUT CLEAR'
                ? 'text-emerald-300 font-semibold'
                : 'text-amber-300 font-semibold'
            }
          >
            {scoutStatusLabel}
          </span>
        </div>
        <div className="text-slate-300/90 text-[9.5px] sm:text-[10px]">
          Terrain Elev: <span className="text-sky-300">{elevationM} m</span>
        </div>
      </div>
    </div>
  );
};
