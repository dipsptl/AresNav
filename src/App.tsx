import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  Bot,
  Clock,
  Compass,
  Database,
  Download,
  FlaskConical,
  MapPin,
  Mountain,
  Pause,
  Play,
  Radiation,
  Radio,
  RotateCcw,
  Route,
  SatelliteDish,
  ScanEye,
  ShieldCheck,
  Square,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { ElevationProfileChart } from './components/ElevationProfileChart';
import { HelmetVisorOverlay } from './components/HelmetVisorOverlay';
import { MarsMapCanvas } from './components/MarsMapCanvas';
import {
  CALIBRATED_DONKI_FALLBACK,
  NasaDataSourcesDrawer,
} from './components/NasaDataSourcesDrawer';
import { TransparentLogo } from './components/TransparentLogo';
import {
  LANDING_ZONE_LIST,
  LANDING_ZONES,
  MARS_GRAVITY_MS2,
  SUIT_STEEP_SLOPE_THRESHOLD_DEG,
} from './data/marsZones';
import type {
  DonkiFlareEvent,
  LandingZoneId,
  LayerId,
  MapClickMode,
  NormalizedCoord,
} from './types/mars';
import {
  type HazardAlertState,
  computeEmergencyShelterRoute,
  computeUHFCommLinkLOS,
  computeUhfShadowGrid,
  generateComparativeRoutes,
  interpolateAlongRoute,
  normToMarsLatLon,
  sampleCellAt,
} from './utils/pathfinding';
import {
  playKlaxonAlarm,
  playRadarPing,
  playTelemetryChirp,
} from './utils/missionAudio';

