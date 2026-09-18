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
- **High-Resolution Beat Parsing & Pacing Tiers**:
  - Dual-stream transient extraction blending sub-bass ($<180\text{Hz}$ lowpass at $50\%$) with positive Spectral Flux onset ($\Delta\text{RMS}^+$ at $1.6\times$) and raw RMS ($25\%$), evaluated with adaptive local moving-window thresholding and debouncing. Dynamically tuned by track energy: calm tracks (<0.08 energy) use 350ms debouncing, $1.38\times$ onset ratio, and 0.013 noise floor to pulse naturally with musical/vocal phrases without vibrato jitter; intense tracks use 160ms debouncing and $1.25\times$ ratio for rapid drum/kick transients.
  - Three distinct pacing tiers: Calm (<0.08 energy: 45 px/s, depth 200–500, spacer 3000ms), Moderate (55 px/s, depth 150–550, spacer 2000ms), and Intense (>=0.16 energy: 68 px/s, depth 100–600, spacer 1400ms).
  - Sweeping winding cave bends with up to 165px vertical excursion (`sin * 110 + cos * 55`) delivering dramatic climbs and dives across all tracks without artificial flattening on low-dynamic music.
- **Harmonic Pentatonic Audio Feedback**:
  - Collectibles play notes ascending through C Major Pentatonic scale ($C_5, D_5, E_5, G_5, A_5 \dots$) matching cluster pickup sequence.
  - Cluster completion triggers triangle-wave major harmonic resolution chord.
- **Deterministic Procedural Level Generation (PRNG Seeding)**: Level generation deterministic for same audio file.
  - Compute 32-bit FNV-1a hash of track duration, sample rate, 1000-point sample channel data.
  - Seed custom Mulberry32 PRNG with hash.
  - All randomized choices (`forceSpawn` clusters, slope directions) use PRNG instead of `Math.random()`. Same audio produce identical layout, collectibles, max score.
- **Audio Normalization**: Stereo-safe in-place normalization before generation + playback. Scale channels uniformly to peak amplitude `0.98`.
- **Master Dynamics Compressor**: Soft limiter (`DynamicsCompressorNode`, threshold `-18dB`, knee `12dB`, ratio `4:1`) inserted between master gain and audio destination, preventing collectible tones and silt rumbles from clipping or masking user music.
- **Live Audio Reactivity & AnalyserNode**: Live 256-point FFT `AnalyserNode` connected downstream of silt lowpass filter. Features 3-tier acoustic signal routing:
  - **Sub-Bass Transient Flux** ($\Delta\text{Bass}^+ = \max(0, \text{Bass}_t - \text{Bass}_{t-1})$ with $e^{-14 \cdot dt}$ decay): Delivers punchy transient kicks to halogen torch bloom (`liveFlare`) and cleanly fuses with offline beat pulse (`currentBeatPulse`) with zero DC floor trapping (allowing physical cave walls to breathe and fully contract).
  - **Sub-Bass DC Level** (Acoustic Pressure): Modulates 2.5D cavern backwall ambient grotto depth (`backwallAlpha`) and drives monotonic liquid micro-refraction phase accumulation (`fx.fxTime`).
  - **Audible Spectrum Energy** (Mids/Highs Bins 0-64): Drives lowpass-smoothed WebGL water caustics shimmer (`fx.causticIntensity`) and marine snow bioluminescent glint (`audioGlint`).

### Breath Physics & State Machine
- Vertical motion via buoyancy + drag physics:
  - **buoyancy**: Controlled by lung volume $V_{lung} \in [0, 1]$, increase on spacebar or touch screen hold (`isBreathingIn()`), decrease on release (exhale).
  - **drag**: High vertical hydrodynamic drag dampens velocity.
  - **buoyancy tuning**: Buoyancy responsiveness `4.8`, vertical accel $a_y = 640$.
  - **mobile input & canvas scale**: Phaser `Scale.FIT` layout with `touch-action: none` prevents gesture collision on tap & hold.
  - **bubble drift & scale**: Exhaled bubbles drift backwards (`speedX: [-45, -15]`) relative to forward-swimming diver with natural turbulent scale variance (`scale: [0.10, 0.42]`).

