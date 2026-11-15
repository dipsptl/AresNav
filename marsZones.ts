import type {
  LandingZone,
  LandingZoneId,
  NasaDataSource,
  TerrainCell,
} from '../types/mars';
import jezeroCraterImg from '../assets/images/mars_jezero_crater_1794717099386.jpg';
import galeCraterImg from '../assets/images/mars_gale_crater_1794717100141.jpg';
import arcadiaPlanitiaImg from '../assets/images/mars_arcadia_planitia_1794717100251.jpg';
import vallesMarinerisImg from '../assets/images/mars_valles_marineris_1794717101165.jpg';

export const MARS_GRAVITY_MS2 = 3.72076;
export const SUIT_STEEP_SLOPE_THRESHOLD_DEG = 25;
export const GRID_COLS = 64;
export const GRID_ROWS = 36;

interface FeaturePrimitive {
  type: 'ridge' | 'crater' | 'canyon' | 'delta' | 'trough';
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  heightM: number;
}

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

function fbm(x: number, y: number, seed: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    value += amp * (smoothNoise(x * freq, y * freq, seed + i * 19) - 0.5);
    freq *= 2.05;
    amp *= 0.5;
  }
  return value;
}

function evaluateFeature(
  nx: number,
  ny: number,
  feat: FeaturePrimitive
): number {
  const dx = nx - feat.x;
  const dy = ny - feat.y;
  const cosA = Math.cos(-feat.angle);
  const sinA = Math.sin(-feat.angle);
  const lx = (dx * cosA - dy * sinA) / feat.rx;
  const ly = (dx * sinA + dy * cosA) / feat.ry;
  const r2 = lx * lx + ly * ly;
  const r = Math.sqrt(r2);

  if (feat.type === 'ridge') {
    return feat.heightM * Math.exp(-r2 * 1.9);
  }
  if (feat.type === 'crater') {
    // Classic bowl + raised rim profile
    if (r > 1.75) return 0;
    const bowl = -feat.heightM * Math.exp(-Math.pow(r / 0.72, 2.4));
    const rim = feat.heightM * 0.42 * Math.exp(-Math.pow((r - 0.96) / 0.2, 2));
    return bowl + rim;
  }
  if (feat.type === 'canyon') {
    // Deep flat-bottomed tectonic graben with steep cliff walls
    const wall = 1 / (1 + Math.exp((r - 0.82) * 9.5));
    return -feat.heightM * wall;
  }
  if (feat.type === 'delta') {
    // Elevated sedimentary fan plateau with terraced scarp
    const plateau = 1 / (1 + Math.exp((r - 0.85) * 6.5));
    return feat.heightM * plateau;
  }
  if (feat.type === 'trough') {
    const dist = Math.abs(ly);
    if (Math.abs(lx) > 1.15) return 0;
    const endFade = Math.exp(-Math.pow(Math.max(0, Math.abs(lx) - 0.85) / 0.25, 2));
    return -feat.heightM * Math.exp(-Math.pow(dist / 0.38, 2)) * endFade;
  }
  return 0;
}

