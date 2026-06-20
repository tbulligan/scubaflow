# ScubaFlow

A flowing, breath-controlled, zero-HUD neon buoyancy music game built with Phaser and the Web Audio API.

ScubaFlow generates an immersive, glowing underwater cave system synchronized dynamically with any custom audio track you upload. Control your buoyancy, maintain your flow, and navigate the depths alongside your AI diving buddy.

---

## 🌊 Core Features

- **Procedural Cave Generation**: Generates paths, obstacles, rhythm ripples, and collectible clusters directly from the rhythm and frequencies of any custom audio track (`.mp3`, `.wav`, `.ogg`) uploaded by the player.
- **Buoyancy & Drag Physics**: Simulated vertical motion using realistic lung volume dynamics and hydrodynamic drag. Hold the spacebar to inhale (increase lung volume and rise) and release to exhale (sink).
- **Zero-HUD Design**: No overlays or meters. All feedback is diegetic:
  - **Lung Volume**: Indicated by the scale of your diver's chest and breathing synthesizer frequencies.
  - **Depth**: Represented by ambient color shifts in the deep neon waters.
  - **Silt-Outs**: Bumping into cave walls stirs up clouds of sediment, temporarily blinding you and resetting your flow multiplier.
- **Diving Buddy AI**: Your companion navigates safely alongside you using advanced terrain-clamping pathfinding, checking in with speech bubbles (`👌?`, `👌!`) to help you recover your flow after silt-outs.

---

## 🎮 How to Play

1. **Upload a Track**: Click the uploader and select any audio file from your device.
2. **Control Buoyancy**: 
   - **Hold Spacebar** to inhale and rise.
   - **Release Spacebar** to exhale and sink.
3. **Collect Neon Debris**: Guide your path precisely through glowing debris to increase your flow.
4. **Stay Centered**: Avoid the ceiling and floor to prevent silt-outs.

---

## ⚙️ Local Setup

To run the game locally on your machine:

1. Open your terminal in the project directory.
2. Start a simple static HTTP server (for example, using Python):
   ```bash
   python3 -m http.server 8000
   ```
3. Navigate to `http://localhost:8000` in your web browser.

---

## 🚀 Deployment to GitHub Pages

ScubaFlow is a 100% static client-side web application, making it ideal for hosting on GitHub Pages:

1. Push this repository to your GitHub account:
   ```bash
   git push origin main
   ```
2. Navigate to your repository settings on GitHub.
3. Under **Settings -> Pages**:
   - Under **Build and deployment -> Source**, select **Deploy from a branch**.
   - Under **Branch**, select `main` and click **Save**.
4. Your game will be live at `https://<your-username>.github.io/scubaflow/`.