### Start Countdown Timer
- 3.0s unified start sequence (four 750ms ticks: "3", "2", "1", "FLOW!"), displaying track title and duration overlay concurrently above countdown numbers. Eliminates dead-air delays.
- **Flat Starting Zone & Active Horizontal Trim:** Flat wide start zone (`introDuration = (750 / baseScrollSpeed) * 1000` ms, $750\text{px}$ from start) on centerline. Player spawns at $x = 250$ centered between corridor walls (`getPlayerCorridorCenterY(250)`) with neutral buoyancy (`V_lung = 0.5`, `buoyancySmooth = 0.5`, `vy = 0`, `rotation = 0`). Buddy spawns at $x = 530$ ($250 + 280\text{px}$ lead, `getBuddyTargetY(530, 0)`) facing forward (`scaleX = 1`, `rotation = 0`, `buddyState = 'normal'`). Diver limbs initialize and hold technical frog-kick glide trim (`updateDiverLimbs(0)`), completely eliminating position snapping or awkward frozen postures across countdown and level restarts. Block collectibles before `introDuration`.
- Visual ticks play procedural audio tone chirps via `AudioContext` oscillators. Audio engine + gameplay start after countdown.

### Autopilot & Music Visualizer Mode
- Autopilot toggle take over vertical buoyancy:
  - **Pathing**: Steer diver along cave centerline (`pPathY`) modulated by 3.6s sinusoidal breathing oscillation (ignore debris lookahead).
  - **Safety Clamping**: Clamp target coordinate against player shape checkpoints with safe $12\text{px}$ clearance buffer from ceiling/floor.
  - **Visual & Audio Sync**: Glide to clamped target via exp interp. Simulated spacebar (`this.simulatedSpaceDown`) toggle periodic 3.6s breath cycle (1.8s inhale, 1.8s exhale). Drive $V_{lung}$ integration, chest scaling, bubble release (mute breathing noise, bubble chirps, collectible tones in autopilot).

### Slope Clearance, Macro Caverns & Collision Navigability
- Prevent impossible collisions on steep slopes for $64\text{px}$ player shape:
  - Sample corridor slope $S = dy/dx$ from path center generator.
  - Scale `minCap` and `baseOffset` with `slopeClearance = 31.0 + (S < 0 ? -34.0 * S : 36.0 * S)` to expand cave on steep sections.
  - Tunnels stay navigable. Procedural collectibles (up to $24\text{px}$ offset, clamped $\ge 40\text{px}$ clear from boundaries) attainable without collision.
- **Macro Cavern Chambers & Rhythmic Beat Bounce**:
  - Dynamic macro cavern chamber breathing (`chamberSwell = Math.sin(wx * 0.0012) * 8 * (1.0 - localEnergy * 0.5)`) smoothly breathes ambient/breakdown passages (up to 85px base offset), contracting to tight technical challenge corridors (56–78px) during intense drops.
  - Cavern boundaries (`getWallOffsets`) expand outward with beat hits (`beatPulseOffset = (currentBeatPulse || 0) * 8.5 * energyFactor * multiBeatScale`), driven by a continuous attack-decay envelope ($65\text{ms}$ attack swell on calm tracks, $28\text{ms}$ on intense tracks) followed by zero-velocity quadratic decay. On calm tracks (<0.08 energy), `energyFactor` scales softly to a serene 0.4–1.0px breath, eliminating mechanical twitches on vocal/choral music.
  - Tightly tuned challenge corridors ($56\text{–}78\text{px}$ base offset, $\ge 112\text{px}$ total corridor clearance) preserve high-speed flow and danger.

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
  - `restartDive()` restarts dive from beginning (`R` key in pause or on results screen). Completely resets silt-out state (`siltActive`, `siltTime`, `currentSiltDuration`, `siltOverlay`, `siltVignetteImage`), kills living particles across `activeSiltBursts` and emitters instantly, resets PostFX chromatic offsets, flashlight intensity, audio lowpass filter, `this.scoreMultiplier = 1`, `this.comboCount = 0`, and resets player and buddy to active horizontal trim (`getPlayerCorridorCenterY(250)` at $x=250$, `getBuddyTargetY(530, 0)` at $x=530$, `buddy.scaleX = 1`, `buddyState = 'normal'`, `updateDiverLimbs(0)`). Resets both main camera and `uiCamera` scroll (`scrollX = 0, scrollY = 0`), clears lingering camera `fadeOut` effects with `resetFX()`, respawns all debris sprites via `spawnCollectibles()`, resets `clusterCollected = {}`, removes results card (`#complete-screen` / `.results-card`), and resets `this.baseHue = 0`.
  - `exitToTrackSelect()` exits to track selection menu (`X` key in pause or on results screen). Stops all audio nodes, closes and nullifies `audioContext` and `window.customAudioContext`, clears all countdown/Phaser timers, removes results card, destroys Phaser instance, and unhides uploader overlay.
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
- **Responsive Zero-Scrollbar Menus (Intro & Results)**:
  - Both intro overlay and results screen use responsive CSS grid (`.intro-grid`, `.results-grid`):
    - Widescreen & landscape viewports ($>1.2$ aspect ratio or height $\le 560\text{px}$) split controls into a 2-column layout (Left: instructions/stats; Right: uploader/buttons), ensuring content height stays $<300\text{px}$ without vertical scrollbars.
    - Narrow portrait viewports collapse gracefully to a single compact column with scaled typography (`clamp`).
    - Custom glowing cyberpunk scrollbars (`scrollbar-width: thin`, cyan glowing thumb) styled for extreme micro-viewports, eliminating default gray OS scrollbars.
