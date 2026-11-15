# 🚀 AresNav: Multi-Mission Layered Marswalk Mission Planner

**AresNav** is a hyperlocalized, multi-layered Extra-Vehicular Activity (EVA) navigation and mission planning system built for the first human explorers on Mars. While regional tools like JPL's Mars Trek are designed for global planning, AresNav integrates orbital topography, rover science targets, surface weather, UHF line-of-sight telemetry, and live space weather alerts from five NASA missions into a unified tactical interface and **Spacesuit Helmet Visor HUD**—empowering astronauts to plan safe traverses and autonomously re-route to shelters during sudden solar or dust storms without waiting ~28 minutes for Earth commands.

- 🌐 **Live Interactive Web App:** [https://vercel.app](https://vercel.app)
- 🎬 **3-Minute Demo Video:** [https://youtu.be/DsmS7NwDN50](https://youtu.be/DsmS7NwDN50)
- 🏆 **Challenge:** Interplanetary Survival Guide: Martian Map (2026 NASA Space Apps Challenge)
- 👩‍🚀 **Team:** Gujju SpaceTech (`DipalPatel`)

---

## 🌟 Key Aerospace & Engineering Features

### 1. Multi-Mission Layered Tactical Mars Map
Explore real Martian landing zones (**Jezero Crater**, **Gale Crater**, **Arcadia Planitia**, and **Valles Marineris**) with four toggleable NASA data layers:
- **🗺️ Topography & Slope (MRO HiRISE & MOLA):** High-resolution elevation contours (`0.25 m/px`) with an automated `>25.0°` spacesuit slope hazard mask.
- **🌪️ Weather & Dust (InSight TWINS/APSS & MARCI):** Live surface wind vectors (`2–22 m/s`), atmospheric pressure (`718 Pa`), and approaching dust storm fronts.
- **☢️ Radiation & Solar (NASA DONKI & Curiosity RAD):** Real-time solar flare (`M4.2` / `X1.6`) radiation tracking (`0.67 mSv/day` GCR baseline) and safe lava-tube shelter markers.
- **🔬 Science & Ice Targets (Perseverance & Curiosity):** Sol-indexed geological biosignature sites (*Wildcat Ridge*, *Enchanted Lake*, Mount Sharp boxwork formations) and subsurface water-ice deposits.

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
- **UHF Line-of-Sight (LOS) & `.JSON` Export:** Evaluates radio signal shadows behind crater rims and exports avionics-ready EVA flight plans (`.JSON`).
- **1-Click Guided Demo (`▶ Demo`):** Automated interactive walkthrough showcasing all core NASA data integrations and emergency protocols.

---

## 🛠️ Tech Stack
- **Frontend:** React, TypeScript, Tailwind CSS, Lucide Icons
- **Visualization & Audio:** Interactive HTML5 Canvas / SVG Tactical Map, Web Audio API Telemetry Cues
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
npm install --legacy-peer-deps

# Start development server
npm run dev
```

---

## 🛰️ Official NASA Data & Resources Used

| Mission / Resource | Application in AresNav | Official Link |
| :--- | :--- | :--- |
| **JPL Mars Trek** | Landing site context & traverse route reference | [trek.nasa.gov/mars](https://nasa.gov) |
| **NASA Planetary Data System (PDS)** | MRO HiRISE/MOLA DEMs (`0.25 m/px`), `25.0°` slope cutoff & rover datasets | [pds.nasa.gov](https://nasa.gov) |
| **Mars Perseverance Raw Images & Science** | *Wildcat Ridge* & *Enchanted Lake* biosignature/ice targets | [mars.nasa.gov/mars2020](https://nasa.gov) |
| **Curiosity Rover (Mount Sharp & RAD)** | Boxwork geology & radiation baselines (`0.67 mSv/day` GCR) | [mars.nasa.gov/msl](https://nasa.gov) |
| **NASA DONKI Space Weather API** | Live solar flare (`M4.2`, `X1.6`) & CME storm alerts | [api.nasa.gov](https://nasa.gov) |
| **USGS-NASA Planetary Geologic Mapping** | Standardized Martian geologic unit & hazard mapping | [astrogeology.usgs.gov](https://usgs.gov) |

---

## 📄 License
This project is licensed under the **MIT License** — built as an open-source submission for the **2026 NASA Space Apps Challenge**.
