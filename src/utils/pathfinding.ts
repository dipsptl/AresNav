import { MARS_GRAVITY_MS2, SUIT_STEEP_SLOPE_THRESHOLD_DEG } from '../data/marsZones';
import type {
  CommLinkStatus,
  ComputedRoute,
  LandingZone,
  LavaTubeShelter,
  NormalizedCoord,
  RoutePoint,
  RouteStrategy,
  ScienceTarget,
  TerrainCell,
} from '../types/mars';

interface GridPos {
  col: number;
  row: number;
}

export interface HazardAlertState {
  active: boolean;
  flareClass: string;
  stormCenter: NormalizedCoord;
  stormRadius: number;
  peakDoseMsVPerHr: number;
  windSurgeMs: number;
  issuedAtSolTime: string;
  nearestShelterId?: string;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function normToGrid(zone: LandingZone, coord: NormalizedCoord): GridPos {
  return {
    col: clamp(Math.floor(coord.x * zone.gridCols), 0, zone.gridCols - 1),
    row: clamp(Math.floor(coord.y * zone.gridRows), 0, zone.gridRows - 1),
  };
}

export function gridToNorm(zone: LandingZone, pos: GridPos): NormalizedCoord {
  return {
    x: (pos.col + 0.5) / zone.gridCols,
    y: (pos.row + 0.5) / zone.gridRows,
  };
}

export function sampleCellAt(
  zone: LandingZone,
  coord: NormalizedCoord,
  hazard?: HazardAlertState | null
): TerrainCell {
  const pos = normToGrid(zone, coord);
  const base = zone.grid[pos.row][pos.col];
  if (!hazard || !hazard.active) return base;

  const dx = coord.x - hazard.stormCenter.x;
  const dy = (coord.y - hazard.stormCenter.y) * (zone.mapHeightKm / zone.mapWidthKm);
  const dist = Math.sqrt(dx * dx + dy * dy);
  const radInfluence = Math.exp(-Math.pow(dist / hazard.stormRadius, 2));

  return {
    ...base,
    radiationMsVPerHr: Number(
      (base.radiationMsVPerHr + hazard.peakDoseMsVPerHr * radInfluence).toFixed(3)
    ),
    windSpeedMs: Number(
      (base.windSpeedMs + hazard.windSurgeMs * radInfluence).toFixed(1)
    ),
    dustOpacityTau: Number(
      (base.dustOpacityTau + 2.4 * radInfluence).toFixed(2)
    ),
  };
}

export function normToMarsLatLon(zone: LandingZone, coord: NormalizedCoord) {
  // ~59.2 km per degree of Mars latitude
  const kmPerDegLat = 59.27;
  const latRad = (zone.centerLat * Math.PI) / 180;
  const kmPerDegLon = kmPerDegLat * Math.max(0.25, Math.cos(latRad));

  const offsetXKm = (coord.x - 0.5) * zone.mapWidthKm;
  const offsetYKm = (0.5 - coord.y) * zone.mapHeightKm;

  const lat = zone.centerLat + offsetYKm / kmPerDegLat;
  const lon = zone.centerLon + offsetXKm / kmPerDegLon;

  return {
    lat,
    lon,
    latFormatted: `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`,
    lonFormatted: `${lon.toFixed(4)}° E`,
  };
}

function aStarGrid(
  zone: LandingZone,
  start: GridPos,
  goal: GridPos,
  strategy: RouteStrategy,
  hazard?: HazardAlertState | null
): GridPos[] {
  const cols = zone.gridCols;
  const rows = zone.gridRows;
  const total = cols * rows;

  const gScore = new Float64Array(total).fill(Infinity);
  const fScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const openSet = new Set<number>();

  const idx = (c: number, r: number) => r * cols + c;
  const startIdx = idx(start.col, start.row);
  const goalIdx = idx(goal.col, goal.row);

  const cellKmX = zone.mapWidthKm / cols;
  const cellKmY = zone.mapHeightKm / rows;

  const heuristic = (c: number, r: number) => {
    const dx = (goal.col - c) * cellKmX;
    const dy = (goal.row - r) * cellKmY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(start.col, start.row);
  openSet.add(startIdx);

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  while (openSet.size > 0) {
    let current = -1;
    let lowestF = Infinity;
    for (const node of openSet) {
      if (fScore[node] < lowestF) {
        lowestF = fScore[node];
        current = node;
      }
    }

    if (current === goalIdx) {
      const path: GridPos[] = [];
      let curr = current;
      while (curr !== -1) {
        const r = Math.floor(curr / cols);
        const c = curr % cols;
        path.push({ col: c, row: r });
        curr = cameFrom[curr];
      }
      path.reverse();
      return path;
    }

    openSet.delete(current);
    closed[current] = 1;

    const cc = current % cols;
    const cr = Math.floor(current / cols);

    for (const [dc, dr] of dirs) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;

      const nIdx = idx(nc, nr);
      if (closed[nIdx]) continue;

      const stepDistKm = Math.sqrt(
        Math.pow(dc * cellKmX, 2) + Math.pow(dr * cellKmY, 2)
      );
      const cell = zone.grid[nr][nc];
      const norm = gridToNorm(zone, { col: nc, row: nr });

      // Radiation & storm hazard sample
      let radDose = cell.radiationMsVPerHr;
      let stormPenalty = 0;
      if (hazard?.active) {
        const dx = norm.x - hazard.stormCenter.x;
        const dy = (norm.y - hazard.stormCenter.y) * (zone.mapHeightKm / zone.mapWidthKm);
        const d = Math.sqrt(dx * dx + dy * dy);
        const factor = Math.exp(-Math.pow(d / hazard.stormRadius, 2));
        radDose += hazard.peakDoseMsVPerHr * factor;
        stormPenalty = factor * 24;
      }

      let costMultiplier = 1.0;

      if (strategy === 'safest') {
        if (cell.slopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG) {
          costMultiplier += 45 + (cell.slopeDeg - 25) * 4;
        } else if (cell.slopeDeg > 14) {
          costMultiplier += (cell.slopeDeg - 14) * 0.45;
        }
        costMultiplier += radDose * 26;
        costMultiplier += Math.max(0, cell.windSpeedMs - 9) * 0.25;
        costMultiplier += stormPenalty;
      } else if (strategy === 'fastest') {
        // Minimum distance bias: only avoid extreme >33° cliffs
        if (cell.slopeDeg > 33) {
          costMultiplier += 38;
        } else if (cell.slopeDeg > 25) {
          costMultiplier += 1.4;
        }
        costMultiplier += stormPenalty * 0.2;
      } else if (strategy === 'science') {
        if (cell.slopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG) {
          costMultiplier += 32 + (cell.slopeDeg - 25) * 3;
        } else if (cell.slopeDeg > 16) {
          costMultiplier += (cell.slopeDeg - 16) * 0.25;
        }
        costMultiplier += radDose * 6;
      } else if (strategy === 'emergency') {
        if (cell.slopeDeg > SUIT_STEEP_SLOPE_THRESHOLD_DEG) {
          costMultiplier += 40 + (cell.slopeDeg - 25) * 3.5;
        }
        costMultiplier += stormPenalty * 1.8 + radDose * 20;
      }

      const tentativeG = gScore[current] + stepDistKm * costMultiplier;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + heuristic(nc, nr);
        openSet.add(nIdx);
      }
    }
  }

