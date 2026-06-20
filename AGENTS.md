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

---

## 2. Core Game Architecture & Systems

### Web Audio API Synchronization & Procedural Generation
- The game procedurally generates cave paths, beats, depth zones, and collectible clusters directly from any custom audio track uploaded in the browser.
- All rhythm parsing, concentric visual ripples, and audio events are synchronized using the Web Audio API context time (`audioContext.currentTime`), not Phaser's delta frames.
- **Deterministic Procedural Level Generation (PRNG Seeding)**: To ensure fairness for future scoreboards and high-score systems, the level generation must be completely deterministic for the same audio file.
  - The procedural generator computes a 32-bit FNV-1a hash of the track's duration, sample rate, and a 1000-point sample of its channel data.
  - This hash is used as the seed for a custom Mulberry32 PRNG.
  - All randomized generation choices (such as `forceSpawn` cluster patterns and ascending/descending slope directions) use this PRNG instead of the standard unseeded `Math.random()`, guaranteeing that replaying the same audio file produces the identical level layout, collectible density, and maximum potential score every time.

### Breath Physics & State Machine
- Vertical motion is simulated using simple buoyancy and drag physics:
  - **buoyancy**: controlled by lung volume $V_{lung} \in [0, 1]$, which increases when the spacebar is held down (inhaling) and decreases when released (exhaling).
  - **drag**: high vertical hydrodynamic drag dampens velocity to create smooth, floaty maneuvers.

### Autopilot & Music Visualizer Mode
- When Autopilot is toggled in the start menu, vertical buoyancy controls are taken over:
  - **Pathing**: To achieve maximum flow and visual smoothness, the visualizer mode ignores individual debris lookahead (preventing micro-jerks) and steers the diver along the smooth centerline of the cave path (`pPathY`) modulated by a rhythmic 3.6-second sinusoidal breathing oscillation.
  - **Safety Clamping**: To prevent silt-outs, the target coordinate is dynamically clamped against all multi-point player shape checkpoints with a safe $12\text{px}$ clearance buffer from the cave ceiling and floor.
  - **Visual & Audio Sync**: The player glides smoothly to the clamped target using exponential linear interpolation. To preserve the zero-HUD diegetic feel, a simulated spacebar input (`this.simulatedSpaceDown`) toggles on a periodic 3.6-second breathing cycle (inhaling for 1.8s, exhaling for 1.8s). This drives natural $V_{lung}$ integration, chest expansion scaling, and bubble release (procedurally generated breathing noise, bubble chirps, and collectible tones are muted during autopilot to focus entirely on the music track).

### Slope Clearance & Collision Navigability
- To prevent impossible collisions where steep slopes narrow the corridor below the clearance of the player's horizontally extended $64\text{px}$ shape (fins to outstretched arm):
  - The game dynamically samples the local corridor slope $S = dy/dx$ from the path center generator.
  - The minimum safety cap `minCap` and `baseOffset` dynamically scale using `slopeClearance = 28.5 + (S < 0 ? -29.0 * S : 15.0 * S)` to expand the cave on steep upward and downward sections.
  - This guarantees that all generated sloping tunnels are navigable and that all procedural collectibles (spanned up to $40\text{px}$ offset) are mathematically attainable.

### End of Dive Sequence
- Upon reaching the end of the song path (`player.x >= targetEndX` where `targetEndX = 250 + (songLengthMs / 1000) * baseScrollSpeed`) or when the Web Audio track finishes playing (`musicSource.onended` as a fallback), the game initiates a 2-second fadeout sequence before displaying the final results card.
- The `musicSource.onended` handler is critical for handling cases where the browser window/tab is not in focus (e.g., during Autopilot/Music Visualizer mode) and the Phaser update loop is throttled or paused by the browser.
- A redundant `setTimeout` fallback is used in `startFadeout` alongside Phaser's clock-based `time.delayedCall` to ensure the HTML results card is successfully rendered in the DOM even when the window is blurred.
- During this transition, the camera fades out to `#020514` and the Web Audio API master gain exponentially ramps down to `0.0001`, while all regular gameplay systems (including collision detection and collectible collecting) remain fully active.

### Zero-HUD Diegetic Signals
All gameplay feedback is represented physically and auditorily:
- **Depth**: Indicated by ambient background HSL color shifts (darkening/shifting colors) and the buddy's depth.
- **Lung Volume**: Indicated by player sprite chest expansion (ellipse scaling) and breathing audio synth frequencies.
- **Failure - Silt-Out**: Floor/ceiling collision blinds the player with particle clouds. The player must wait for the silt to clear while staying steady.
- **AI Buddy**: Displays helper speech bubbles ("👌?", "👌!") when assisting the player or clearing/recovering from silt. The buddy utilizes a safe (15px margin) and absolute (2px margin/midpoint fallback) terrain-clamping algorithm so they never collide with the walls or raise sediment on their own.

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