function buildTerrainGrid(
  zoneId: LandingZoneId,
  datumM: number,
  mapWidthKm: number,
  mapHeightKm: number,
  seed: number,
  features: FeaturePrimitive[],
  noiseScaleM: number,
  baseWindDirRad: number,
  baseWindSpeedMs: number,
  dustFront: LandingZone['dustFront'],
  radiationZones: LandingZone['radiationZones'],
  baselineGcrDay: number
): TerrainCell[][] {
  const elevations: number[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array(GRID_COLS).fill(0)
  );

  for (let r = 0; r < GRID_ROWS; r++) {
    const ny = (r + 0.5) / GRID_ROWS;
    for (let c = 0; c < GRID_COLS; c++) {
      const nx = (c + 0.5) / GRID_COLS;
      let elev = datumM + fbm(nx * 6.5, ny * 3.8, seed) * noiseScaleM;
      for (const feat of features) {
        elev += evaluateFeature(nx, ny, feat);
      }
      elevations[r][c] = elev;
    }
  }

  const cellWidthM = (mapWidthKm * 1000) / GRID_COLS;
  const cellHeightM = (mapHeightKm * 1000) / GRID_ROWS;
  const baselineHr = baselineGcrDay / 24;

  const grid: TerrainCell[][] = [];

  for (let r = 0; r < GRID_ROWS; r++) {
    const rowCells: TerrainCell[] = [];
    const ny = (r + 0.5) / GRID_ROWS;

    for (let c = 0; c < GRID_COLS; c++) {
      const nx = (c + 0.5) / GRID_COLS;

      const left = elevations[r][Math.max(0, c - 1)];
      const right = elevations[r][Math.min(GRID_COLS - 1, c + 1)];
      const up = elevations[Math.max(0, r - 1)][c];
      const down = elevations[Math.min(GRID_ROWS - 1, r + 1)][c];

      const dxSpan = c === 0 || c === GRID_COLS - 1 ? cellWidthM : cellWidthM * 2;
      const dySpan = r === 0 || r === GRID_ROWS - 1 ? cellHeightM : cellHeightM * 2;

      const dzdx = (right - left) / dxSpan;
      const dzdy = (down - up) / dySpan;
      const grad = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      const slopeDeg = Math.min(48, (Math.atan(grad) * 180) / Math.PI);

      // Dust front influence
      const dfx = nx - dustFront.centerX;
      const dfy = ny - dustFront.centerY;
      const cosA = Math.cos(-dustFront.angleRad);
      const sinA = Math.sin(-dustFront.angleRad);
      const dlx = (dfx * cosA - dfy * sinA) / dustFront.radiusX;
      const dly = (dfx * sinA + dfy * cosA) / dustFront.radiusY;
      const dustDist2 = dlx * dlx + dly * dly;
      const dustWeight = Math.exp(-dustDist2 * 1.4);

      const windSpeedMs =
        baseWindSpeedMs +
        dustWeight * (dustFront.peakWindMs - baseWindSpeedMs) +
        smoothNoise(nx * 5, ny * 5, seed + 41) * 2.2;

      const windDirRad =
        baseWindDirRad +
        (smoothNoise(nx * 4, ny * 4, seed + 83) - 0.5) * 0.45 +
        dustWeight * 0.25;

      const dustOpacityTau = 0.42 + dustWeight * (dustFront.opticalDepthTau - 0.42);

      // Ambient + localized radiation zone intensity
      let radRate = baselineHr + (elevations[r][c] > datumM ? 0.004 : 0);
      for (const rz of radiationZones) {
        const d2 = Math.pow(nx - rz.centerX, 2) + Math.pow(ny - rz.centerY, 2);
        const r2 = rz.radius * rz.radius;
        radRate += rz.peakDoseMsVPerHr * Math.exp(-d2 / (0.65 * r2));
      }

      // Slight zone-specific calibration tweaks
      if (zoneId === 'arcadia') {
        radRate *= 0.94;
      }

      rowCells.push({
        col: c,
        row: r,
        elevationM: Math.round(elevations[r][c]),
        slopeDeg: Number(slopeDeg.toFixed(1)),
        windSpeedMs: Number(windSpeedMs.toFixed(1)),
        windDirRad,
        radiationMsVPerHr: Number(radRate.toFixed(3)),
        dustOpacityTau: Number(dustOpacityTau.toFixed(2)),
      });
    }
    grid.push(rowCells);
  }

  return grid;
}

