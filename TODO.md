# ScubaFlow Roadmap & Backlog: Neon-Flow Edition

## 1. Core Systems & Progress Persistence
- [x] **Persistent High Scores (`localStorage`)**
  - Implement a save/load system using `localStorage` keyed by the custom track's FNV-1a hash (`getAudioBufferHash()`).
  - Store a JSON object string: `{ trackHash: string, highPointsScore: number, maxCollectiblesPercent: number }`.
  - Update `levelComplete()` to compare, commit, and display the historical high score vs. the current session score.
- [x] **Lifetime Career Profile Tracking**
  - Create a global career object persistent across page reloads via `localStorage`.
  - Increment cumulative variables on session end: `lifetimeDiveTimeMs` (sum of `this.elapsedTime`), `lifetimeBubblesBlown` (count of triggered exhale particles), and save the absolute historical peak of `this.scoreMultiplier`.
- [x] **Unified Flow Identity Branding**
  - Standardize all diegetic UI elements, text strings, and layout wrappers to use the term **"Neon-Flow"** to cement the psychological state of rhythm and buoyancy control.

## 2. Gameplay-Safe Visual & Shader Polish
- [x] **Multiplier-Scaled WebGL Bloom Pipeline**
  - Implement a custom WebGL post-processing bloom shader pass applied to the main camera.
  - Bind the bloom intensity parameter dynamically to `this.scoreMultiplier`. Scale linearly from a crisp, non-glowing wireframe state at x1 up to a vibrant light-bleed state at x8.
  - Set a strict hardware constraint upper-bound on the blur/spread radius to ensure cave wall boundaries (`terrainGraphics`) remain perfectly sharp and legible for accurate navigation.
- [x] **Bioluminescent Marine Snow Motes**
  - Deploy a passive, screen-space particle layer tracking low-velocity ambient drifting particles.
  - Set base particle alpha to near-invisible (`0.05`) to represent a dormant dark water state, using a distinct tiny dot shape to prevent any visual confusion with collectibles.
  - Pass the analytical boundary coordinate data of *both* primary light cones (`drawDiveLight` logic for player hand and buddy hand vectors) into the particle rendering pass.
  - Force particles to flare up softly to a moderate alpha (`0.40`) with a clean color transformation whenever they intersect the interior boundary of either active light beam geometry.
- [x] **Foreground-Aligned Volumetric Hydrothermal Plumes**
  - Map specific particle emission anchor points directly to the procedural floor crack offsets generated inside the `drawTerrain()` slot iteration.
  - **Volumetric Layering Integration:** Instantiate these upward-surging plumes using a dedicated particle emitter tracking 100% foreground scroll speed, but set its depth to `11` (directly above the player/buddy containers at depth `10`).
  - **Gameplay Safety & Realism Constraint:** Use a strict alpha cap of `0.10` and an additive blend mode (`ADD`). When a diver passes a vent, the translucent particles will softly overlay the sprite rather than being obscured by it, making the diver look like they are swimming *through* a volumetric stream without blocking character or boundary legibility.

## 3. Game Feel & Legible Feedback Loop
- [x] **Velocity-Proportional Chromatic Abstraction Filter**
  - Modify `triggerPsychedelicSilt(source, impactVy)` to process a fast-decaying camera lens channel split instead of a standard violent screen shake.
  - Feed the absolute value of `impactVy` directly into the shader's red/blue channel offset scalar variable, creating an instant visual "thunk" split proportional to the impact.
  - **Silt Integration:** Sync the shader's normalization decay directly to the duration lifecycle of `this.siltTime`. The color channel split must clean up fluidly in parallel with the fading silt vignette, ensuring the player's view of the immediate corridor track is never blocked or compromised during recovery.
- [x] **High-Flow Environment Luminance Strobing**
  - Restrict full-screen background tint shifts and camera macro zoom thrusts exclusively to "Extreme Flow" operational modes (`this.scoreMultiplier >= 8`).
  - Ensure standard beat intervals (`this.currentBeatPulse`) only trigger localized illumination accents along the active depth zone boundaries (`terrainGraphics` strokes), keeping the center corridor completely clear for safe trajectory calculation.

## 4. Level Selection UX & Architecture
- [x] **Interactive Waveform Launchpad Card**
  - Develop a pre-game landing page layout overlay that intercepts `window.customAudioBuffer` right after data loading.
  - Read the downsampled mono data arrays from the buffer and draw a complete visual audio waveform preview across the file configuration wrapper.
  - Provide immediate visual confirmation of the track's dynamic layout (density spikes, breakdown zones) before initializing the game countdown state.