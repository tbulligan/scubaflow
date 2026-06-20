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

### Breath Physics & State Machine
- Vertical motion is simulated using simple buoyancy and drag physics:
  - **buoyancy**: controlled by lung volume $V_{lung} \in [0, 1]$, which increases when the spacebar is held down (inhaling) and decreases when released (exhaling).
  - **drag**: high vertical hydrodynamic drag dampens velocity to create smooth, floaty maneuvers.

### Slope Clearance & Collision Navigability
- To prevent impossible collisions where steep slopes narrow the corridor below the clearance of the player's horizontally extended $64\text{px}$ shape (fins to outstretched arm):
  - The game dynamically samples the local corridor slope $S = dy/dx$ from the path center generator.
  - The minimum safety cap `minCap` and `baseOffset` dynamically scale using `slopeClearance = 28.5 + (S < 0 ? -29.0 * S : 15.0 * S)` to expand the cave on steep upward and downward sections.
  - This guarantees that all generated sloping tunnels are navigable and that all procedural collectibles (spanned up to $40\text{px}$ offset) are mathematically attainable.

### End of Dive Sequence
- Upon reaching the end of the track (`levelData.levelLengthMs`), the game initiates a 2-second fadeout sequence before displaying the final results card.
- During this transition, the camera fades out to `#020514` and the Web Audio API master gain exponentially ramps down to `0.0001`, while all regular gameplay systems (including collision detection and collectible collecting) remain fully active.

### Zero-HUD Diegetic Signals
All gameplay feedback is represented physically and auditorily:
- **Depth**: Indicated by ambient background HSL color shifts (darkening/shifting colors) and the buddy's depth.
- **Lung Volume**: Indicated by player sprite chest expansion (ellipse scaling) and breathing audio synth frequencies.
- **Failure - Silt-Out**: Floor/ceiling collision blinds the player with particle clouds. The player must wait for the silt to clear while staying steady.
- **AI Buddy**: Displays helper speech bubbles ("👌?", "👌!") when assisting the player or clearing/recovering from silt. The buddy demonstrates perfect buoyancy, utilizing a safe (15px margin) and absolute (2px margin/midpoint fallback) terrain-clamping algorithm so they never collide with the walls or raise sediment on their own.

---

## 3. Development & Environment Setup

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
