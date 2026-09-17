# Agent Guidelines — ScubaFlow

Repo prototype for **ScubaFlow**: flowing, breath-controlled, zero-HUD neon buoyancy music game. Document outline architectural guidelines + design principles.

> [!IMPORTANT]
> **Agent Directive**: Keep document up to date with code changes.

---

## 1. Source of Truth

Repository code absolute source of truth:
- `index.html`: Clean, static page with local track upload & drag-and-drop, responsive mobile viewport, + Open Graph metadata.
- `game.js`: Core Phaser game logic + Web Audio procedural cave generation.
- `favicon.svg`: Glowing neon vector bubble icon.
- `scubaflow_og_image.png`: Graphic for social link preview.
- `PRIVACY.md`: Client-side local-only privacy policy.
- `LICENSE`: Open-source license pointing to tomaso.bulligan.com.

### Architectural & Development Philosophy
For ScubaFlow:
- **Assert-Based Testing:** Non-trivial logic leave exactly one runnable check in `runSelfTests()` inside `game.js`. Smallest test to fail if logic break. Heavy test frameworks prohibited. Trivial code need no tests.

---

## 2. Core Game Architecture & Systems

### Web Audio API Synchronization & Procedural Generation
- Procedurally generate cave paths, beats, depth zones, collectible clusters from uploaded audio track.
- Rhythm parsing, visual ripples, audio events sync via `audioContext.currentTime` (not Phaser delta frames).
- **Deterministic Procedural Level Generation (PRNG Seeding)**: Level generation deterministic for same audio file.
  - Compute 32-bit FNV-1a hash of track duration, sample rate, 1000-point sample channel data.
  - Seed custom Mulberry32 PRNG with hash.
  - All randomized choices (`forceSpawn` clusters, slope directions) use PRNG instead of `Math.random()`. Same audio produce identical layout, collectibles, max score.
- **Audio Normalization**: Stereo-safe in-place normalization before generation + playback. Scale channels uniformly to peak amplitude `0.98`.

### Breath Physics & State Machine
- Vertical motion via buoyancy + drag physics:
  - **buoyancy**: Controlled by lung volume $V_{lung} \in [0, 1]$, increase on spacebar or touch screen hold (`isBreathingIn()`), decrease on release (exhale).
  - **drag**: High vertical hydrodynamic drag dampens velocity.
  - **buoyancy tuning**: Buoyancy responsiveness `4.8`, vertical accel $a_y = 640$.
  - **mobile input & canvas scale**: Phaser `Scale.FIT` layout with `touch-action: none` prevents gesture collision on tap & hold.

### Start Countdown Timer
- Display start-of-dive overlay (`showTrackStartOverlay()`) for 2.0s, then numeric countdown (four 600ms ticks: "3", "2", "1", "FLOW!").
- Freeze player/buddy at start section, pause level time (`elapsedTime = 0`), render terrain during countdown.
- **Flat Starting Zone:** Flat wide start zone (`introDuration = (750 / baseScrollSpeed) * 1000` ms, $750\text{px}$ from start) on centerline (Y=250). Player (spawn `x = 250`) and buddy (spawn `x = 550`) spawn safe without wall collision. Block collectibles before `introDuration`.
- Visual ticks play procedural audio tone chirps via `AudioContext` oscillators. Audio engine + gameplay start after countdown.

### Autopilot & Music Visualizer Mode
- Autopilot toggle take over vertical buoyancy:
  - **Pathing**: Steer diver along cave centerline (`pPathY`) modulated by 3.6s sinusoidal breathing oscillation (ignore debris lookahead).
  - **Safety Clamping**: Clamp target coordinate against player shape checkpoints with safe $12\text{px}$ clearance buffer from ceiling/floor.
  - **Visual & Audio Sync**: Glide to clamped target via exp interp. Simulated spacebar (`this.simulatedSpaceDown`) toggle periodic 3.6s breath cycle (1.8s inhale, 1.8s exhale). Drive $V_{lung}$ integration, chest scaling, bubble release (mute breathing noise, bubble chirps, collectible tones in autopilot).

### Slope Clearance & Collision Navigability
- Prevent impossible collisions on steep slopes for $64\text{px}$ player shape:
  - Sample corridor slope $S = dy/dx$ from path center generator.
  - Scale `minCap` and `baseOffset` with `slopeClearance = 28.5 + (S < 0 ? -29.0 * S : 32.0 * S)` to expand cave on steep sections.
  - Tunnels stay navigable. Procedural collectibles (up to $24\text{px}$ offset, clamped $\ge 40\text{px}$ clear from boundaries) attainable without collision.