export default function App() {
  const [zoneId, setZoneId] = useState<LandingZoneId>('jezero');
  const zone = LANDING_ZONES[zoneId];

  const [activeLayers, setActiveLayers] = useState<Record<LayerId, boolean>>({
    topography: true,
    weather: false,
    radiation: true,
    science: true,
  });

  const [clickMode, setClickMode] = useState<MapClickMode>('set_target');
  const [startCoord, setStartCoord] = useState<NormalizedCoord>(zone.defaultStart);
  const [targetCoord, setTargetCoord] = useState<NormalizedCoord>(zone.defaultTarget);
  const [selectedStrategy, setSelectedStrategy] = useState<'safest' | 'fastest' | 'science'>(
    'safest'
  );

  // Simulation & Emergency Alert state
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState<10 | 60 | 120>(60);
  const [progressRatio, setProgressRatio] = useState(0);
  const [usedO2BeforeDivert, setUsedO2BeforeDivert] = useState(0);
  const [usedBatteryBeforeDivert, setUsedBatteryBeforeDivert] = useState(0);
  const [elapsedMinBeforeDivert, setElapsedMinBeforeDivert] = useState(0);
  const [distanceBeforeDivertKm, setDistanceBeforeDivertKm] = useState(0);

  const [hazardAlert, setHazardAlert] = useState<HazardAlertState | null>(null);
  const [emergencyOrigin, setEmergencyOrigin] = useState<NormalizedCoord | null>(null);
  const [dataDrawerOpen, setDataDrawerOpen] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [visorHudActive, setVisorHudActive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [demoActive, setDemoActive] = useState(false);
  const [demoElapsedMs, setDemoElapsedMs] = useState(0);
  const demoStartTimeRef = useRef<number>(0);
  const triggeredDemoStepRef = useRef<number>(0);

  // Shared live NASA DONKI space weather feed
  const [donkiStatus, setDonkiStatus] = useState<'idle' | 'loading' | 'live' | 'cached'>('idle');
  const [donkiEvents, setDonkiEvents] = useState<DonkiFlareEvent[]>(CALIBRATED_DONKI_FALLBACK);

  const queryLiveDonki = useCallback(async () => {
    setDonkiStatus('loading');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const end = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
      const res = await fetch(
        `https://api.nasa.gov/DONKI/FLR?startDate=${startDate}&endDate=${end}&api_key=DEMO_KEY`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('DONKI request returned non-200');
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const latest: DonkiFlareEvent[] = data.slice(-3).reverse().map((item) => ({
          flrID: String(item.flrID ?? 'FLR-LIVE'),
          classType: String(item.classType ?? 'C-Class'),
          beginTime: String(item.beginTime ?? '').replace('T', ' ').replace('Z', ' UTC'),
          sourceLocation: String(item.sourceLocation || 'Solar Disk'),
          note: String(item.note || 'Observed via NASA GOES/SDO space weather telemetry.'),
        }));
        setDonkiEvents(latest);
        setDonkiStatus('live');
      } else {
        setDonkiEvents(CALIBRATED_DONKI_FALLBACK);
        setDonkiStatus('cached');
      }
    } catch {
      clearTimeout(timeoutId);
      setDonkiEvents(CALIBRATED_DONKI_FALLBACK);
      setDonkiStatus('cached');
    }
  }, []);

  useEffect(() => {
    void queryLiveDonki();
  }, [queryLiveDonki]);

  const handleSelectZone = (nextId: LandingZoneId) => {
    playRadarPing(soundEnabled);
    const nextZone = LANDING_ZONES[nextId];
    setZoneId(nextId);
    setStartCoord(nextZone.defaultStart);
    setTargetCoord(nextZone.defaultTarget);
    setIsSimulating(false);
    setIsPaused(false);
    setProgressRatio(0);
    setHazardAlert(null);
    setEmergencyOrigin(null);
    setUsedO2BeforeDivert(0);
    setUsedBatteryBeforeDivert(0);
    setElapsedMinBeforeDivert(0);
    setDistanceBeforeDivertKm(0);
  };

  const comparativeRoutes = useMemo(
    () => generateComparativeRoutes(zone, startCoord, targetCoord, hazardAlert),
    [zone, startCoord, targetCoord, hazardAlert]
  );

  const emergencyRoute = useMemo(() => {
    if (!hazardAlert?.active) return null;
    const origin = emergencyOrigin ?? startCoord;
    return computeEmergencyShelterRoute(zone, origin, hazardAlert);
  }, [zone, hazardAlert, emergencyOrigin, startCoord]);

  const activeRoute =
    hazardAlert?.active && emergencyRoute
      ? emergencyRoute
      : comparativeRoutes[selectedStrategy];

  const uhfShadowGrid = useMemo(
    () => computeUhfShadowGrid(zone, startCoord),
    [zone, startCoord]
  );

  const commLinkStatus = useMemo(
    () => computeUHFCommLinkLOS(zone, startCoord, activeRoute, hazardAlert),
    [zone, startCoord, activeRoute, hazardAlert]
  );

  const interpolated = useMemo(
    () => interpolateAlongRoute(activeRoute, progressRatio),
    [activeRoute, progressRatio]
  );

  const liveCell = useMemo(
    () => sampleCellAt(zone, { x: interpolated.x, y: interpolated.y }, hazardAlert),
    [zone, interpolated.x, interpolated.y, hazardAlert]
  );

  const liveLatLon = useMemo(
    () => normToMarsLatLon(zone, { x: interpolated.x, y: interpolated.y }),
    [zone, interpolated.x, interpolated.y]
  );

  const currentElapsedMin =
    elapsedMinBeforeDivert + progressRatio * activeRoute.walkTimeMinutes;
  const currentDistanceKm = distanceBeforeDivertKm + interpolated.distanceKm;
  const currentRemainingKm = Math.max(0, activeRoute.distanceKm - interpolated.distanceKm);

  const currentO2ConsumedPct = Math.min(
    100,
    usedO2BeforeDivert + progressRatio * activeRoute.oxygenRequiredPct
  );
  const currentBatteryConsumedPct = Math.min(
    100,
    usedBatteryBeforeDivert + progressRatio * activeRoute.batteryDrainPct
  );

  const remainingO2Pct = Math.max(0, 100 - currentO2ConsumedPct);
  const remainingBatteryPct = Math.max(0, 100 - currentBatteryConsumedPct);

  const metabolicKcalHr = Math.round(
    245 +
      interpolated.slopeDeg * 8.5 +
      (liveCell.windSpeedMs > 12 ? 45 : 0) +
      (isSimulating && !isPaused ? 35 : 0)
  );

  // Autonomous Scout Rover companion 200m ahead along active route during mission traverse
  const scoutRoverState = useMemo(() => {
    const leadKm = 0.2; // 200 meters ahead
    const leadRatio = Math.min(0.22, leadKm / Math.max(0.25, activeRoute.distanceKm));
    const scoutProgress = Math.min(1, progressRatio + leadRatio);
    const scoutInterp = interpolateAlongRoute(activeRoute, scoutProgress);
    const scoutCell = sampleCellAt(zone, { x: scoutInterp.x, y: scoutInterp.y }, hazardAlert);
    const active = isSimulating || (progressRatio > 0 && progressRatio < 1);
    const isClear =
      scoutCell.slopeDeg <= SUIT_STEEP_SLOPE_THRESHOLD_DEG &&
      scoutCell.radiationMsVPerHr <= 0.45 &&
      scoutCell.windSpeedMs <= 16;

    return {
      active,
      x: scoutInterp.x,
      y: scoutInterp.y,
      headingRad: scoutInterp.headingRad,
      slopeDeg: scoutCell.slopeDeg,
      radiationMsVPerHr: scoutCell.radiationMsVPerHr,
      isClear,
      statusLabel: isClear ? 'SCOUT CLEAR' : 'HAZARD DETECTED',
    };
  }, [activeRoute, progressRatio, zone, hazardAlert, isSimulating]);

  const heartRateBpm = Math.round(
    84 +
      (isSimulating && !isPaused ? 10 : 0) +
      (isSimulating ? Math.min(20, interpolated.slopeDeg * 0.65) : 0) +
      (hazardAlert?.active ? 14 : 0)
  );

  const lastFrameRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isSimulating || isPaused) {
      lastFrameRef.current = null;
      return;
    }

    let rafId = 0;
    const tick = (now: number) => {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = now;
      }
      const dtSec = Math.min(0.1, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      const totalSimSec = Math.max(120, activeRoute.walkTimeMinutes * 60);
      const deltaProgress = (dtSec * simSpeedMultiplier) / totalSimSec;

      setProgressRatio((prev) => {
        const next = prev + deltaProgress;
        if (next >= 1) {
          setIsSimulating(false);
          setIsPaused(false);
          return 1;
        }
        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isSimulating, isPaused, simSpeedMultiplier, activeRoute.walkTimeMinutes]);

  const toggleLayer = (id: LayerId) => {
    playTelemetryChirp(soundEnabled);
    setActiveLayers((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const resetSimulation = (silent = false) => {
    if (!silent) {
      playTelemetryChirp(soundEnabled);
    }
    setIsSimulating(false);
    setIsPaused(false);
    setProgressRatio(0);
    setHazardAlert(null);
    setEmergencyOrigin(null);
    setUsedO2BeforeDivert(0);
    setUsedBatteryBeforeDivert(0);
    setElapsedMinBeforeDivert(0);
    setDistanceBeforeDivertKm(0);
  };

  const handleMapClick = (coord: NormalizedCoord) => {
    if (clickMode === 'set_start') {
      playRadarPing(soundEnabled);
      setStartCoord(coord);
      resetSimulation(true);
    } else if (clickMode === 'set_target') {
      playRadarPing(soundEnabled);
      setTargetCoord(coord);
      resetSimulation(true);
    }
  };

  const handleSelectTargetFromPoi = (coord: NormalizedCoord) => {
    playRadarPing(soundEnabled);
    setTargetCoord(coord);
    resetSimulation(true);
  };

  const handleStartOrToggleSimulation = () => {
    playTelemetryChirp(soundEnabled);
    if (!isSimulating) {
      if (progressRatio >= 1) {
        setProgressRatio(0);
        setUsedO2BeforeDivert(0);
        setUsedBatteryBeforeDivert(0);
        setElapsedMinBeforeDivert(0);
        setDistanceBeforeDivertKm(0);
      }
      setIsSimulating(true);
      setIsPaused(false);
    } else {
      setIsPaused((p) => !p);
    }
  };

  const triggerSolarStormFresh = useCallback(() => {
    playKlaxonAlarm(soundEnabled);
    const plannedPts = comparativeRoutes[selectedStrategy].points;
    const aheadRatio = Math.min(0.85, Math.max(0.45, progressRatio + 0.25));
    const aheadIdx = Math.min(
      plannedPts.length - 1,
      Math.floor(aheadRatio * (plannedPts.length - 1))
    );
    const stormPt = plannedPts[aheadIdx] ?? targetCoord;

    const currentPos = { x: interpolated.x, y: interpolated.y };
    setUsedO2BeforeDivert(currentO2ConsumedPct);
    setUsedBatteryBeforeDivert(currentBatteryConsumedPct);
    setElapsedMinBeforeDivert(currentElapsedMin);
    setDistanceBeforeDivertKm(currentDistanceKm);
    setEmergencyOrigin(currentPos);
    setProgressRatio(0);

    setActiveLayers((prev) => ({
      ...prev,
      radiation: true,
      weather: true,
    }));

    setHazardAlert({
      active: true,
      flareClass: 'X2.4',
      stormCenter: { x: stormPt.x, y: stormPt.y },
      stormRadius: 0.19,
      peakDoseMsVPerHr: 3.85,
      windSurgeMs: 14.5,
      issuedAtSolTime: 'Sol 142 · 14:22 LMST',
    });
  }, [
    soundEnabled,
    comparativeRoutes,
    selectedStrategy,
    progressRatio,
    targetCoord,
    interpolated.x,
    interpolated.y,
    currentO2ConsumedPct,
    currentBatteryConsumedPct,
    currentElapsedMin,
    currentDistanceKm,
  ]);

  const handleTriggerSolarStorm = () => {
    if (hazardAlert?.active) {
      resetSimulation(false);
      return;
    }
    triggerSolarStormFresh();
  };

  const stopJudgeDemo = useCallback(
    (playCue = true) => {
      if (playCue) {
        playTelemetryChirp(soundEnabled);
      }
      setDemoActive(false);
      setDemoElapsedMs(0);
      triggeredDemoStepRef.current = 0;
    },
    [soundEnabled]
  );

  const startJudgeDemo = () => {
    if (demoActive) {
      stopJudgeDemo(true);
      return;
    }
    playTelemetryChirp(soundEnabled);
    setHazardAlert(null);
    setEmergencyOrigin(null);
    setIsSimulating(false);
    setIsPaused(false);
    setProgressRatio(0);
    setUsedO2BeforeDivert(0);
    setUsedBatteryBeforeDivert(0);
    setElapsedMinBeforeDivert(0);
    setDistanceBeforeDivertKm(0);
    setVisorHudActive(false);
    setActiveLayers((prev) => ({
      ...prev,
      topography: false,
      radiation: false,
    }));

    demoStartTimeRef.current = Date.now();
    triggeredDemoStepRef.current = 0;
    setDemoElapsedMs(0);
    setDemoActive(true);
  };

  const demoStep: 1 | 2 | 3 | null = !demoActive
    ? null
    : demoElapsedMs < 4000
    ? 1
    : demoElapsedMs < 8000
    ? 2
    : 3;

  useEffect(() => {
    if (!demoActive) return;

    const timerId = window.setInterval(() => {
      const elapsed = Date.now() - demoStartTimeRef.current;
      if (elapsed >= 12000) {
        setDemoActive(false);
        setDemoElapsedMs(0);
        triggeredDemoStepRef.current = 0;
        return;
      }
      setDemoElapsedMs(elapsed);
    }, 100);

    return () => window.clearInterval(timerId);
  }, [demoActive]);

  const latestStormTriggerRef = useRef(triggerSolarStormFresh);
  latestStormTriggerRef.current = triggerSolarStormFresh;

  useEffect(() => {
    if (!demoActive || demoStep === null) return;

    if (demoStep === 1 && demoElapsedMs >= 300 && triggeredDemoStepRef.current < 1) {
      triggeredDemoStepRef.current = 1;
      playTelemetryChirp(soundEnabled);
      setActiveLayers((prev) => ({
        ...prev,
        topography: true,
        radiation: true,
      }));
    } else if (demoStep === 2 && triggeredDemoStepRef.current < 2) {
      triggeredDemoStepRef.current = 2;
      playTelemetryChirp(soundEnabled);
      setSelectedStrategy('safest');
      setProgressRatio(0.06);
      setIsSimulating(true);
      setIsPaused(false);
    } else if (demoStep === 3 && triggeredDemoStepRef.current < 3) {
      triggeredDemoStepRef.current = 3;
      setVisorHudActive(true);
      latestStormTriggerRef.current();
    }
  }, [demoActive, demoStep, demoElapsedMs, soundEnabled]);

  const arrivedAtShelter = Boolean(hazardAlert?.active && progressRatio >= 0.999);
  const arrivedAtDestination = Boolean(!hazardAlert?.active && progressRatio >= 0.999);

  const handleExportEvaPlan = () => {
    const startLatLon = normToMarsLatLon(zone, startCoord);
    const targetLatLon = normToMarsLatLon(zone, targetCoord);

    const payload = {
      schemaVersion: '1.0',
      missionControl: 'AresNav: Marswalk Mission Planner',
      exportedAtUtc: new Date().toISOString(),
      sector: {
        id: zone.id,
        name: zone.name,
        regionSubtitle: zone.regionSubtitle,
        missionReference: zone.missionReference,
        centerLat: zone.centerLat,
        centerLon: zone.centerLon,
        datumElevationM: zone.datumElevationM,
        ambientTempC: zone.ambientTempC,
        pressurePa: zone.pressurePa,
        gravityMs2: MARS_GRAVITY_MS2,
      },
      coordinates: {
        startBase: {
          normalized: startCoord,
          lat: Number(startLatLon.lat.toFixed(5)),
          lon: Number(startLatLon.lon.toFixed(5)),
          formatted: `${startLatLon.latFormatted}, ${startLatLon.lonFormatted}`,
        },
        targetWaypoint: {
          normalized: targetCoord,
          lat: Number(targetLatLon.lat.toFixed(5)),
          lon: Number(targetLatLon.lon.toFixed(5)),
          formatted: `${targetLatLon.latFormatted}, ${targetLatLon.lonFormatted}`,
        },
        eva1CurrentPosition: {
          normalized: { x: Number(interpolated.x.toFixed(4)), y: Number(interpolated.y.toFixed(4)) },
          lat: Number(liveLatLon.lat.toFixed(5)),
          lon: Number(liveLatLon.lon.toFixed(5)),
          elevationM: interpolated.elevationM,
          slopeDeg: interpolated.slopeDeg,
        },
        routeWaypoints: activeRoute.points.map((pt, idx) => {
          const coords = normToMarsLatLon(zone, pt);
          return {
            seq: idx + 1,
            distanceKm: pt.distanceKm,
            lat: Number(coords.lat.toFixed(5)),
            lon: Number(coords.lon.toFixed(5)),
            elevationM: pt.elevationM,
            slopeDeg: pt.slopeDeg,
            radiationMsVPerHr: pt.radiationMsVPerHr,
            windSpeedMs: pt.windSpeedMs,
          };
        }),
      },
      chosenRoute: {
        strategy: activeRoute.strategy,
        label: activeRoute.label,
        subtitle: activeRoute.subtitle,
        distanceKm: activeRoute.distanceKm,
        walkTimeMinutes: activeRoute.walkTimeMinutes,
        oxygenRequiredPct: activeRoute.oxygenRequiredPct,
        batteryDrainPct: activeRoute.batteryDrainPct,
        peakSlopeDeg: activeRoute.peakSlopeDeg,
        avgSlopeDeg: activeRoute.avgSlopeDeg,
        cumulativeDoseMsV: activeRoute.cumulativeDoseMsV,
        steepSegmentsCount: activeRoute.steepSegmentsCount,
        emergencyDetourActive: Boolean(hazardAlert?.active),
        targetShelter: activeRoute.targetShelter?.name ?? null,
        scienceTargetsVisited: activeRoute.scienceTargetsVisited.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          instrument: t.instrument,
        })),
      },
      uhfCommLinkLOS: commLinkStatus,
      communicationsLatency: {
        earthOneWayDelay: '14m 18s',
        earthRoundTripDelay: '28m 36s',
        autonomousAiMode: 'ACTIVE',
      },
      spaceWeatherDONKI: {
        feedStatus: donkiStatus,
        activeSolarStormAlert: hazardAlert?.active
          ? {
              flareClass: hazardAlert.flareClass,
              issuedAtSolTime: hazardAlert.issuedAtSolTime,
              peakDoseMsVPerHr: hazardAlert.peakDoseMsVPerHr,
              windSurgeMs: hazardAlert.windSurgeMs,
              stormCenter: hazardAlert.stormCenter,
            }
          : null,
        recentFlareEvents: donkiEvents,
      },
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aresnav-eva-plan-${zone.id}-${activeRoute.strategy}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExportConfirmed(true);
    playTelemetryChirp(soundEnabled);
    setTimeout(() => setExportConfirmed(false), 2400);
  };

  return (
    <div className="relative min-h-screen flex flex-col text-slate-100 overflow-x-hidden">
      {/* Full-Viewport Cosmic Mars & Earth Backdrop (Scaled to Fit Full Image) */}
      <div className="fixed inset-0 z-0 pointer-events-none select-none bg-[#04060B]">
        {!bgFailed ? (
          <img
            src="/assets/aistudio/Untitled_Design__5__e74bfd91.png"
            alt="Mars and Earth orbital view with sun corona and starfield"
            referrerPolicy="no-referrer"
            onError={() => setBgFailed(true)}
            className="w-full h-full object-fill brightness-[0.95] contrast-[1.03]"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#140907] via-[#070B14] to-[#04060B]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-[#04060B]/22 to-[#04060B]/50" />
      </div>

      {/* Top Navigation Bar: Mobile (<768px 2-Row), Tablet (768-1023px Full Single Row), Desktop (1024px+) */}
      <header className="relative z-20 min-h-[68px] lg:min-h-[82px] px-3 sm:px-4 py-2 bg-transparent flex flex-wrap md:flex-nowrap items-center justify-between lg:justify-start gap-2.5 md:gap-2 lg:gap-4 xl:gap-7 shrink-0">
        {/* Left Zone: Landing Zone Navigation Links */}
        <nav
          aria-label="Mars landing zones"
          className="order-2 md:order-1 w-full md:w-auto flex items-center justify-between md:justify-start gap-2 md:gap-2 lg:gap-3.5 xl:gap-4 px-2.5 md:px-2.5 lg:px-3.5 py-1 lg:py-1.5 rounded-lg bg-[#050811]/78 backdrop-blur-md border border-sky-400/25 overflow-x-auto shrink-0"
        >
          {LANDING_ZONE_LIST.map((z) => {
            const active = z.id === zoneId;
            return (
              <button
                key={z.id}
                type="button"
                onClick={() => handleSelectZone(z.id)}
                className={`py-0.5 lg:py-1 text-[11px] md:text-[11px] lg:text-[13px] xl:text-sm font-display font-semibold tracking-wide border-b-2 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-orange-400 ares-text-solar'
                    : 'border-transparent text-slate-200 hover:text-sky-300'
                }`}
              >
                {z.name}
              </button>
            );
          })}
        </nav>

        {/* Left-Center Zone: Glossy Black Glass Glow NASA Data Sources Button */}
        <div className="order-1 md:order-2 flex items-center justify-center shrink-0">
          <button
            type="button"
            onClick={() => setDataDrawerOpen(true)}
            className="flex items-center gap-1.5 lg:gap-2 px-2.5 md:px-2.5 lg:px-4 py-1 lg:py-1.5 rounded-lg backdrop-blur-md bg-gradient-to-b from-white/15 via-black/80 to-black/95 hover:from-white/25 hover:via-neutral-900/85 hover:to-black border border-white/25 border-t-white/60 border-b-black shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),inset_0_-2px_6px_rgba(255,255,255,0.08),0_3px_0_#000000,0_0_18px_rgba(148,163,184,0.35),0_8px_20px_rgba(0,0,0,0.9)] hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.55),inset_0_-2px_8px_rgba(255,255,255,0.14),0_3px_0_#000000,0_0_24px_rgba(226,232,240,0.48),0_10px_24px_rgba(0,0,0,0.95)] active:translate-y-[2px] active:shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_1px_0_#000000,0_0_14px_rgba(148,163,184,0.3)] text-[12px] md:text-[11.5px] lg:text-[14px] xl:text-[15px] font-display font-bold tracking-wide transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Database className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-orange-400 [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.95))]" />
            <span className="ares-text-solar [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.98))_drop-shadow(0_0_1px_rgba(0,0,0,1))]">
              NASA Data Sources
            </span>
          </button>
        </div>

        {/* Desktop-Only Header Demo Trigger (Mobile/Tablet Demo sits cleanly above SFX) */}
        <div className="hidden lg:flex lg:order-4 lg:ml-auto items-center shrink-0">
          <button
            type="button"
            onClick={startJudgeDemo}
            aria-pressed={demoActive}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border font-display text-sm font-bold tracking-wide transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              demoActive
                ? 'bg-rose-950/85 hover:bg-rose-900/90 border-rose-400/75 text-rose-200 shadow-[0_0_16px_rgba(244,63,94,0.35)]'
                : 'bg-[#071021]/85 hover:bg-sky-950/80 border-sky-400/50 hover:border-sky-300/85 text-sky-200 hover:text-white shadow-[0_0_16px_rgba(56,189,248,0.28)]'
            }`}
          >
            {demoActive ? (
              <>
                <Square className="w-3 h-3 fill-current text-rose-300 shrink-0" />
                <span>Stop Demo</span>
              </>
            ) : (
              <span>▶ Demo</span>
            )}
          </button>
        </div>

        {/* Right Zone: Logo Seated Inside Earth with Clean Dark Contrast Backdrop */}
        <div className="order-1 md:order-3 lg:absolute lg:left-[75%] lg:-translate-x-1/2 lg:top-1.5 flex items-center justify-center ml-auto md:ml-0 lg:ml-auto shrink-0">
          <a
            href="#top"
            onClick={(e) => e.preventDefault()}
            className="relative flex items-center shrink-0 px-1.5 lg:px-3 py-0 bg-transparent border-0 shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded"
            aria-label="AresNav: Marswalk Mission Planner"
          >
            {/* Feathered dark contrast halo so logo reads clearly over Earth */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-3 lg:-inset-x-4 -inset-y-1.5 lg:-inset-y-2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.48)_52%,transparent_78%)]"
            />
            <TransparentLogo
              src="/assets/aistudio/AresNav_Marswalk_Mission_Planner_Logo_d7ab8fda.png"
              alt="AresNav Marswalk Mission Planner"
              className="relative z-10 h-[38px] md:h-[36px] lg:h-[52px] xl:h-[56px] w-auto object-contain select-none brightness-110 contrast-115 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,1))_drop-shadow(0_0_6px_rgba(0,0,0,0.95))]"
            />
          </a>
        </div>
      </header>

      {/* Main Asymmetric Mission Control Workspace */}
      <main className="relative z-10 flex-1 flex flex-col lg:flex-row gap-2.5 md:gap-4 px-2.5 md:px-4 pb-3 md:pb-4 pt-0.5 md:pt-1 max-w-[1740px] w-full mx-auto min-h-0">
        {/* Left Control & Planning Sidebar (Compact on Mobile, Standard 330px on Desktop) */}
        <aside className="w-full lg:w-[330px] shrink-0 flex flex-col gap-2 md:gap-3">
          {/* Row 1: Earth Delay Pill + Mobile/Tablet Demo Button directly above SFX */}
          <div className="grid grid-cols-[1fr_auto] lg:grid-cols-1 gap-1.5 md:gap-2 items-center">
            <div className="flex items-center justify-center gap-1.5 md:gap-2 px-2 sm:px-2.5 md:px-3 py-1 md:py-1.5 rounded-full ares-panel border border-sky-400/35 font-mono tabular-nums text-[9.5px] sm:text-[10px] md:text-[11px] font-semibold tracking-tight whitespace-nowrap">
              <SatelliteDish className="w-3 h-3 md:w-3.5 md:h-3.5 text-sky-400 shrink-0" />
              <span className="text-slate-200">
                EARTH DELAY: <span className="text-orange-300">14m 18s</span>
                <span className="text-slate-500 mx-1 sm:mx-1.5" aria-hidden="true">•</span>
                <span className="text-emerald-300">AUTONOMOUS AI</span>
              </span>
            </div>

            <button
              type="button"
              onClick={startJudgeDemo}
              aria-pressed={demoActive}
              className={`lg:hidden flex items-center justify-center gap-1 min-w-[80px] px-2.5 py-1 md:py-1.5 rounded-md border font-display text-[11px] md:text-xs font-bold tracking-wide transition-all whitespace-nowrap cursor-pointer ${
                demoActive
                  ? 'bg-rose-950/85 hover:bg-rose-900/90 border-rose-400/75 text-rose-200 shadow-[0_0_14px_rgba(244,63,94,0.35)]'
                  : 'bg-[#071021]/85 hover:bg-sky-950/80 border-sky-400/50 hover:border-sky-300/85 text-sky-200 hover:text-white shadow-[0_0_14px_rgba(56,189,248,0.24)]'
              }`}
            >
              {demoActive ? (
                <>
                  <Square className="w-2.5 h-2.5 fill-current text-rose-300 shrink-0" />
                  <span>Stop</span>
                </>
              ) : (
                <span>▶ Demo</span>
              )}
            </button>
          </div>

          {/* Row 2: Visor HUD & Mission Control Audio Toggles */}
          <div className="grid grid-cols-[1fr_auto] gap-1.5 md:gap-2">
            <button
              type="button"
              onClick={() => {
                playTelemetryChirp(soundEnabled);
                setVisorHudActive((v) => !v);
              }}
              aria-pressed={visorHudActive}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border font-display text-[11px] md:text-xs font-bold tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                visorHudActive
                  ? 'bg-gradient-to-r from-sky-500/30 to-cyan-500/20 border-sky-400/70 text-sky-200 shadow-[0_0_16px_rgba(56,189,248,0.28)]'
                  : 'ares-panel border-slate-700/80 text-slate-300 hover:text-white hover:border-sky-400/50'
              }`}
            >
              <ScanEye className={`w-3.5 h-3.5 ${visorHudActive ? 'text-sky-300' : 'text-sky-400'}`} />
              VISOR HUD
              <span
                className={`ml-0.5 font-mono text-[10px] ${
                  visorHudActive ? 'text-emerald-300' : 'text-slate-500'
                }`}
              >
                {visorHudActive ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) playTelemetryChirp(true);
              }}
              aria-pressed={soundEnabled}
              aria-label={soundEnabled ? 'Mute Mission Control Sound Effects' : 'Enable Mission Control Sound Effects'}
              title={soundEnabled ? 'Mission Control Audio: ON' : 'Mission Control Audio: MUTED'}
              className={`flex items-center justify-center gap-1.5 min-w-[80px] lg:min-w-0 px-3 py-1.5 rounded-md border font-mono text-[10.5px] md:text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                soundEnabled
                  ? 'ares-panel border-emerald-400/45 text-emerald-300 hover:border-emerald-400/80'
                  : 'ares-panel border-slate-700/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              {soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
              <span>{soundEnabled ? 'SFX' : 'MUTE'}</span>
            </button>
          </div>

          {/* Landing Sector Telemetry & Click-Mode Control */}
          <section className="p-2.5 md:p-4 rounded-lg ares-panel space-y-2 md:space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h1 className="font-display text-sm md:text-base font-bold tracking-wide">
                <span className="ares-text-metallic">SECTOR </span>
                <span className="ares-text-solar">BASELINE</span>
              </h1>
              <span className="font-mono tabular-nums text-[10px] md:text-[11px] font-semibold text-emerald-400">
                g = {MARS_GRAVITY_MS2.toFixed(2)} m/s²
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1.5 md:pt-2 text-[11px] md:text-xs font-mono tabular-nums border-t border-slate-700/60">
              <div>
                <div className="text-[10px] md:text-[11px] font-sans text-slate-400">Datum Elev</div>
                <div className="text-sky-300 font-semibold mt-0.5">
                  {zone.datumElevationM} m
                </div>
              </div>
              <div>
                <div className="text-[10px] md:text-[11px] font-sans text-slate-400">Surface Temp</div>
                <div className="text-orange-300 font-semibold mt-0.5">
                  {zone.ambientTempC} °C
                </div>
              </div>
              <div>
                <div className="text-[10px] md:text-[11px] font-sans text-slate-400">Pressure</div>
                <div className="text-emerald-300 font-semibold mt-0.5">
                  {zone.pressurePa} Pa
                </div>
              </div>
            </div>

            {/* Map Placement Mode Segmented Control */}
            <div className="pt-0.5 md:pt-1">
              <div className="text-[10px] md:text-[11px] text-slate-300 font-medium mb-1 md:mb-1.5">
                Map Click Assignment
              </div>
              <div className="grid grid-cols-3 gap-1 md:gap-1.5 p-0.5 md:p-1 rounded-md bg-[#04060B]/85 border border-slate-700/70">
                {(
                  [
                    {
                      id: 'set_start',
                      label: 'Start Base',
                      activeClass:
                        'bg-gradient-to-b from-sky-500/30 to-sky-600/20 text-sky-200 border border-sky-400/60 shadow-[0_0_12px_rgba(56,189,248,0.22)]',
                    },
                    {
                      id: 'set_target',
                      label: 'Waypoint',
                      activeClass:
                        'bg-gradient-to-b from-orange-500/30 to-orange-600/20 text-orange-200 border border-orange-400/60 shadow-[0_0_12px_rgba(249,115,22,0.22)]',
                    },
                    {
                      id: 'inspect',
                      label: 'Inspect',
                      activeClass:
                        'bg-gradient-to-b from-emerald-500/25 to-emerald-600/15 text-emerald-200 border border-emerald-400/55 shadow-[0_0_12px_rgba(34,197,94,0.2)]',
                    },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setClickMode(mode.id)}
                    className={`py-1 md:py-1.5 px-1.5 md:px-2 rounded text-[11px] md:text-xs font-display font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      clickMode === mode.id
                        ? mode.activeClass
                        : 'text-slate-400 hover:text-slate-100 border border-transparent'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 4 Toggleable NASA Multi-Mission Data Layers */}
          <section
            className={`p-2.5 md:p-4 rounded-lg ares-panel space-y-1.5 md:space-y-2.5 transition-all ${
              demoStep === 1
                ? 'ring-2 ring-sky-400/80 shadow-[0_0_24px_rgba(56,189,248,0.3)]'
                : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xs md:text-sm font-bold tracking-wide">
                <span className="ares-text-metallic">NASA MISSION </span>
                <span className="ares-text-solar">LAYERS</span>
              </h2>
              <span className="font-mono tabular-nums text-[10px] md:text-[11px] font-semibold text-emerald-400">
                {Object.values(activeLayers).filter(Boolean).length}/4 active
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-1 gap-1.5 md:gap-0 md:space-y-1.5">
              {(
                [
                  {
                    id: 'topography',
                    title: 'Topography & Slope',
                    source: 'MRO HiRISE · >25° hazard mask',
                    icon: Mountain,
                    iconColor: 'text-rose-400',
                    switchTrack: 'bg-gradient-to-r from-rose-500 to-orange-500',
                    activeBorder: 'border-rose-400/45 bg-[#151221]/85',
                  },
                  {
                    id: 'weather',
                    title: 'Weather & Dust',
                    source: 'InSight / MARCI · Wind & storm front',
                    icon: Wind,
                    iconColor: 'text-orange-400',
                    switchTrack: 'bg-gradient-to-r from-amber-400 to-orange-500',
                    activeBorder: 'border-orange-400/45 bg-[#16131D]/85',
                  },
                  {
                    id: 'radiation',
                    title: 'Radiation & Solar',
                    source: 'DONKI / RAD · Dose & shelters',
                    icon: Radiation,
                    iconColor: 'text-emerald-400',
                    switchTrack: 'bg-gradient-to-r from-emerald-400 to-green-500',
                    activeBorder: 'border-emerald-400/45 bg-[#0C1A1D]/85',
                  },
                  {
                    id: 'science',
                    title: 'Science & Ice Targets',
                    source: 'Perseverance · Core & H₂O sites',
                    icon: FlaskConical,
                    iconColor: 'text-sky-400',
                    switchTrack: 'bg-gradient-to-r from-sky-400 to-blue-500',
                    activeBorder: 'border-sky-400/45 bg-[#0C1729]/85',
                  },
                ] as const
              ).map((layer) => {
                const Icon = layer.icon;
                const enabled = activeLayers[layer.id];
                return (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => toggleLayer(layer.id)}
                    aria-pressed={enabled}
                    className={`w-full flex items-center justify-between gap-2 md:gap-3 px-2 py-1.5 md:px-3 md:py-2 rounded-md border text-left transition-all cursor-pointer ${
                      enabled
                        ? `${layer.activeBorder} text-white`
                        : 'bg-[#05080F]/70 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 md:gap-2.5 min-w-0">
                      <Icon
                        className={`w-3.5 h-3.5 md:w-4 md:h-4 shrink-0 ${
                          enabled ? layer.iconColor : 'text-slate-500'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-[11px] md:text-xs font-semibold truncate">{layer.title}</div>
                        <div className="hidden md:block text-[11px] text-slate-400 truncate">
                          {layer.source}
                        </div>
                      </div>
                    </div>

                    <span
                      aria-hidden="true"
                      className={`relative inline-flex h-3.5 w-6 md:h-4 md:w-7 shrink-0 items-center rounded-full transition-colors ${
                        enabled ? layer.switchTrack : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-2.5 w-2.5 md:h-3 md:w-3 rounded-full bg-white shadow transition-transform ${
                          enabled ? 'translate-x-3 md:translate-x-3.5' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Comparative Route Planner & Life-Support Calculator */}
          <section className="p-2.5 md:p-4 rounded-lg ares-panel space-y-1.5 md:space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 md:gap-2">
                <Route className="w-3.5 h-3.5 md:w-4 md:h-4 text-sky-400" />
                <h2 className="font-display text-xs md:text-sm font-bold tracking-wide">
                  <span className="ares-text-metallic">ROUTE </span>
                  <span className="ares-text-solar">PLANNER</span>
                </h2>
              </div>
              <span className="font-mono text-[10px] md:text-[11px] text-emerald-400 font-semibold">
                xEMU PLSS
              </span>
            </div>

            <div className="space-y-1.5 md:space-y-2">
              {(['safest', 'fastest', 'science'] as const).map((key) => {
                const route = comparativeRoutes[key];
                const isSelected = selectedStrategy === key && !hazardAlert?.active;
                const meta =
                  key === 'safest'
                    ? {
                        titleColor: 'text-emerald-300',
                        lineBg: 'bg-gradient-to-r from-emerald-400 to-green-500',
                        selectedClass:
                          'bg-[#0B1C1E]/90 border-emerald-400/75 shadow-[0_0_18px_rgba(16,185,129,0.18)]',
                      }
                    : key === 'fastest'
                    ? {
                        titleColor: 'text-sky-300',
                        lineBg: 'bg-gradient-to-r from-sky-400 to-blue-500',
                        selectedClass:
                          'bg-[#0C192C]/90 border-sky-400/75 shadow-[0_0_18px_rgba(56,189,248,0.18)]',
                      }
                    : {
                        titleColor: 'text-orange-300',
                        lineBg: 'bg-gradient-to-r from-amber-400 to-orange-500',
                        selectedClass:
                          'bg-[#1B141D]/90 border-orange-400/75 shadow-[0_0_18px_rgba(249,115,22,0.18)]',
                      };

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedStrategy(key);
                      if (!hazardAlert?.active) {
                        setProgressRatio(0);
                        setIsSimulating(false);
                        setIsPaused(false);
                      }
                    }}
                    className={`w-full p-2 md:p-3 rounded-md border text-left transition-all cursor-pointer ${
                      isSelected
                        ? meta.selectedClass
                        : 'bg-[#05080F]/75 border-slate-800/85 hover:border-slate-600'
                    } ${
                      demoStep === 2 && key === 'safest'
                        ? 'ring-2 ring-emerald-400/85 shadow-[0_0_24px_rgba(52,211,153,0.35)]'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`flex items-center gap-1.5 md:gap-2 text-[11px] md:text-xs font-display font-bold tracking-wide ${meta.titleColor}`}
                      >
                        <span className={`inline-block w-2.5 md:w-3 h-1 rounded-full ${meta.lineBg}`} />
                        {route.label}
                      </span>
                      <span className="font-mono tabular-nums text-[11px] md:text-xs text-white font-semibold">
                        {route.distanceKm.toFixed(2)} km
                      </span>
                    </div>
                    <div className="hidden md:block text-[11px] text-slate-300/85 mt-0.5 mb-2">
                      {route.subtitle}
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 pt-1.5 md:pt-2 mt-1 md:mt-0 border-t border-slate-700/60 font-mono tabular-nums text-[10px] md:text-[11px]">
                      <div>
                        <div className="text-slate-400 text-[9px] md:text-[10px]">Time</div>
                        <div className="text-white font-medium">{route.walkTimeMinutes}m</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[9px] md:text-[10px]">O₂ Req</div>
                        <div
                          className={
                            route.oxygenRequiredPct > 75
                              ? 'text-orange-300 font-semibold'
                              : 'text-emerald-300 font-semibold'
                          }
                        >
                          {route.oxygenRequiredPct.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[9px] md:text-[10px]">Battery</div>
                        <div className="text-sky-300 font-semibold">
                          {route.batteryDrainPct.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[9px] md:text-[10px]">Max Slope</div>
                        <div
                          className={
                            route.peakSlopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG
                              ? 'text-rose-400 font-semibold'
                              : 'text-emerald-300 font-semibold'
                          }
                        >
                          {route.peakSlopeDeg.toFixed(1)}°
                        </div>
                      </div>
                    </div>

                    <div className="mt-1.5 md:mt-2 h-1 w-full rounded-full bg-slate-800/90 overflow-hidden">
                      <div
                        className={`h-full ${meta.lineBg}`}
                        style={{ width: `${Math.min(100, route.oxygenRequiredPct)}%` }}
                      />
                    </div>

                    {key === 'science' && route.scienceTargetsVisited.length > 0 && (
                      <div className="mt-1 md:mt-1.5 text-[10px] md:text-[11px] text-orange-300 font-mono">
                        Intercepts {route.scienceTargetsVisited.length} science/ice target
                        {route.scienceTargetsVisited.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Live Marswalk Simulation & Emergency Solar Storm Controls */}
          <section className="p-2.5 md:p-4 rounded-lg ares-panel space-y-2 md:space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xs md:text-sm font-bold tracking-wide">
                <span className="ares-text-metallic">EVA </span>
                <span className="ares-text-solar">EXECUTION</span>
              </h2>
              <div className="flex items-center gap-1 font-mono text-[11px]">
                {([10, 60, 120] as const).map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setSimSpeedMultiplier(spd)}
                    className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                      simSpeedMultiplier === spd
                        ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {spd}×
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleStartOrToggleSimulation}
                className="flex-1 flex items-center justify-center gap-2 py-2 md:py-2.5 px-3 md:px-4 rounded-md bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 hover:from-sky-400 hover:via-cyan-400 hover:to-blue-500 border border-sky-300/45 shadow-[0_0_22px_rgba(14,165,233,0.38)] hover:-translate-y-[1px] active:translate-y-0 text-white font-display text-[11px] md:text-xs font-bold tracking-wider transition-all whitespace-nowrap cursor-pointer"
              >
                {isSimulating && !isPaused ? (
                  <>
                    <Pause className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    PAUSE MARSWALK
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 md:w-4 md:h-4 fill-current" />
                    {isPaused ? 'RESUME MARSWALK' : 'SIMULATE MISSION'}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => resetSimulation(false)}
                aria-label="Reset Marswalk simulation"
                className="p-2 md:p-2.5 rounded-md border border-sky-400/35 bg-gradient-to-b from-slate-800/80 to-slate-950/90 text-sky-200 hover:text-white hover:border-sky-400 transition-all cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleTriggerSolarStorm}
              className={`w-full flex items-center justify-center gap-2 py-2 md:py-2.5 px-3 md:px-4 rounded-md font-display text-[11px] md:text-xs font-bold tracking-wider transition-all whitespace-nowrap cursor-pointer hover:-translate-y-[1px] active:translate-y-0 ${
                hazardAlert?.active
                  ? 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 border border-emerald-300/45 shadow-[0_0_20px_rgba(34,197,94,0.32)] text-white'
                  : 'bg-gradient-to-r from-orange-600 via-amber-600 to-rose-600 hover:from-orange-500 hover:via-amber-500 hover:to-rose-500 border border-amber-300/45 shadow-[0_0_20px_rgba(249,115,22,0.35)] text-white'
              }`}
            >
              {hazardAlert?.active ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
                  CLEAR STORM ALERT &amp; RESET
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
                  TRIGGER SOLAR STORM / DUST ALERT
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportEvaPlan}
              className="w-full flex items-center justify-center gap-2 py-1.5 md:py-2 px-3 md:px-4 rounded-md border border-sky-400/35 bg-[#070C16]/85 hover:bg-sky-950/55 hover:border-sky-400/70 text-sky-200 hover:text-white font-display text-[11px] md:text-xs font-semibold tracking-wider transition-all whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              {exportConfirmed ? 'EVA PLAN EXPORTED (.JSON)' : 'Export EVA Plan (.JSON)'}
            </button>
          </section>
        </aside>

        {/* Right Main Viewport: Map Stage + Bottom Engineering Telemetry Tray */}
        <div className="flex-1 flex flex-col gap-2.5 md:gap-4 min-w-0">
          <MarsMapCanvas
            zone={zone}
            activeLayers={activeLayers}
            clickMode={clickMode}
            startCoord={startCoord}
            targetCoord={targetCoord}
            routes={comparativeRoutes}
            selectedStrategy={selectedStrategy}
            emergencyRoute={emergencyRoute}
            hazardAlert={hazardAlert}
            uhfShadowGrid={uhfShadowGrid}
            astronautPos={{ x: interpolated.x, y: interpolated.y }}
            astronautHeadingRad={interpolated.headingRad}
            scoutRover={{
              active: scoutRoverState.active,
              x: scoutRoverState.x,
              y: scoutRoverState.y,
              headingRad: scoutRoverState.headingRad,
              isClear: scoutRoverState.isClear,
            }}
            isSimulating={isSimulating && !isPaused}
            visorHudActive={visorHudActive}
            remainingO2Pct={remainingO2Pct}
            heartRateBpm={heartRateBpm}
            metabolicKcalHr={metabolicKcalHr}
            onMapClick={handleMapClick}
            onSelectTargetFromPoi={handleSelectTargetFromPoi}
            onPoiPing={() => playRadarPing(soundEnabled)}
          />

          {/* Bottom Engineering & Life-Support Telemetry Tray */}
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-3 md:gap-4 p-2.5 md:p-4 rounded-lg ares-panel !border-2 !border-black ring-1 ring-sky-400/20 shadow-[0_12px_36px_rgba(0,0,0,0.85)]">
            {/* Live Suit & Navigation Telemetry Metrics */}
            <div className="xl:col-span-6 flex flex-col justify-between gap-2 md:gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 md:gap-2 text-xs font-semibold">
                  <Compass className="w-3.5 h-3.5 md:w-4 md:h-4 text-sky-400" />
                  <span className="font-display text-xs md:text-sm font-bold ares-text-metallic">
                    {hazardAlert?.active
                      ? emergencyRoute?.label ?? 'Emergency Shelter Detour'
                      : `${activeRoute.label} · EVA-1 Telemetry`}
                  </span>
                </div>

                <div className="font-mono tabular-nums text-[11px] md:text-xs">
                  {arrivedAtShelter ? (
                    <span className="text-emerald-400 font-semibold">
                      ● Shelter Reached · Shielding Active
                    </span>
                  ) : arrivedAtDestination ? (
                    <span className="text-emerald-400 font-semibold">
                      ● Waypoint Reached
                    </span>
                  ) : hazardAlert?.active ? (
                    <span className="text-orange-400 font-semibold">
                      ▲ Emergency Re-Route Active
                    </span>
                  ) : isSimulating && !isPaused ? (
                    <span className="text-sky-300 font-semibold">
                      ● EVA Traverse In Progress
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-semibold">
                      ● Mission Plan Nominal
                    </span>
                  )}
                </div>
              </div>

              {/* Tabular Telemetry Readout Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 pt-1.5 md:pt-2 border-t border-slate-700/60">
                <div>
                  <div className="text-[10px] md:text-[11px] text-slate-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-sky-400" />
                    Distance
                  </div>
                  <div className="font-mono tabular-nums text-base md:text-lg font-bold text-sky-200 mt-0.5">
                    {currentDistanceKm.toFixed(2)}
                    <span className="text-xs text-slate-400 ml-1">km</span>
                  </div>
                  <div className="font-mono tabular-nums text-[10px] md:text-[11px] text-slate-400">
                    {currentRemainingKm.toFixed(2)} km left
                  </div>
                </div>

                <div>
                  <div className="text-[10px] md:text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-orange-400" />
                    Walk Time
                  </div>
                  <div className="font-mono tabular-nums text-base md:text-lg font-bold text-orange-300 mt-0.5">
                    {Math.round(currentElapsedMin)}
                    <span className="text-xs text-slate-400 ml-1">min</span>
                  </div>
                  <div className="font-mono tabular-nums text-[10px] md:text-[11px] text-slate-400">
                    Est {activeRoute.walkTimeMinutes} min leg
                  </div>
                </div>

                <div
                  className={`transition-all ${
                    demoStep === 2
                      ? 'rounded-md p-1.5 -m-1.5 bg-emerald-500/15 ring-2 ring-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.45)]'
                      : ''
                  }`}
                >
                  <div className="text-[10px] md:text-[11px] text-slate-400 flex items-center justify-between gap-1">
                    <span>Suit O₂ Reserve</span>
                    {demoStep === 2 && (
                      <span className="px-1 py-0.5 rounded bg-emerald-500/25 text-emerald-300 font-mono text-[9px] font-bold uppercase tracking-wider">
                        xEMU O₂
                      </span>
                    )}
                  </div>
                  <div
                    className={`font-mono tabular-nums text-base md:text-lg font-bold mt-0.5 ${
                      remainingO2Pct < 25 ? 'text-rose-400' : 'text-emerald-300'
                    }`}
                  >
                    {remainingO2Pct.toFixed(1)}
                    <span className="text-xs text-slate-400 ml-0.5">%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800/90 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        remainingO2Pct < 25
                          ? 'bg-rose-500'
                          : 'bg-gradient-to-r from-emerald-400 to-green-500'
                      }`}
                      style={{ width: `${remainingO2Pct}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] md:text-[11px] text-slate-400 flex items-center gap-1">
                    <BatteryCharging className="w-3 h-3 text-sky-400" />
                    PLSS Battery
                  </div>
                  <div
                    className={`font-mono tabular-nums text-base md:text-lg font-bold mt-0.5 ${
                      remainingBatteryPct < 25 ? 'text-orange-400' : 'text-sky-300'
                    }`}
                  >
                    {remainingBatteryPct.toFixed(1)}
                    <span className="text-xs text-slate-400 ml-0.5">%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800/90 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        remainingBatteryPct < 25
                          ? 'bg-orange-500'
                          : 'bg-gradient-to-r from-sky-400 to-cyan-400'
                      }`}
                      style={{ width: `${remainingBatteryPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Secondary Live Environmental Row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t border-slate-700/60 font-mono tabular-nums text-[11px] text-slate-300">
                <span className="text-sky-300">
                  Pos: {liveLatLon.latFormatted}, {liveLatLon.lonFormatted}
                </span>
                <span>Slope: {interpolated.slopeDeg.toFixed(1)}°</span>
                <span>Wind: {liveCell.windSpeedMs.toFixed(1)} m/s</span>
                <span
                  className={
                    liveCell.radiationMsVPerHr > 0.5 ? 'text-rose-400 font-semibold' : ''
                  }
                >
                  Rad: {liveCell.radiationMsVPerHr.toFixed(3)} mSv/h
                </span>
                <span className="text-emerald-300">Load: {metabolicKcalHr} kcal/h</span>
              </div>

              {/* Line-of-Sight (LOS) UHF Comm Link Status Indicator */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-700/60 font-mono tabular-nums text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Radio
                    className={`w-3.5 h-3.5 shrink-0 ${
                      commLinkStatus.status === 'STRONG' ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  />
                  <span className="text-slate-400">UHF Comm Link:</span>
                  <span
                    className={
                      commLinkStatus.status === 'STRONG'
                        ? 'text-emerald-400 font-semibold'
                        : 'text-amber-400 font-semibold'
                    }
                  >
                    {commLinkStatus.label}
                  </span>
                </div>
                <span className="text-slate-400 text-[10.5px]">
                  {commLinkStatus.status === 'SHADOW'
                    ? `Terrain occlusion +${commLinkStatus.maxObstructionM} m · ${commLinkStatus.signalStrengthPct}% RF`
                    : `Clear LOS (${commLinkStatus.baseAntennaHeightM}m mast → ${commLinkStatus.suitAntennaHeightM}m suit)`}
                </span>
              </div>

              {/* Autonomous Companion Scout Rover Sync Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-700/60 font-mono tabular-nums text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Bot
                    className={`w-3.5 h-3.5 shrink-0 ${
                      scoutRoverState.active
                        ? scoutRoverState.isClear
                          ? 'text-teal-400'
                          : 'text-amber-400'
                        : 'text-slate-400'
                    }`}
                  />
                  <span className="text-slate-400">Scout Rover → ARES-AI:</span>
                  {scoutRoverState.active ? (
                    <span
                      className={
                        scoutRoverState.isClear
                          ? 'text-teal-300 font-semibold'
                          : 'text-amber-400 font-semibold'
                      }
                    >
                      {scoutRoverState.statusLabel}
                    </span>
                  ) : (
                    <span className="text-slate-300 font-medium">STANDBY (200m Lead)</span>
                  )}
                </div>
                <span className="text-slate-400 text-[10.5px]">
                  {scoutRoverState.active
                    ? `200m ahead · Slope ${scoutRoverState.slopeDeg.toFixed(1)}° · Rad ${scoutRoverState.radiationMsVPerHr.toFixed(2)} mSv/h`
                    : 'Auto-deploys on Simulate Mission'}
                </span>
              </div>
            </div>

            {/* Dual-Axis Elevation & Slope SVG Chart */}
            <div className="xl:col-span-6 xl:border-l xl:border-slate-700/60 xl:pl-4">
              <ElevationProfileChart
                route={activeRoute}
                progressRatio={progressRatio}
                isEmergency={Boolean(hazardAlert?.active)}
              />
            </div>
          </section>
        </div>
      </main>

      <HelmetVisorOverlay
        active={visorHudActive}
        elevationM={interpolated.elevationM}
        scoutStatusLabel={scoutRoverState.statusLabel}
        isHazardActive={Boolean(hazardAlert?.active)}
      />

      <NasaDataSourcesDrawer
        open={dataDrawerOpen}
        onClose={() => setDataDrawerOpen(false)}
        donkiStatus={donkiStatus}
        donkiEvents={donkiEvents}
        onSyncDonki={queryLiveDonki}
      />

      {/* Automated 12-Second Demo Guided Caption Bar */}
      {demoActive && demoStep !== null && (
        <div
          role="region"
          aria-live="polite"
          aria-label="Demo Guided Showcase"
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[min(94vw,660px)] rounded-xl bg-[#050914]/94 backdrop-blur-md border border-sky-400/50 shadow-[0_14px_40px_rgba(0,0,0,0.9),0_0_26px_rgba(56,189,248,0.24)] px-3.5 py-2.5"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/45 font-mono tabular-nums text-[10px] font-bold text-sky-300 tracking-wider">
                DEMO · STEP {demoStep}/3
              </span>
              <span className="font-mono tabular-nums text-[11px] text-orange-300 font-semibold">
                {Math.max(0, 12 - demoElapsedMs / 1000).toFixed(1)}s
              </span>
            </div>

            <button
              type="button"
              onClick={() => stopJudgeDemo(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/55 text-rose-200 hover:text-white font-display text-[11px] font-bold tracking-wide transition-all cursor-pointer whitespace-nowrap"
            >
              <Square className="w-2.5 h-2.5 fill-current shrink-0" />
              Stop Demo
            </button>
          </div>

          <div className="text-xs sm:text-[13px] text-slate-100 leading-snug">
            {demoStep === 1 && (
              <>
                <span className="font-display font-bold text-sky-300">
                  1. NASA Mission Layers:{' '}
                </span>
                Activating MRO HiRISE Topography (&gt;25° hazard mask) &amp; DONKI/RAD Radiation
                overlays.
              </>
            )}
            {demoStep === 2 && (
              <>
                <span className="font-display font-bold text-emerald-300">
                  2. Safest Route &amp; xEMU Oxygen:{' '}
                </span>
                Selecting Safest Route, launching EVA-1 &amp; Scout Rover, and highlighting live
                xEMU Suit O₂ Reserve telemetry.
              </>
            )}
            {demoStep === 3 && (
              <>
                <span className="font-display font-bold text-orange-300">
                  3. Visor HUD &amp; Solar Storm Re-Routing:{' '}
                </span>
                Engaging Astronaut Visor HUD and triggering X2.4 Solar Storm Alert for autonomous
                shelter detour.
              </>
            )}
          </div>

          <div className="mt-2 h-1 w-full rounded-full bg-slate-800/95 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-400 via-emerald-400 to-orange-400 transition-[width] duration-100"
              style={{ width: `${Math.min(100, (demoElapsedMs / 12000) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