  return [start, goal];
}

// Waypoint-chained A* for Max Science Route so it genuinely routes past key science/ice targets
function buildMaxScienceGridPath(
  zone: LandingZone,
  start: GridPos,
  goal: GridPos,
  hazard?: HazardAlertState | null
): GridPos[] {
  const startNorm = gridToNorm(zone, start);
  const goalNorm = gridToNorm(zone, goal);
  const directDist = Math.hypot(goalNorm.x - startNorm.x, goalNorm.y - startNorm.y);

  // Pick 1 or 2 high-value science targets that lie within a reasonable excursion envelope
  const candidates = zone.scienceTargets
    .map((t) => {
      const dStart = Math.hypot(t.x - startNorm.x, t.y - startNorm.y);
      const dGoal = Math.hypot(goalNorm.x - t.x, goalNorm.y - t.y);
      const detour = dStart + dGoal - directDist;
      const priorityScore = t.priority === 'Critical' ? 0.16 : 0.08;
      return {
        target: t,
        dStart,
        score: detour - priorityScore,
      };
    })
    .filter((c) => c.score < 0.55)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .sort((a, b) => a.dStart - b.dStart);

  if (candidates.length === 0) {
    return aStarGrid(zone, start, goal, 'science', hazard);
  }

  const waypoints: GridPos[] = [
    start,
    ...candidates.map((c) => normToGrid(zone, { x: c.target.x, y: c.target.y })),
    goal,
  ];

  const fullPath: GridPos[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const seg = aStarGrid(zone, waypoints[i], waypoints[i + 1], 'science', hazard);
    if (i > 0 && seg.length > 0) {
      seg.shift();
    }
    fullPath.push(...seg);
  }
  return fullPath;
}