export const LANDING_ZONES: Record<LandingZoneId, LandingZone> = {
  jezero: (() => {
    const dustFront: LandingZone['dustFront'] = {
      centerX: 0.78,
      centerY: 0.24,
      radiusX: 0.24,
      radiusY: 0.22,
      angleRad: -0.4,
      peakWindMs: 17.4,
      opticalDepthTau: 1.85,
    };
    const radiationZones: LandingZone['radiationZones'] = [
      { centerX: 0.52, centerY: 0.34, radius: 0.16, peakDoseMsVPerHr: 0.085 },
      { centerX: 0.22, centerY: 0.62, radius: 0.14, peakDoseMsVPerHr: 0.072 },
    ];
    const features: FeaturePrimitive[] = [
      // Western crater rim escarpments
      { type: 'ridge', x: 0.08, y: 0.28, rx: 0.11, ry: 0.28, angle: 0.1, heightM: 210 },
      { type: 'ridge', x: 0.11, y: 0.72, rx: 0.12, ry: 0.26, angle: -0.15, heightM: 195 },
      // Belva-style impact crater top-left
      { type: 'crater', x: 0.21, y: 0.12, rx: 0.085, ry: 0.135, angle: 0, heightM: 165 },
      // Southern crater
      { type: 'crater', x: 0.12, y: 0.85, rx: 0.045, ry: 0.07, angle: 0, heightM: 95 },
      // Central Jezero delta fan scarp
      { type: 'delta', x: 0.48, y: 0.44, rx: 0.17, ry: 0.24, angle: -0.25, heightM: 125 },
      { type: 'ridge', x: 0.46, y: 0.26, rx: 0.08, ry: 0.09, angle: 0.4, heightM: 98 },
      { type: 'ridge', x: 0.53, y: 0.64, rx: 0.09, ry: 0.10, angle: -0.3, heightM: 105 },
      // Eastern small craters
      { type: 'crater', x: 0.84, y: 0.16, rx: 0.032, ry: 0.055, angle: 0, heightM: 68 },
      { type: 'crater', x: 0.81, y: 0.49, rx: 0.03, ry: 0.05, angle: 0, heightM: 62 },
    ];
    return {
      id: 'jezero',
      name: 'Jezero Crater',
      regionSubtitle: 'Neretva Vallis Delta & Syrtis Major Basin',
      missionReference: 'Perseverance / Mars 2020 Field Sector',
      centerLat: 18.3847,
      centerLon: 77.5806,
      datumElevationM: -2560,
      mapWidthKm: 12.0,
      mapHeightKm: 6.75,
      imageUrl: jezeroCraterImg,
      ambientTempC: -63,
      pressurePa: 718,
      baselineGcrMsVPerDay: 0.67,
      defaultStart: { x: 0.74, y: 0.62 },
      defaultTarget: { x: 0.34, y: 0.46 },
      scienceTargets: [
        {
          id: 'jez-sci-1',
          name: 'Wildcat Ridge Mudstone',
          kind: 'geology',
          instrument: 'SHERLOC / PIXL',
          composition: 'Hydrated sulfates & organic carbon biosignature target',
          priority: 'Critical',
          x: 0.41,
          y: 0.53,
        },
        {
          id: 'jez-sci-2',
          name: 'Brac Olivine Cumulate',
          kind: 'geology',
          instrument: 'SuperCam LIBS',
          composition: 'Carbonate-altered igneous bedrock (Seitah unit)',
          priority: 'High',
          x: 0.58,
          y: 0.72,
        },
        {
          id: 'jez-sci-3',
          name: 'Kodiak Mesa Ice Lens',
          kind: 'water_ice',
          instrument: 'RIMFAX GPR',
          composition: 'Subsurface pore-ice reflector at 1.8 m depth',
          priority: 'Critical',
          x: 0.55,
          y: 0.25,
        },
        {
          id: 'jez-sci-4',
          name: 'Enchanted Lake Siltstone',
          kind: 'geology',
          instrument: 'MASTCAM-Z / WATSON',
          composition: 'Fine-grained lacustrine claystone strata',
          priority: 'High',
          x: 0.36,
          y: 0.36,
        },
      ],
      shelters: [
        {
          id: 'jez-sh-1',
          name: 'Neretva Basalt Tube',
          shieldingFactor: 0.94,
          capacityAstronauts: 4,
          depthMeters: 6.5,
          x: 0.63,
          y: 0.46,
        },
        {
          id: 'jez-sh-2',
          name: 'Butler Plains Bunker',
          shieldingFactor: 0.91,
          capacityAstronauts: 6,
          depthMeters: 4.2,
          x: 0.82,
          y: 0.74,
        },
        {
          id: 'jez-sh-3',
          name: 'Belva Rim Vault',
          shieldingFactor: 0.96,
          capacityAstronauts: 4,
          depthMeters: 8.1,
          x: 0.28,
          y: 0.27,
        },
      ],
      dustFront,
      radiationZones,
      gridCols: GRID_COLS,
      gridRows: GRID_ROWS,
      grid: buildTerrainGrid(
        'jezero',
        -2560,
        12.0,
        6.75,
        17,
        features,
        42,
        0.52,
        6.8,
        dustFront,
        radiationZones,
        0.67
      ),
    };
  })(),

  gale: (() => {
    const dustFront: LandingZone['dustFront'] = {
      centerX: 0.31,
      centerY: 0.29,
      radiusX: 0.22,
      radiusY: 0.22,
      angleRad: 0.35,
      peakWindMs: 18.9,
      opticalDepthTau: 2.1,
    };
    const radiationZones: LandingZone['radiationZones'] = [
      { centerX: 0.62, centerY: 0.48, radius: 0.17, peakDoseMsVPerHr: 0.092 },
      { centerX: 0.25, centerY: 0.68, radius: 0.14, peakDoseMsVPerHr: 0.064 },
    ];
    const features: FeaturePrimitive[] = [
      // Mount Sharp layered ridges
      { type: 'ridge', x: 0.34, y: 0.72, rx: 0.18, ry: 0.18, angle: -0.4, heightM: 220 },
      { type: 'ridge', x: 0.36, y: 0.24, rx: 0.14, ry: 0.15, angle: 0.5, heightM: 185 },
      { type: 'ridge', x: 0.62, y: 0.18, rx: 0.16, ry: 0.14, angle: -0.2, heightM: 195 },
      // Vera Rubin scarp
      { type: 'delta', x: 0.16, y: 0.36, rx: 0.12, ry: 0.22, angle: 0.2, heightM: 135 },
      // Bagnold sand trough
      { type: 'trough', x: 0.74, y: 0.56, rx: 0.24, ry: 0.12, angle: -0.35, heightM: 115 },
    ];
    return {
      id: 'gale',
      name: 'Gale Crater',
      regionSubtitle: 'Aeolis Mons Foothills & Bagnold Dunes',
      missionReference: 'Curiosity / MSL Traverse Corridor',
      centerLat: -5.4018,
      centerLon: 137.8015,
      datumElevationM: -4500,
      mapWidthKm: 12.0,
      mapHeightKm: 6.75,
      imageUrl: galeCraterImg,
      ambientTempC: -58,
      pressurePa: 795,
      baselineGcrMsVPerDay: 0.64,
      defaultStart: { x: 0.84, y: 0.24 },
      defaultTarget: { x: 0.22, y: 0.56 },
      scienceTargets: [
        {
          id: 'gal-sci-1',
          name: 'Vera Rubin Hematite Ridge',
          kind: 'geology',
          instrument: 'ChemCam / APXS',
          composition: 'Iron-oxide diagenetic concretions & phyllosilicates',
          priority: 'Critical',
          x: 0.44,
          y: 0.52,
        },
        {
          id: 'gal-sci-2',
          name: 'Glen Torridon Clay Trough',
          kind: 'geology',
          instrument: 'SAM / CheMin',
          composition: 'Smectite clay-bearing mudstone unit',
          priority: 'High',
          x: 0.64,
          y: 0.68,
        },
        {
          id: 'gal-sci-3',
          name: 'Gediz Vallis Hydrated Talus',
          kind: 'water_ice',
          instrument: 'DAN Neutron Spectrometer',
          composition: 'Elevated subsurface hydration & sulfate cement',
          priority: 'Critical',
          x: 0.39,
          y: 0.35,
        },
      ],
      shelters: [
        {
          id: 'gal-sh-1',
          name: 'Bradbury Basalt Overhang',
          shieldingFactor: 0.92,
          capacityAstronauts: 4,
          depthMeters: 5.4,
          x: 0.72,
          y: 0.39,
        },
        {
          id: 'gal-sh-2',
          name: 'Pahrump Hills Cavern',
          shieldingFactor: 0.95,
          capacityAstronauts: 5,
          depthMeters: 7.2,
          x: 0.48,
          y: 0.77,
        },
      ],
      dustFront,
      radiationZones,
      gridCols: GRID_COLS,
      gridRows: GRID_ROWS,
      grid: buildTerrainGrid(
        'gale',
        -4500,
        12.0,
        6.75,
        53,
        features,
        46,
        -0.35,
        7.9,
        dustFront,
        radiationZones,
        0.64
      ),
    };
  })(),

  arcadia: (() => {
    const dustFront: LandingZone['dustFront'] = {
      centerX: 0.68,
      centerY: 0.74,
      radiusX: 0.25,
      radiusY: 0.20,
      angleRad: 0.15,
      peakWindMs: 14.8,
      opticalDepthTau: 1.45,
    };
    const radiationZones: LandingZone['radiationZones'] = [
      { centerX: 0.42, centerY: 0.36, radius: 0.15, peakDoseMsVPerHr: 0.058 },
    ];
    const features: FeaturePrimitive[] = [
      // Sinuous volcanic rille / fracture trough running center to lower-right
      { type: 'trough', x: 0.56, y: 0.48, rx: 0.28, ry: 0.055, angle: 0.32, heightM: 125 },
      { type: 'trough', x: 0.38, y: 0.44, rx: 0.12, ry: 0.05, angle: -0.45, heightM: 95 },
      // Small crisp craters
      { type: 'crater', x: 0.31, y: 0.08, rx: 0.028, ry: 0.045, angle: 0, heightM: 64 },
      { type: 'crater', x: 0.91, y: 0.57, rx: 0.036, ry: 0.055, angle: 0, heightM: 76 },
      { type: 'crater', x: 0.12, y: 0.62, rx: 0.026, ry: 0.042, angle: 0, heightM: 58 },
      { type: 'ridge', x: 0.92, y: 0.85, rx: 0.10, ry: 0.14, angle: 0.2, heightM: 110 },
    ];
    return {
      id: 'arcadia',
      name: 'Arcadia Planitia',
      regionSubtitle: 'Northern Lowland Subsurface Ice Sheet',
      missionReference: 'ISRU Water-Ice Extraction Survey Zone',
      centerLat: 39.21,
      centerLon: 189.04,
      datumElevationM: -3910,
      mapWidthKm: 12.0,
      mapHeightKm: 6.75,
      imageUrl: arcadiaPlanitiaImg,
      ambientTempC: -74,
      pressurePa: 760,
      baselineGcrMsVPerDay: 0.61,
      defaultStart: { x: 0.16, y: 0.28 },
      defaultTarget: { x: 0.78, y: 0.36 },
      scienceTargets: [
        {
          id: 'arc-sci-1',
          name: 'Scalloped Ice Sheet North',
          kind: 'water_ice',
          instrument: 'SHARAD / Neutron Probe',
          composition: 'Pure buried water-ice sheet < 0.7 m below regolith',
          priority: 'Critical',
          x: 0.49,
          y: 0.24,
        },
        {
          id: 'arc-sci-2',
          name: 'Thermokarst Basin South',
          kind: 'water_ice',
          instrument: 'Subsurface Core Drill',
          composition: 'Stratified glacial ice lens & dust-ice permafrost',
          priority: 'Critical',
          x: 0.48,
          y: 0.78,
        },
        {
          id: 'arc-sci-3',
          name: 'Erebus Lava Flow Rim',
          kind: 'geology',
          instrument: 'XRF Spectrometer',
          composition: 'Amazonian flood basalt & polygonal thermal fractures',
          priority: 'High',
          x: 0.24,
          y: 0.56,
        },
        {
          id: 'arc-sci-4',
          name: 'Phlegra Boundary Ice Lens',
          kind: 'water_ice',
          instrument: 'GPR Array',
          composition: 'High-purity H2O ice deposit (86% vol)',
          priority: 'High',
          x: 0.74,
          y: 0.62,
        },
      ],
      shelters: [
        {
          id: 'arc-sh-1',
          name: 'Arcadia Ice-Cavern Alpha',
          shieldingFactor: 0.93,
          capacityAstronauts: 6,
          depthMeters: 5.8,
          x: 0.38,
          y: 0.26,
        },
        {
          id: 'arc-sh-2',
          name: 'Rille Basalt Tube East',
          shieldingFactor: 0.95,
          capacityAstronauts: 4,
          depthMeters: 7.5,
          x: 0.66,
          y: 0.44,
        },
      ],
      dustFront,
      radiationZones,
      gridCols: GRID_COLS,
      gridRows: GRID_ROWS,
      grid: buildTerrainGrid(
        'arcadia',
        -3910,
        12.0,
        6.75,
        89,
        features,
        16,
        0.22,
        5.1,
        dustFront,
        radiationZones,
        0.61
      ),
    };
  })(),

  valles: (() => {
    const dustFront: LandingZone['dustFront'] = {
      centerX: 0.52,
      centerY: 0.58,
      radiusX: 0.26,
      radiusY: 0.16,
      angleRad: 0.1,
      peakWindMs: 21.4,
      opticalDepthTau: 2.35,
    };
    const radiationZones: LandingZone['radiationZones'] = [
      { centerX: 0.24, centerY: 0.22, radius: 0.15, peakDoseMsVPerHr: 0.088 },
      { centerX: 0.80, centerY: 0.30, radius: 0.16, peakDoseMsVPerHr: 0.094 },
    ];
    const features: FeaturePrimitive[] = [
      // Main Coprates Chasma deep canyon corridor
      { type: 'canyon', x: 0.28, y: 0.45, rx: 0.34, ry: 0.17, angle: 0.14, heightM: 320 },
      { type: 'canyon', x: 0.72, y: 0.58, rx: 0.32, ry: 0.18, angle: 0.18, heightM: 330 },
      // Steep northern slump alcove spurs
      { type: 'ridge', x: 0.64, y: 0.22, rx: 0.16, ry: 0.14, angle: 0.1, heightM: 250 },
      { type: 'ridge', x: 0.42, y: 0.66, rx: 0.12, ry: 0.09, angle: -0.2, heightM: 185 },
      { type: 'ridge', x: 0.22, y: 0.24, rx: 0.18, ry: 0.08, angle: 0.12, heightM: 210 },
    ];
    return {
      id: 'valles',
      name: 'Valles Marineris',
      regionSubtitle: 'Coprates Chasma Canyon Floor & Escarpment',
      missionReference: 'Deep Rift Tectonic Stratigraphy Sector',
      centerLat: -13.92,
      centerLon: 300.81,
      datumElevationM: -5840,
      mapWidthKm: 12.0,
      mapHeightKm: 6.75,
      imageUrl: vallesMarinerisImg,
      ambientTempC: -52,
      pressurePa: 940,
      baselineGcrMsVPerDay: 0.55,
      defaultStart: { x: 0.18, y: 0.45 },
      defaultTarget: { x: 0.82, y: 0.62 },
      scienceTargets: [
        {
          id: 'val-sci-1',
          name: 'Coprates Sulfate Strata',
          kind: 'geology',
          instrument: 'CRISM / Raman Laser',
          composition: 'Polyhydrated magnesium sulfate canyon wall outcrops',
          priority: 'Critical',
          x: 0.48,
          y: 0.48,
        },
        {
          id: 'val-sci-2',
          name: 'Melas Landslide Ice Apron',
          kind: 'water_ice',
          instrument: 'Neutron Albedo / GPR',
          composition: 'Shadowed talus subsurface ice-rich breccia',
          priority: 'Critical',
          x: 0.65,
          y: 0.49,
        },
        {
          id: 'val-sci-3',
          name: 'Chasma Olivine Basalt Seam',
          kind: 'geology',
          instrument: 'MOXIE / LIBS',
          composition: 'Exposed deep crustal mafic dyke sequence',
          priority: 'High',
          x: 0.34,
          y: 0.51,
        },
      ],
      shelters: [
        {
          id: 'val-sh-1',
          name: 'Coprates Cliff Cavern',
          shieldingFactor: 0.97,
          capacityAstronauts: 6,
          depthMeters: 11.4,
          x: 0.30,
          y: 0.54,
        },
        {
          id: 'val-sh-2',
          name: 'Chasma Floor Tube East',
          shieldingFactor: 0.96,
          capacityAstronauts: 4,
          depthMeters: 9.2,
          x: 0.68,
          y: 0.64,
        },
      ],
      dustFront,
      radiationZones,
      gridCols: GRID_COLS,
      gridRows: GRID_ROWS,
      grid: buildTerrainGrid(
        'valles',
        -5840,
        12.0,
        6.75,
        123,
        features,
        48,
        0.18,
        9.2,
        dustFront,
        radiationZones,
        0.55
      ),
    };
  })(),
};

