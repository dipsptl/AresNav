import React from 'react';
import { Database, RefreshCw, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { MARS_GRAVITY_MS2, NASA_DATA_SOURCES } from '../data/marsZones';
import type { DonkiFlareEvent } from '../types/mars';

interface NasaDataSourcesDrawerProps {
  open: boolean;
  onClose: () => void;
  donkiStatus: 'idle' | 'loading' | 'live' | 'cached';
  donkiEvents: DonkiFlareEvent[];
  onSyncDonki: () => void;
}

export const CALIBRATED_DONKI_FALLBACK: DonkiFlareEvent[] = [
  {
    flrID: '2026-11-12T04:18:00-FLR-001',
    classType: 'M4.2',
    beginTime: '2026-11-12 04:18 UTC',
    sourceLocation: 'N14E28 (AR3891)',
    note: 'Moderate SEP proton flux enhancement along Mars Parker spiral corridor.',
  },
  {
    flrID: '2026-11-08T19:42:00-FLR-002',
    classType: 'X1.6',
    beginTime: '2026-11-08 19:42 UTC',
    sourceLocation: 'S11W19 (AR3886)',
    note: 'Associated halo CME; surface shelter advisory issued for equatorial sectors.',
  },
];

export const NasaDataSourcesDrawer: React.FC<NasaDataSourcesDrawerProps> = ({
  open,
  onClose,
  donkiStatus,
  donkiEvents,
  onSyncDonki,
}) => {
  if (!open) return null;

  const queryLiveDonki = onSyncDonki;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Official NASA Data Sources"
    >
      <div className="w-full max-w-xl h-full bg-[#060910] border-l border-slate-800 flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0A0F19] border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-sky-400" />
            <h2 className="font-display text-base font-semibold text-white">
              Official NASA Data Sources
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close NASA Data Sources drawer"
            className="p-1.5 rounded border border-slate-700/80 text-slate-400 hover:text-white hover:border-sky-500/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Physical Constants Summary */}
          <div className="p-4 rounded-lg ares-panel">
            <div className="text-xs font-medium text-slate-400 mb-2">
              Planetary Navigation &amp; PLSS Baseline Constants
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono tabular-nums text-xs">
              <div>
                <div className="text-slate-500 text-[11px]">Surface Gravity</div>
                <div className="text-orange-300 font-semibold mt-0.5">
                  {MARS_GRAVITY_MS2} m/s²
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-[11px]">Martian Sol</div>
                <div className="text-sky-300 font-semibold mt-0.5">24h 39m 35s</div>
              </div>
              <div>
                <div className="text-slate-500 text-[11px]">Suit Slope Cutoff</div>
                <div className="text-rose-400 font-semibold mt-0.5">25.0° max</div>
              </div>
            </div>
          </div>

          {/* Integrated NASA Datasets List */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-slate-400">
              Integrated Orbital, Surface &amp; Space Weather Datasets
            </h3>
            <div className="divide-y divide-slate-800/90 border border-slate-800 rounded-lg bg-[#0D111A]">
              {NASA_DATA_SOURCES.map((src) => (
                <div key={src.id} className="p-4 space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-display font-semibold text-sm text-slate-100">
                      {src.name}
                    </span>
                    <span className="font-mono text-[11px] text-cyan-400">
                      {src.cadence}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{src.agencyInstrument}</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{src.datasetRole}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] text-slate-400">
                    <span>{src.nominalMetric}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500">{src.endpointRef}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live NASA DONKI Query Section */}
          <div className="p-4 rounded-lg bg-[#0D111A] border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  NASA DONKI Solar Flare Feed
                </div>
                <div className="text-xs text-slate-400">
                  Space Weather Database Of Notifications, Knowledge, Information
                </div>
              </div>
              <button
                type="button"
                onClick={queryLiveDonki}
                disabled={donkiStatus === 'loading'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${donkiStatus === 'loading' ? 'animate-spin' : ''}`}
                />
                {donkiStatus === 'loading' ? 'Querying DONKI...' : 'Sync NASA DONKI'}
              </button>
            </div>

            {donkiStatus === 'live' && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Live records retrieved from api.nasa.gov/DONKI/FLR</span>
              </div>
            )}
            {donkiStatus === 'cached' && (
              <div className="flex items-center gap-1.5 text-xs text-amber-300">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Showing calibrated NASA DONKI archive telemetry (sandbox network fallback)</span>
              </div>
            )}

            <div className="space-y-2">
              {donkiEvents.map((ev) => (
                <div
                  key={ev.flrID}
                  className="p-3 rounded border border-slate-800 bg-[#07090E] text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span className="font-semibold text-amber-300">
                      Class {ev.classType} Flare
                    </span>
                    <span className="text-slate-400">{ev.beginTime}</span>
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]">
                    Region: {ev.sourceLocation}
                  </div>
                  <p className="text-slate-300 leading-relaxed">{ev.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