function smoothNormPath(
  zone: LandingZone,
  rawNorms: NormalizedCoord[],
  startExact: NormalizedCoord,
  goalExact: NormalizedCoord
): NormalizedCoord[] {
  if (rawNorms.length <= 2) return [startExact, goalExact];

  const pinned = [startExact, ...rawNorms.slice(1, -1), goalExact];

  // Single gentle Chaikin pass that never cuts across steep (>25°) cells
  const smoothed: NormalizedCoord[] = [pinned[0]];
  for (let i = 0; i < pinned.length - 1; i++) {
    const p0 = pinned[i];
    const p1 = pinned[i + 1];
    const q = { x: 0.72 * p0.x + 0.28 * p1.x, y: 0.72 * p0.y + 0.28 * p1.y };
    const r = { x: 0.28 * p0.x + 0.72 * p1.x, y: 0.28 * p0.y + 0.72 * p1.y };

    const cellQ = sampleCellAt(zone, q);
    const cellR = sampleCellAt(zone, r);
    if (i > 0 && cellQ.slopeDeg <= SUIT_STEEP_SLOPE_THRESHOLD_DEG) smoothed.push(q);
    if (i < pinned.length - 2 && cellR.slopeDeg <= SUIT_STEEP_SLOPE_THRESHOLD_DEG) smoothed.push(r);
  }
  smoothed.push(pinned[pinned.length - 1]);
  return smoothed;
}