export const LANDING_ZONE_LIST: LandingZone[] = [
  LANDING_ZONES.jezero,
  LANDING_ZONES.gale,
  LANDING_ZONES.arcadia,
  LANDING_ZONES.valles,
];

export const NASA_DATA_SOURCES: NasaDataSource[] = [
  {
    id: 'mro-hirise',
    name: 'MRO HiRISE & MOLA',
    agencyInstrument: 'NASA JPL / Univ. of Arizona · Mars Reconnaissance Orbiter',
    datasetRole: 'High-resolution digital terrain elevation models (DEM) and slope hazard masks (>25 deg suit safety cutoff)',
    nominalMetric: '0.25 m/px spatial resolution · 1.0 m vertical precision',
    cadence: 'Static Orbital Mosaic',
    endpointRef: 'PDS Geosciences Node / HiRISE DTM',
  },
  {
    id: 'perseverance',
    name: 'Perseverance (Mars 2020)',
    agencyInstrument: 'NASA JPL · SHERLOC, PIXL & RIMFAX GPR',
    datasetRole: 'Geological core sample prioritization, organic biosignature targets, and subsurface water-ice radar stratigraphy',
    nominalMetric: '10 m GPR penetration · 120 um elemental spot mapping',
    cadence: 'Sol-Indexed Traverse Targets',
    endpointRef: 'NASA Mars 2020 Mission Data Archive',
  },
  {
    id: 'curiosity-rad',
    name: 'Curiosity RAD',
    agencyInstrument: 'NASA JPL / SwRI · Radiation Assessment Detector',
    datasetRole: 'Galactic Cosmic Ray (GCR) surface baseline dosimetry and Solar Energetic Particle (SEP) acute exposure tracking',
    nominalMetric: '0.67 mSv/day GCR baseline · >2.5 mSv/hr SEP storm spike',
    cadence: 'Continuous Surface Dosimetry',
    endpointRef: 'MSL RAD PDS Planetary Plasma Node',
  },
  {
    id: 'insight-weather',
    name: 'InSight Weather (TWINS / APSS) & MARCI',
    agencyInstrument: 'NASA JPL / CAB · Temperature & Winds for InSight + MRO MARCI',
    datasetRole: 'Surface wind velocity vectors, barometric pressure, and regional dust storm optical depth (tau) tracking',
    nominalMetric: '2-22 m/s wind vectors · 610-950 Pa pressure · tau 0.4-2.4',
    cadence: 'Hourly Sol Atmospheric Grid',
    endpointRef: 'NASA PDS Atmospheres Node / MARCI',
  },
  {
    id: 'nasa-donki',
    name: 'NASA DONKI',
    agencyInstrument: 'NASA GSFC · Space Weather Database Of Notifications, Knowledge, Information',
    datasetRole: 'Real-time Coronal Mass Ejection (CME), X-Class Solar Flare (FLR), and SEP radiation storm early warning triggers',
    nominalMetric: 'Earth-Mars Parker Spiral propagation & flare class alerts',
    cadence: 'Live API / Real-Time Trigger',
    endpointRef: 'https://api.nasa.gov/DONKI/FLR',
  },
  {
    id: 'mars-constants',
    name: 'Mars Gravity & xEMU PLSS Physics',
    agencyInstrument: 'NASA JSC / EVA Exploration Architecture',
    datasetRole: 'Metabolic O2 consumption, battery thermal load, and slope-adjusted walking speed calibrated to Martian gravity',
    nominalMetric: 'g = 3.72076 m/s^2 (0.379g) · Sol = 24h 39m 35s · 95.3% CO2',
    cadence: 'Engineering Reference Model',
    endpointRef: 'NASA EVA-EXP-0042 Life Support Spec',
  },
];