- **Stable Cave Geometry**: Cave boundaries (`getWallOffsets`, `drawTerrain`) stable, not warped by beat pulses.

### End of Dive Sequence
- Level finish when player reach end (`player.x >= targetEndX` where `targetEndX = 250 + (songLengthMs / 1000) * baseScrollSpeed`), track finish (`elapsedTime >= songLengthMs`), or `musicSource.onended` fire.
  - **Constant Scroll Speed:** Keep horizontal scroll speed constant (`scrollSpeed = baseScrollSpeed`).
  - **Seamless End (No Invisible Wall):** Disable clamping. Player glide forward smoothly during 2s camera fade (to `#020514`) + Web Audio volume ramp-down (to `0.0001`) before results card.
- `musicSource.onended` mark audio complete when tab unfocused.
- Redundant `setTimeout` fallback in `startFadeout` with Phaser `time.delayedCall` render results card in DOM when window blurred.
- Camera fade out `#020514`, master gain ramp down `0.0001`, gameplay systems active during transition.

### Zero-HUD Game Controls & Lifecycle Management
- **Translucent Quick Controls Dock:**
  - Minimal top-right corner dock (`opacity: 0.45` / `0.6` on touch, glows on hover/focus):
    - `btn-fullscreen`: Toggles borderless HTML5 Fullscreen (`F` key). Globally registered across intro screen, gameplay, pause menu, and results card. Feature-detects `fullscreenEnabled` to gracefully hide on unsupported platforms (e.g. iPhone Safari).
    - `btn-pause`: Toggles pause overlay (`Esc` / `P` keys). Hidden on intro screen, visible during dive.
  - **Mobile Touch Isolation (`isInteractiveUI` & `bindFastTap`):** Prevents window-wide touch breathing listeners (`preventDefault()`) from blocking dock and modal button taps. `bindFastTap` triggers instantly on touch without 300ms mobile delay.
- **Pause & Resume Lifecycle:**
  - `togglePause()` / `pauseDive()` suspends Web Audio clock (`audioContext.suspend()`), pauses update loop, renders glass pause modal displaying current score, flow multiplier (`this.scoreMultiplier`), and elapsed time.
  - `resumeDive()` resumes Web Audio (`audioContext.resume()`) and hides modal (`Esc` / `P` keys).
  - `restartDive()` restarts dive from beginning (`R` key in-game, in pause, or on results screen). Completely resets silt-out state (`siltActive`, `siltTime`, `currentSiltDuration`, `siltOverlay`, `siltVignetteImage`), kills living particles across `activeSiltBursts` and emitters instantly, resets PostFX chromatic offsets, flashlight intensity, audio lowpass filter, `this.scoreMultiplier = 1`, `this.comboCount = 0`, and `this.buddyState = 'normal'`. Clears lingering camera `fadeOut` effects with `resetFX()`, respawns all debris sprites via `spawnCollectibles()`, resets `clusterCollected = {}`, removes results card (`#complete-screen` / `.results-card`), and resets `this.baseHue = 0`.
  - `exitToTrackSelect()` exits to track selection menu (`X` key in pause or on results screen). Removes results card, destroys Phaser instance, and unhides uploader overlay.
- **Results Card Controls:**
  - Displays "DIVE AGAIN (R)" and "SELECT NEW TRACK (X)" wired with `bindFastTap` for instant mobile taps and keyboard hotkeys (`R`/`X`).
- **Start Countdown Avatar Clarity:**
  - During countdown ("3, 2, 1"), player displays "YOU 🫧" and buddy displays "FOLLOW ME 👌" diegetic speech bubbles. Both hide automatically when "FLOW!" triggers.
- **Mobile SOTA Auto-Fullscreen & Orientation Guard:**
  - On "Begin Dive" button click, touch devices automatically request borderless fullscreen and attempt `screen.orientation.lock('landscape')`.
  - Non-intrusive `#rotate-device-overlay` displays an animated rotating device prompt whenever a mobile device is in portrait orientation, vanishing instantly when rotated to landscape.
- **Seamless Desktop Borderless Viewport:**
  - `#game-container` fills 100% width and height without fixed 1200x700 box borders or glowing boxes in fullscreen / F11 mode.
  - `#game-container canvas` suppresses browser `:focus-visible` outlines to eliminate white boundary lines upon keyboard input.
- **Unified Countdown & Dive Background Luminance:**
  - Base colors unified to pure void `#000206` across HTML `body`, `--bg-color`, `.ambient-glow`, `#game-container`, `#intro-screen`, Phaser game config, decoder overlay, camera `fadeOut`, and `this.cameras.main.setBackgroundColor` (`lightnessBoost = 0.012`), eliminating blue tint bleed and brightness shifts.