function evaluateRouteMetrics(
  zone: LandingZone,
  strategy: RouteStrategy,
  label: string,
  subtitle: string,
  coords: NormalizedCoord[],
  hazard?: HazardAlertState | null,
  targetShelter?: LavaTubeShelter
): ComputedRoute {
  const points: RoutePoint[] = [];
  let totalDistKm = 0;
  let totalTimeHours = 0;
  let totalO2Pct = 0;
  let totalBatteryPct = 0;
  let peakSlopeDeg = 0;
  let slopeSum = 0;
  let cumulativeDoseMsV = 0;
  let steepSegmentsCount = 0;

  // Mars xEMU PLSS Reference Specs under 3.72 m/s^2 gravity
  // Primary + Secondary O2 reserve supports ~8.0 hours nominal EVA (12.5% O2 / hr baseline)
  // 1.8 kWh PLSS battery supports ~8.5 hours nominal thermal + avionics (11.8% / hr baseline)
  const flatWalkSpeedKmH = 3.6;
  const gravityFactor = MARS_GRAVITY_MS2 / 9.80665; // ~0.379g

  for (let i = 0; i < coords.length; i++) {
    const pt = coords[i];
    const cell = sampleCellAt(zone, pt, hazard);

    if (i > 0) {
      const prev = coords[i - 1];
      const prevCell = sampleCellAt(zone, prev, hazard);
      const dxKm = (pt.x - prev.x) * zone.mapWidthKm;
      const dyKm = (pt.y - prev.y) * zone.mapHeightKm;
      const segHorizKm = Math.sqrt(dxKm * dxKm + dyKm * dyKm);
      const dzKm = (cell.elevationM - prevCell.elevationM) / 1000;
      const segDistKm = Math.sqrt(segHorizKm * segHorizKm + dzKm * dzKm);
      const grade = segHorizKm > 0.0001 ? dzKm / segHorizKm : 0;

      // Tobler hiking function adapted for 0.38g pressurized spacesuit
      const speedKmH = Math.max(
        1.15,
        flatWalkSpeedKmH *
          Math.exp(-3.1 * Math.abs(grade + 0.04)) *
          (cell.windSpeedMs > 14 ? 0.84 : 1.0)
      );

      const segHours = segDistKm / speedKmH;
      const localSlope = Math.max(
        cell.slopeDeg,
        Math.min(45, (Math.atan(Math.abs(grade)) * 180) / Math.PI)
      );

      if (localSlope > SUIT_STEEP_SLOPE_THRESHOLD_DEG) {
        steepSegmentsCount += 1;
      }

      // Metabolic O2 scales with incline effort & pressurized suit mobility under 0.38g
      const inclineMetabolicMultiplier =
        1 + Math.max(0, grade) * 4.2 * (0.75 + gravityFactor) + (localSlope > 20 ? 0.28 : 0);
      const o2RatePctHr = 11.4 * inclineMetabolicMultiplier;
      const batteryRatePctHr =
        10.6 +
        (cell.dustOpacityTau > 1.2 ? 2.4 : 0) +
        (zone.ambientTempC < -65 ? 1.5 : 0) +
        Math.max(0, grade) * 3.1;

      totalDistKm += segDistKm;
      totalTimeHours += segHours;
      totalO2Pct += segHours * o2RatePctHr;
      totalBatteryPct += segHours * batteryRatePctHr;
      cumulativeDoseMsV += segHours * cell.radiationMsVPerHr;
      peakSlopeDeg = Math.max(peakSlopeDeg, localSlope);
      slopeSum += localSlope;
    }

    points.push({
      x: pt.x,
      y: pt.y,
      distanceKm: Number(totalDistKm.toFixed(2)),
      elevationM: cell.elevationM,
      slopeDeg: cell.slopeDeg,
      radiationMsVPerHr: cell.radiationMsVPerHr,
      windSpeedMs: cell.windSpeedMs,
    });
  }

  // Detect science targets within 0.65 km of route
  const visited: ScienceTarget[] = [];
  for (const target of zone.scienceTargets) {
    let minKm = Infinity;
    for (const pt of points) {
      const dKm = Math.hypot(
        (pt.x - target.x) * zone.mapWidthKm,
        (pt.y - target.y) * zone.mapHeightKm
      );
      if (dKm < minKm) minKm = dKm;
    }
    if (minKm <= 0.72) {
      visited.push(target);
    }
  }

  const count = Math.max(1, points.length - 1);

  return {
    strategy,
    label,
    subtitle,
    points,
    distanceKm: Number(totalDistKm.toFixed(2)),
    walkTimeMinutes: Math.max(1, Math.round(totalTimeHours * 60)),
    oxygenRequiredPct: Number(Math.min(100, totalO2Pct).toFixed(1)),
    batteryDrainPct: Number(Math.min(100, totalBatteryPct).toFixed(1)),
    peakSlopeDeg: Number(peakSlopeDeg.toFixed(1)),
    avgSlopeDeg: Number((slopeSum / count).toFixed(1)),
    cumulativeDoseMsV: Number(cumulativeDoseMsV.toFixed(3)),
    scienceTargetsVisited: visited,
    targetShelter,
    steepSegmentsCount,
  };
}

