# Agent Guidelines — ScubaFlow

Welcome, Agent. This repository contains the prototype for **ScubaFlow**, a flowing, breath-controlled, zero-HUD neon buoyancy music game. This document outlines the architectural guidelines and design principles that MUST be followed.

> [!IMPORTANT]
> **Agent Directive**: This document must be kept up to date. You must update `AGENTS.md` and keep it current with code changes when necessary.

---

## 1. Source of Truth

The repository code is the absolute source of truth:
- [index.html](file:///home/tomaso/projects/scubaflow/index.html): Clean, static-only page featuring local music track upload and Open Graph social sharing metadata.
- [game.js](file:///home/tomaso/projects/scubaflow/game.js): Contains the Core Phaser game logic and Web Audio procedural cave generation.
- [favicon.svg](file:///home/tomaso/projects/scubaflow/favicon.svg): Sleek, glowing neon vector bubble icon used as the site's favicon.
- [scubaflow_og_image.png](file:///home/tomaso/projects/scubaflow/scubaflow_og_image.png): Premium high-resolution graphic used for social media link sharing previews.
- [PRIVACY.md](file:///home/tomaso/projects/scubaflow/PRIVACY.md): Simple, client-side local-only processing privacy policy statement.
- [LICENSE](file:///home/tomaso/projects/scubaflow/LICENSE): Open-source license file pointing to tomaso.bulligan.com.
- [.agents/ponytail.md](file:///home/tomaso/projects/scubaflow/.agents/ponytail.md): Defines the Ponytail Philosophy.

### Architectural & Development Philosophy
All changes, architectures, and updates MUST strictly comply with the **Ponytail Philosophy** defined in [.agents/ponytail.md](file:///home/tomaso/projects/scubaflow/.agents/ponytail.md).

For ScubaFlow, this specifically means:
- **Assert-Based Testing:** Non-trivial logic must leave behind exactly one runnable check in `runSelfTests()` inside [game.js](file:///home/tomaso/projects/scubaflow/game.js)—the smallest thing that fails if the logic breaks. Heavy testing frameworks or fixtures are prohibited. Trivial one-liners need no tests.

---

## 2. Core Game Architecture & Systems

### Web Audio API Synchronization & Procedural Generation
- The game procedurally generates cave paths, beats, depth zones, and collectible clusters directly from any custom audio track uploaded in the browser.
- All rhythm parsing, concentric visual ripples, and audio events are synchronized using the Web Audio API context time (`audioContext.currentTime`), not Phaser's delta frames.
- **Deterministic Procedural Level Generation (PRNG Seeding)**: To ensure fairness for future scoreboards and high-score systems, the level generation must be completely deterministic for the same audio file.
  - The procedural generator computes a 32-bit FNV-1a hash of the track's duration, sample rate, and a 1000-point sample of its channel data.
  - This hash is used as the seed for a custom Mulberry32 PRNG.
  - All randomized generation choices (such as `forceSpawn` cluster patterns and ascending/descending slope directions) use this PRNG instead of the standard unseeded `Math.random()`, guaranteeing that replaying the same audio file produces the identical level layout, collectible density, and maximum potential score every time.
- **Audio Normalization**: To ensure consistent beat parsing, energy difficulty mapping, and volume comfort, the game performs stereo-safe in-place normalization of the decoded track before generation and playback. All audio channels are scaled uniformly so that the peak amplitude reaches `0.98`, avoiding clipping while boosting quiet tracks.
### Breath Physics & State Machine
- Vertical motion is simulated using simple buoyancy and drag physics:
  - **buoyancy**: controlled by lung volume $V_{lung} \in [0, 1]$, which increases when the spacebar is held down (inhaling) and decreases when released (exhaling).
  - **drag**: high vertical hydrodynamic drag dampens velocity to create smooth, floaty maneuvers.
  - **buoyancy tuning**: buoyancy responsiveness coefficient is set to `4.8` and buoyancy vertical acceleration $a_y$ is set to `640` to ensure responsive, enjoyable vertical adjustments while preventing twitchy oversteering.

### Start Countdown Timer
- To allow players to prepare for the level, the game displays a Start-of-Dive fading track info overlay (`showTrackStartOverlay()`) for 2.0 seconds, followed immediately by an accelerated numeric countdown timer (four 600ms ticks for "3", "2", "1", and "FLOW!").
- During this entire countdown sequence (including both the track start overlay and the numeric ticks), positions of the player and buddy are frozen at the starting section of the cave, level progression time is paused at `elapsedTime = 0`, and the background/terrain layers are kept fully rendered.
- **Flat Starting Zone:** The level generator enforces a flat, wide starting zone (`introDuration = (750 / baseScrollSpeed) * 1000` ms, matching $750\text{px}$ from start) on the centerline (Y=250) of the cave. Both the player (spawned at `x = 250`) and buddy (spawned at `x = 550`) are guaranteed to spawn safely within this wide, flat starting corridor without wall collision, and collectibles are blocked from spawning before `introDuration` to ensure they are never out of reach at spawn.
- Visual ticks are accompanied by procedural audio tone chirps generated via raw `AudioContext` oscillators. Once the countdown completes, the custom audio engine begins and standard gameplay commences.

### Autopilot & Music Visualizer Mode
- When Autopilot is toggled in the start menu, vertical buoyancy controls are taken over:
  - **Pathing**: To achieve maximum flow and visual smoothness, the visualizer mode ignores individual debris lookahead (preventing micro-jerks) and steers the diver along the smooth centerline of the cave path (`pPathY`) modulated by a rhythmic 3.6-second sinusoidal breathing oscillation.
  - **Safety Clamping**: To prevent silt-outs, the target coordinate is dynamically clamped against all multi-point player shape checkpoints with a safe $12\text{px}$ clearance buffer from the cave ceiling and floor.
  - **Visual & Audio Sync**: The player glides smoothly to the clamped target using exponential linear interpolation. To preserve the zero-HUD diegetic feel, a simulated spacebar input (`this.simulatedSpaceDown`) toggles on a periodic 3.6-second breathing cycle (inhaling for 1.8s, exhaling for 1.8s). This drives natural $V_{lung}$ integration, chest expansion scaling, and bubble release (procedurally generated breathing noise, bubble chirps, and collectible tones are muted during autopilot to focus entirely on the music track).

### Slope Clearance & Collision Navigability
- To prevent impossible collisions where steep slopes narrow the corridor below the clearance of the player's horizontally extended $64\text{px}$ shape (fins to outstretched arm):
  - The game dynamically samples the local corridor slope $S = dy/dx$ from the path center generator.
  - The minimum safety cap `minCap` and `baseOffset` dynamically scale using `slopeClearance = 28.5 + (S < 0 ? -29.0 * S : 32.0 * S)` to expand the cave on steep upward and downward sections.
  - This guarantees that all generated sloping tunnels are navigable and that all procedural collectibles (spanned up to $24\text{px}$ offset and dynamically clamped to be at least $40\text{px}$ clear of both floor and ceiling boundaries at their exact position) are mathematically attainable without colliding.
- **Stable Cave Geometry**: To ensure predictable collision detection and clear navigation, the physical cave boundaries (`getWallOffsets` and `drawTerrain`) are kept completely stable and are not physically warped or wiggled by beat pulses.
### End of Dive Sequence
- The level completion triggers when the player reaches the end coordinates (`player.x >= targetEndX` where `targetEndX = 250 + (songLengthMs / 1000) * baseScrollSpeed`), the track time completes (`elapsedTime >= songLengthMs`), or `musicSource.onended` fires.
  - **Constant Scroll Speed:** To ensure points are calculated deterministically and gameplay matches the music exactly, horizontal scroll speed is kept constant (`scrollSpeed = baseScrollSpeed`) at all times.
  - **Seamless End (No Invisible Wall):** Clamping is disabled; the player continues to glide forward smoothly during the 2-second camera fade-out (to `#020514`) and Web Audio volume ramp-down (to `0.0001`) before the results card displays.
- The `musicSource.onended` handler is critical for marking the audio as complete, especially when the browser window/tab is out of focus (e.g., during Autopilot/Music Visualizer mode) and the Phaser update loop is throttled.
- A redundant `setTimeout` fallback is used in `startFadeout` alongside Phaser's clock-based `time.delayedCall` to ensure the HTML results card is successfully rendered in the DOM even when the window is blurred.
- During this transition, the camera fades out to `#020514` and the Web Audio API master gain exponentially ramps down to `0.0001`, while all regular gameplay systems (including collision detection and collectible collecting) remain fully active.

### Zero-HUD Diegetic Signals & Balance Mechanics
All gameplay feedback is represented physically and auditorily:
- **Depth**: Indicated by ambient background HSL color shifts (darkening/shifting colors) and the buddy's depth.
- **Lung Volume**: Indicated by player sprite chest expansion (ellipse scaling) and breathing audio synth frequencies.
- **Failure - Silt-Out & Light Cone Failure**: Floor/ceiling collision blinds the player with particle clouds. The player must wait for the silt to clear while staying steady.
  - **Relative Duration**: Silt-out blindness recovery time is proportional to vertical impact velocity (`impactVy`), scaling between 0.44x and 1.33x of `siltDuration` (~800ms to ~2400ms). Soft scrapes are less punishing than hard vertical bumps. Additionally, the duration scales inversely with `baseScrollSpeed` (using the factor $50/\text{baseScrollSpeed}$) to maintain a consistent horizontal distance traveled while blinded across different level speeds.
  - **Dynamic Color Shifts**: On each wall collision, `this.baseHue` shifts complementary by 120 degrees, producing a dramatic, dynamic transition of the cave color palette and matched silt particle coloring.
  - **Light Failure**: On wall impact, the player's primary light cone (beam length, spread, and opacity) contracts to 5% of its normal capacity and gradually scales back to 100% intensity as the silt time decays.
  - **Aura Vaporization**: Active neon oscilloscope aura rings are instantly vaporized (reset to 0 active rings) on impact and must be rebuilt one by one.
  - **Guideline Lifeline**: The buddy's guide line is rendered on the terrain graphics layer (depth 0) and is obscured during a silt-out, mirroring the realism of losing visibility of the guideline in a sediment cloud. The player must follow the buddy's speech bubbles ("👌?")—which render at depth 20 (above the silt overlay)—to orient themselves and guide recovery.
- **AI Buddy**: Displays helper speech bubbles ("👌?", "👌!") when assisting the player or clearing/recovering from silt. The buddy utilizes a safe (15px margin) and absolute (2px margin/midpoint fallback) terrain-clamping algorithm so they never collide with the walls or raise sediment on their own.
- **Realistic Flashlight Occlusion**: Flashlight beams (player and buddy) are realistically obstructed by terrain. The beam uses an incremental raycast shadow-casting approximation to project shadows from encountered protrusions, preventing light from passing through solid rock. Marine snow illumination checks interpolate these exact occluded beam points so particles are only lit when within the visible beam.

### Active Debris-Driven Multipliers
Instead of time-based milestones, multiplier growth is performance-driven:
- **The Combo Engine**: Collecting 15 consecutive pieces of neon debris without hitting a wall increases the multiplier by $+1$.
- **Cluster Combo Boost**: Collecting 100% of a distinct procedural cluster (tracked via `clusterId`) awards a $+5$ combo point boost to accelerate multiplier progression, alongside the points bonus.
- **Flow Decay Meter**: If the player does not collect debris for 12.5 seconds, the multiplier decays by $1$, resetting the decay buffer. Collecting any debris refills the decay buffer to 100%.

### "Hyper-Flow" State ($\ge \times 9$)
When the flow multiplier is $\ge \times 9$, advanced aesthetic shifts occur (capped at $\times 9$ intensity so visuals do not scale further):
- **Scrolling Rainbow Contours**: Terrain near and far line stroke hues dynamically cycle over time, rendering the cave profile as a shifting rainbow matrix.
- **Background Saturation Bleed**: The background color bleeds into a highly saturated, breathing pulse matrix.
- **Particle Frenzy**: Marine snow motes speed up to enhance the illusion of extreme speed.

### "Super-Flow" State ($\ge \times 10$)
When the flow multiplier is $\ge \times 10$, custom aesthetic shifts occur to reward the player without disrupting the core visual baseline:
- **Chromatic Shockwave & Zoom Thud Pulse**: Reaching a multiplier of 10 or above triggers a fast-decaying chromatic aberration lens zoom flash and a camera lens zoom-in thud, accompanied by multiple fast-expanding neon ripples centered on the player.
- **Overcharged Oscilloscope Aura**: The player's 7 neon aura rings increase in phase speed, oscillation amplitude, thickness, and glow brightness while cycling through rainbow gradients.
- **Warp Speed Marine Snow Motion Blur**: Background marine snow particles speed up aggressively and stretch horizontally into motion blur streaks to create the illusion of high velocity.
  - **Coloring & Thickness**: Illuminated streaks render in bright neon cyan (`0x00f0ff`) with high alpha (`0.85`), and are thickened to $1.8\times$ size to stand out clearly. Unilluminated snow streaks shift to a soft, visible light blue (`0x38bdf8`) with a target alpha of `0.25` so the warp effect is visible across the entire field.
- **Visual Scaling Cap**: All Super-Flow visual scaling (including marine snow speedup, streak length, and aura ring size/thickness expansions) scales progressively but is capped at $\times 15$ to maintain visual balance and prevent screen clutter.
- **Superflow Text Notifications**: Leveling up to 10+ spawns glowing, enlarged yellow text (`🫧 SUPERFLOW x{multiplier}! 🫧`).
"
### Uncapped Deterministic Simulation
- Rating calculations utilize the simulation function `calculateMaxPotentialPoints()`.
- The simulation chronologically replicates the perfect run (all items collected, no silt-outs), factoring in the combo increments, cluster combo boosts, and decay gaps to compute the theoretical maximum score ($S_{max}$). This ensures the 5-star rating (awarded at $\ge 95\%$ of $S_{max}$) remains fully deterministic.

---

## 3. Development & Environment Setup

To set up the development environment, use the `scubaflow` micromamba environment:
```bash
micromamba activate scubaflow
```

To run the game locally:
1. Start a simple static HTTP server in the repository root directory (for example, using Python):
   ```bash
   python3 -m http.server 8000
   ```
2. Open `http://localhost:8000` in your web browser.

### GitHub Pages Deployment
1. Push the repository to GitHub:
   ```bash
   git push origin main
   ```
2. Enable GitHub Pages in your GitHub Repository Settings under **Settings -> Pages**:
   - Under **Build and deployment -> Source**, select **Deploy from a branch**.
   - Under **Branch**, select `main` (folder `/root`) and click **Save**.

---

## 4. Verification & Testing Guidelines

### Skipping Agentic Browsing
- To conserve token usage and maintain execution efficiency, agents MUST NOT run automated agentic browser subagents for visual or gameplay testing.
- Rely on built-in diagnostic self-tests and request human feedback for manual gameplay/UI verification.

