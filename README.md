# 🚀 AresNav: Multi-Mission Layered Marswalk Mission Planner

**AresNav** is an interactive, multi-layered Extra-Vehicular Activity (EVA) navigation and mission planning system built for the first human explorers on Mars. By integrating orbital topography, rover science targets, surface weather, UHF line-of-sight telemetry, and live space weather alerts from five NASA missions into a unified tactical interface, AresNav enables astronauts to plan safe traverses, monitor xEMU spacesuit life-support limits, and autonomously re-route to shelters during sudden solar or dust storms.

🔗 **Live Demo:** [Your Vercel Live Link Here]

---

## 🌟 Key Aerospace & Engineering Features

### 1. Multi-Mission Layered Tactical Mars Map
Explore real Martian landing zones (**Jezero Crater**, **Gale Crater**, **Arcadia Planitia**, and **Valles Marineris**) with four toggleable NASA data layers and a **2D Orbital / 3D Terrain Tilt** view toggle:
- **🗺️ Topography & Slope (MRO HiRISE & MOLA):** High-resolution elevation contours (`0.25 m/px`) with an automated `>25.0°` spacesuit slope hazard mask.
- **🌪️ Weather & Dust (InSight TWINS/APSS & MARCI):** Live surface wind vectors (`2–22 m/s`), atmospheric pressure (`718 Pa`), and approaching dust storm fronts.
- **☢️ Radiation & Solar (NASA DONKI & Curiosity RAD):** Real-time solar flare (`M4.2` / `X1.6`) radiation tracking (`0.67 mSv/day` GCR baseline) and safe lava-tube shelter markers.
- **🔬 Science & Ice Targets (Perseverance & Curiosity):** Sol-indexed geological biosignature sites (*Wildcat Ridge*, *Enchanted Lake*) and subsurface water-ice deposits.

### 2. Multi-Objective AI Route Planner & ARES-AI Copilot
Place custom **Start Base (EVA-1)** and **Target Waypoints** to compute three optimized traverse paths:
- **Safest Route:** Minimizes steep terrain slopes (`<25.0°`) and radiation exposure.
- **Fastest Route:** Minimizes traverse distance to conserve spacesuit consumables.
- **Max Science Route:** Optimizes waypoints to intersect high-priority geological and water-ice targets.
- **ARES-AI Copilot & xEMU Telemetry:** Calculates traverse distance (`km`), elevation gain, **xEMU PLSS Oxygen (`O₂`) reserve**, and battery drain calibrated to Mars surface gravity (`3.72076 m/s²`), providing real-time engineering recommendations.

### 3. Autonomous AI Re-Routing & Light-Time Delay Simulation
- Simulates the **~14m 18s one-way Earth-to-Mars light-time communication delay** (`~28m 36s` round-trip).
- When a **Solar Flare or Dust Storm Alert** triggers, AresNav's onboard AI automatically overrides manual waiting and executes an immediate **Emergency Shelter Re-Route** to the nearest safe bunker (*Neretva Basalt Tube*, *Belva Rim Vault*, *Butler Plains Bunker*).

### 4. Astronaut Visor HUD, Scout Rover Sync & Flight Plan Export
- **Visor HUD Mode:** Overlays an xEMU astronaut helmet visor frame with live biometric and suit telemetry (`Suit Pressure: 4.3 PSI`, `Heart Rate`, `Metabolic kcal/h`).
- **Autonomous Scout Rover:** Deploys an ahead-of-astronaut rover companion during EVA simulations to detect terrain hazards early.
- **UHF Line-of-Sight (LOS) & `.JSON` Export:** Evaluates radio signal shadows behind crater rims and exports structured EVA flight plans (`.JSON`) ready for suit/rover avionics.
- **1-Click Guided Demo (`▶ Demo`):** Automated interactive walkthrough showcasing all core NASA data integrations and emergency protocols.

---

## 🛰️ Official NASA Data Sources Integrated

| Mission / Dataset | Application in AresNav |
| :--- | :--- |
| **MRO HiRISE & MOLA (PDS Geosciences)** | Digital Elevation Models (DEM) & `25.0°` spacesuit slope safety cutoff |
| **Perseverance (SHERLOC, PIXL, RIMFAX)** | Geological sample targets & subsurface water-ice mapping |
| **Curiosity RAD (MSL PDS)** | GCR (`0.67 mSv/day`) & SEP (`>2.5 mSv/hr`) radiation exposure modeling |
| **InSight (TWINS/APSS) & MRO MARCI** | Martian surface wind, pressure (`610–950 Pa`), and dust storm tracking |
| **NASA DONKI Live API (`api.nasa.gov`)** | Real-time solar flare (`M4.2`, `X1.6`) and space weather alerts |
| **NASA JSC xEMU PLSS Architecture** | Metabolic oxygen and battery consumption modeling under `3.72 m/s²` gravity |

---

## 🛠️ Tech Stack
- **Frontend:** React, TypeScript, Tailwind CSS, Lucide Icons
- **Visualization & Audio:** Interactive HTML5 Canvas / SVG Tactical Map, 3D Terrain Tilt, Web Audio API Telemetry Cues
- **Data Integration:** NASA Open APIs (`DONKI`) + Calibrated Planetary Science Constants
- **Deployment:** Vercel

---

## 🚀 Running Locally

```bash
# Clone the repository
git clone https://github.com

# Navigate to project directory
cd aresnav-marswalk-planner

# Install dependencies
npm install

# Start development server
npm run dev
```

---

## 📄 License
This project is licensed under the **MIT License** — built as an open-source submission for the **NASA Space Apps Challenge**.