- **Start Menu Hotkeys & Desktop Key Guide:**
  - Intro screen displays diegetic key guide: `F` (Fullscreen), `P` / `Esc` (Pause).
  - Pressing `Enter` when track is loaded automatically triggers "Begin Dive (Enter)".
- **Honest Track Best & Autopilot Isolation:**
  - Track Best binds points score and collectible % to a single coherent run, preventing cross-run stat combinations (Frankenstein stats).
  - Autopilot runs display visualizer banner and do not overwrite human high score records.
- **Unified Countdown & Dive Background Luminance:**
  - Base colors unified to pure void `#000206` across HTML `body`, `--bg-color`, `.ambient-glow`, `#game-container`, `#intro-screen`, Phaser game config, decoder overlay, camera `fadeOut`, and `this.cameras.main.setBackgroundColor` (`lightnessBoost = 0.012`), eliminating blue tint bleed and brightness shifts.

### Zero-HUD Diegetic Signals & Balance Mechanics
Feedback physical + auditory:
- **Lung Volume**: Buoyancy vertical trajectory + breathing audio synth pitch modulation ($300 + V_{lung} \cdot 600\text{Hz}$) + bubble emission on exhale + organic diver torso expansion ($14\text{–}20\text{px}$).
- **Failure - Silt-Out & Light Cone Failure**: Wall collision blind player with particle cloud. Wait for silt to clear while steady.
  - **Relative Duration**: Silt recovery time proportional to vertical impact velocity (`impactVy`), scale 0.44x-1.33x of `siltDuration` (~800ms to ~2400ms). Duration scale inverse with `baseScrollSpeed` (factor $50/\text{baseScrollSpeed}$).
  - **Dynamic Color Shifts**: Shift `this.baseHue` by 120 deg on wall collision, update cave palette + silt particle color.
  - **Light Failure**: Primary light cone contract to 5% capacity on impact, scale back to 100% as silt decay.
  - **Buddy Rescue Escort**: Buddy decelerates to $90\text{px}$ lead (from 280px normal), faces backward (`scaleX = -1`) during the full `assisting → clearing → relieved` state sequence — not just while silt is active.
  - **Aura Vaporization**: Active neon oscilloscope aura rings reset to 0 on impact.
  - **Guideline Lifeline**: Buddy guide line with 8px sampling and directional cave exit arrows rotated along slope tangent. Rendered on dedicated `guideLineGraphics` (depth 1 normally, depth 15 during rescue states — above silt cloud at depth 9 and silt overlay at depth 12). Simulates following the guide line by touch in zero visibility. Player follow buddy speech bubbles ("👌?") at depth 20.
- **Active AI Companion Guide**:
  - **Center-Channel Scout Drafting**: Buddy tracks true corridor midpoint (`(floorY + ceilY) * 0.5`) with organic sinusoidal breathing sway ($\pm 10\text{px}$) and generous boundary margins ($18\text{–}32\text{px}$). Fluid exponential glide ($k = 2.2$ on Y, $k = 0.9$ on X) absorbs high-frequency rock spikiness and decouples flipper flutter, eliminating jitter and rock hugging.
  - **Horizontal Trim**: Divers maintain realistic technical cave diving horizontal trim with level forward-facing dive lamps, eliminating unnatural tilt jitter.