export function generateComparativeRoutes(
  zone: LandingZone,
  start: NormalizedCoord,
  target: NormalizedCoord,
  hazard?: HazardAlertState | null
): Record<'safest' | 'fastest' | 'science', ComputedRoute> {
  const startGrid = normToGrid(zone, start);
  const targetGrid = normToGrid(zone, target);

  const safestGrid = aStarGrid(zone, startGrid, targetGrid, 'safest', hazard);
  const fastestGrid = aStarGrid(zone, startGrid, targetGrid, 'fastest', hazard);
  const scienceGrid = buildMaxScienceGridPath(zone, startGrid, targetGrid, hazard);

  const safestSmooth = smoothNormPath(
    zone,
    safestGrid.map((g) => gridToNorm(zone, g)),
    start,
    target
  );
  const fastestSmooth = smoothNormPath(
    zone,
    fastestGrid.map((g) => gridToNorm(zone, g)),
    start,
    target
  );
  const scienceSmooth = smoothNormPath(
    zone,
    scienceGrid.map((g) => gridToNorm(zone, g)),
    start,
    target
  );

  return {
    safest: evaluateRouteMetrics(
      zone,
      'safest',
      'Safest Route',
      'Lowest slope & radiation exposure',
      safestSmooth,
      hazard
    ),
    fastest: evaluateRouteMetrics(
      zone,
      'fastest',
      'Fastest Route',
      'Minimum traverse distance',
      fastestSmooth,
      hazard
    ),
    science: evaluateRouteMetrics(
      zone,
      'science',
      'Max Science Route',
      'Sweeps near key rock & ice targets',
      scienceSmooth,
      hazard
    ),
  };
}

export function computeEmergencyShelterRoute(
  zone: LandingZone,
  astronautPos: NormalizedCoord,
  hazard: HazardAlertState
): ComputedRoute {
  const startGrid = normToGrid(zone, astronautPos);
  let bestRoute: ComputedRoute | null = null;

  for (const shelter of zone.shelters) {
    const goalNorm = { x: shelter.x, y: shelter.y };
    const goalGrid = normToGrid(zone, goalNorm);
    const gridPath = aStarGrid(zone, startGrid, goalGrid, 'emergency', hazard);
    const smooth = smoothNormPath(
      zone,
      gridPath.map((g) => gridToNorm(zone, g)),
      astronautPos,
      goalNorm
    );
    const candidate = evaluateRouteMetrics(
      zone,
      'emergency',
      `Emergency Shelter: ${shelter.name}`,
      `${(shelter.shieldingFactor * 100).toFixed(0)}% radiation attenuation · ${shelter.depthMeters}m depth`,
      smooth,
      hazard,
      shelter
    );

    if (
      !bestRoute ||
      candidate.walkTimeMinutes + candidate.cumulativeDoseMsV * 60 <
        bestRoute.walkTimeMinutes + bestRoute.cumulativeDoseMsV * 60
    ) {
      bestRoute = candidate;
    }
  }

  return bestRoute!;
}

export function interpolateAlongRoute(
  route: ComputedRoute,
  progressRatio: number
): {
  x: number;
  y: number;
  headingRad: number;
  distanceKm: number;
  elevationM: number;
  slopeDeg: number;
} {
  const pts = route.points;
  if (pts.length === 0) {
    return { x: 0.5, y: 0.5, headingRad: 0, distanceKm: 0, elevationM: 0, slopeDeg: 0 };
  }
  if (pts.length === 1 || progressRatio <= 0) {
    return {
      x: pts[0].x,
      y: pts[0].y,
      headingRad: 0,
      distanceKm: 0,
      elevationM: pts[0].elevationM,
      slopeDeg: pts[0].slopeDeg,
    };
  }
  if (progressRatio >= 1) {
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    return {
      x: last.x,
      y: last.y,
      headingRad: Math.atan2(last.y - prev.y, last.x - prev.x),
      distanceKm: route.distanceKm,
      elevationM: last.elevationM,
      slopeDeg: last.slopeDeg,
    };
  }

  const targetDist = progressRatio * route.distanceKm;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    if (curr.distanceKm >= targetDist || i === pts.length - 1) {
      const span = Math.max(0.0001, curr.distanceKm - prev.distanceKm);
      const t = clamp((targetDist - prev.distanceKm) / span, 0, 1);
      return {
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
        headingRad: Math.atan2(curr.y - prev.y, curr.x - prev.x),
        distanceKm: targetDist,
        elevationM: Math.round(prev.elevationM + (curr.elevationM - prev.elevationM) * t),
        slopeDeg: Number((prev.slopeDeg + (curr.slopeDeg - prev.slopeDeg) * t).toFixed(1)),
      };
    }
  }

  const last = pts[pts.length - 1];
  return {
    x: last.x,
    y: last.y,
    headingRad: 0,
    distanceKm: route.distanceKm,
    elevationM: last.elevationM,
    slopeDeg: last.slopeDeg,
  };
}