### Zero-HUD Diegetic Signals & Balance Mechanics
Feedback physical + auditory:
- **Depth**: Ambient background HSL color shift + buddy depth.
- **Lung Volume**: Player sprite chest expansion (ellipse scale) + breathing audio synth freq.
- **Failure - Silt-Out & Light Cone Failure**: Wall collision blind player with particle cloud. Wait for silt to clear while steady.
  - **Relative Duration**: Silt recovery time proportional to vertical impact velocity (`impactVy`), scale 0.44x-1.33x of `siltDuration` (~800ms to ~2400ms). Duration scale inverse with `baseScrollSpeed` (factor $50/\text{baseScrollSpeed}$).
  - **Dynamic Color Shifts**: Shift `this.baseHue` by 120 deg on wall collision, update cave palette + silt particle color.
  - **Light Failure**: Primary light cone contract to 5% capacity on impact, scale back to 100% as silt decay.
  - **Aura Vaporization**: Active neon oscilloscope aura rings reset to 0 on impact.
  - **Guideline Lifeline**: Buddy guide line on terrain layer (depth 0), obscured by silt. Player follow buddy speech bubbles ("👌?") at depth 20.
- **AI Buddy**: Speech bubbles ("👌?", "👌!") assist player. Terrain clamping (15px margin, 2px absolute margin) prevent wall collision / sediment.
- **Realistic Flashlight Occlusion**: Flashlight beam raycast shadow-casting obstructed by terrain protrusions. Snow illumination check interpolate occluded beam points.

### Active Debris-Driven Multipliers
Multiplier performance-driven:
- **The Combo Engine**: Collect 15 consecutive neon debris without wall hit add $+1$ multiplier.
- **Cluster Combo Boost**: Collect 100% procedural cluster (`clusterId`) award $+5$ combo point boost.
- **Flow Decay Meter**: No debris for 12.5s decay multiplier by $1$. Collect debris refill buffer to 100%.

### "Hyper-Flow" State ($\ge \times 9$)
Multiplier $\ge \times 9$ (cap intensity at $\times 9$):
- **Scrolling Rainbow Contours**: Terrain line stroke hues cycle over time.
- **Background Saturation Bleed**: Background color bleed into saturated breathing pulse matrix.
- **Particle Frenzy**: Marine snow motes speed up.

### "Super-Flow" State ($\ge \times 10$)
Multiplier $\ge \times 10$:
- **Chromatic Shockwave & Zoom Thud Pulse**: Multiplier $\ge 10$ trigger chromatic aberration flash + camera zoom thud + expanding neon ripples.
- **Overcharged Oscilloscope Aura**: 7 aura rings increase phase speed, oscillation amp, thickness, glow brightness, rainbow gradient cycle.
- **Warp Speed Marine Snow Motion Blur**: Snow particles speed up + stretch horizontally into motion blur streaks.
  - **Coloring & Thickness**: Illuminated streaks neon cyan (`0x00f0ff`, alpha `0.85`, $1.8\times$ size). Unilluminated streaks light blue (`0x38bdf8`, target alpha `0.25`).
- **Visual Scaling Cap**: Super-Flow visual scaling capped at $\times 15$.
- **Superflow Text Notifications**: Level 10+ spawn yellow text (`🫧 SUPERFLOW x{multiplier}! 🫧`).

### Uncapped Deterministic Simulation
- Rating calculation via `calculateMaxPotentialPoints()`.
- Simulation replicate perfect run (all items, no silt) with combos, cluster boosts, decay gaps to compute max score ($S_{max}$). 5-star rating at $\ge 95\%$ $S_{max}$.

---

## 3. Development & Environment Setup

Activate `scubaflow` micromamba env:
```bash
micromamba activate scubaflow
```

Run game locally:
1. Start static HTTP server in repo root:
   ```bash
   python3 -m http.server 8000
   ```
2. Open `http://localhost:8000` in browser.

### GitHub Pages Deployment
1. Push repo to GitHub:
   ```bash
   git push origin main
   ```
2. Enable GitHub Pages in Repository **Settings -> Pages**:
   - **Source**: **Deploy from a branch**.
   - **Branch**: `main` (folder `/root`), **Save**.

---

## 4. Verification & Testing Guidelines

### Skipping Agentic Browsing
- DO NOT run automated agentic browser subagents for visual/gameplay testing.
- Use diagnostic self-tests + request human feedback for UI verification.