- **Realistic Flashlight Occlusion & Convex Dome Wavefront**: Flashlight beam raycast shadow-casting obstructed by terrain protrusions. Rendered as 3 expanding optical cones (ambient outer cone, focused mid beam, and hot white core) terminating in forward-projecting convex spherical dome wavefront caps, eliminating vertical segmentation chops and unnatural pinched bullet points. Snow illumination check interpolates occluded beam points.
  - **Zero-GC Raycast Caching**: `playerLightCache` and `buddyLightCache` pre-allocate static 32-point coordinate buffers on scene initialization, mutating points in-place during raycasting to eliminate 7,200 object allocations/second during active dive gameplay.
- **Mobile Web Haptics API (`navigator.vibrate`)**:
  - Breath transition: $12\text{ms}$ tap on inhalation/exhalation turnaround.
  - Collectibles: $8\text{ms}$ click on debris pickup, $[20, 35, 25]\text{ms}$ double-pulse chord on cluster completion.
  - Wall impact: $40-90\text{ms}$ solid rumble scaled to impact velocity. Muted during autopilot.

### Active Debris-Driven Multipliers
Multiplier performance-driven:
- **The Combo Engine**: Collect 15 consecutive neon debris without wall hit add $+1$ multiplier.
- **Cluster Combo Boost**: Collect 100% procedural cluster (`clusterId`) award $+5$ combo point boost.
- **Flow Decay Meter**: No debris for 12.5s decay multiplier by $1$. Collect debris refill buffer to 100%.
- **Continuous Multiplier Smoothing (`smoothVisualMultiplier`)**: Visual attributes (terrain stroke width, neon fill alpha, saturation boost, aura ring expansion, marine snow speed) smoothly interpolate with exponential damping towards integer `scoreMultiplier`, eliminating visual snapping on combo pickups, flow decay, or silt impacts.

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

### Cinematic Visuals & PostFX Pipeline
- **Living Underwater Micro-Refraction**: WebGL `PsychedelicFX` shader applies subtle organic liquid wave distortion to screen UVs (`uTime`).
- **Dynamic Bioluminescent Caustics**: Voronoi-approx underwater light mesh (`uCausticIntensity`) shimmers with continuous lowpass audio reactivity and silky quadratic falloff across cave walls.
- **Deep-Sea Edge Vignette**: Smooth radial contrast falloff (`dot * 0.85`) gently dimming screen corners and edges toward pitch-black void `#000206` without washing out scene contrast.
- **Radiant Diamond Shard Debris & Glint Sparks**: Collectibles rendered as glowing multi-stop diamond crystals with rotating core and outer neon aura. Debris explosions release 4-point diamond glint stars.
- **Translucent Scuba Bubbles & Specular Sheen**: Dedicated procedural bubble texture featuring spherical glass membrane, internal refraction, and dual specular light highlights for breathing exhales and ambient floating bubbles.
- **Luminous Lamp Lens Halos & Fused Audio Reactivity**: Player and buddy dive lamps emit radiant multi-ring halogen bulb blooms ($38\text{px}$ optical flare) at beam origins with smooth optical falloff. Fused rhythm engine (`Math.max(currentBeatPulse, liveBassTransient)`) pulses flashlight cone luminosity and bulb bloom halo in sync with musical beats across all genres.
- **2.5D Multi-Plane Cavern Depth & Parallax Sandwich**:
  - **Recessed Cavern Backwall (`depth -0.5`)**: Fills corridor between ceiling and floor with an ambient grotto tone modulated by sub-bass acoustic pressure, providing clean deep void contrast for neon diver silhouettes and forward-projecting volumetric beams without artificial vector spotlight discs.
  - **Opaque Solid Rock Mask (`depth 0.0`)**: Solid void `#000206` fill extending outward from cave ceiling and floor boundaries, physically occluding all background layers outside the corridor and preserving crisp, high-contrast neon boundary strokes.
  - **Near-Field Foreground Rock Silhouettes (`depth 22`)**: Procedural dark jagged stalactites and arches scrolling at $1.35\times$ camera speed across extreme foreground, occluding diver and buddy for a visual parallax sandwich.
  - **Z-Perspective Marine Snow (`depth -1.5`)**: Motes assigned perspective depth $z \in [0.35, 2.0]$, scaling drift velocity and particle radius by $1/z$, rendered behind corridor terrain at `depth -1.5` so cave walls physically occlude particles without visual pop or overlap.

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