// Effective 4/3 Mars radio horizon radius in meters (R_mars = 3,389,500 m)
const EFFECTIVE_MARS_RADIO_RADIUS_M = 3389500 * (4 / 3);
const UHF_BASE_ANTENNA_M = 10.0;
const UHF_SUIT_ANTENNA_M = 2.2;

export function sampleElevationBilinear(
  zone: LandingZone,
  coord: NormalizedCoord
): number {
  const gx = clamp(coord.x * zone.gridCols - 0.5, 0, zone.gridCols - 1);
  const gy = clamp(coord.y * zone.gridRows - 0.5, 0, zone.gridRows - 1);
  const c0 = Math.floor(gx);
  const r0 = Math.floor(gy);
  const c1 = Math.min(zone.gridCols - 1, c0 + 1);
  const r1 = Math.min(zone.gridRows - 1, r0 + 1);
  const tx = gx - c0;
  const ty = gy - r0;

  const e00 = zone.grid[r0][c0].elevationM;
  const e10 = zone.grid[r0][c1].elevationM;
  const e01 = zone.grid[r1][c0].elevationM;
  const e11 = zone.grid[r1][c1].elevationM;

  const top = e00 * (1 - tx) + e10 * tx;
  const bot = e01 * (1 - tx) + e11 * tx;
  return top * (1 - ty) + bot * ty;
}

function raycastObstructionMeters(
  zone: LandingZone,
  baseCoord: NormalizedCoord,
  baseHeightM: number,
  targetCoord: NormalizedCoord,
  targetHeightM: number,
  steps = 22
): { maxObstructionM: number; totalDistM: number } {
  const dxM = (targetCoord.x - baseCoord.x) * zone.mapWidthKm * 1000;
  const dyM = (targetCoord.y - baseCoord.y) * zone.mapHeightKm * 1000;
  const totalDistM = Math.hypot(dxM, dyM);
  if (totalDistM < 60) {
    return { maxObstructionM: 0, totalDistM };
  }

  let maxObstructionM = 0;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const sx = baseCoord.x + (targetCoord.x - baseCoord.x) * t;
    const sy = baseCoord.y + (targetCoord.y - baseCoord.y) * t;
    const d1 = totalDistM * t;
    const d2 = totalDistM * (1 - t);
    const curvatureDropM = (d1 * d2) / (2 * EFFECTIVE_MARS_RADIO_RADIUS_M);
    const rayElevM =
      baseHeightM * (1 - t) + targetHeightM * t - curvatureDropM;
    const terrainElevM = sampleElevationBilinear(zone, { x: sx, y: sy });
    const excessM = terrainElevM - rayElevM;
    if (excessM > maxObstructionM) {
      maxObstructionM = excessM;
    }
  }

  return { maxObstructionM, totalDistM };
}

