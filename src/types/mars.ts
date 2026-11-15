export type LandingZoneId =
  | 'jezero'
  | 'gale'
  | 'arcadia'
  | 'valles';

export type LayerId =
  | 'topography'
  | 'weather'
  | 'radiation'
  | 'science';

export type RouteStrategy = 'safest' | 'fastest' | 'science' | 'emergency';

export type MapClickMode = 'inspect' | 'set_start' | 'set_target';

export interface NormalizedCoord {
  x: number; // 0..1 across map width
  y: number; // 0..1 across map height
}

export interface ScienceTarget {
  id: string;
  name: string;
  kind: 'geology' | 'water_ice';
  instrument: string;
  composition: string;
  priority: 'High' | 'Critical';
  x: number;
  y: number;
}

export interface LavaTubeShelter {
  id: string;
  name: string;
  shieldingFactor: number; // 0.92 = 92% radiation attenuation
  capacityAstronauts: number;
  depthMeters: number;
  x: number;
  y: number;
}

export interface DustStormFront {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  angleRad: number;
  peakWindMs: number;
  opticalDepthTau: number;
}

export interface RadiationZone {
  centerX: number;
  centerY: number;
  radius: number;
  peakDoseMsVPerHr: number;
}

export interface TerrainCell {
  col: number;
  row: number;
  elevationM: number;
  slopeDeg: number;
  windSpeedMs: number;
  windDirRad: number;
  radiationMsVPerHr: number;
  dustOpacityTau: number;
}

export interface LandingZone {
  id: LandingZoneId;
  name: string;
  regionSubtitle: string;
  missionReference: string;
  centerLat: number; // +N, -S
  centerLon: number; // degrees E
  datumElevationM: number;
  mapWidthKm: number;
  mapHeightKm: number;
  imageUrl: string;
  ambientTempC: number;
  pressurePa: number;
  baselineGcrMsVPerDay: number;
  defaultStart: NormalizedCoord;
  defaultTarget: NormalizedCoord;
  scienceTargets: ScienceTarget[];
  shelters: LavaTubeShelter[];
  dustFront: DustStormFront;
  radiationZones: RadiationZone[];
  gridCols: number;
  gridRows: number;
  grid: TerrainCell[][];
}

export interface RoutePoint {
  x: number;
  y: number;
  distanceKm: number;
  elevationM: number;
  slopeDeg: number;
  radiationMsVPerHr: number;
  windSpeedMs: number;
}

export interface ComputedRoute {
  strategy: RouteStrategy;
  label: string;
  subtitle: string;
  points: RoutePoint[];
  distanceKm: number;
  walkTimeMinutes: number;
  oxygenRequiredPct: number;
  batteryDrainPct: number;
  peakSlopeDeg: number;
  avgSlopeDeg: number;
  cumulativeDoseMsV: number;
  scienceTargetsVisited: ScienceTarget[];
  targetShelter?: LavaTubeShelter;
  steepSegmentsCount: number;
}

export interface LiveTelemetry {
  isRunning: boolean;
  isPaused: boolean;
  progressRatio: number; // 0..1 along active route
  currentX: number;
  currentY: number;
  headingRad: number;
  elapsedMinutes: number;
  distanceCoveredKm: number;
  distanceRemainingKm: number;
  remainingO2Pct: number;
  remainingBatteryPct: number;
  currentSlopeDeg: number;
  currentElevationM: number;
  currentRadiationMsVPerHr: number;
  currentWindMs: number;
  metabolicRateKcalHr: number;
  arrivedAtDestination: boolean;
  arrivedAtShelter: boolean;
}

export interface NasaDataSource {
  id: string;
  name: string;
  agencyInstrument: string;
  datasetRole: string;
  nominalMetric: string;
  cadence: string;
  endpointRef: string;
}

export interface CommLinkStatus {
  status: 'STRONG' | 'SHADOW';
  label: string;
  signalStrengthPct: number;
  blockedSegments: number;
  totalCheckedSegments: number;
  maxObstructionM: number;
  shadowedRouteRatio: number;
  baseAntennaHeightM: number;
  suitAntennaHeightM: number;
}

export interface DonkiFlareEvent {
  flrID: string;
  classType: string;
  beginTime: string;
  sourceLocation: string;
  note: string;
}