export function computeUHFCommLinkLOS(
  zone: LandingZone,
  baseCoord: NormalizedCoord,
  route: ComputedRoute,
  hazard?: HazardAlertState | null
): CommLinkStatus {
  const baseHeightM = sampleElevationBilinear(zone, baseCoord) + UHF_BASE_ANTENNA_M;
  const pts = route.points;

  if (pts.length === 0) {
    return {
      status: 'STRONG',
      label: 'STRONG (98%)',
      signalStrengthPct: 98,
      blockedSegments: 0,
      totalCheckedSegments: 1,
      maxObstructionM: 0,
      shadowedRouteRatio: 0,
      baseAntennaHeightM: UHF_BASE_ANTENNA_M,
      suitAntennaHeightM: UHF_SUIT_ANTENNA_M,
    };
  }

  let blockedSegments = 0;
  let maxObstructionM = 0;
  let maxDistM = 0;
  let avgTau = 0;

  for (const pt of pts) {
    const ptHeightM = sampleElevationBilinear(zone, pt) + UHF_SUIT_ANTENNA_M;
    const { maxObstructionM: obsM, totalDistM } = raycastObstructionMeters(
      zone,
      baseCoord,
      baseHeightM,
      pt,
      ptHeightM,
      24
    );
    maxDistM = Math.max(maxDistM, totalDistM);
    if (obsM > 4.0) {
      blockedSegments += 1;
    }
    if (obsM > maxObstructionM) {
      maxObstructionM = obsM;
    }
    const cell = sampleCellAt(zone, pt, hazard);
    avgTau += cell.dustOpacityTau;
  }

  avgTau /= pts.length;
  const totalCheckedSegments = pts.length;
  const shadowedRouteRatio = blockedSegments / totalCheckedSegments;

  // Path loss + dust attenuation + knife-edge terrain diffraction loss
  const distKm = maxDistM / 1000;
  const distancePenalty = Math.min(12, distKm * 0.45);
  const dustPenalty = hazard?.active ? Math.min(10, avgTau * 2.1) : Math.min(4, avgTau * 1.1);
  const diffractionPenalty =
    maxObstructionM > 4.0
      ? Math.min(58, 16 + maxObstructionM * 0.72 + shadowedRouteRatio * 22)
      : 0;

  const rawSignal = Math.round(
    clamp(100 - distancePenalty - dustPenalty - diffractionPenalty, 14, 99)
  );
  const isShadow = blockedSegments > 0 && (shadowedRouteRatio >= 0.08 || maxObstructionM >= 7.5);

  return {
    status: isShadow ? 'SHADOW' : 'STRONG',
    label: isShadow ? 'SIGNAL SHADOW - RELAY NEEDED' : `STRONG (${rawSignal}%)`,
    signalStrengthPct: rawSignal,
    blockedSegments,
    totalCheckedSegments,
    maxObstructionM: Number(maxObstructionM.toFixed(1)),
    shadowedRouteRatio: Number(shadowedRouteRatio.toFixed(2)),
    baseAntennaHeightM: UHF_BASE_ANTENNA_M,
    suitAntennaHeightM: UHF_SUIT_ANTENNA_M,
  };
}

export function computeUhfShadowGrid(
  zone: LandingZone,
  baseCoord: NormalizedCoord
): number[][] {
  const baseHeightM = sampleElevationBilinear(zone, baseCoord) + UHF_BASE_ANTENNA_M;
  const shadowGrid: number[][] = [];

  for (let r = 0; r < zone.gridRows; r++) {
    const rowVals: number[] = [];
    const ny = (r + 0.5) / zone.gridRows;
    for (let c = 0; c < zone.gridCols; c++) {
      const nx = (c + 0.5) / zone.gridCols;
      const cellHeightM = zone.grid[r][c].elevationM + UHF_SUIT_ANTENNA_M;
      const { maxObstructionM } = raycastObstructionMeters(
        zone,
        baseCoord,
        baseHeightM,
        { x: nx, y: ny },
        cellHeightM,
        18
      );
      rowVals.push(maxObstructionM > 4.5 ? clamp((maxObstructionM - 4.5) / 42, 0.12, 1) : 0);
    }
    shadowGrid.push(rowVals);
  }

  return shadowGrid;
}

