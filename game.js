// ScubaFlow - Psychedelic Buoyancy Music Game
// Core Game Logic (Phaser.js & Web Audio API)

class PsychedelicFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game) {
        super({
            game: game,
            name: 'PsychedelicFX',
            fragShader: `
                #define SHADER_NAME PSYCHEDELIC_FS
                precision mediump float;
                uniform sampler2D uMainSampler;
                uniform float uChromaticOffset;
                varying vec2 outTexCoord;
                
                void main() {
                    // 1. Chromatic Abstraction (horizontal Red/Blue split offset)
                    vec2 rCoord = outTexCoord + vec2(uChromaticOffset, 0.0);
                    vec2 bCoord = outTexCoord - vec2(uChromaticOffset, 0.0);
                    
                    float r = texture2D(uMainSampler, rCoord).r;
                    float g = texture2D(uMainSampler, outTexCoord).g;
                    float b = texture2D(uMainSampler, bCoord).b;
                    float a = texture2D(uMainSampler, outTexCoord).a;
                    
                    gl_FragColor = vec4(r, g, b, a);
                }
            `
        });
        this.chromaticOffset = 0.0;
        this.chromaticOffsetStart = 0.0;
    }
    
    onPreRender() {
        this.set1f('uChromaticOffset', this.chromaticOffset);
    }
}

class ScubaFlowScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ScubaFlowScene' });
    }

    hslToColorInt(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            let p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    }

    init() {
        // State Variables
        this.elapsedTime = 0; // ms
        this.isPlaying = false;
        this.scrollSpeed = 40; // px per second
        this.baseScrollSpeed = 40;
        this.useAutopilot = window.useAutopilot || false;
        this.simulatedSpaceDown = false;
        this.countdownActive = false;
        this.countdownText = null;

        // Simplified Agile Buoyancy Physics
        this.V_lung = 0.5; // target state [0 = full sink, 1 = full rise]
        this.buoyancySmooth = 0.5; // smoothed buoyancy state
        this.vy = 0; // vertical velocity
        this.dragCoeff = 2.4; // Responsive drag


        // Psychedelic Visuals & Music-Reactive Systems
        this.score = 0;
        this.totalCollectibles = 0;
        this.currentBeatPulse = 0;
        this.localEnergy = 0.2;
        this.baseHue = 0;
        this.beatRipples = [];
        this.lastProcessedBeatIdx = -1;

        // Visual Distortion Silt Mode
        this.sActive = false; // renamed from siltActive to avoid search noise if needed, but wait, keeping same names:
        this.siltActive = false;
        this.siltTime = 0;
        this.siltDuration = 1800; // 1.8 seconds recovery distortion — shorter for playability
        this.siltSource = 'floor';
        this.currentSiltDuration = 1800;

        // Buddy State Machine
        this.buddyState = 'normal'; // 'normal', 'assisting', 'relieved'
        this.buddyStateTimer = 0;

        // Path / Controls
        this.spaceKey = null;
        this.levelData = null;
        this.audioContext = null;

        // Sound timing
        this.lastBubbleSoundTime = 0;
        this.musicStartTime = null;

        // Score Flow State points system
        this.siltFreeTime = 0;
        this.scoreMultiplier = 1;
        this.pointsScore = 0;
        this.maxPotentialPoints = 0;
        this.musicFilter = null;
        this.clusterTotals = {};
        this.clusterCollected = {};
        this.isFadingOut = false;
        this.isLevelCompleted = false;
        this.musicCompleted = false;
        this.targetEndX = 0;
        this.exhaleBubblesCount = 0;
        this.marineSnowMotes = [];

        // Point Arrays pre-allocation for zero GC churn
        this.floorPoints = [];
        this.ceilPoints = [];
        this.farPoints = [];
        this.nearPoints = [];
    }

    preload() {
        // Dynamic procedural generation is used for uploaded audio tracks.
    }

    create() {
        // 1. Mock Level Data for Self-Tests validation
        this.levelData = {
            bpm: 60,
            levelLengthMs: 120000,
            songLengthMs: 120000,
            path: [
                { time: 0, y: 200, energy: 0.2 },
                { time: 30000, y: 450, energy: 0.5 },
                { time: 120000, y: 250, energy: 0.3 }
            ],
            collectibles: [],
            zones: [
                { startTime: 0, endTime: 120000, targetDepth: 300, name: "Reef", floorColor: 0xbd00ff, ceilColor: 0x00f0ff, floorHue: 284, ceilHue: 184, bgColor: 0x010410 }
            ],
            beats: []
        };
        this.totalCollectibles = 0;
        this.lastProcessedBeatIdx = -1;
        this.beatRipples = [];
        this.targetEndX = (this.levelData.songLengthMs / 1000) * this.baseScrollSpeed + 250;

        // Retrieve avatar selection from global scope
        this.avatarType = window.selectedAvatar || 'diver';

        // 2. Run Self-Tests (Ponytail Rule)
        this.runSelfTests();

        // 3. Create Dynamic Canvas Textures
        this.createProceduralTextures();

        // 4. Setup Input
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        // 5. Setup Visual Emitters
        this.setupEmitters();

        // Setup Chat Bubbles (Zero-HUD diegetic speech)
        this.buddyBubble = this.add.text(0, 0, "", {
            fontFamily: 'Outfit',
            fontSize: '15px',
            color: '#00f0ff',
            fontStyle: 'bold',
            backgroundColor: 'rgba(2, 5, 20, 0.75)',
            padding: { x: 8, y: 4 }
        }).setOrigin(0.5).setDepth(20).setVisible(false);

        this.playerBubble = this.add.text(0, 0, "", {
            fontFamily: 'Outfit',
            fontSize: '15px',
            color: '#bd00ff',
            fontStyle: 'bold',
            backgroundColor: 'rgba(2, 5, 20, 0.75)',
            padding: { x: 8, y: 4 }
        }).setOrigin(0.5).setDepth(20).setVisible(false);

        // 6. Setup Graphics layers
        this.parallaxFarGraphics = this.add.graphics().setDepth(-2).setScrollFactor(0);  // farthest layer (slowest) — screen-space so it tiles left correctly
        this.parallaxNearGraphics = this.add.graphics().setDepth(-1); // near layer (faster)
        this.backgroundGraphics = this.add.graphics();
        this.terrainGraphics = this.add.graphics();
        this.lightGraphics = this.add.graphics();
        this.lightGraphics.setDepth(5);
        this.siltOverlay = this.add.graphics();
        this.siltOverlay.setDepth(12); // render on top of containers
        this.siltVignetteImage = this.add.image(600, 350, 'silt_vignette')
            .setScrollFactor(0)
            .setDepth(12)
            .setDisplaySize(1200, 700)
            .setAlpha(0)
            .setVisible(false);
        this.foregroundGraphics = this.add.graphics().setDepth(20).setScrollFactor(0); // foreground bubble layer
        this.foregroundBubbles = [];
        for (let i = 0; i < 6; i++) {
            this.foregroundBubbles.push({
                x: Math.random() * 1300,
                y: Math.random() * 700,
                radius: 12 + Math.random() * 18,
                speed: 1.4 + Math.random() * 0.4,
                alpha: 0.12 + Math.random() * 0.15,
                verticalDrift: -15 - Math.random() * 20
            });
        }
        // Second layer of smaller, more numerous bubbles (midground parallax)
        this.foregroundBubbles2 = [];
        for (let i = 0; i < 18; i++) {
            this.foregroundBubbles2.push({
                x: Math.random() * 1300,
                y: Math.random() * 700,
                radius: 4 + Math.random() * 6,
                speed: 1.08 + Math.random() * 0.22,
                alpha: 0.08 + Math.random() * 0.12,
                verticalDrift: -8 - Math.random() * 12
            });
        }

        // Set camera bounds
        this.cameras.main.setBounds(0, 0, 999999, 700);

        // 7. Decode Custom Track (Always required now)
        if (window.customAudioBuffer) {
            this.isPlaying = false;

            // SOTA Loader: Full-screen overlay with a pulsing sonar ring
            let statusBg = this.add.graphics();
            statusBg.fillStyle(0x020514, 0.95);
            statusBg.fillRect(0, 0, 1200, 700);

            let sonarRing = this.add.graphics();
            let loaderProgress = { val: 0 };
            let loaderTween = this.tweens.add({
                targets: loaderProgress,
                val: 1,
                duration: 1600,
                repeat: -1,
                onUpdate: () => {
                    sonarRing.clear();
                    sonarRing.lineStyle(2, 0x00f0ff, 1.0 - loaderProgress.val);
                    sonarRing.strokeCircle(600, 300, 15 + loaderProgress.val * 65);
                }
            });

            let statusText = this.add.text(600, 390, 'DECODING CUSTOM TRACK', {
                fontFamily: 'Outfit',
                fontSize: '18px',
                color: '#00f0ff',
                letterSpacing: 2,
                fontStyle: 'bold'
            }).setOrigin(0.5);

            let subText = this.add.text(600, 420, 'Analyzing waveform & generating cave system', {
                fontFamily: 'Montserrat',
                fontSize: '12px',
                color: '#64748b',
                letterSpacing: 1
            }).setOrigin(0.5);

            statusText.setDepth(100);
            subText.setDepth(100);
            sonarRing.setDepth(100);
            statusBg.setDepth(99);

            try {
                // Bulletproof context lookup from pre-resumed gesture or Phaser config
                let ctx = window.customAudioContext || this.sound.context || new (window.AudioContext || window.webkitAudioContext)();
                if (!ctx) {
                    throw new Error("Web Audio API is not supported in this browser.");
                }
                this.audioContext = ctx;
                console.log("AudioContext retrieved. State:", ctx.state, "SampleRate:", ctx.sampleRate);

                let startDecode = () => {
                    console.log("Invoking decodeAudioData with buffer byteLength:", window.customAudioBuffer ? window.customAudioBuffer.byteLength : "null/undefined");
                    ctx.decodeAudioData(window.customAudioBuffer.slice(0), (decodedBuffer) => {
                        try {
                            console.log("decodeAudioData success! Buffer duration:", decodedBuffer.duration, "channels:", decodedBuffer.numberOfChannels, "sampleRate:", decodedBuffer.sampleRate);
                            this.customDecodedBuffer = decodedBuffer;

                            // Procedurally generate level from the custom track
                            console.log("Starting generateProceduralLevel...");
                            this.generateProceduralLevel(decodedBuffer);
                            console.log("generateProceduralLevel completed.");

                            // Spawn player and buddy matching initial path positions
                            let playerStartY = this.getTargetYAtTime((250 / this.baseScrollSpeed) * 1000);
                            let buddyStartY = this.getTargetYAtTime((550 / this.baseScrollSpeed) * 1000);
                            console.log("Player spawn Y:", playerStartY, "Buddy spawn Y:", buddyStartY);

                            this.spawnDiver(playerStartY);
                            console.log("Player spawned.");
                            this.spawnBuddy(buddyStartY);
                            console.log("Buddy spawned.");
                            this.spawnCollectibles();
                            console.log("Collectibles spawned.");

                            // Set camera to follow player
                            this.cameras.main.startFollow(this.player, true, 0.1, 1, -250, 0);
                            console.log("Camera follow configured.");

                            // Register and add WebGL post-processing PsychedelicFX pipeline
                            let renderer = this.renderer;
                            if (renderer && renderer.pipelines) {
                                try {
                                     renderer.pipelines.addPostPipeline('PsychedelicFX', PsychedelicFX);
                                     this.cameras.main.setPostPipeline(PsychedelicFX);
                                     console.log("PsychedelicFX WebGL Pipeline registered and attached.");
                                } catch (e) {
                                     console.warn("Failed to register WebGL PostFX pipeline:", e);
                                }
                            }

                            // Initialize Bioluminescent Marine Snow Motes (40 screen-space motes)
                            this.marineSnowMotes = [];
                            for (let i = 0; i < 40; i++) {
                                this.marineSnowMotes.push({
                                    x: Math.random() * 1200,
                                    y: Math.random() * 700,
                                    vx: -12 - Math.random() * 14,
                                    vy: -4 + Math.random() * 8,
                                    size: 1.0 + Math.random() * 1.5,
                                    alpha: 0.05
                                });
                            }
                            this.marineSnowGraphics = this.add.graphics().setDepth(-1.5).setScrollFactor(0);

                            // ONLY destroy text overlay if everything succeeded!
                            if (loaderTween) loaderTween.stop();
                            if (sonarRing) sonarRing.destroy();
                            statusText.destroy();
                            subText.destroy();
                            statusBg.destroy();
                            console.log("Loading status overlay elements destroyed.");

                            // Start countdown before beginning gameplay and music
                            this.startCountdown(ctx);
                        } catch (innerErr) {
                            console.error("Error in decode success callback:", innerErr);
                            if (loaderTween) loaderTween.stop();
                            if (sonarRing) sonarRing.destroy();
                            statusText.setText('Initialization Error');
                            subText.setText(innerErr.stack || innerErr.message);
                        }
                    }, (err) => {
                        console.error("Error decoding audio data:", err);
                        if (loaderTween) loaderTween.stop();
                        if (sonarRing) sonarRing.destroy();
                        statusText.setText('Failed to decode track.');
                        subText.setText(err ? (err.message || String(err)) : 'Unknown decoding error');
                    });
                };

                // Asynchronously resume context if suspended before calling decode
                console.log("Initial AudioContext state checks. State is currently:", ctx.state);
                if (ctx.state === 'suspended') {
                    console.log("Context is suspended, calling ctx.resume()...");
                    ctx.resume().then(() => {
                        console.log("Context resumed successfully. New state:", ctx.state);
                        startDecode();
                    }).catch((e) => {
                        console.warn("AudioContext resume failed, proceeding with decode:", e);
                        startDecode();
                    });
                } else {
                    console.log("Context is not suspended. Proceeding directly with startDecode().");
                    startDecode();
                }

            } catch (err) {
                console.error("Error setting up audio context:", err);
                statusText.setText('Audio Context Failed');
                subText.setText(err.message);
            }
        }
    }

    startCountdown(ctx) {
        this.countdownActive = true;
        this.elapsedTime = 0;
        this.isPlaying = true; // allow update loop to render the starting scene

        this.showTrackStartOverlay(() => {
            let countdownNumbers = ['3', '2', '1', 'FLOW!'];
            let colors = ['#bd00ff', '#00f0ff', '#ff007f', '#00ff66'];
            let index = 0;

            let showNext = () => {
                if (index < countdownNumbers.length) {
                    let numStr = countdownNumbers[index];
                    let colorHex = colors[index];
                    this.countdownText.setText(numStr);
                    this.countdownText.setColor(colorHex);
                    this.countdownText.setShadow(0, 0, colorHex, 30, true, true);
                    this.countdownText.setStroke(colorHex, 8);
                    this.countdownText.setScale(0.3);
                    this.countdownText.setAlpha(1);

                    // Play tick beep using Web Audio API AudioContext directly
                    try {
                        let osc = ctx.createOscillator();
                        let gainNode = ctx.createGain();
                        osc.connect(gainNode);
                        gainNode.connect(ctx.destination);
                        osc.type = 'sine';
                        if (numStr === 'FLOW!') {
                            osc.frequency.setValueAtTime(440, ctx.currentTime);
                            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
                            gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
                            gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
                            osc.start();
                            osc.stop(ctx.currentTime + 0.5);
                        } else {
                            osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5 note
                            gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
                            gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
                            osc.start();
                            osc.stop(ctx.currentTime + 0.2);
                        }
                    } catch (e) {
                        console.warn("Failed to play countdown beep:", e);
                    }

                    let stepDuration = numStr === 'FLOW!' ? 800 : 600;
                    this.tweens.add({
                        targets: this.countdownText,
                        scale: 1.5,
                        alpha: { from: 1, to: 0 },
                        duration: stepDuration,
                        ease: 'Cubic.easeOut',
                        onComplete: () => {
                            index++;
                            showNext();
                        }
                    });
                } else {
                    this.countdownText.destroy();
                    this.countdownActive = false;
                    console.log("Countdown complete. Starting setupAudioEngine...");
                    this.setupAudioEngine(ctx);
                    console.log("setupAudioEngine completed.");
                }
            };

            this.countdownText = this.add.text(600, 350, '', {
                fontFamily: 'Outfit',
                fontSize: '140px',
                fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(100);

            showNext();
        });
    }

    update(time, delta) {
        try {
            if (!this.isPlaying) return;

            if (this.countdownActive) {
                this.elapsedTime = 0;
                this.player.x = 250;
                this.buddy.x = 550;

                let buddyStartY = this.getTargetYAtTime((550 / this.baseScrollSpeed) * 1000);
                this.buddy.y = buddyStartY;

                let playerStartY = this.getTargetYAtTime((250 / this.baseScrollSpeed) * 1000);
                this.player.y = playerStartY;

                // Simulate normal breathing cycle for player visuals during countdown
                let breathPeriod = 3600;
                let breathPhase = (time % breathPeriod) / breathPeriod;
                this.V_lung = 0.5 + 0.3 * Math.sin(breathPhase * Math.PI * 2);

                this.emitBreathingParticles();

                // Redraw visualizers and terrain so everything is visible
                this.drawParallax(time);
                this.drawBackgroundVisuals(time);
                this.drawTerrain();
                this.drawCaveLights();
                this.drawPlayerVisuals(time);
                this.drawBuddyVisuals(time);
                this.drawForegroundBubbles(delta / 1000);
                this.drawSiltOverlay();
                return;
            }

            let prevElapsedTime = this.elapsedTime;
            if (this.musicStartTime !== null && this.audioContext) {
                this.elapsedTime = (this.audioContext.currentTime - this.musicStartTime) * 1000;
            } else {
                this.elapsedTime += delta;
            }
            let dt = (this.elapsedTime - prevElapsedTime) / 1000;
            if (dt < 0) dt = 0; // Prevent negative time steps due to clock jitter
            let deltaMs = dt * 1000;
            let physDt = Math.min(dt, 0.15); // cap physics step to prevent physics engine explosions

            // Start fadeout when player reaches targetEndX, track completes, or time runs out
            if ((this.player.x >= this.targetEndX || this.musicCompleted || this.elapsedTime >= this.levelData.songLengthMs) && !this.isFadingOut) {
                this.startFadeout();
            }


            // 1. (baseHue now updated in section 6 below, multiplier-scaled)


            // Multi-point body checkPoints definition (defined early so they can be reused for autopilot safety clamping)
            let checkPoints = [];
            if (this.avatarType === 'diver') {
                let frogPhase = (this.elapsedTime / 350) % (Math.PI * 2);
                let kickExtension = Math.max(0, Math.sin(frogPhase));
                let frogPhase2 = frogPhase + 0.25;
                let kickExtension2 = Math.max(0, Math.sin(frogPhase2));

                let foot2X = -8 - (6 + kickExtension * 8) - (2 + kickExtension * 12);
                let foot2Y = -6 - (12 - kickExtension * 8) - (10 - kickExtension * 10);

                let foot1X = -10 - (6 + kickExtension2 * 8) - (2 + kickExtension2 * 12);
                let foot1Y = 2 - (12 - kickExtension2 * 8) - (10 - kickExtension2 * 10);

                checkPoints = [
                    { x: 0, y: 0, r: 6.5, floor: true, ceil: true }, // Torso center
                    { x: 14, y: -4, r: 4, floor: true, ceil: true }, // Head
                    { x: -10, y: -13, r: 2, floor: false, ceil: true }, // Tank tops (highest solid point)
                    { x: 26, y: -2, r: 3, floor: true, ceil: true }, // Light hand (forward-most)
                    { x: foot1X, y: foot1Y, r: 4, floor: true, ceil: true }, // Foot 1 — floor & ceiling
                    { x: foot2X, y: foot2Y, r: 4, floor: true, ceil: true }, // Foot 2 — floor & ceiling
                ];
            } else {
                checkPoints = [
                    { x: 0, y: 0, r: 12 }
                ];
            }

            // 2. Process Input & Buoyancy State
            if (this.useAutopilot) {
                let px = this.player.x;
                let timeAtPlayer = (px / this.baseScrollSpeed) * 1000;
                let pPathY = this.getTargetYAtTime(timeAtPlayer);

                // Periodic breathing cycle (3.6 seconds per breath cycle: 1.8s inhale, 1.8s exhale)
                let breathPeriod = 3600; // ms
                let breathPhase = (time % breathPeriod) / breathPeriod; // 0 to 1
                this.simulatedSpaceDown = (breathPhase < 0.5);

                // Smoothly guide player along the centerline with a natural breathing bobbing effect (12px amplitude)
                let targetY = pPathY - Math.sin(breathPhase * Math.PI * 2) * 12;

                // Clamp targetY inside the corridor so we don't try to steer past walls
                let minYAllowed = -9999;
                let maxYAllowed = 9999;
                let safetyMargin = 12; // 12px safe clearance buffer

                for (let pt of checkPoints) {
                    let wx = px + pt.x;
                    let ptTime = (wx / this.baseScrollSpeed) * 1000;
                    let ptPathY = this.getTargetYAtTime(ptTime);
                    let ptEnergy = this.getEnergyAtTime(ptTime);
                    let { floorOffset, ceilOffset } = this.getWallOffsets(wx, ptEnergy);
                    let ptFloorY = ptPathY + floorOffset;
                    let ptCeilY = ptPathY - ceilOffset;

                    if (pt.ceil !== false) {
                        minYAllowed = Math.max(minYAllowed, ptCeilY - pt.y + pt.r + safetyMargin);
                    }
                    if (pt.floor !== false) {
                        maxYAllowed = Math.min(maxYAllowed, ptFloorY - pt.y - pt.r - safetyMargin);
                    }
                }

                if (minYAllowed <= maxYAllowed) {
                    targetY = Phaser.Math.Clamp(targetY, minYAllowed, maxYAllowed);
                }

                // Glide player smoothly towards the target path (completely organic visualizer glide)
                let lastY = this.player.y;
                this.player.y = Phaser.Math.Linear(this.player.y, targetY, 1 - Math.exp(-6 * physDt));

                // Calculate simulated velocity
                if (physDt > 0) {
                    this.vy = (this.player.y - lastY) / physDt;
                }
            }

            // Standard input & lung volume simulation (shared between manual & autopilot)
            let spaceDown = this.useAutopilot ? this.simulatedSpaceDown : this.spaceKey.isDown;
            let fillRate = 3.0;
            if (spaceDown) {
                this.V_lung = Math.min(1.0, this.V_lung + fillRate * physDt);
            } else {
                this.V_lung = Math.max(0.0, this.V_lung - fillRate * physDt);
            }

            // Audio Breathing Volumes
            let ctx = this.audioContext;
            if (ctx) {
                if (this.useAutopilot) {
                    // Mute inhale/exhale synths completely in music visualizer mode
                    this.inhaleGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
                    this.exhaleGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
                    this.lastBubbleSoundTime = 0;
                } else if (spaceDown) {
                    this.inhaleGain.gain.setTargetAtTime(0.10, ctx.currentTime, 0.05);
                    this.exhaleGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
                    this.inhaleFilter.frequency.setValueAtTime(300 + this.V_lung * 600, ctx.currentTime);
                    this.lastBubbleSoundTime = 0;
                } else {
                    this.inhaleGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
                    if (this.V_lung > 0.05) {
                        let rumble = 0.15 + 0.05 * Math.sin(time * 0.012) + 0.02 * Math.random();
                        this.exhaleGain.gain.setTargetAtTime(rumble, ctx.currentTime, 0.05);

                        // Trigger bubble chirps for exhaling
                        this.lastBubbleSoundTime += deltaMs;
                        let nextBubbleInterval = 60 + Math.random() * 50;
                        if (this.lastBubbleSoundTime >= nextBubbleInterval) {
                            this.lastBubbleSoundTime = 0;
                            this.playBubbleChirp();
                        }
                    } else {
                        this.exhaleGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
                        this.lastBubbleSoundTime = 0;
                    }
                }

                // Silt-out lowpass filter transition tied to buddy dialogue states
                if (this.musicFilter) {
                    let targetFreq = 22000;
                    if (this.buddyState === 'assisting' || this.buddyState === 'clearing') {
                        targetFreq = 450;
                    } else if (this.buddyState === 'relieved') {
                        let sweepPhase = Math.max(0, Math.min(1.0, this.buddyStateTimer / 2000));
                        targetFreq = 450 + Math.pow(1 - sweepPhase, 3.5) * (22000 - 450);
                    }
                    this.musicFilter.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.08);
                }
            }

            // 3. Simplified Buoyancy Physics
            let lastY = this.player.y;
            if (!this.useAutopilot) {
                this.buoyancySmooth += (this.V_lung - this.buoyancySmooth) * physDt * 4.8;
                let ay = (this.buoyancySmooth - 0.5) * -640; // Retuned for balanced, swifter steering with less oversteer

                this.vy += ay * physDt;
                this.vy *= Math.exp(-this.dragCoeff * physDt);
                this.player.y += this.vy * physDt;
            }

            // Capture pre-clamp velocity for collision impact calculations
            let preClampVy = this.vy;

            // Strict position-clamping for Autopilot to guarantee 100% no silt-outs
            if (this.useAutopilot) {
                let px = this.player.x;
                let minYAllowed = -9999;
                let maxYAllowed = 9999;
                let safetyMargin = 12;

                for (let pt of checkPoints) {
                    let wx = px + pt.x;
                    let ptTime = (wx / this.baseScrollSpeed) * 1000;
                    let ptPathY = this.getTargetYAtTime(ptTime);
                    let ptEnergy = this.getEnergyAtTime(ptTime);
                    let { floorOffset, ceilOffset } = this.getWallOffsets(wx, ptEnergy);
                    let ptFloorY = ptPathY + floorOffset;
                    let ptCeilY = ptPathY - ceilOffset;

                    if (pt.ceil !== false) {
                        minYAllowed = Math.max(minYAllowed, ptCeilY - pt.y + pt.r + safetyMargin);
                    }
                    if (pt.floor !== false) {
                        maxYAllowed = Math.min(maxYAllowed, ptFloorY - pt.y - pt.r - safetyMargin);
                    }
                }

                if (minYAllowed <= maxYAllowed) {
                    this.player.y = Phaser.Math.Clamp(this.player.y, minYAllowed, maxYAllowed);
                } else {
                    this.player.y = (minYAllowed + maxYAllowed) / 2;
                }

                // Update vy post-clamp for visual/audio effects
                if (physDt > 0) {
                    this.vy = (this.player.y - lastY) / physDt;
                }
            }

            // 4. Cave Boundaries & Local Energy Calculation
            let px = this.player.x;
            let timeAtPlayer = (px / this.baseScrollSpeed) * 1000;
            let localEnergy = this.getEnergyAtTime(timeAtPlayer);
            this.localEnergy = localEnergy;

            let pPathY = this.getTargetYAtTime(timeAtPlayer);
            let { floorOffset, ceilOffset } = this.getWallOffsets(px, localEnergy);

            let floorY = pPathY + floorOffset;
            let ceilingY = pPathY - ceilOffset;

            // Re-use checkPoints defined early in Section 2 for multi-point body collision checks

            let collisionTriggered = false;
            let collisionSource = 'floor';

            // Capture pre-collision vertical velocity to determine impact strength
            let impactVy = preClampVy;

            for (let pt of checkPoints) {
                let wx = px + pt.x;
                let wy = this.player.y + pt.y;

                let ptTime = (wx / this.baseScrollSpeed) * 1000;
                let ptPathY = this.getTargetYAtTime(ptTime);
                let ptEnergy = this.getEnergyAtTime(ptTime);
                let { floorOffset, ceilOffset } = this.getWallOffsets(wx, ptEnergy);
                let ptFloorY = ptPathY + floorOffset;
                let ptCeilY = ptPathY - ceilOffset;

                if ((pt.floor !== false) && wy + pt.r >= ptFloorY) {
                    collisionTriggered = true;
                    collisionSource = 'floor';
                    this.player.y = ptFloorY - pt.y - pt.r - 2; // nudge inward
                    break;
                } else if ((pt.ceil !== false) && wy - pt.r <= ptCeilY) {
                    collisionTriggered = true;
                    collisionSource = 'ceiling';
                    this.player.y = ptCeilY - pt.y + pt.r + 2; // nudge inward
                    break;
                }
            }

            if (collisionTriggered) {
                if (this.vy > 0 && collisionSource === 'floor') this.vy = -this.vy * 0.3;
                if (this.vy < 0 && collisionSource === 'ceiling') this.vy = -this.vy * 0.3;
                let pathCenterY = this.getTargetYAtTime(timeAtPlayer);
                let pushDir = Math.sign(pathCenterY - this.player.y);
                this.vy += pushDir * 60;
                this.triggerPsychedelicSilt(collisionSource, impactVy);
            }

            // Continuous silt particle emission when dragging (big sediment clouds, not overwhelming)
            if (this.siltActive && this.siltEmitter) {
                let py = (this.siltSource === 'floor') ? floorY : ceilingY;
                if (Math.random() < 0.65) { // probabilistic — not every frame, keeps it dramatic not suffocating
                    let siltHue = (this.baseHue + 180) % 360;
                    let siltColor = this.hslToColorInt(siltHue / 360, 0.8, 0.45);
                    this.siltEmitter.particleTint = siltColor;
                    this.siltEmitter.emitParticleAt(
                        this.player.x - 40 + Math.random() * 80,
                        py + (this.siltSource === 'floor' ? -Math.random() * 15 : Math.random() * 15),
                        1,
                        {
                            speedY: this.siltSource === 'floor' ? { min: -180, max: -30 } : { min: 30, max: 180 },
                            speedX: { min: -this.scrollSpeed - 50, max: -this.scrollSpeed + 50 },
                            scale: { start: 6.0, end: 24.0 },
                            lifespan: { min: 2500, max: 5000 }
                        }
                    );
                }
            }

            // 5. Beat Pulse & concentric ripples spawn checks
            let lastBeatTime = -99999;
            let beats = this.levelData.beats || [];
            for (let i = 0; i < beats.length; i++) {
                if (this.elapsedTime >= beats[i] && i > this.lastProcessedBeatIdx) {
                    this.lastProcessedBeatIdx = i;
                    this.spawnBeatRipple();
                }
            }

            // Find time since last beat for visual pulses
            for (let b of beats) {
                if (this.elapsedTime >= b) {
                    lastBeatTime = b;
                } else {
                    break;
                }
            }
            let timeSinceBeat = this.elapsedTime - lastBeatTime;
            let pulse = 0;
            if (timeSinceBeat >= 0 && timeSinceBeat < 300) {
                pulse = 1.0 - (timeSinceBeat / 300);
            }
            this.currentBeatPulse = pulse;

            // Update active background ripples
            for (let i = this.beatRipples.length - 1; i >= 0; i--) {
                let r = this.beatRipples[i];
                r.radius += dt * 380;
                r.alpha -= dt * 1.25;
                if (r.alpha <= 0 || r.radius >= r.maxRadius) {
                    this.beatRipples.splice(i, 1);
                }
            }

            // 6. Slow HSL Background Color cycle + Beat Flashes (Darker for dive lamp illumination)
            // Hue speed escalates with flow multiplier — at x5 it spins 3x as fast
            let hueSpeed = 2.2 + (this.scoreMultiplier - 1) * 2.8;
            this.baseHue = (this.baseHue + dt * hueSpeed) % 360;
            let bgHue = (this.baseHue * 0.25) % 360;
            let multiBeat = 1.0 + (this.scoreMultiplier - 1) * 0.55;
            
            // Restrict background beat flashes & zoom throb exclusively to operational modes multiplier >= 8
            let lightnessBoost = 0.012;
            let targetZoom = 1.0;
            if (this.scoreMultiplier >= 8) {
                // Softened beat flash & zoom throb to keep it energetic but not overwhelming
                lightnessBoost += pulse * 0.010 * multiBeat;
                targetZoom += pulse * 0.005 * multiBeat;
            }
            
            let bgColorVal = this.hslToColorInt(bgHue / 360, 0.7, lightnessBoost);
            this.cameras.main.setBackgroundColor(bgColorVal);

            // Camera micro-zoom throb on beats
            this.cameras.main.zoom = Phaser.Math.Linear(this.cameras.main.zoom, targetZoom, 0.15);

            // Horizontal scrolling displacement
            this.player.x += this.scrollSpeed * dt;

            // 7. Update AI Buddy & Dialogue States (Diegetic Hand Signals)
            if (this.siltActive) {
                // If silt happens, revert to assisting unless already doing so
                if (this.buddyState !== 'assisting') {
                    this.buddyState = 'assisting';
                    this.buddyBubble.setText("👌?");
                    this.buddyBubble.setVisible(true);
                    this.playerBubble.setVisible(false); // Cancel player's OK!
                }
            } else {
                if (this.buddyState === 'assisting') {
                    this.buddyState = 'clearing';
                    this.buddyStateTimer = 1800; // Delay for particles to clear
                } else if (this.buddyState === 'clearing') {
                    this.buddyStateTimer -= deltaMs;
                    if (this.buddyStateTimer <= 0) {
                        this.buddyState = 'relieved';
                        this.buddyStateTimer = 2000;
                        this.buddyBubble.setText("👌!");
                        this.playerBubble.setText("👌!");
                        this.playerBubble.setVisible(true);
                    }
                } else if (this.buddyState === 'relieved') {
                    this.buddyStateTimer -= deltaMs;
                    if (this.buddyStateTimer <= 0) {
                        this.buddyState = 'normal';
                        this.buddyBubble.setVisible(false);
                        this.playerBubble.setVisible(false);
                    }
                }
            }

            let targetBuddyX = this.player.x + 300;
            if (this.buddyState === 'assisting' || this.buddyState === 'clearing' || this.buddyState === 'relieved') {
                targetBuddyX = this.player.x + 90;
                this.buddy.scaleX = -1; // Face player
            } else {
                this.buddy.scaleX = 1;  // Face forward
            }
            this.buddy.x = Phaser.Math.Linear(this.buddy.x, targetBuddyX, 1 - Math.exp(-2.0 * physDt));

            let buddyLeadTime = this.elapsedTime + (this.buddy.x - this.player.x) / this.baseScrollSpeed * 1000;
            let buddyTargetY = this.getTargetYAtTime(buddyLeadTime);
            this.buddy.y = Phaser.Math.Linear(this.buddy.y, buddyTargetY, 1 - Math.exp(-4 * physDt));

            // Clamp buddy tightly to safety zone borders so buddy never touches wall or raises sediment
            let scaleX = this.buddy.scaleX || 1;
            let buddyPts = this.getBuddyCheckPoints(scaleX);
            let minYAllowed = -9999;
            let maxYAllowed = 9999;
            let minYAbsolute = -9999;
            let maxYAbsolute = 9999;
            let safetyMargin = 15; // 15px safe buffer so buddy is completely clear of walls
            let absoluteMargin = 2; // 2px absolute buffer to never touch terrain

            for (let pt of buddyPts) {
                let wx = this.buddy.x + pt.x;
                let ptTime = (wx / this.baseScrollSpeed) * 1000;
                let ptPathY = this.getTargetYAtTime(ptTime);
                let ptEnergy = this.getEnergyAtTime(ptTime);
                let { floorOffset, ceilOffset } = this.getWallOffsets(wx, ptEnergy);
                let ptFloorY = ptPathY + floorOffset;
                let ptCeilY = ptPathY - ceilOffset;

                minYAllowed = Math.max(minYAllowed, ptCeilY - pt.y + pt.r + safetyMargin);
                maxYAllowed = Math.min(maxYAllowed, ptFloorY - pt.y - pt.r - safetyMargin);

                minYAbsolute = Math.max(minYAbsolute, ptCeilY - pt.y + pt.r + absoluteMargin);
                maxYAbsolute = Math.min(maxYAbsolute, ptFloorY - pt.y - pt.r - absoluteMargin);
            }

            if (minYAllowed <= maxYAllowed) {
                this.buddy.y = Phaser.Math.Clamp(this.buddy.y, minYAllowed, maxYAllowed);
            } else if (minYAbsolute <= maxYAbsolute) {
                this.buddy.y = Phaser.Math.Clamp(this.buddy.y, minYAbsolute, maxYAbsolute);
            } else {
                this.buddy.y = (minYAbsolute + maxYAbsolute) / 2;
            }

            // 8. Silt Recovery timer & Scroll Speed Slowdown
            if (this.siltActive) {
                this.siltTime -= deltaMs;
                if (this.siltTime <= 0) {
                    this.siltActive = false;
                }
                this.scrollSpeed = Phaser.Math.Linear(this.scrollSpeed, this.baseScrollSpeed * 0.72, physDt * 3); // less punishing slowdown
            } else {
                this.scrollSpeed = Phaser.Math.Linear(this.scrollSpeed, this.baseScrollSpeed, physDt * 2.5);
            }

            // Update WebGL PostFX shader parameters (Chromatic Split)
            let fx = this.cameras.main.getPostPipeline(PsychedelicFX);
            if (fx) {
                // Chromatic split decays in sync with silt time
                let siltOffset = (this.siltActive && this.currentSiltDuration > 0)
                    ? (fx.chromaticOffsetStart || 0.02) * Math.max(0, this.siltTime / this.currentSiltDuration)
                    : 0;
                fx.chromaticOffset = siltOffset;
            }
            // Score multiplier logic (avoiding silt-outs increases multiplier dynamically)
            if (!this.siltActive) {
                this.siltFreeTime += deltaMs;
                let nextMilestone = this.flowMilestoneInterval || 10000;
                if (this.siltFreeTime >= nextMilestone) {
                    this.siltFreeTime = 0;
                    if (this.scoreMultiplier < 8) {
                        this.scoreMultiplier++;
                        let bonusPoints = 50 * this.scoreMultiplier;
                        this.pointsScore += bonusPoints;
                        this.spawnFloatingText(this.player.x, this.player.y - 35, `FLOW x${this.scoreMultiplier}! +${bonusPoints}`, '#00ff66');
                    } else {
                        let bonusPoints = 50 * this.scoreMultiplier;
                        this.pointsScore += bonusPoints;
                        this.spawnFloatingText(this.player.x, this.player.y - 35, `MAX FLOW! +${bonusPoints}`, '#00f0ff');
                        this.triggerMaxFlowPulse();
                    }
                }
            } else {
                this.siltFreeTime = 0;
            }

            // Update speech bubbles positions
            if (this.buddyBubble.visible) {
                this.buddyBubble.setPosition(this.buddy.x, this.buddy.y - 45);
            }
            if (this.playerBubble.visible) {
                this.playerBubble.setPosition(this.player.x, this.player.y - 45);
            }

            // 9. Particle emissions
            this.emitBreathingParticles();
            this.updateMarineSnow(dt);

            // 10. Redraw Visualizers and Terrain
            this.drawParallax(time);
            this.drawBackgroundVisuals(time);
            this.drawTerrain();
            this.drawCaveLights();
            this.drawPlayerVisuals(time);
            this.drawBuddyVisuals(time);
            this.drawForegroundBubbles(delta / 1000);
            this.drawSiltOverlay();

            // 11. Check Collectibles steering
            this.checkCollisions();
        } catch (e) {
            console.error("Error in update loop:", e);
            this.isPlaying = false;
            let parent = document.getElementById('game-container');
            if (parent) {
                let errDiv = document.createElement('div');
                errDiv.style.position = 'absolute';
                errDiv.style.top = '10px';
                errDiv.style.left = '10px';
                errDiv.style.color = '#ff1e56';
                errDiv.style.backgroundColor = 'rgba(0,0,0,0.95)';
                errDiv.style.padding = '15px';
                errDiv.style.border = '2px solid #ff1e56';
                errDiv.style.borderRadius = '8px';
                errDiv.style.fontFamily = 'monospace';
                errDiv.style.fontSize = '12px';
                errDiv.style.zIndex = '99999';
                errDiv.style.maxWidth = '1180px';
                errDiv.style.maxHeight = '680px';
                errDiv.style.overflow = 'auto';
                errDiv.innerText = "update() Crash Stack Trace:\n\n" + (e.stack || e.message);
                parent.appendChild(errDiv);
            }
        }
    }

    // --- PROCEDURAL DRAWING & ANIMATIONS ---

    createProceduralTextures() {
        if (!this.textures.exists('spark')) {
            let starCanvas = document.createElement('canvas');
            starCanvas.width = 16;
            starCanvas.height = 16;
            let sCtx = starCanvas.getContext('2d');
            let grad = sCtx.createRadialGradient(8, 8, 1, 8, 8, 8);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
            grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            sCtx.fillStyle = grad;
            sCtx.beginPath();
            sCtx.arc(8, 8, 8, 0, Math.PI * 2);
            sCtx.fill();
            this.textures.addCanvas('spark', starCanvas);
        }

        if (!this.textures.exists('collectible')) {
            let debCanvas = document.createElement('canvas');
            debCanvas.width = 24;
            debCanvas.height = 24;
            let dCtx = debCanvas.getContext('2d');
            let dGrad = dCtx.createRadialGradient(12, 12, 2, 12, 12, 12);
            dGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
            dGrad.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
            dGrad.addColorStop(1, 'rgba(0,0,0,0)');
            dCtx.fillStyle = dGrad;
            dCtx.beginPath();
            dCtx.arc(12, 12, 12, 0, Math.PI * 2);
            dCtx.fill();
            this.textures.addCanvas('collectible', debCanvas);
        }

        if (!this.textures.exists('silt_cloud')) {
            let siltCanvas = document.createElement('canvas');
            siltCanvas.width = 32;
            siltCanvas.height = 32;
            let sCtx = siltCanvas.getContext('2d');
            let sGrad = sCtx.createRadialGradient(16, 16, 2, 16, 16, 16);
            sGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            sGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
            sGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            sCtx.fillStyle = sGrad;
            sCtx.beginPath();
            sCtx.arc(16, 16, 16, 0, Math.PI * 2);
            sCtx.fill();
            this.textures.addCanvas('silt_cloud', siltCanvas);
        }

        if (!this.textures.exists('silt_vignette')) {
            let canvas = document.createElement('canvas');
            canvas.width = 600;
            canvas.height = 350;
            let ctx = canvas.getContext('2d');
            let grad = ctx.createRadialGradient(300, 175, 40, 300, 175, 330);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
            grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.4)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 1)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 600, 350);
            this.textures.addCanvas('silt_vignette', canvas);
        }
    }

    spawnDiver(startY = 200) {
        this.player = this.add.container(250, startY).setDepth(10);
        this.playerGraphics = this.add.graphics();
        this.player.add(this.playerGraphics);
    }

    spawnBuddy(startY = 200) {
        this.buddy = this.add.container(550, startY).setDepth(10);
        this.buddyGraphics = this.add.graphics();
        this.buddy.add(this.buddyGraphics);
    }

    setupEmitters() {
        this.bubbleEmitter = this.add.particles(0, 0, 'spark', {
            lifespan: 1800,
            speedY: { min: -120, max: -40 },
            speedX: { min: -15, max: 20 },
            scale: { start: 0.4, end: 1.2 },
            alpha: { start: 0.6, end: 0 },
            frequency: -1,
            blendMode: 'ADD'
        });

        this.siltEmitter = this.add.particles(0, 0, 'silt_cloud', {
            lifespan: { min: 2000, max: 4500 },
            scale: { start: 4.0, end: 24.0 }, // Massive silt clouds
            alpha: { start: 0.9, end: 0 },
            frequency: -1,
            blendMode: 'NORMAL'
        });
        this.siltEmitter.setDepth(9);

        // Volumetric Hydrothermal Plumes Emitter
        this.plumeEmitter = this.add.particles(0, 0, 'silt_cloud', {
            lifespan: { min: 1500, max: 2500 },
            speedY: { min: -140, max: -60 },
            speedX: { min: -20, max: 20 },
            scale: { start: 2.0, end: 8.0 },
            alpha: { start: 0.10, end: 0 },
            frequency: -1,
            blendMode: 'ADD'
        });
        this.plumeEmitter.setDepth(11); // directly above containers at depth 10
    }

    emitBreathingParticles() {
        let dt = this.game.loop.delta / 1000;

        // 1. Exhale bubbles on spacebar release (lung volume shrinking)
        let spaceDown;
        if (this.countdownActive) {
            let breathPeriod = 3600;
            let breathPhase = (this.time.now % breathPeriod) / breathPeriod;
            spaceDown = (breathPhase < 0.5);
        } else {
            spaceDown = this.useAutopilot ? this.simulatedSpaceDown : this.spaceKey.isDown;
        }

        if (!spaceDown && this.V_lung > 0.05) {
            if (Math.random() < 0.20) {
                let rndHue = (this.baseHue + Math.random() * 60) % 360;
                let bubbleColor = this.hslToColorInt(rndHue / 360, 1.0, 0.65);
                this.bubbleEmitter.particleTint = bubbleColor;
                this.bubbleEmitter.emitParticleAt(this.player.x + 18, this.player.y - 4);
                this.exhaleBubblesCount++;
            }
        }

        // 2. Periodic natural breathing exhale for player
        if (Math.random() < 0.008) {
            this.emitExhaleBubbles(this.player.x + 18, this.player.y - 4);
            this.exhaleBubblesCount += 3; // emitExhaleBubbles generates 3 particles
        }

        // 3. Periodic natural breathing exhale for buddy
        if (Math.random() < 0.008) {
            let buddyMouthX = this.buddy.x + (this.buddy.scaleX * 18);
            this.emitExhaleBubbles(buddyMouthX, this.buddy.y - 4);
        }

    }

    emitExhaleBubbles(x, y) {
        let rndHue = (this.baseHue + Math.random() * 40) % 360;
        let bColor = this.hslToColorInt(rndHue / 360, 0.7, 0.85);
        this.bubbleEmitter.particleTint = bColor;
        for (let i = 0; i < 3; i++) {
            this.bubbleEmitter.emitParticleAt(
                x + Math.random() * 6 - 3,
                y + Math.random() * 6 - 3
            );
        }
    }

    updateMarineSnow(dt) {
        let g = this.marineSnowGraphics;
        if (!g) return;
        g.clear();
        if (!this.player || !this.buddy) return;

        let camX = this.cameras.main.scrollX;
        let pHandX = this.player.x + 26;
        let pHandY = this.player.y - 2;

        let bDir = this.buddy.scaleX || 1;
        let bHandX = this.buddy.x + 26 * bDir;
        let bHandY = this.buddy.y - 2;

        for (let mote of this.marineSnowMotes) {
            mote.x += mote.vx * dt;
            mote.y += mote.vy * dt;

            // Wrap screen boundaries
            if (mote.x < 0) mote.x += 1200;
            if (mote.x > 1200) mote.x -= 1200;
            if (mote.y < 0) mote.y += 700;
            if (mote.y > 700) mote.y -= 700;

            // Translate screen position to world position for light cone checks
            let wx = mote.x + camX;
            let wy = mote.y;

            // Player light beam check
            let dxP = wx - pHandX;
            let dyP = wy - pHandY;
            let inPlayerCone = (dxP >= 0 && dxP <= 320 && Math.abs(dyP) <= (dxP / 320) * 75);

            // Buddy light beam check
            let dxB = (wx - bHandX) * bDir;
            let dyB = wy - bHandY;
            let inBuddyCone = (dxB >= 0 && dxB <= 320 && Math.abs(dyB) <= (dxB / 320) * 75);

            let illuminated = inPlayerCone || inBuddyCone;
            let targetAlpha = illuminated ? 0.40 : 0.05;
            mote.alpha += (targetAlpha - mote.alpha) * 0.1;

            let color = illuminated ? 0x00f0ff : 0x475569;
            g.fillStyle(color, mote.alpha);
            g.fillCircle(mote.x, mote.y, mote.size);
        }
    }

    drawParallax(time) {
        let camX = this.cameras.main.scrollX;
        let screenW = 1300;
        let multiFactor = this.scoreMultiplier - 1;
        let baseSat = this.siltActive ? 0.05 : Math.min(0.85, 0.25 + multiFactor * 0.086);
        let baseLum = this.siltActive ? 0.15 : Math.min(0.55, 0.25 + multiFactor * 0.043);
        let baseAlpha = this.siltActive ? 0.08 : Math.min(0.55, 0.18 + multiFactor * 0.053);

        const getCaveFloorY = (worldX) => {
            let t = (worldX / this.baseScrollSpeed) * 1000;
            let pathY = this.getTargetYAtTime(t);
            let energy = this.getEnergyAtTime(t);
            let bOff = Math.max(65, 85 - energy * 30);
            let jag = 0.5 + energy * 1.5;
            let bPulse = (this.currentBeatPulse || 0) * 15 * (0.8 + energy);
            return pathY + Math.max(68, bOff + (Math.cos(worldX * 0.015) * 10 + Math.sin(worldX * 0.04) * 5) * jag) + bPulse;
        };

        const getCaveCeilY = (worldX) => {
            let t = (worldX / this.baseScrollSpeed) * 1000;
            let pathY = this.getTargetYAtTime(t);
            let energy = this.getEnergyAtTime(t);
            let bOff = Math.max(65, 85 - energy * 30);
            let jag = 0.5 + energy * 1.5;
            let bPulse = (this.currentBeatPulse || 0) * 15 * (0.8 + energy);
            return pathY - Math.max(68, bOff + (Math.sin(worldX * 0.02) * 10 + Math.cos(worldX * 0.05) * 5) * jag) - bPulse;
        };

        // flowFill: 0 at multiplier x1 (wireframe), 1 at multiplier x8 (full solid neon) - gradual power curve
        let flowFill = Math.pow((this.scoreMultiplier - 1) / 7.0, 1.5);

        // --- FAR layer (10% relative speed, screen-space) ---
        // Far layer is visibly FAINTER than the near layer — lower lum and lower alpha.
        // parallaxFarGraphics has setScrollFactor(0) so coordinates are screen-space.
        let fg = this.parallaxFarGraphics;
        fg.clear();
        let farHue = (this.baseHue + 200) % 360;
        // Far layer: noticeably dimmer luminosity and capped alpha
        let farLum = Math.max(0.03, baseLum - 0.18);
        let farAlpha = baseAlpha * 0.28; // clearly fainter than near
        let farColor = this.hslToColorInt(farHue / 360, baseSat * 0.8, farLum);
        fg.lineStyle(1.0, farColor, farAlpha);

        let farFactor = 0.10;
        let farSpacing = 190;
        // farPhase: how many px the far layer has scrolled left (mod one spacing period)
        let farPhase = (camX * farFactor) % farSpacing;
        let farCount = Math.ceil(screenW / farSpacing) + 2;

        // Solid far-layer rock: continuous ceiling and floor bands behind stalactites/stalagmites
        // Ceiling band: fill from screen top to cave ceiling profile
        fg.fillStyle(farColor, farAlpha * 0.45 + flowFill * 0.15);
        fg.lineStyle(1.0, farColor, farAlpha * 0.5);
        {
            let bStep = 60;
            let bCount = Math.ceil(screenW / bStep) + 2;
            fg.beginPath();
            let bFirst = true;
            for (let nb = -1; nb <= bCount; nb++) {
                let bsx = nb * bStep - (camX * farFactor) % bStep;
                let bwx = bsx + camX * farFactor;
                let bc = getCaveCeilY(bwx);
                if (bFirst) { fg.moveTo(bsx, -50); fg.lineTo(bsx, bc); bFirst = false; }
                else { fg.lineTo(bsx, bc); }
            }
            // Close top
            let lastBsx = bCount * bStep - (camX * farFactor) % bStep;
            fg.lineTo(lastBsx, -50);
            fg.closePath();
            fg.fillPath();
            fg.strokePath();

            // Floor band: fill from cave floor profile to screen bottom
            fg.beginPath();
            bFirst = true;
            for (let nb = -1; nb <= bCount; nb++) {
                let bsx = nb * bStep - (camX * farFactor) % bStep;
                let bwx = bsx + camX * farFactor;
                let bf = getCaveFloorY(bwx);
                if (bFirst) { fg.moveTo(bsx, 750); fg.lineTo(bsx, bf); bFirst = false; }
                else { fg.lineTo(bsx, bf); }
            }
            fg.lineTo(lastBsx, 750);
            fg.closePath();
            fg.fillPath();
            fg.strokePath();
        }

        for (let n = -1; n <= farCount; n++) {
            // screen-space X position of this tile slot
            let sx = n * farSpacing - farPhase;
            // stable global index for deterministic sin-jitter (doesn't change sign of motion)
            let i = Math.floor((camX * farFactor + sx + farPhase) / farSpacing);
            sx += Math.sin(i * 7.3) * 50;

            // Each shape anchors to its own x for correct cave profile
            let worldX = sx + camX * farFactor;
            let stalCeilFloor = getCaveFloorY(worldX);
            let stalCeil = getCaveCeilY(worldX);
            let channelH = stalCeilFloor - stalCeil;
            let maxH = Math.max(10, (channelH - 30) * 0.55); // leave ≥30px gap between tips
            let stalH = Math.min(maxH, 60 + Math.sin(i * 2.1) * 40);
            let stagH = Math.min(maxH, 50 + Math.sin(i * 1.5 + 1.2) * 35);
            let hw = 10 + Math.sin(i * 3.7) * 5;

            // Fill alpha driven by flow level — 0 = wireframe, 1 = solid
            fg.fillStyle(farColor, Math.max(farAlpha * 0.4, farAlpha * flowFill * 0.6));
            fg.lineStyle(1.0, farColor, farAlpha * 0.8);

            let stagW = Math.max(6, hw * 1.3 + Math.sin(i * 2.9) * 4);

            // Occasional cave columns representing fused stalactites/stalagmites (flared hourglass)
            let isColumn = (Math.abs(i) % 6 === 0);
            if (isColumn) {
                let midW = Math.max(3, hw * 0.45);
                let baseCeilW = hw * 1.3;
                let baseFloorW = stagW * 1.3;
                let midY = stalCeil + (stalCeilFloor - stalCeil) * 0.45;

                fg.beginPath();
                fg.moveTo(sx - baseCeilW, stalCeil - 60);
                fg.lineTo(sx + baseCeilW, stalCeil - 60);
                fg.lineTo(sx + midW, midY);
                fg.lineTo(sx + baseFloorW, stalCeilFloor + 60);
                fg.lineTo(sx - baseFloorW, stalCeilFloor + 60);
                fg.lineTo(sx - midW, midY);
                fg.closePath();
                fg.fillPath();
                fg.strokePath();
            } else {
                // Stalactite
                fg.beginPath();
                fg.moveTo(sx - hw, stalCeil - 60); fg.lineTo(sx + hw, stalCeil - 60); fg.lineTo(sx, stalCeil + stalH); fg.closePath();
                fg.fillPath(); fg.strokePath();

                // Stalagmite (drawn as an organic upward-pointing triangle)
                fg.beginPath();
                fg.moveTo(sx - stagW, stalCeilFloor + 60);
                fg.lineTo(sx + stagW, stalCeilFloor + 60);
                fg.lineTo(sx, stalCeilFloor - stagH);
                fg.closePath();
                fg.fillPath(); fg.strokePath();
            }
        }

        // --- NEAR layer (40% relative speed) ---
        // Near layer: brighter than far — higher lum and higher alpha.
        let ng = this.parallaxNearGraphics;
        ng.clear();
        let nearHue = (this.baseHue + 110) % 360;
        let nearColor = this.hslToColorInt(nearHue / 360, Math.min(1, baseSat * 1.1), Math.max(0.12, baseLum - 0.10));
        let nearStrokeAlpha = baseAlpha * 0.65;
        ng.lineStyle(2, nearColor, nearStrokeAlpha);

        let nearFactor = 0.40;
        let nearSpacing = 240;
        let nearStart = Math.floor((camX * nearFactor) / nearSpacing) * nearSpacing - nearSpacing;
        let nearEnd = nearStart + screenW + nearSpacing * 3;

        // Solid near-layer rock bands
        ng.fillStyle(nearColor, nearStrokeAlpha * 0.40 + flowFill * 0.18);
        ng.lineStyle(2, nearColor, nearStrokeAlpha * 0.6);
        {
            let nStep = 80;
            let nCount = Math.ceil(screenW / nStep) + 2;
            let nBase = Math.floor((camX * nearFactor) / nStep) * nStep;
            // Ceiling band
            ng.beginPath();
            let nFirst = true;
            for (let nb = 0; nb <= nCount; nb++) {
                let nwx = nBase + nb * nStep;
                let nsx = nwx + camX * (1 - nearFactor);
                let nc = getCaveCeilY(nwx);
                if (nFirst) { ng.moveTo(nsx, -50); ng.lineTo(nsx, nc); nFirst = false; }
                else { ng.lineTo(nsx, nc); }
            }
            let lastNsx = nBase + nCount * nStep + camX * (1 - nearFactor);
            ng.lineTo(lastNsx, -50);
            ng.closePath();
            ng.fillPath();
            ng.strokePath();

            // Floor band
            ng.beginPath();
            nFirst = true;
            for (let nb = 0; nb <= nCount; nb++) {
                let nwx = nBase + nb * nStep;
                let nsx = nwx + camX * (1 - nearFactor);
                let nf = getCaveFloorY(nwx);
                if (nFirst) { ng.moveTo(nsx, 750); ng.lineTo(nsx, nf); nFirst = false; }
                else { ng.lineTo(nsx, nf); }
            }
            ng.lineTo(lastNsx, 750);
            ng.closePath();
            ng.fillPath();
            ng.strokePath();
        }

        ng.lineStyle(2, nearColor, nearStrokeAlpha);
        for (let worldX = nearStart; worldX <= nearEnd; worldX += nearSpacing) {
            let i = Math.round(worldX / nearSpacing);
            let sx = worldX + camX * (1 - nearFactor);
            sx += Math.sin(i * 5.1) * 60;

            let sampleX = worldX + Math.sin(i * 5.1) * 60;

            // Anchor each shape to its own screen x for correct cave profile
            let nearFloor = getCaveFloorY(sampleX);
            let nearCeil = getCaveCeilY(sampleX);
            let channelH = nearFloor - nearCeil;
            let maxH = Math.max(10, (channelH - 30) * 0.55); // leave ≥30px gap between tips
            let stalH = Math.min(maxH, 85 + Math.sin(i * 1.7) * 55);
            let stagH = Math.min(maxH, 70 + Math.sin(i * 2.4 + 0.7) * 50);
            let hw = 13 + Math.sin(i * 4.2) * 6;

            // Fill alpha driven by flow level — 0 = wireframe, 1 = solid neon
            ng.fillStyle(nearColor, Math.max(nearStrokeAlpha * 0.35, nearStrokeAlpha * flowFill * 0.75));

            let stagW = Math.max(8, hw * 1.3 + Math.sin(i * 3.1) * 5);

            // Occasional cave columns representing fused stalactites/stalagmites (flared hourglass)
            let isColumn = (Math.abs(i) % 5 === 0);
            if (isColumn) {
                let midW = Math.max(5, hw * 0.45);
                let baseCeilW = hw * 1.3;
                let baseFloorW = stagW * 1.3;
                let midY = nearCeil + (nearFloor - nearCeil) * 0.45;

                ng.beginPath();
                ng.moveTo(sx - baseCeilW, nearCeil - 80);
                ng.lineTo(sx + baseCeilW, nearCeil - 80);
                ng.lineTo(sx + midW, midY);
                ng.lineTo(sx + baseFloorW, nearFloor + 80);
                ng.lineTo(sx - baseFloorW, nearFloor + 80);
                ng.lineTo(sx - midW, midY);
                ng.closePath();
                ng.fillPath();
                ng.strokePath();
            } else {
                // Stalactite
                ng.beginPath();
                ng.moveTo(sx - hw, nearCeil - 80); ng.lineTo(sx + hw, nearCeil - 80); ng.lineTo(sx, nearCeil + stalH);
                ng.closePath();
                ng.fillPath(); ng.strokePath();

                // Stalagmite (drawn as an organic upward-pointing triangle)
                ng.beginPath();
                ng.moveTo(sx - stagW, nearFloor + 80);
                ng.lineTo(sx + stagW, nearFloor + 80);
                ng.lineTo(sx, nearFloor - stagH);
                ng.closePath();
                ng.fillPath(); ng.strokePath();
            }
        }
    }

    drawBackgroundVisuals(time) {
        let bgG = this.backgroundGraphics;
        bgG.clear();

        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.scoreMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.scoreMultiplier - 1) * 0.017);

        for (let r of this.beatRipples) {
            let hue = (this.baseHue + r.radius * 0.15) % 360;
            let rippleColor = Phaser.Display.Color.HSLToColor(hue / 360, flowSat, 0.6 + flowLightBoost).color;
            bgG.lineStyle(2, rippleColor, r.alpha * 0.7);
            bgG.strokeCircle(r.x, r.y, r.radius);
        }
    }

    drawForegroundBubbles(dt) {
        let fg = this.foregroundGraphics;
        fg.clear();

        // 1. Draw midground bubbles (smaller, more numerous, slower parallax)
        for (let b of this.foregroundBubbles2) {
            b.x -= this.scrollSpeed * b.speed * dt;
            b.y += b.verticalDrift * dt;

            // Screen boundary wrapping
            if (b.x < -b.radius * 2) {
                b.x = 1300 + b.radius * 2;
                b.y = Math.random() * 700;
                b.radius = 4 + Math.random() * 6;
                b.speed = 1.08 + Math.random() * 0.22;
                b.alpha = 0.08 + Math.random() * 0.12;
                b.verticalDrift = -8 - Math.random() * 12;
            }
            if (b.y < -b.radius * 2) {
                b.y = 700 + b.radius * 2;
                b.x = Math.random() * 1300;
            }

            let bubbleHue = (this.baseHue + 180) % 360;
            let bubbleColor = Phaser.Display.Color.HSLToColor(bubbleHue / 360, 0.6, 0.85).color;
            fg.fillStyle(bubbleColor, b.alpha);
            fg.fillCircle(b.x, b.y, b.radius);
            fg.lineStyle(0.8, 0xffffff, b.alpha * 1.2);
            fg.strokeCircle(b.x, b.y, b.radius);
        }

        // 2. Draw foreground bubbles (larger, faster parallax)
        for (let b of this.foregroundBubbles) {
            b.x -= this.scrollSpeed * b.speed * dt;
            b.y += b.verticalDrift * dt;

            // Screen boundary wrapping
            if (b.x < -b.radius * 2) {
                b.x = 1300 + b.radius * 2;
                b.y = Math.random() * 700;
                b.radius = 12 + Math.random() * 18;
                b.speed = 1.4 + Math.random() * 0.4;
                b.alpha = 0.12 + Math.random() * 0.15;
                b.verticalDrift = -15 - Math.random() * 20;
            }
            if (b.y < -b.radius * 2) {
                b.y = 700 + b.radius * 2;
                b.x = Math.random() * 1300;
            }

            let bubbleHue = (this.baseHue + 180) % 360;
            let bubbleColor = Phaser.Display.Color.HSLToColor(bubbleHue / 360, 0.6, 0.85).color;
            fg.fillStyle(bubbleColor, b.alpha);
            fg.fillCircle(b.x, b.y, b.radius);
            fg.lineStyle(1.0, 0xffffff, b.alpha * 1.5);
            fg.strokeCircle(b.x, b.y, b.radius);
        }
    }

    drawPlayerVisuals(time) {
        let g = this.playerGraphics;
        g.clear();
        let pulse = this.currentBeatPulse || 0;

        // Dynamic flow-state color popping based on silt-free multiplier
        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.scoreMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.scoreMultiplier - 1) * 0.017);

        let playerHue = (this.baseHue + 320) % 360; // Pink/Magenta base (distinct from buddy)
        let mainColor = this.hslToColorInt(playerHue / 360, flowSat, 0.55 + flowLightBoost);
        let accentColor = this.hslToColorInt(((playerHue + 130) % 360) / 360, flowSat, 0.6 + flowLightBoost); // Neon Green/Yellow

        if (this.avatarType === 'diver') {
            let glowRadius = 20 + this.V_lung * 8 + pulse * 8 + (this.scoreMultiplier - 1) * 4;
            g.fillStyle(mainColor, 0.08 + this.V_lung * 0.04 + pulse * 0.08);
            g.fillCircle(0, 0, glowRadius);

            // --- AURA RINGS: concentric neon rings that grow with scoreMultiplier ---
            // x1: none. x2-x7: rings. x8+: 7 rings.
            let auraLevels = Math.min(this.scoreMultiplier - 1, 7);
            for (let a = 0; a < auraLevels; a++) {
                let auraHue = (this.baseHue + a * 75) % 360;
                let auraColor = this.hslToColorInt(auraHue / 360, 1.0, 0.65);
                // Each ring pulses with beat, offset phase per ring
                let auraPhase = (this.elapsedTime * 0.003 + a * 0.8) % (Math.PI * 2);
                let auraR = 32 + a * 18 + pulse * (10 + a * 5) + Math.sin(auraPhase) * 5;
                let auraAlpha = 0.22 + pulse * 0.35 - a * 0.04;

                // Draw jagged oscilloscope-like aura
                g.lineStyle(1.2 + a * 0.5, auraColor, Math.max(0, auraAlpha));
                g.beginPath();
                let steps = 60;
                for (let step = 0; step <= steps; step++) {
                    let angle = (step / steps) * Math.PI * 2;
                    // Multi-harmonic oscillation locked to angle and time
                    let freq1 = 4 + a;
                    let freq2 = 10 + a * 3;
                    let phase1 = angle * freq1 - (time * 0.005);
                    let phase2 = angle * freq2 + (time * 0.012);

                    let amp1 = 4 + pulse * 6;
                    let amp2 = 2 + pulse * 3;
                    let waveVal = Math.sin(phase1) * amp1 + (Math.abs(Math.sin(phase2)) - 0.5) * amp2 * 2;

                    // Modulate radius by localEnergy and flowState multiplier
                    let r = auraR + waveVal * (0.4 + this.localEnergy * 0.6);
                    let ax = Math.cos(angle) * r;
                    let ay = Math.sin(angle) * r;
                    if (step === 0) {
                        g.moveTo(ax, ay);
                    } else {
                        g.lineTo(ax, ay);
                    }
                }
                g.strokePath();
            }

            // Masterful frog-kick calculation (highly visible large displacement)
            let frogPhase = (this.elapsedTime / 350) % (Math.PI * 2);
            let kickExtension = Math.max(0, Math.sin(frogPhase)); // 0 = flexed, 1 = extended

            // --- 1. DRAW BACK LEG (LEG 2 - bent knee frog kick trim) ---
            g.lineStyle(2.5, mainColor, 0.65); // slightly dimmer
            let hip2X = -8, hip2Y = 0;
            let knee2X = hip2X - (6 + kickExtension * 8);
            let knee2Y = hip2Y - (12 - kickExtension * 8);
            let foot2X = knee2X - (2 + kickExtension * 12);
            let foot2Y = knee2Y - (10 - kickExtension * 10);

            g.beginPath();
            g.moveTo(hip2X, hip2Y);
            g.lineTo(knee2X, knee2Y);
            g.lineTo(foot2X, foot2Y);
            g.strokePath();

            // Back Fin (accent color, neon)
            let finLength = 15;
            let finWidth = 10;
            g.fillStyle(accentColor, 0.85);
            g.beginPath();
            g.moveTo(foot2X, foot2Y);
            g.lineTo(foot2X - finLength, foot2Y - finWidth / 2 + (1 - kickExtension) * 4);
            g.lineTo(foot2X - finLength + 3, foot2Y + finWidth / 2 + (1 - kickExtension) * 4);
            g.closePath();
            g.fillPath();

            // --- 2. DRAW DOUBLE TANKS (TWINSET - Cave diving standard horizontal trim) ---
            g.lineStyle(1.2, accentColor, 1);
            g.fillStyle(0x020514, 0.95);

            // Tank 2 (upper cylinder in perspective)
            g.fillRoundedRect(-22, -16, 24, 6, 2);
            g.strokeRoundedRect(-22, -16, 24, 6, 2);

            // Tank 1 (lower cylinder, closer to back)
            g.fillRoundedRect(-22, -11, 24, 6, 2);
            g.strokeRoundedRect(-22, -11, 24, 6, 2);

            // Isolator Manifold connecting the two tanks at the valves (X = 2)
            g.lineStyle(1.5, accentColor, 1);
            g.beginPath();
            g.moveTo(2, -13);
            g.lineTo(2, -8);
            g.strokePath();

            // Metal tank bands holding them together
            g.lineStyle(1.0, mainColor, 0.8);
            g.beginPath();
            // Band 1 (rear)
            g.moveTo(-16, -16); g.lineTo(-16, -5);
            // Band 2 (front)
            g.moveTo(-6, -16); g.lineTo(-6, -5);
            g.strokePath();

            // Regulator hose starting from valve manifold area
            g.lineStyle(1, accentColor, 0.8);
            let p0x = 2, p0y = -11;
            let cx = 8, cy = -16;
            let p1x = 16, p1y = -3; // mouthpiece
            g.beginPath();
            g.moveTo(p0x, p0y);
            // Draw smooth curve using quadratic Bezier approximation
            for (let i = 1; i <= 4; i++) {
                let t = i / 4;
                let mt = 1 - t;
                let x = mt * mt * p0x + 2 * mt * t * cx + t * t * p1x;
                let y = mt * mt * p0y + 2 * mt * t * cy + t * t * p1y;
                g.lineTo(x, y);
            }
            g.strokePath();

            // --- 3. DRAW CHEST ---
            let chestWidth = 28 + this.V_lung * 10;
            g.lineStyle(2, mainColor, 1);
            g.fillStyle(0x020514, 0.95);
            g.fillEllipse(0, 0, chestWidth, 16);
            g.strokeEllipse(0, 0, chestWidth, 16);

            // Suit details
            g.lineStyle(1.5, accentColor, 1);
            g.strokeRect(-12, -12, 20, 5);

            // --- 4. DRAW HEAD & MASK (Mask is neon colored) ---
            g.lineStyle(2, mainColor, 1);
            g.fillStyle(0x020514, 0.95);
            g.fillCircle(14, -4, 6);
            g.strokeCircle(14, -4, 6);

            // Goggles Visor (glowing neon rounded visor)
            g.fillStyle(accentColor, 0.85);
            g.fillRoundedRect(15, -7, 4, 5, 1);

            // Regulator mouthpiece
            g.fillStyle(mainColor, 1);
            g.fillRect(16, -3, 3, 3);

            // --- 5. DRAW FRONT LEG (LEG 1 - frog kick trim) ---
            g.lineStyle(2.5, mainColor, 1);
            let hip1X = -10, hip1Y = 2;
            let frogPhase2 = frogPhase + 0.25;
            let kickExtension2 = Math.max(0, Math.sin(frogPhase2));
            let knee1X = hip1X - (6 + kickExtension2 * 8);
            let knee1Y = hip1Y - (12 - kickExtension2 * 8);
            let foot1X = knee1X - (2 + kickExtension2 * 12);
            let foot1Y = knee1Y - (10 - kickExtension2 * 10);

            g.beginPath();
            g.moveTo(hip1X, hip1Y);
            g.lineTo(knee1X, knee1Y);
            g.lineTo(foot1X, foot1Y);
            g.strokePath();

            // Front Fin (accent color, neon)
            g.fillStyle(accentColor, 1.0);
            g.beginPath();
            g.moveTo(foot1X, foot1Y);
            g.lineTo(foot1X - finLength, foot1Y - finWidth / 2 + (1 - kickExtension2) * 4);
            g.lineTo(foot1X - finLength + 3, foot1Y + finWidth / 2 + (1 - kickExtension2) * 4);
            g.closePath();
            g.fillPath();

            // --- 6. DRAW ARM & LIGHT (Masterful outstretched position holding primary light) ---
            let shoulderX = 8, shoulderY = -2;
            let elbowX = shoulderX + 10;
            let elbowY = shoulderY;
            let handX = elbowX + 8;
            let handY = elbowY;

            if (this.buddyState === 'relieved') {
                // Raise arm to make "OK" hand signal
                elbowX = shoulderX + 4;
                elbowY = shoulderY - 8;
                handX = elbowX + 6;
                handY = elbowY - 6;
            }

            g.lineStyle(2.5, mainColor, 1);
            g.beginPath();
            g.moveTo(shoulderX, shoulderY);
            g.lineTo(elbowX, elbowY);
            g.lineTo(handX, handY);
            g.strokePath();

            // Primary Light Canister
            g.lineStyle(1.5, accentColor, 1);
            g.fillStyle(0x020514, 0.95);
            g.fillRoundedRect(handX - 1, handY - 3, 6, 6, 1);
            g.strokeRoundedRect(handX - 1, handY - 3, 6, 6, 1);

            // Cave Diving Primary Light Beam
            let beamLength = 280;
            let beamSpread = 50;
            g.fillStyle(accentColor, 0.08); // soft neon glowing beam
            g.beginPath();
            g.moveTo(handX + 3, handY);
            g.lineTo(handX + 3 + beamLength, handY - beamSpread);
            g.lineTo(handX + 3 + beamLength, handY + beamSpread);
            g.closePath();
            g.fillPath();

        } else if (this.avatarType === 'fish') {
            let glowRadius = 24 + this.V_lung * 8 + pulse * 8;
            g.fillStyle(mainColor, 0.08 + this.V_lung * 0.04 + pulse * 0.08);
            g.fillCircle(0, 0, glowRadius);

            let bodyWidth = 28 + this.V_lung * 10;
            let bodyHeight = 18;

            g.lineStyle(2, mainColor, 1);
            g.fillStyle(0x020514, 0.9);
            g.fillEllipse(0, 0, bodyWidth, bodyHeight);
            g.strokeEllipse(0, 0, bodyWidth, bodyHeight);

            let tailPhase = Math.sin((this.elapsedTime / 140)) * 10;
            g.lineStyle(2, accentColor, 1);
            g.fillStyle(0x020514, 0.85);
            g.beginPath();
            g.moveTo(-bodyWidth / 2, 0);
            g.lineTo(-bodyWidth / 2 - 15, -12 + tailPhase);
            g.lineTo(-bodyWidth / 2 - 10, 0);
            g.lineTo(-bodyWidth / 2 - 15, 12 + tailPhase);
            g.closePath();
            g.fillPath();
            g.strokePath();

            g.fillStyle(mainColor, 1);
            g.fillCircle(bodyWidth / 2 - 8, -3, 2);

            g.lineStyle(1.5, accentColor, 0.5 + this.V_lung * 0.5);
            g.beginPath();
            g.arc(-bodyWidth / 4 + 6, -3, 6, Math.PI * 0.75, Math.PI * 1.25);
            g.strokePath();
            g.beginPath();
            g.arc(-bodyWidth / 4 + 9, -3, 6, Math.PI * 0.75, Math.PI * 1.25);
            g.strokePath();

        } else if (this.avatarType === 'turtle') {
            let glowRadius = 26 + this.V_lung * 6 + pulse * 6;
            g.fillStyle(mainColor, 0.08 + this.V_lung * 0.04 + pulse * 0.08);
            g.fillCircle(0, 0, glowRadius);

            let shellWidth = 32 + this.V_lung * 6;
            let shellHeight = 22;

            let swimPhase = Math.sin((this.elapsedTime / 200));
            g.lineStyle(2, mainColor, 1);
            g.fillStyle(0x020514, 0.9);

            g.beginPath();
            g.moveTo(6, -8);
            g.lineTo(16 + swimPhase * 8, -22);
            g.lineTo(6 + swimPhase * 6, -18);
            g.closePath();
            g.fillPath();
            g.strokePath();

            g.beginPath();
            g.moveTo(6, 8);
            g.lineTo(16 - swimPhase * 8, 22);
            g.lineTo(6 - swimPhase * 6, 18);
            g.closePath();
            g.fillPath();
            g.strokePath();

            g.lineStyle(2, mainColor, 1);
            g.fillStyle(0x010c06, 0.95);
            g.fillEllipse(0, 0, shellWidth, shellHeight);
            g.strokeEllipse(0, 0, shellWidth, shellHeight);

            g.lineStyle(1, mainColor, 0.3);
            g.strokeEllipse(0, 0, shellWidth - 8, shellHeight - 6);

            g.lineStyle(1.5, mainColor, 1);
            g.fillStyle(0x020514, 0.95);
            g.fillCircle(shellWidth / 2 + 4, 0, 5);
            g.strokeCircle(shellWidth / 2 + 4, 0, 5);

        } else if (this.avatarType === 'jellyfish') {
            let glowRadius = 22 + this.V_lung * 10 + pulse * 8;
            g.fillStyle(mainColor, 0.08 + this.V_lung * 0.04 + pulse * 0.08);
            g.fillCircle(0, 0, glowRadius);

            let bellRadius = 16 + this.V_lung * 8;

            g.lineStyle(2, mainColor, 1);
            g.fillStyle(0x020514, 0.95);
            g.beginPath();
            g.arc(4, 0, bellRadius, -Math.PI / 2, Math.PI / 2);
            g.lineTo(4, -bellRadius);
            g.closePath();
            g.fillPath();
            g.strokePath();

            g.lineStyle(1.5, accentColor, 0.5);
            g.beginPath();
            g.moveTo(4, -bellRadius + 3);
            g.lineTo(4, bellRadius - 3);
            g.strokePath();

            g.lineStyle(1.5, mainColor, 0.7);
            let tentacleCount = 4;
            for (let i = 0; i < tentacleCount; i++) {
                let offset = (i - (tentacleCount - 1) / 2) * 6;
                let wavePhase = (this.elapsedTime / 180) + i;

                g.beginPath();
                g.moveTo(4, offset);

                let step = 10;
                let currentX = 4;
                let currentY = offset;
                for (let j = 0; j < 3; j++) {
                    let nextX = currentX - step;
                    let nextY = offset + Math.sin(wavePhase - j) * (6 + this.V_lung * 4);
                    g.lineTo(nextX, nextY);
                    currentX = nextX;
                    currentY = nextY;
                }
                g.strokePath();
            }
        }
    }

    drawBuddyVisuals(time) {
        let g = this.buddyGraphics;
        g.clear();
        let pulse = this.currentBeatPulse || 0;

        // Dynamic flow-state color popping based on silt-free multiplier
        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.scoreMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.scoreMultiplier - 1) * 0.017);

        // Cycle the buddy neon color (complementary hue)
        let buddyHue = (this.baseHue + 180) % 360; // Cyan base (distinct from player)
        let mainColor = this.hslToColorInt(buddyHue / 360, flowSat, 0.55 + flowLightBoost);
        let accentColor = this.hslToColorInt(((buddyHue + 100) % 360) / 360, flowSat, 0.6 + flowLightBoost); // Violet/Orange

        // Pure wireframe styling: buddy has a translucent glowing aura, but body parts are line-only
        g.fillStyle(mainColor, 0.04);
        g.fillCircle(0, 0, 20 + pulse * 6);

        // Masterful frog-kick calculation for buddy (highly visible large displacement)
        let frogPhase = (this.elapsedTime / 350) % (Math.PI * 2);
        let kickExtension = Math.max(0, Math.sin(frogPhase)); // 0 = flexed, 1 = extended

        // --- 1. DRAW BACK LEG (LEG 2 - bent knee frog kick trim) ---
        g.lineStyle(2.5, mainColor, 0.65); // slightly dimmer
        let hip2X = -8, hip2Y = 0;
        let knee2X = hip2X - (6 + kickExtension * 8);
        let knee2Y = hip2Y - (12 - kickExtension * 8);
        let foot2X = knee2X - (2 + kickExtension * 12);
        let foot2Y = knee2Y - (10 - kickExtension * 10);

        g.beginPath();
        g.moveTo(hip2X, hip2Y);
        g.lineTo(knee2X, knee2Y);
        g.lineTo(foot2X, foot2Y);
        g.strokePath();

        // Back Fin (accent color, neon - wireframe only)
        let finLength = 15;
        let finWidth = 10;
        g.lineStyle(1.5, accentColor, 0.7);
        g.beginPath();
        g.moveTo(foot2X, foot2Y);
        g.lineTo(foot2X - finLength, foot2Y - finWidth / 2 + (1 - kickExtension) * 4);
        g.lineTo(foot2X - finLength + 3, foot2Y + finWidth / 2 + (1 - kickExtension) * 4);
        g.closePath();
        g.strokePath();

        // --- 2. DRAW DOUBLE TANKS (TWINSET - Wireframe style, horizontal trim) ---
        g.lineStyle(1.2, accentColor, 0.95);

        // Tank 2 (upper cylinder in perspective)
        g.strokeRoundedRect(-22, -16, 24, 6, 2);

        // Tank 1 (lower cylinder, closer to back)
        g.strokeRoundedRect(-22, -11, 24, 6, 2);

        // Isolator Manifold connecting the two tanks at the valves
        g.lineStyle(1.5, accentColor, 0.95);
        g.beginPath();
        g.moveTo(2, -13);
        g.lineTo(2, -8);
        g.strokePath();

        // Metal tank bands holding them together
        g.lineStyle(1.0, mainColor, 0.7);
        g.beginPath();
        g.moveTo(-16, -16); g.lineTo(-16, -5);
        g.moveTo(-6, -16); g.lineTo(-6, -5);
        g.strokePath();

        // Regulator hose
        g.lineStyle(1, accentColor, 0.8);
        let bp0x = 2, bp0y = -11;
        let bcx = 8, bcy = -16;
        let bp1x = 16, bp1y = -3;
        g.beginPath();
        g.moveTo(bp0x, bp0y);
        for (let i = 1; i <= 4; i++) {
            let t = i / 4;
            let mt = 1 - t;
            let x = mt * mt * bp0x + 2 * mt * t * bcx + t * t * bp1x;
            let y = mt * mt * bp0y + 2 * mt * t * bcy + t * t * bp1y;
            g.lineTo(x, y);
        }
        g.strokePath();

        // --- 3. DRAW CHEST (Wireframe - stroke only) ---
        g.lineStyle(2, mainColor, 1.0);
        g.strokeEllipse(0, 0, 32, 16);

        // Suit details
        g.lineStyle(1.5, accentColor, 0.9);
        g.strokeRect(-12, -12, 20, 5);

        // Safety Reel spool (carried by buddy, cave diving protocol - wireframe style)
        let reelX = -4, reelY = 6;
        g.lineStyle(1.5, accentColor, 1.0);
        g.strokeCircle(reelX, reelY, 6);
        g.strokeCircle(reelX, reelY, 2);
        g.beginPath();
        g.moveTo(reelX - 6, reelY); g.lineTo(reelX + 6, reelY);
        g.moveTo(reelX, reelY - 6); g.lineTo(reelX, reelY + 6);
        g.strokePath();

        // --- 4. DRAW HEAD & MASK (Wireframe - stroke only) ---
        g.lineStyle(2, mainColor, 1.0);
        g.strokeCircle(14, -4, 6);

        // Goggles Visor (wireframe visor)
        g.lineStyle(1.5, accentColor, 0.95);
        g.strokeRoundedRect(15, -7, 4, 5, 1);

        // Regulator mouthpiece
        g.lineStyle(1.5, mainColor, 1.0);
        g.strokeRect(16, -3, 3, 3);

        // --- 5. DRAW FRONT LEG (LEG 1 - frog kick trim) ---
        g.lineStyle(2.5, mainColor, 1);
        let hip1X = -10, hip1Y = 2;
        let frogPhase2 = frogPhase + 0.25;
        let kickExtension2 = Math.max(0, Math.sin(frogPhase2));
        let knee1X = hip1X - (6 + kickExtension2 * 8);
        let knee1Y = hip1Y - (12 - kickExtension2 * 8);
        let foot1X = knee1X - (2 + kickExtension2 * 12);
        let foot1Y = knee1Y - (10 - kickExtension2 * 10);

        g.beginPath();
        g.moveTo(hip1X, hip1Y);
        g.lineTo(knee1X, knee1Y);
        g.lineTo(foot1X, foot1Y);
        g.strokePath();

        // Front Fin (accent color, neon - wireframe only)
        g.lineStyle(1.5, accentColor, 1.0);
        g.beginPath();
        g.moveTo(foot1X, foot1Y);
        g.lineTo(foot1X - finLength, foot1Y - finWidth / 2 + (1 - kickExtension2) * 4);
        g.lineTo(foot1X - finLength + 3, foot1Y + finWidth / 2 + (1 - kickExtension2) * 4);
        g.closePath();
        g.strokePath();

        // --- 6. DRAW ARM & LIGHT (Masterful outstretched position holding primary light) ---
        let shoulderX = 8, shoulderY = -2;
        let elbowX = shoulderX + 10;
        let elbowY = shoulderY;
        let handX = elbowX + 8;
        let handY = elbowY;

        if (this.buddyState === 'assisting') {
            // Raise arm to make "OK" hand signal
            elbowX = shoulderX + 4;
            elbowY = shoulderY - 8;
            handX = elbowX + 6;
            handY = elbowY - 6;
        }

        g.lineStyle(2.5, mainColor, 1.0);
        g.beginPath();
        g.moveTo(shoulderX, shoulderY);
        g.lineTo(elbowX, elbowY);
        g.lineTo(handX, handY);
        g.strokePath();

        // Primary Light Canister (Wireframe)
        g.lineStyle(1.5, accentColor, 1.0);
        g.strokeRoundedRect(handX - 1, handY - 3, 6, 6, 1);
    }

    getBuddyCheckPoints(scaleX) {
        let frogPhase = (this.elapsedTime / 350) % (Math.PI * 2);
        let kickExtension = Math.max(0, Math.sin(frogPhase));
        let frogPhase2 = frogPhase + 0.25;
        let kickExtension2 = Math.max(0, Math.sin(frogPhase2));

        let foot2X = -8 - (6 + kickExtension * 8) - (2 + kickExtension * 12);
        let foot2Y = -6 - (12 - kickExtension * 8) - (10 - kickExtension * 10);

        let foot1X = -10 - (6 + kickExtension2 * 8) - (2 + kickExtension2 * 12);
        let foot1Y = 2 - (12 - kickExtension2 * 8) - (10 - kickExtension2 * 10);

        let handX = 26;
        let handY = -2;
        if (this.buddyState === 'assisting') {
            handX = 18;
            handY = -16;
        }

        return [
            { x: 0, y: 0, r: 10 },                         // Torso
            { x: 14 * scaleX, y: -4, r: 6 },               // Head
            { x: handX * scaleX, y: handY, r: 5 },          // Hand/Light
            { x: foot1X * scaleX, y: foot1Y, r: 8 },       // Foot 1 + Fin (increased to 8 to cover fin)
            { x: foot2X * scaleX, y: foot2Y, r: 8 }        // Foot 2 + Fin
        ];
    }

    drawCaveLights() {
        let g = this.lightGraphics;
        g.clear();
        if (!this.player || !this.buddy) return;

        let playerHue = (this.baseHue + 320) % 360;
        let pHue = ((playerHue + 130) % 360) / 360;
        let pAccent = this.hslToColorInt(pHue, 1.0, 0.65);

        let buddyHue = (this.baseHue + 180) % 360;
        let bHue = ((buddyHue + 100) % 360) / 360;
        let bAccent = this.hslToColorInt(bHue, 1.0, 0.65);

        // Player Light (hand is at 26, -2 relative to player container)
        let pHandX = this.player.x + 26;
        let pHandY = this.player.y - 2;
        this.drawDiveLight(g, pHandX, pHandY, 1, 0xffffff, pAccent, pHue);

        // Buddy Light (hand is at 26, -2 relative to buddy container, scaled by scaleX)
        let bDir = this.buddy.scaleX; // 1 or -1
        let bHandX = this.buddy.x + 26 * bDir;
        let bHandY = this.buddy.y - 2;
        this.drawDiveLight(g, bHandX, bHandY, bDir, 0xffffff, bAccent, bHue);
    }

    drawDiveLight(g, x0, y0, dir, mainColor, accentColor, hueVal) {
        let beamLength = 320;
        let beamSpread = 75;
        let steps = 30;
        let stepX = (beamLength / steps) * dir;

        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.scoreMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.scoreMultiplier - 1) * 0.017);

        let lightCol = this.hslToColorInt(hueVal, flowSat, 0.65 + flowLightBoost);

        let topPoints = [];
        let bottomPoints = [];
        for (let i = 0; i <= steps; i++) {
            let x = x0 + i * stepX;
            let ratio = i / steps;

            // Unconstrained beam Y
            let yTop = y0 - ratio * beamSpread;
            let yBottom = y0 + ratio * beamSpread;

            // Cave boundaries at x
            let t = (x / this.baseScrollSpeed) * 1000;
            let pathY = this.getTargetYAtTime(t);
            let energy = this.getEnergyAtTime(t);
            let { floorOffset, ceilOffset } = this.getWallOffsets(x, energy);
            let floorLimitY = pathY + floorOffset;
            let ceilLimitY = pathY - ceilOffset;

            // Constrain Y
            let cTop = Math.max(yTop, ceilLimitY);
            let cBottom = Math.min(yBottom, floorLimitY);

            // Clamp
            cTop = Math.min(cTop, floorLimitY);
            cBottom = Math.max(cBottom, ceilLimitY);

            topPoints.push({ x: x, y: cTop });
            bottomPoints.push({ x: x, y: cBottom });
        }

        // Draw main beam
        g.fillStyle(lightCol, 0.16 + (this.scoreMultiplier - 1) * 0.02);
        g.beginPath();
        g.moveTo(x0, y0);
        for (let pt of topPoints) {
            g.lineTo(pt.x, pt.y);
        }
        for (let i = bottomPoints.length - 1; i >= 0; i--) {
            g.lineTo(bottomPoints[i].x, bottomPoints[i].y);
        }
        g.closePath();
        g.fillPath();

        // Draw inner bright core beam
        g.fillStyle(0xffffff, 0.08 + (this.scoreMultiplier - 1) * 0.01);
        g.beginPath();
        g.moveTo(x0, y0);
        for (let i = 0; i <= steps; i++) {
            let ptTop = topPoints[i];
            let ptBottom = bottomPoints[i];
            // Interpolate core towards the center y0
            let coreTop = ptTop.y * 0.45 + y0 * 0.55;
            let coreBottom = ptBottom.y * 0.45 + y0 * 0.55;
            g.lineTo(ptTop.x, coreTop);
        }
        for (let i = steps; i >= 0; i--) {
            let ptTop = topPoints[i];
            let ptBottom = bottomPoints[i];
            let coreBottom = ptBottom.y * 0.45 + y0 * 0.55;
            g.lineTo(ptTop.x, coreBottom);
        }
        g.closePath();
        g.fillPath();
    }

    drawGuideLine() {
        let g = this.terrainGraphics; // Draw on the terrain layer so it integrates nicely
        if (!this.buddy) return;

        let bDir = this.buddy.scaleX;
        let reelWorldX = this.buddy.x + (-4) * bDir;
        let reelWorldY = this.buddy.y + 6;

        let startX = this.cameras.main.scrollX - 50;
        let endX = reelWorldX;

        if (endX <= startX) return;

        // Draw the guideline in neon orange/yellow
        let lineHue = (this.baseHue + 40) % 360;
        let lineColor = Phaser.Display.Color.HSLToColor(lineHue / 360, 1.0, 0.6).color;

        g.lineStyle(1.5, lineColor, 0.75);
        g.beginPath();

        let first = true;
        let points = [];
        let blendRange = 150; // Smooth blending over the last 150px before the reel

        for (let x = startX; x <= endX; x += 15) {
            let t = (x / this.baseScrollSpeed) * 1000;
            let pathY = this.getTargetYAtTime(t);

            // Blend path Y towards reel Y as x approaches the reel
            let distToReel = endX - x;
            let blend = distToReel < blendRange ? (1 - distToReel / blendRange) : 0;
            let y = pathY * (1 - blend) + reelWorldY * blend;

            points.push({ x: x, y: y });
            if (first) {
                g.moveTo(x, y);
                first = false;
            } else {
                g.lineTo(x, y);
            }
        }
        // Connect directly to the reel
        g.lineTo(reelWorldX, reelWorldY);
        g.strokePath();

        // Draw cave arrows pointing exit-ward (left) along the line
        g.fillStyle(lineColor, 0.85);
        let arrowInterval = 160;
        let nextArrowX = Math.ceil(startX / arrowInterval) * arrowInterval;
        for (let x = nextArrowX; x < endX - 40; x += arrowInterval) {
            let t = (x / this.baseScrollSpeed) * 1000;
            let pathY = this.getTargetYAtTime(t);

            // Blend arrow Y towards reel Y as x approaches the reel
            let distToReel = endX - x;
            let blend = distToReel < blendRange ? (1 - distToReel / blendRange) : 0;
            let y = pathY * (1 - blend) + reelWorldY * blend;

            // Draw triangle pointing left (exit)
            g.beginPath();
            g.moveTo(x - 5, y);
            g.lineTo(x + 3, y - 4);
            g.lineTo(x + 3, y + 4);
            g.closePath();
            g.fillPath();
        }
    }

    drawTerrain() {
        let g = this.terrainGraphics;
        g.clear();

        let activeZone = this.getCurrentDepthZone();
        let baseFloorHue = activeZone ? (activeZone.floorHue !== undefined ? activeZone.floorHue : Phaser.Display.Color.IntegerToColor(activeZone.floorColor).h * 360) : 280;
        let baseCeilHue = activeZone ? (activeZone.ceilHue !== undefined ? activeZone.ceilHue : Phaser.Display.Color.IntegerToColor(activeZone.ceilColor).h * 360) : 180;

        let floorHue = (baseFloorHue + this.baseHue * 0.5) % 360;
        let ceilHue = (baseCeilHue + this.baseHue * 0.5) % 360;

        // Dynamic flow-state color popping based on silt-free multiplier
        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.scoreMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.scoreMultiplier - 1) * 0.017);

        // flowFill: 0 = wireframe (multiplier x1), 1 = fully solid neon (multiplier x8+) - gradual power curve
        let flowFill = Math.pow((this.scoreMultiplier - 1) / 7.0, 1.5);

        // At high flow, walls use full neon saturation; at low flow, muted
        let wallSat = this.siltActive ? 0.15 : Math.min(1.0, flowSat + flowFill * 0.3);
        let wallLum = Math.min(0.60, (0.42 + flowLightBoost) + flowFill * 0.08);
        let floorColor = this.hslToColorInt(floorHue / 360, wallSat, wallLum);
        let ceilColor = this.hslToColorInt(ceilHue / 360, wallSat, wallLum);

        let startX = this.cameras.main.scrollX - 100;
        let endX = startX + 1400;

        const getWallY = (wx) => {
            let t = (wx / this.baseScrollSpeed) * 1000;
            let targetY = this.getTargetYAtTime(t);
            let localEnergy = this.getEnergyAtTime(t);

            let { floorOffset, ceilOffset } = this.getWallOffsets(wx, localEnergy);
            return { floorY: targetY + floorOffset, ceilY: targetY - ceilOffset };
        };

        // Generate base points with zero allocation GC cache
        let idx = 0;
        for (let x = startX; x <= endX; x += 30) {
            let { floorY, ceilY } = getWallY(x);
            if (!this.floorPoints[idx]) {
                this.floorPoints[idx] = { x: 0, y: 0 };
                this.ceilPoints[idx] = { x: 0, y: 0 };
            }
            this.floorPoints[idx].x = x;
            this.floorPoints[idx].y = floorY;
            this.ceilPoints[idx].x = x;
            this.ceilPoints[idx].y = ceilY;
            idx++;
        }
        this.floorPoints.length = idx;
        this.ceilPoints.length = idx;
        let floorPoints = this.floorPoints;
        let ceilPoints = this.ceilPoints;

        let pulse = this.currentBeatPulse || 0;
        let lineWidth = 1.5 + pulse * 2.0 + flowFill * 1.0; // thicker stroke at high flow
        let lineAlpha = 0.35 + pulse * 0.15 + flowFill * 0.45; // brighter neon edge at high flow

        // Draw Floor
        // Fill: dark base at low flow, neon-tinted at high flow
        g.lineStyle(lineWidth, floorColor, lineAlpha);
        g.fillStyle(floorColor, flowFill * 0.72); // 0 = invisible (wireframe), 0.72 = solid neon
        g.beginPath();
        g.moveTo(floorPoints[0].x, 800);
        for (let pt of floorPoints) {
            g.lineTo(pt.x, pt.y);
        }
        g.lineTo(floorPoints[floorPoints.length - 1].x, 800);
        g.closePath();
        g.fillPath();
        // Dark backing only at low/mid flow so rock feels solid at low levels
        if (flowFill < 0.8) {
            g.fillStyle(0x020410, 0.95 - flowFill * 0.9);
            g.beginPath();
            g.moveTo(floorPoints[0].x, 800);
            for (let pt of floorPoints) { g.lineTo(pt.x, pt.y); }
            g.lineTo(floorPoints[floorPoints.length - 1].x, 800);
            g.closePath();
            g.fillPath();
        }
        g.strokePath();

        g.lineStyle(1.0, floorColor, (0.25 + flowFill * 0.35) * lineAlpha);
        g.beginPath();
        g.moveTo(floorPoints[0].x, floorPoints[0].y + 6);
        for (let i = 1; i < floorPoints.length; i++) {
            g.lineTo(floorPoints[i].x, floorPoints[i].y + 6);
        }
        g.strokePath();

        // Draw Ceiling
        g.lineStyle(lineWidth, ceilColor, lineAlpha);
        g.fillStyle(ceilColor, flowFill * 0.72);
        g.beginPath();
        g.moveTo(ceilPoints[0].x, -100);
        for (let pt of ceilPoints) {
            g.lineTo(pt.x, pt.y);
        }
        g.lineTo(ceilPoints[ceilPoints.length - 1].x, -100);
        g.closePath();
        g.fillPath();
        if (flowFill < 0.8) {
            g.fillStyle(0x020410, 0.95 - flowFill * 0.9);
            g.beginPath();
            g.moveTo(ceilPoints[0].x, -100);
            for (let pt of ceilPoints) { g.lineTo(pt.x, pt.y); }
            g.lineTo(ceilPoints[ceilPoints.length - 1].x, -100);
            g.closePath();
            g.fillPath();
        }
        g.strokePath();

        g.lineStyle(1.0, ceilColor, (0.25 + flowFill * 0.35) * lineAlpha);
        g.beginPath();
        g.moveTo(ceilPoints[0].x, ceilPoints[0].y - 6);
        for (let i = 1; i < ceilPoints.length; i++) {
            g.lineTo(ceilPoints[i].x, ceilPoints[i].y - 6);
        }
        g.strokePath();

        // --- Peppered Foreground Cracks on Player's Layer (Drawn in solid rock face with high variety) ---
        const SLOT_SIZE = 320;
        let firstSlot = Math.floor(startX / SLOT_SIZE);
        let lastSlot = Math.ceil(endX / SLOT_SIZE);
        for (let slot = firstSlot; slot <= lastSlot; slot++) {
            // 1. Cracks on Floor rock face
            let numCracksF = Math.floor(1 + this._seededRnd(slot * 23 + 5) * 3); // 1, 2, or 3 cracks
            for (let cIdx = 0; cIdx < numCracksF; cIdx++) {
                let seed = slot * 31 + cIdx * 97 + 5;
                let rVal = this._seededRnd(seed);
                if (rVal > 0.75) continue; // 75% chance per candidate crack to keep density balanced

                let cx = slot * SLOT_SIZE + this._seededRnd(seed + 1) * SLOT_SIZE * 0.9 - SLOT_SIZE * 0.45;
                let { floorY } = getWallY(cx);

                if (this.plumeEmitter && this._seededRnd(seed + 12) < 0.4) {
                    let plumeHue = (floorHue + 20) % 360;
                    let plumeColor = this.hslToColorInt(plumeHue / 360, 0.9, 0.6);
                    
                    // Dynamic scaling of vents based on Flow multiplier
                    let mult = this.scoreMultiplier || 1;
                    let ventScaleStart = 1.0 + (mult - 1) * 0.3; // x1: 1.0, x8: 3.1
                    let ventScaleEnd = 2.5 + (mult - 1) * 1.0;   // x1: 2.5, x8: 9.5
                    let ventAlpha = 0.06 + (mult - 1) * 0.02;    // x1: 0.06, x8: 0.20
                    let emitChance = 0.06 + (mult - 1) * 0.02;    // x1: 0.06, x8: 0.20
                    
                    if (!this.countdownActive && Math.random() < emitChance) {
                        this.plumeEmitter.particleTint = plumeColor;
                        this.plumeEmitter.emitParticleAt(cx, floorY, 1, {
                            scale: { start: ventScaleStart, end: ventScaleEnd },
                            alpha: { start: Math.min(0.9, ventAlpha * 5.5), end: 0 }, // 5.5x multiplier for visibility
                            lifespan: { min: 1800, max: 2800 },
                            speedY: { min: -150, max: -70 },
                            speedX: { min: -this.scrollSpeed * 0.5 - 15, max: -this.scrollSpeed * 0.5 + 15 }
                        });
                    }
                }

                // Vertical depth into floor rock: 12px to 160px
                let depth = 12 + this._seededRnd(seed + 2) * 148;
                let cy = floorY + depth;

                let w = 8 + this._seededRnd(seed + 3) * 82; // 8px to 90px wide
                let h = 4 + this._seededRnd(seed + 4) * 36; // 4px to 40px vertical displacement (irregularity)

                let segments = Math.floor(3 + this._seededRnd(seed + 5) * 4); // 3 to 6 segments
                let branchAt = this._seededRnd(seed + 6) > 0.5 ? Math.floor(1 + this._seededRnd(seed + 7) * (segments - 2)) : -1;

                let thickness = 0.6 + this._seededRnd(seed + 8) * 1.6; // some hairline, some thick
                let alphaScale = 0.15 + this._seededRnd(seed + 9) * 0.4;
                g.lineStyle(thickness, floorColor, (alphaScale + flowFill * 0.22));

                g.beginPath();
                let prevX = cx - w / 2;
                let prevY = cy;
                g.moveTo(prevX, prevY);

                let branchStartX = 0;
                let branchStartY = 0;

                for (let step = 0; step < segments; step++) {
                    let progress = (step + 1) / segments;
                    let targetSegX = cx - w / 2 + progress * w;
                    let targetSegY = cy + (this._seededRnd(seed + 10 + step) - 0.5) * h;
                    g.lineTo(targetSegX, targetSegY);

                    if (step === branchAt) {
                        branchStartX = targetSegX;
                        branchStartY = targetSegY;
                    }

                    prevX = targetSegX;
                    prevY = targetSegY;
                }
                g.strokePath();

                // Draw secondary branch
                if (branchAt !== -1) {
                    let branchW = w * (0.3 + this._seededRnd(seed + 20) * 0.4);
                    let branchH = h * (0.3 + this._seededRnd(seed + 21) * 0.4);
                    let branchDirY = this._seededRnd(seed + 22) > 0.5 ? 1 : -1;

                    g.lineStyle(thickness * 0.6, floorColor, (alphaScale + flowFill * 0.22) * 0.7);
                    g.beginPath();
                    g.moveTo(branchStartX, branchStartY);

                    let bSegments = Math.floor(2 + this._seededRnd(seed + 23) * 3);
                    for (let step = 0; step < bSegments; step++) {
                        let progress = (step + 1) / bSegments;
                        let targetSegX = branchStartX + progress * branchW;
                        let targetSegY = branchStartY + branchDirY * progress * branchH + (this._seededRnd(seed + 24 + step) - 0.5) * branchH * 0.5;
                        g.lineTo(targetSegX, targetSegY);
                    }
                    g.strokePath();
                }
            }

            // 2. Cracks on Ceiling rock face
            let numCracksC = Math.floor(1 + this._seededRnd(slot * 37 + 12) * 3);
            for (let cIdx = 0; cIdx < numCracksC; cIdx++) {
                let seed = slot * 43 + cIdx * 103 + 12;
                let rVal = this._seededRnd(seed);
                if (rVal > 0.75) continue;

                let cx = slot * SLOT_SIZE + this._seededRnd(seed + 1) * SLOT_SIZE * 0.9 - SLOT_SIZE * 0.45;
                let { ceilY } = getWallY(cx);

                // Vertical depth into ceiling rock: 12px to 160px
                let depth = 12 + this._seededRnd(seed + 2) * 148;
                let cy = ceilY - depth;

                let w = 8 + this._seededRnd(seed + 3) * 82;
                let h = 4 + this._seededRnd(seed + 4) * 36;

                let segments = Math.floor(3 + this._seededRnd(seed + 5) * 4);
                let branchAt = this._seededRnd(seed + 6) > 0.5 ? Math.floor(1 + this._seededRnd(seed + 7) * (segments - 2)) : -1;

                let thickness = 0.6 + this._seededRnd(seed + 8) * 1.6;
                let alphaScale = 0.15 + this._seededRnd(seed + 9) * 0.4;
                g.lineStyle(thickness, ceilColor, (alphaScale + flowFill * 0.22));

                g.beginPath();
                let prevX = cx - w / 2;
                let prevY = cy;
                g.moveTo(prevX, prevY);

                let branchStartX = 0;
                let branchStartY = 0;

                for (let step = 0; step < segments; step++) {
                    let progress = (step + 1) / segments;
                    let targetSegX = cx - w / 2 + progress * w;
                    let targetSegY = cy + (this._seededRnd(seed + 10 + step) - 0.5) * h;
                    g.lineTo(targetSegX, targetSegY);

                    if (step === branchAt) {
                        branchStartX = targetSegX;
                        branchStartY = targetSegY;
                    }

                    prevX = targetSegX;
                    prevY = targetSegY;
                }
                g.strokePath();

                // Draw secondary branch
                if (branchAt !== -1) {
                    let branchW = w * (0.3 + this._seededRnd(seed + 20) * 0.4);
                    let branchH = h * (0.3 + this._seededRnd(seed + 21) * 0.4);
                    let branchDirY = this._seededRnd(seed + 22) > 0.5 ? -1 : 1; // go deeper/higher into rock

                    g.lineStyle(thickness * 0.6, ceilColor, (alphaScale + flowFill * 0.22) * 0.7);
                    g.beginPath();
                    g.moveTo(branchStartX, branchStartY);

                    let bSegments = Math.floor(2 + this._seededRnd(seed + 23) * 3);
                    for (let step = 0; step < bSegments; step++) {
                        let progress = (step + 1) / bSegments;
                        let targetSegX = branchStartX + progress * branchW;
                        let targetSegY = branchStartY + branchDirY * progress * branchH + (this._seededRnd(seed + 24 + step) - 0.5) * branchH * 0.5;
                        g.lineTo(targetSegX, targetSegY);
                    }
                    g.strokePath();
                }
            }
        }

        // --- Draw Wall Openings (cracks & windows as overlays on top of the terrain) ---
        this.drawWallOpenings(g, startX, endX, floorPoints, ceilPoints, floorColor, ceilColor, flowFill, flowSat, flowLightBoost, floorHue, ceilHue);

        // Draw cave safety line guideline attached to buddy's reel
        this.drawGuideLine();
    }

    // Seeded pseudo-random based on integer seed — fast, deterministic, no Math.random()
    _seededRnd(seed) {
        let s = Math.imul(seed ^ (seed >>> 13), 0x9e3779b9 | 0);
        s = Math.imul(s ^ (s >>> 7), 0x6c62272e | 0);
        return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
    }

    getAudioBufferHash(audioBuffer) {
        let channelData = audioBuffer.getChannelData(0);
        let duration = audioBuffer.duration;
        let sampleRate = audioBuffer.sampleRate;

        // FNV-1a 32-bit offset basis
        let hash = 2166136261;
        let str = duration.toString() + sampleRate.toString();
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        // Fast sampling of audio channel data (1000 points) to create signature
        let samplesToHash = 1000;
        let step = Math.max(1, Math.floor(channelData.length / samplesToHash));
        for (let i = 0; i < channelData.length; i += step) {
            let val = channelData[i];
            let intVal = Math.floor((val + 1) * 1000000);
            hash ^= intVal;
            hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0; // Unsigned 32-bit int
    }

    createMulberry32(seed) {
        return function () {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    drawWallOpenings(g, startX, endX, floorPoints, ceilPoints, floorColor, ceilColor, flowFill, flowSat, flowLightBoost, floorHue, ceilHue) {
        const SLOT_SIZE = 320; // world-px between opening-slot centres
        const OPEN_CHANCE = 0.55; // probability a slot has an opening
        const WIN_EVERY = 5;  // every Nth opening is a "depth window"

        let wallSat = this.siltActive ? 0.15 : Math.min(1.0, flowSat + flowFill * 0.3);
        let wallLum = Math.min(0.75, 0.5 + flowFill * 0.15);

        // Far-parallax background colour used for depth-window fill
        let farHue = (this.baseHue + 200) % 360;
        let farAlpha = Math.min(0.55, 0.18 + (this.scoreMultiplier - 1) * 0.053) * 0.45;
        let farLum = Math.max(0.05, (this.siltActive ? 0.15 : Math.min(0.55, 0.25 + (this.scoreMultiplier - 1) * 0.043)) - 0.12);
        let farColor = this.hslToColorInt(farHue / 360,
            (this.siltActive ? 0.05 : Math.min(0.85, 0.25 + (this.scoreMultiplier - 1) * 0.086)) * 0.8,
            farLum);

        let firstSlot = Math.floor(startX / SLOT_SIZE);
        let lastSlot = Math.ceil(endX / SLOT_SIZE);
        let openingIdx = 0; // count openings to determine window slots

        for (let slot = firstSlot; slot <= lastSlot; slot++) {
            let r0 = this._seededRnd(slot * 17 + 3);
            if (r0 > OPEN_CHANCE) continue; // no opening this slot

            openingIdx++;
            let isWindow = (openingIdx % WIN_EVERY === 0);

            let cx = slot * SLOT_SIZE + this._seededRnd(slot * 31 + 7) * SLOT_SIZE * 0.6 - SLOT_SIZE * 0.3;
            let onFloor = this._seededRnd(slot * 13 + 11) > 0.5;

            // Opening width and depth — wider/deeper on window slots
            let ow = 28 + this._seededRnd(slot * 41 + 1) * (isWindow ? 55 : 35);
            let od = 28 + this._seededRnd(slot * 53 + 5) * (isWindow ? 70 : 40);

            let t = (cx / this.baseScrollSpeed) * 1000;
            let targetY = this.getTargetYAtTime(t);
            let energy = this.getEnergyAtTime(t);
            let { floorOffset, ceilOffset } = this.getWallOffsets(cx, energy);
            let floorY = targetY + floorOffset;
            let ceilY = targetY - ceilOffset;

            // Rock color for this opening's rim
            let rimHue = onFloor ? floorHue : ceilHue;
            let rimColor = this.hslToColorInt(rimHue / 360, wallSat, wallLum);

            if (onFloor) {
                // Crack / side-tunnel opening IN the floor wall
                // Shape: an irregular arch-like notch cut into the floor surface
                let baseY = floorY;       // surface of floor at cx
                let leftX = cx - ow / 2;
                let rightX = cx + ow / 2;
                let deepY = baseY + od;   // bottom of the pocket (into rock)

                // Jagged interior polygon with 5 control points for crack feel
                let r1 = this._seededRnd(slot * 67 + 2);
                let r2 = this._seededRnd(slot * 71 + 4);
                let r3 = this._seededRnd(slot * 79 + 6);
                let midX1 = leftX + ow * (0.25 + r1 * 0.15);
                let midX2 = leftX + ow * (0.6 + r2 * 0.15);
                let peakY = baseY + od * (0.45 + r3 * 0.35);

                // Window: fill with far parallax depth colour
                if (isWindow) {
                    g.fillStyle(farColor, 0.55 + farAlpha);
                    g.beginPath();
                    g.moveTo(leftX, baseY);
                    g.lineTo(midX1, peakY);
                    g.lineTo(cx, deepY);
                    g.lineTo(midX2, peakY);
                    g.lineTo(rightX, baseY);
                    g.closePath();
                    g.fillPath();
                }

                // Dark rock interior
                g.fillStyle(0x010208, isWindow ? 0.0 : 0.90);
                g.beginPath();
                g.moveTo(leftX, baseY);
                g.lineTo(midX1, peakY);
                g.lineTo(cx, deepY);
                g.lineTo(midX2, peakY);
                g.lineTo(rightX, baseY);
                g.closePath();
                g.fillPath();

                // Rim glow stroke
                g.lineStyle(1.2 + flowFill * 0.8, rimColor, 0.45 + flowFill * 0.3);
                g.beginPath();
                g.moveTo(leftX, baseY);
                g.lineTo(midX1, peakY);
                g.lineTo(cx, deepY);
                g.lineTo(midX2, peakY);
                g.lineTo(rightX, baseY);
                g.strokePath();

            } else {
                // Crack / side-tunnel opening IN the ceiling wall
                let baseY = ceilY;        // surface of ceiling at cx
                let leftX = cx - ow / 2;
                let rightX = cx + ow / 2;
                let deepY = baseY - od;   // top of the pocket (into rock above)

                let r1 = this._seededRnd(slot * 83 + 9);
                let r2 = this._seededRnd(slot * 89 + 11);
                let r3 = this._seededRnd(slot * 97 + 13);
                let midX1 = leftX + ow * (0.22 + r1 * 0.15);
                let midX2 = leftX + ow * (0.58 + r2 * 0.15);
                let peakY = baseY - od * (0.40 + r3 * 0.35);

                if (isWindow) {
                    g.fillStyle(farColor, 0.55 + farAlpha);
                    g.beginPath();
                    g.moveTo(leftX, baseY);
                    g.lineTo(midX1, peakY);
                    g.lineTo(cx, deepY);
                    g.lineTo(midX2, peakY);
                    g.lineTo(rightX, baseY);
                    g.closePath();
                    g.fillPath();
                }

                g.fillStyle(0x010208, isWindow ? 0.0 : 0.90);
                g.beginPath();
                g.moveTo(leftX, baseY);
                g.lineTo(midX1, peakY);
                g.lineTo(cx, deepY);
                g.lineTo(midX2, peakY);
                g.lineTo(rightX, baseY);
                g.closePath();
                g.fillPath();

                g.lineStyle(1.2 + flowFill * 0.8, rimColor, 0.45 + flowFill * 0.3);
                g.beginPath();
                g.moveTo(leftX, baseY);
                g.lineTo(midX1, peakY);
                g.lineTo(cx, deepY);
                g.lineTo(midX2, peakY);
                g.lineTo(rightX, baseY);
                g.strokePath();
            }
        }
    }

    spawnCollectibles() {
        this.collectiblesGroup = this.add.group();

        for (let col of this.levelData.collectibles) {
            let colX = 250 + (col.time / 1000) * this.baseScrollSpeed;
            let debris = this.add.sprite(colX, col.y, 'collectible');
            debris.setOrigin(0.5);

            let colHue = (col.time * 0.05) % 360;
            let colColor = Phaser.Display.Color.HSLToColor(colHue / 360, 1.0, 0.65).color;
            debris.setTint(colColor);
            debris.clusterId = col.clusterId;

            this.tweens.add({
                targets: debris,
                scale: { from: 0.7, to: 1.3 },
                duration: 1000 + Math.random() * 500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            this.collectiblesGroup.add(debris);
        }
    }

    checkCollisions() {
        let targetAlpha = this.siltActive ? 0.12 : 0.95;

        // Build body hitbox list (mirrors update() collision checkpoints)
        let collectPts = [{ x: 0, y: 0, r: 6.5 }]; // fallback for non-diver
        if (this.avatarType === 'diver') {
            let frogPhase = (this.elapsedTime / 350) % (Math.PI * 2);
            let ke = Math.max(0, Math.sin(frogPhase));
            let ke2 = Math.max(0, Math.sin(frogPhase + 0.25));
            let f2x = -8 - (6 + ke * 8) - (2 + ke * 12);
            let f2y = -6 - (12 - ke * 8) - (10 - ke * 10);
            let f1x = -10 - (6 + ke2 * 8) - (2 + ke2 * 12);
            let f1y = 2 - (12 - ke2 * 8) - (10 - ke2 * 10);
            collectPts = [
                { x: 0, y: 0, r: 6.5 },  // torso
                { x: 14, y: -4, r: 4 },    // head
                { x: -10, y: -13, r: 2 },    // tank
                { x: 26, y: -2, r: 3 },    // hand
                { x: f1x, y: f1y, r: 4 },    // foot 1 + fin
                { x: f2x, y: f2y, r: 4 },    // foot 2 + fin
            ];
        }

        this.collectiblesGroup.children.iterate((debris) => {
            if (!debris) return;

            // Transition collectible visibility dynamically in silt
            debris.alpha = Phaser.Math.Linear(debris.alpha, targetAlpha, 0.15);

            if (!debris.active) return;

            const collectibleR = 14; // visual radius of collectible sprite
            let hit = collectPts.some(pt => {
                let dx = (this.player.x + pt.x) - debris.x;
                let dy = (this.player.y + pt.y) - debris.y;
                return dx * dx + dy * dy < (pt.r + collectibleR) * (pt.r + collectibleR);
            });

            if (hit) {
                debris.active = false;
                let cid = debris.clusterId;
                debris.destroy();

                this.score++;

                // Base points
                let gainedPoints = 1 * this.scoreMultiplier;
                this.pointsScore += gainedPoints;

                // Track cluster progress
                if (cid) {
                    if (!this.clusterCollected[cid]) this.clusterCollected[cid] = 0;
                    this.clusterCollected[cid]++;

                    let totalInCluster = this.clusterTotals[cid] || 0;
                    if (this.clusterCollected[cid] === totalInCluster && totalInCluster > 1) {
                        // Full Cluster Bonus!
                        let bonus = Math.floor((totalInCluster * 1.5) * this.scoreMultiplier);
                        this.pointsScore += bonus;
                        this.spawnFloatingText(this.player.x, this.player.y - 30, `CLUSTER BONUS! +${bonus}`, '#00f0ff');
                    } else {
                        this.spawnFloatingText(this.player.x, this.player.y - 20, `+${gainedPoints}`, '#bd00ff');
                    }
                } else {
                    this.spawnFloatingText(this.player.x, this.player.y - 20, `+${gainedPoints}`, '#bd00ff');
                }

                this.triggerSparkExplosion(debris.x, debris.y);
                this.playCollectibleTone();
            }
        });
    }

    triggerSparkExplosion(x, y) {
        let expl = this.add.particles(x, y, 'spark', {
            lifespan: 600,
            speed: { min: 40, max: 120 },
            scale: { start: 0.8, end: 0 },
            alpha: { start: 1, end: 0 },
            quantity: 12,
            emitting: false
        });

        let rndHue = Math.random() * 360;
        let sparkColor = Phaser.Display.Color.HSLToColor(rndHue / 360, 1.0, 0.6).color;
        expl.particleTint = sparkColor;

        expl.explode();
        this.time.delayedCall(800, () => expl.destroy());
    }

    triggerMaxFlowPulse() {
        let flowHue = (this.baseHue + 120) % 360;
        let colorObj = Phaser.Display.Color.HSLToColor(flowHue / 360, 1.0, 0.6);

        // Camera flash & thump (color-matched to flowHue, with subtle screenshake)
        this.cameras.main.flash(350, colorObj.r, colorObj.g, colorObj.b, 0.12);
        this.cameras.main.shake(150, 0.005);

        let px = this.player.x;
        let py = this.player.y;

        // Spawn a circular expansion of glowing sparks/bubbles
        let ring = this.add.particles(px, py, 'spark', {
            lifespan: 1000,
            speed: 180,
            scale: { start: 1.4, end: 0 },
            alpha: { start: 0.9, end: 0 },
            quantity: 36,
            emitting: false
        });

        ring.particleTint = colorObj.color;
        ring.explode();

        this.time.delayedCall(1200, () => ring.destroy());
    }

    spawnFloatingText(x, y, text, color) {
        let fText = this.add.text(x, y, text, {
            fontFamily: 'Outfit',
            fontSize: '16px',
            color: color,
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(20);

        this.tweens.add({
            targets: fText,
            y: y - 40,
            alpha: 0,
            duration: 1000,
            onComplete: () => fText.destroy()
        });
    }

    triggerPsychedelicSilt(source = 'floor', impactVy = 0) {
        this.siltSource = source;

        // Dynamically scale silt-out duration based on impact speed (absolute vy)
        let impactSpeed = Math.abs(impactVy);
        let scale = Phaser.Math.Clamp(impactSpeed / 70, 0.44, 1.33); // range: ~0.8s to ~2.4s

        // Scale duration inversely with level scroll speed to keep blind travel distance consistent
        let speedFactor = 50 / this.baseScrollSpeed;
        let currentDuration = this.siltDuration * scale * speedFactor;

        // Shift baseHue complementary (120 degrees) on each bump to dramatically shift the visual color palette
        this.baseHue = (this.baseHue + 120) % 360;

        if (!this.siltActive) {
            this.siltActive = true;
            this.siltTime = currentDuration;
            this.currentSiltDuration = currentDuration;
            if (this.scoreMultiplier > 1) {
                this.scoreMultiplier = 1;
                this.spawnFloatingText(this.player.x, this.player.y - 35, "FLOW RESET", '#ff1e56');
            } else {
                this.scoreMultiplier = 1;
            }
            this.siltFreeTime = 0;
        } else {
            // If already in a silt-out, only update if the new impact is stronger than what was used to set the current remaining time
            if (currentDuration > this.siltTime) {
                this.siltTime = currentDuration;
                this.currentSiltDuration = currentDuration;
            }
        }

        // Throttle heavy visuals to every 800ms
        if (this.time.now - (this.lastHeavySilt || 0) > 800) {
            this.lastHeavySilt = this.time.now;
            
            // Trigger dynamic screen shake and chromatic split proportional to impactVy
            this.cameras.main.shake(200, Math.min(0.012, 0.003 + (impactSpeed / 150) * 0.008));

            let fx = this.cameras.main.getPostPipeline(PsychedelicFX);
            if (fx) {
                let offsetStart = Math.min(0.02, 0.003 + (impactSpeed / 100) * 0.006);
                fx.chromaticOffset = offsetStart;
                fx.chromaticOffsetStart = offsetStart;
            }

            this.playSiltThump();

            let px = this.player.x;
            let py = (source === 'floor') ? (this.player.y + 10) : (this.player.y - 10);

            let siltE = this.add.particles(px, py, 'silt_cloud', {
                lifespan: { min: 3500, max: 6000 },
                speed: { min: 50, max: 220 },
                angle: source === 'floor' ? { min: 220, max: 320 } : { min: 40, max: 140 },
                scale: { start: 8.0, end: 35.0 },
                alpha: { start: 0.95, end: 0 },
                quantity: 120,
                emitting: false
            });

            let siltHue = (this.baseHue + 180) % 360;
            let siltColor = this.hslToColorInt(siltHue / 360, 0.8, 0.45);
            siltE.particleTint = siltColor;

            siltE.explode();
            this.time.delayedCall(5000, () => siltE.destroy());
        } // <- This was the missing brace that broke the game
    }

    drawSiltOverlay() {
        let g = this.siltOverlay;
        g.clear();

        if (!this.siltVignetteImage) return;

        if (this.siltActive) {
            let phase = this.siltTime / (this.currentSiltDuration || this.siltDuration);

            let siltHue = (this.baseHue + 180) % 360;
            let siltColorVal = this.hslToColorInt(siltHue / 360, 0.75, 0.25);

            this.siltVignetteImage.setTint(siltColorVal);
            this.siltVignetteImage.setAlpha(Math.min(0.95, phase * 1.4));
            this.siltVignetteImage.setVisible(true);
        } else {
            this.siltVignetteImage.setAlpha(0);
            this.siltVignetteImage.setVisible(false);
        }
    }

    spawnBeatRipple() {
        this.beatRipples.push({
            x: this.player.x,
            y: this.player.y,
            radius: 10,
            maxRadius: 320,
            alpha: 0.8
        });
    }

    // --- LEVEL PARSING & HELPERS ---

    getTargetYAtTime(timeMs) {
        let path = this.levelData.path;
        if (timeMs <= path[0].time) return path[0].y;
        if (timeMs >= path[path.length - 1].time) return path[path.length - 1].y;

        for (let i = 0; i < path.length - 1; i++) {
            let k0 = path[i];
            let k1 = path[i + 1];
            if (timeMs >= k0.time && timeMs <= k1.time) {
                let ratio = (timeMs - k0.time) / (k1.time - k0.time);
                return Phaser.Math.Linear(k0.y, k1.y, ratio);
            }
        }
        return 350;
    }

    getEnergyAtTime(timeMs) {
        let path = this.levelData.path;
        if (!path || path.length === 0) return 0.2;
        if (timeMs <= path[0].time) return path[0].energy || 0.2;
        if (timeMs >= path[path.length - 1].time) return path[path.length - 1].energy || 0.2;

        for (let i = 0; i < path.length - 1; i++) {
            let k0 = path[i];
            let k1 = path[i + 1];
            if (timeMs >= k0.time && timeMs <= k1.time) {
                let ratio = (timeMs - k0.time) / (k1.time - k0.time);
                return Phaser.Math.Linear(k0.energy || 0.2, k1.energy || 0.2, ratio);
            }
        }
        return 0.2;
    }

    getWallOffsets(wx, localEnergy) {
        // Calculate local path slope to dynamically adjust cave width for clearance
        let t1 = (wx / this.baseScrollSpeed) * 1000;
        let t2 = ((wx + 10) / this.baseScrollSpeed) * 1000;
        let y1 = this.getTargetYAtTime(t1);
        let y2 = this.getTargetYAtTime(t2);
        let slope = (y2 - y1) / 10;

        // Compute minimum half-height clearance needed for player's horizontal bounding box
        // Sinking/descending is harder to react to, so downward slopes get symmetric/sufficient clearance.
        let slopeClearance = 28.5 + (slope < 0 ? -29.0 * slope : 32.0 * slope);

        // Ensure baseOffset expands to allow clearance plus some margin
        let baseOffset = Math.max(78 - localEnergy * 22, slopeClearance + 5); // 56–78px minimum base
        let jaggednessMultiplier = 0.35 + localEnergy * 0.85;

        // Beat pulse scaled by multiplier — expands the cave on beat hits
        let multiBeatScale = 1.0 + (this.scoreMultiplier - 1) * 0.4;
        let beatPulseOffset = (this.currentBeatPulse || 0) * 10 * (0.5 + localEnergy * 0.5) * multiBeatScale;

        // Dynamic extra-wide and smooth start zone from spawn up to 750px
        let isStartZone = wx < 750;
        if (isStartZone) {
            let tRatio = Math.max(0, Math.min(1, wx / 750));
            // Let the starting zone be extra wide (120px) at spawn, smoothly tapering to standard width
            baseOffset = 120 + (baseOffset - 120) * tRatio;
            jaggednessMultiplier *= tRatio;
            beatPulseOffset *= tRatio;
        }

        // Dynamic minimum safety cap: shrinks from 68px (calm) to 50px (intense/metal), but must respect slopeClearance
        let minCap = Math.max(68 - localEnergy * 18, slopeClearance);

        // High-frequency rocky spikiness projections (scaled by energy)
        let highFreqSpikeF = (Math.sin(wx * 0.09) * 8 + Math.cos(wx * 0.18) * 4) * jaggednessMultiplier;
        let highFreqSpikeC = (Math.sin(wx * 0.08) * 8 + Math.cos(wx * 0.17) * 4) * jaggednessMultiplier;

        let floorOffset = Math.max(minCap, baseOffset + (Math.cos(wx * 0.015) * 10 + Math.sin(wx * 0.04) * 5) * jaggednessMultiplier - highFreqSpikeF) + beatPulseOffset;
        let ceilOffset = Math.max(minCap, baseOffset + (Math.sin(wx * 0.02) * 10 + Math.cos(wx * 0.05) * 5) * jaggednessMultiplier - highFreqSpikeC) + beatPulseOffset;

        // Guarantee 100% collectability without wall collisions:
        // Max downward offset is 40px (+8px player torso + 16px safety margin = 64px min floor offset)
        // Max upward offset is 28px (+16px player top + 16px safety margin = 60px min ceiling offset)
        return {
            floorOffset: Math.max(64, floorOffset),
            ceilOffset: Math.max(60, ceilOffset)
        };
    }

    getCurrentDepthZone() {
        let zones = this.levelData.zones;
        if (!zones || zones.length === 0) return null;
        if (this.elapsedTime >= zones[zones.length - 1].endTime) {
            return zones[zones.length - 1];
        }
        for (let zone of zones) {
            if (this.elapsedTime >= zone.startTime && this.elapsedTime <= zone.endTime) {
                return zone;
            }
        }
        return zones[0];
    }



    // --- AUDIO SYNTHESIZER ENGINE ---

    setupAudioEngine(ctx) {
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 0.95;
        this.masterGain.connect(ctx.destination);

        let audioBuffer = this.customDecodedBuffer;
        this.musicSource = ctx.createBufferSource();
        this.musicSource.buffer = audioBuffer;
        this.musicSource.loop = false; // Disable loop to prevent song restart at dive end

        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = 0.55;

        // Initialize low-pass filter for silt-outs
        this.musicFilter = ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = 22000;

        this.musicSource.connect(this.musicGain);
        this.musicGain.connect(this.musicFilter);
        this.musicFilter.connect(this.masterGain);
        this.musicStartTime = ctx.currentTime;

        this.musicSource.onended = () => {
            console.log("musicSource onended fired");
            this.musicCompleted = true;
            if (!this.isFadingOut && !this.isLevelCompleted) {
                this.startFadeout();
            }
        };

        this.musicSource.start(0);

        const sampleRate = ctx.sampleRate;
        const bufferSize = 2 * sampleRate;
        const noiseBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            noiseData[i] = Math.random() * 2 - 1;
        }

        // Inhale
        this.inhaleFilter = ctx.createBiquadFilter();
        this.inhaleFilter.type = 'bandpass';
        this.inhaleFilter.Q.value = 1.8;
        this.inhaleFilter.frequency.value = 250;

        this.inhaleSource = ctx.createBufferSource();
        this.inhaleSource.buffer = noiseBuffer;
        this.inhaleSource.loop = true;

        this.inhaleGain = ctx.createGain();
        this.inhaleGain.gain.value = 0.0;

        this.inhaleSource.connect(this.inhaleFilter);
        this.inhaleFilter.connect(this.inhaleGain);
        this.inhaleGain.connect(this.masterGain);
        if (!this.useAutopilot) {
            this.inhaleSource.start(0);
        }

        // Exhale
        this.exhaleFilter = ctx.createBiquadFilter();
        this.exhaleFilter.type = 'lowpass';
        this.exhaleFilter.frequency.value = 150;

        this.exhaleSource = ctx.createBufferSource();
        this.exhaleSource.buffer = noiseBuffer;
        this.exhaleSource.loop = true;

        this.exhaleGain = ctx.createGain();
        this.exhaleGain.gain.value = 0.0;

        this.exhaleSource.connect(this.exhaleFilter);
        this.exhaleFilter.connect(this.exhaleGain);
        this.exhaleGain.connect(this.masterGain);
        if (!this.useAutopilot) {
            this.exhaleSource.start(0);
        }
    }

    playCollectibleTone() {
        if (this.useAutopilot) return; // Mute in music visualizer mode
        let ctx = this.audioContext;
        if (!ctx) return;

        let osc = ctx.createOscillator();
        let gainNode = ctx.createGain();

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);

        gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);

        osc.start();
        osc.stop(ctx.currentTime + 0.6);
    }

    playSiltThump() {
        if (this.useAutopilot) return; // Mute in music visualizer mode
        let ctx = this.audioContext;
        if (!ctx) return;

        let osc = ctx.createOscillator();
        let gainNode = ctx.createGain();
        let filter = ctx.createBiquadFilter();

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        filter.type = 'lowpass';
        filter.frequency.value = 120;

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.35);

        gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);

        osc.start();
        osc.stop(ctx.currentTime + 0.4);
    }

    playBubbleChirp() {
        if (this.useAutopilot) return; // Mute in music visualizer mode
        let ctx = this.audioContext;
        if (!ctx) return;

        let osc = ctx.createOscillator();
        let gainNode = ctx.createGain();

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Sine wave: smooth, round tone like real underwater air bubbles
        osc.type = 'sine';

        // Realistic bubble frequencies: low-to-mid (200-600Hz), rising slightly as bubble shrinks
        let startFreq = 200 + Math.random() * 200;
        let endFreq = startFreq * (1.3 + Math.random() * 0.4);
        let duration = 0.10 + Math.random() * 0.12; // 100-220ms — natural bubble pop length

        let t0 = ctx.currentTime;
        osc.frequency.setValueAtTime(startFreq, t0);
        osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);

        gainNode.gain.setValueAtTime(0.0, t0);
        // Moderate volume — audible but not jarring
        gainNode.gain.linearRampToValueAtTime(0.18 + Math.random() * 0.10, t0 + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

        osc.start(t0);
        osc.stop(t0 + duration + 0.02);
    }

    startFadeout() {
        if (this.isFadingOut) return;
        this.isFadingOut = true;

        // 1. Trigger camera fade out to the dark background color (rgb: 2, 5, 20) over 2 seconds
        this.cameras.main.fadeOut(2000, 2, 5, 20);

        // 2. Smoothly fade out the Web Audio API master gain over 2 seconds
        let ctx = this.audioContext;
        if (ctx && this.masterGain) {
            try {
                this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, ctx.currentTime);
                this.masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.0);
            } catch (e) {
                console.warn("Failed to fade out master gain:", e);
            }
        }

        // 3. Schedule the levelComplete screen to show after the fadeout finishes (2 seconds)
        // Redundantly use both Phaser's clock and a browser setTimeout to ensure completion when the tab is blurred.
        this.time.delayedCall(2000, () => {
            this.levelComplete();
        }, [], this);

        setTimeout(() => {
            this.levelComplete();
        }, 2000);
    }

    showTrackStartOverlay(onCompleteCallback) {
        let trackName = window.customTrackName || "Unknown Track";
        let durationMs = this.levelData.songLengthMs || 0;
        let minutes = Math.floor(durationMs / 60000);
        let seconds = Math.floor((durationMs % 60000) / 1000);
        let durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        let currentZone = this.getCurrentDepthZone();
        let colorStr = currentZone ? '#' + currentZone.ceilColor.toString(16).padStart(6, '0') : '#00f0ff';

        let infoText = this.add.text(600, 260, `TRACK: ${trackName.toUpperCase()}`, {
            fontFamily: 'Outfit',
            fontSize: '32px',
            fontStyle: 'bold',
            color: colorStr,
            align: 'center'
        }).setOrigin(0.5).setDepth(100).setAlpha(0);

        let durationText = this.add.text(600, 310, `DURATION: ${durationStr}`, {
            fontFamily: 'Outfit',
            fontSize: '20px',
            color: '#cbd5e1',
            align: 'center'
        }).setOrigin(0.5).setDepth(100).setAlpha(0);

        this.tweens.add({
            targets: [infoText, durationText],
            alpha: 1,
            duration: 500,
            ease: 'Power2',
            onComplete: () => {
                this.time.delayedCall(1000, () => {
                    this.tweens.add({
                        targets: [infoText, durationText],
                        alpha: 0,
                        duration: 500,
                        onComplete: () => {
                            infoText.destroy();
                            durationText.destroy();
                            if (onCompleteCallback) {
                                onCompleteCallback();
                            }
                        }
                    });
                });
            }
        });
    }

    levelComplete() {
        if (this.isLevelCompleted) return;
        this.isLevelCompleted = true;
        this.isPlaying = false;

        let ctx = this.audioContext;
        if (ctx) {
            if (this.musicSource) {
                try { this.musicSource.stop(); } catch (e) { }
            }
            this.inhaleGain.gain.cancelScheduledValues(ctx.currentTime);
            this.inhaleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
            this.exhaleGain.gain.cancelScheduledValues(ctx.currentTime);
            this.exhaleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        }

        // Calculate performance rating (0 to 5 stars) based on an 80/20 weighted split of debris gathered (accuracy) and perfect-run points achieved (flow state)
        let maxPoints = this.maxPotentialPoints || 0;
        let debrisPercent = this.totalCollectibles > 0 ? (this.score / this.totalCollectibles) * 100 : 100;
        let pointsPercent = maxPoints > 0 ? (this.pointsScore / maxPoints) * 100 : 100;
        let percent = (debrisPercent * 0.8) + (pointsPercent * 0.2);
        percent = Math.min(100, Math.max(0, percent));
        let stars = 0;
        if (percent >= 95) stars = 5;
        else if (percent >= 80) stars = 4;
        else if (percent >= 60) stars = 3;
        else if (percent >= 40) stars = 2;
        else if (percent >= 15) stars = 1;
        else stars = 0;

        let isPerfect = percent >= 100;
        let starString = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= stars) {
                if (isPerfect) {
                    starString += `<span class="perfect-star" style="color: #00f0ff; text-shadow: 0 0 10px #00f0ff, 0 0 20px #ff00e4; margin: 0 6px; font-size: 2.6rem; animation-delay: ${(i - 1) * 0.15}s;">★</span>`;
                } else {
                    starString += '<span style="color: #ffcc00; text-shadow: 0 0 12px rgba(255, 204, 0, 0.7); margin: 0 4px; font-size: 2.2rem; filter: drop-shadow(0 0 4px rgba(255, 204, 0, 0.4));">★</span>';
                }
            } else {
                starString += '<span style="color: #475569; margin: 0 4px; font-size: 2.2rem;">☆</span>';
            }
        }

        // Local Storage High Scores Keyed by FNV-1a Hash
        let trackHash = "unknown";
        if (this.customDecodedBuffer) {
            trackHash = String(this.getAudioBufferHash(this.customDecodedBuffer));
        }
        
        let scoreKey = `scubaflow_highscore_${trackHash}`;
        let prevHighPointsScore = 0;
        let prevMaxCollectiblesPercent = 0;
        
        try {
            let saved = localStorage.getItem(scoreKey);
            if (saved) {
                let parsed = JSON.parse(saved);
                prevHighPointsScore = parsed.highPointsScore || 0;
                prevMaxCollectiblesPercent = parsed.maxCollectiblesPercent || 0;
            }
        } catch (e) {
            console.error("Failed to read highscore from localStorage", e);
        }
        
        let isNewHighPoints = this.pointsScore > prevHighPointsScore;
        let highPointsScore = Math.max(prevHighPointsScore, this.pointsScore);
        let maxCollectiblesPercent = Math.max(prevMaxCollectiblesPercent, debrisPercent);
        
        try {
            localStorage.setItem(scoreKey, JSON.stringify({
                trackHash: trackHash,
                highPointsScore: highPointsScore,
                maxCollectiblesPercent: parseFloat(maxCollectiblesPercent.toFixed(1))
            }));
        } catch (e) {
            console.error("Failed to save highscore to localStorage", e);
        }
        
        // Lifetime Career Profile Tracking
        let careerKey = "scubaflow_career_profile";
        let career = {
            lifetimeDiveTimeMs: 0,
            lifetimeBubblesBlown: 0,
            peakScoreMultiplier: 1
        };
        try {
            let savedCareer = localStorage.getItem(careerKey);
            if (savedCareer) {
                career = JSON.parse(savedCareer);
            }
        } catch (e) {
            console.error("Failed to read career from localStorage", e);
        }
        
        career.lifetimeDiveTimeMs = (career.lifetimeDiveTimeMs || 0) + this.elapsedTime;
        career.lifetimeBubblesBlown = (career.lifetimeBubblesBlown || 0) + (this.exhaleBubblesCount || 0);
        career.peakScoreMultiplier = Math.max(career.peakScoreMultiplier || 1, this.scoreMultiplier);
        
        try {
            localStorage.setItem(careerKey, JSON.stringify(career));
        } catch (e) {
            console.error("Failed to save career to localStorage", e);
        }
        
        // Format lifetime stats
        let totalSecs = Math.floor(career.lifetimeDiveTimeMs / 1000);
        let mins = Math.floor(totalSecs / 60);
        let secs = totalSecs % 60;
        let formattedTime = `${mins}m ${secs}s`;
        
        let highScoreHTML = "";
        if (prevHighPointsScore > 0) {
            highScoreHTML = `
                <div style="font-size: 0.95rem; color: #94a3b8; margin-top: 10px; border-top: 1px solid rgba(0, 240, 255, 0.15); padding-top: 12px; display: flex; justify-content: space-around;">
                    <div>TRACK BEST: <strong style="color: #00f0ff;">${highPointsScore} pts</strong> (${maxCollectiblesPercent.toFixed(1)}%)</div>
                    ${isNewHighPoints ? '<div style="color: #00ff66; font-weight: bold; animation: pulse 1s infinite alternate; text-shadow: 0 0 8px #00ff66;">★ NEW BEST! ★</div>' : ''}
                </div>
            `;
        } else {
            highScoreHTML = `
                <div style="font-size: 0.95rem; color: #94a3b8; margin-top: 10px; border-top: 1px solid rgba(0, 240, 255, 0.15); padding-top: 12px; text-align: center;">
                    FIRST RUN LOGGED! Track best set to <strong style="color: #00f0ff;">${highPointsScore} pts</strong>
                </div>
            `;
        }
        
        let careerHTML = `
            <div style="margin: 20px 0; padding: 12px 16px; background: rgba(0, 240, 255, 0.03); border: 1px solid rgba(0, 240, 255, 0.1); border-radius: 12px; text-align: left; font-size: 0.85rem; color: #94a3b8; line-height: 1.6;">
                <div style="font-weight: bold; color: #cbd5e1; margin-bottom: 6px; letter-spacing: 1px; text-transform: uppercase;">LIFETIME FLOW CAREER:</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>⏱ Time Drifting: <strong style="color: #e2e8f0;">${formattedTime}</strong></div>
                    <div>🫧 Bubbles Blown: <strong style="color: #e2e8f0;">${career.lifetimeBubblesBlown}</strong></div>
                    <div style="grid-column: span 2;">⚡ Peak Flow Multiplier: <strong style="color: #00f0ff;">x${career.peakScoreMultiplier}</strong></div>
                </div>
            </div>
        `;

        let parent = document.getElementById('game-container');
        let card = document.createElement('div');
        card.id = 'complete-screen';
        card.style.position = 'absolute';
        card.style.top = '0';
        card.style.left = '0';
        card.style.width = '100%';
        card.style.height = '100%';
        card.style.backgroundColor = 'rgba(2, 5, 20, 0.85)';
        card.style.backdropFilter = 'blur(12px)';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.justifyContent = 'center';
        card.style.alignItems = 'center';
        card.style.zIndex = '20';
        card.style.color = '#e2e8f0';

        if (isPerfect) {
            let styleSheet = document.createElement('style');
            styleSheet.textContent = `
                @keyframes perfectPulse {
                    0% { transform: scale(1); filter: drop-shadow(0 0 2px #00f0ff); }
                    100% { transform: scale(1.15); filter: drop-shadow(0 0 12px #ff00e4); }
                }
                .perfect-star {
                    display: inline-block;
                    animation: perfectPulse 0.8s infinite alternate ease-in-out;
                }
            `;
            card.appendChild(styleSheet);
        }

        let titleStyle = isPerfect
            ? 'background: linear-gradient(135deg, #00f0ff 0%, #ff00e4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 3.6rem; font-weight: 800; margin-bottom: 20px; letter-spacing: 3px; filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.6));'
            : 'background: linear-gradient(135deg, #00f0ff 0%, #bd00ff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 3rem; font-weight: 700; margin-bottom: 20px; letter-spacing: 2px;';

        let titleText = isPerfect ? 'PERFECT FLOW' : 'DIVE COMPLETED';

        let trackName = window.customTrackName || "Custom Track";
        let durationMs = this.levelData.songLengthMs || 0;
        let minutes = Math.floor(durationMs / 60000);
        let seconds = Math.floor((durationMs % 60000) / 1000);
        let durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        let innerCard = document.createElement('div');
        innerCard.className = 'glass-card';
        innerCard.style.textAlign = 'center';
        innerCard.innerHTML = `
            <h1 style="${titleStyle}">${titleText}</h1>
            <div style="font-size: 0.9rem; color: #94a3b8; margin-top: -10px; margin-bottom: 15px; font-weight: 500; letter-spacing: 1px;">
                ${trackName.toUpperCase()} (${durationStr})
            </div>
            <div style="margin-bottom: 20px; display: flex; justify-content: center; align-items: center;">
                ${starString}
            </div>
            <div style="font-size: 1.15rem; color: #cbd5e1; margin-bottom: 10px; line-height: 1.8;">
                Neon Debris Gathered: <strong style="color: #00f0ff; font-size: 1.25rem;">${this.score}</strong> / ${this.totalCollectibles}<br>
                Total Score: <strong style="color: #bd00ff; font-size: 1.5rem; text-shadow: 0 0 12px rgba(189, 0, 255, 0.4);">${this.pointsScore}</strong> / ${maxPoints} points
            </div>
            ${highScoreHTML}
            ${careerHTML}
            <button id="btn-restart" class="btn-dive" style="box-shadow: 0 0 25px rgba(189, 0, 255, 0.4); margin-top: 10px;">DIVE AGAIN</button>
        `;
        card.appendChild(innerCard);
        parent.appendChild(card);

        document.getElementById('btn-restart').addEventListener('click', () => {
            location.reload();
        });
    }

    // --- PROCEDURAL LEVEL GENERATION ---
    generateProceduralLevel(audioBuffer) {
        let duration = audioBuffer.duration;
        let sampleRate = audioBuffer.sampleRate;
        let channelData = audioBuffer.getChannelData(0);

        let songLengthMs = duration * 1000;
        let levelLengthMs = songLengthMs + 45000;

        let seed = this.getAudioBufferHash(audioBuffer);
        let rng = this.createMulberry32(seed);

        let windowSec = 0.5;
        let chunkSize = Math.floor(sampleRate * windowSec);
        let numChunks = Math.floor(channelData.length / chunkSize);

        let rawEnergy = [];
        for (let c = 0; c < numChunks; c++) {
            let start = c * chunkSize;
            let sum = 0;
            let count = 0;
            for (let i = 0; i < chunkSize; i += 150) {
                let val = channelData[start + i];
                sum += val * val;
                count++;
            }
            rawEnergy.push(Math.sqrt(sum / count));
        }

        let smoothedEnergy = [];
        let windowSize = 2;
        for (let i = 0; i < rawEnergy.length; i++) {
            let sum = 0;
            let count = 0;
            for (let w = -Math.floor(windowSize / 2); w <= Math.floor(windowSize / 2); w++) {
                let idx = i + w;
                if (idx >= 0 && idx < rawEnergy.length) {
                    sum += rawEnergy[idx];
                    count++;
                }
            }
            smoothedEnergy.push(sum / count);
        }

        let maxEnergy = Math.max(...smoothedEnergy) || 0.001;
        let maxRawEnergy = Math.max(...rawEnergy) || 0.001;

        // High-Resolution Beat Parsing Pass
        let beatWindowSec = 0.08; // Increased from 0.05 to smooth out audio noise
        let beatChunkSize = Math.floor(sampleRate * beatWindowSec);
        let numBeatChunks = Math.floor(channelData.length / beatChunkSize);
        let rawBeats = [];
        for (let c = 0; c < numBeatChunks; c++) {
            let start = c * beatChunkSize;
            let sum = 0;
            for (let i = 0; i < beatChunkSize; i += 50) {
                sum += channelData[start + i] * channelData[start + i];
            }
            rawBeats.push(Math.sqrt(sum / (beatChunkSize / 50)));
        }

        let maxBeat = Math.max(...rawBeats) || 0.001;
        let beats = [];
        let lastBeatTime = -9999;
        let absoluteBeatThreshold = 0.015; // Ignore quiet background noise/hiss

        for (let i = 1; i < rawBeats.length - 1; i++) {
            if (rawBeats[i] > rawBeats[i - 1] && rawBeats[i] > rawBeats[i + 1]) {
                // Must exceed both 50% of the track peak AND the absolute noise floor
                if (rawBeats[i] > maxBeat * 0.50 && rawBeats[i] > absoluteBeatThreshold) {
                    let beatTime = i * beatWindowSec * 1000;
                    // Debouncer: Enforce minimum 250ms gap between visual beats
                    if (beatTime - lastBeatTime >= 250) {
                        beats.push(beatTime);
                        lastBeatTime = beatTime;
                    }
                }
            }
        }

        // If track is very quiet, ambient, or spoken-word, it may yield almost no beats.
        // Fall back to a steady, relaxing 60 BPM rhythm (every 1000ms) to ensure gameplay remains engaging.
        let minExpectedBeats = songLengthMs / 5000;
        if (beats.length < minExpectedBeats) {
            console.log(`Procedural fallback: detected only ${beats.length} beats. Generating a relaxing 60 BPM grid.`);
            beats = [];
            for (let t = 2000; t < songLengthMs - 2000; t += 1000) {
                beats.push(t);
            }
        }

        let averageEnergy = rawEnergy.reduce((a, b) => a + b, 0) / rawEnergy.length;

        let yDepthMin = 150;
        let yDepthMax = 550;
        let spacerTime = 2000;

        if (averageEnergy < 0.08) {
            this.baseScrollSpeed = 45; // Gentle pace for calm tracks
            yDepthMin = 200;
            yDepthMax = 500;
            spacerTime = 3000;
        } else if (averageEnergy >= 0.16) {
            this.baseScrollSpeed = 68; // High speed challenges
            yDepthMin = 100;
            yDepthMax = 600;
            spacerTime = 1400;
        } else {
            this.baseScrollSpeed = 55; // Moderate speed challenge
            yDepthMin = 150;
            yDepthMax = 550;
            spacerTime = 2000;
        }
        this.scrollSpeed = this.baseScrollSpeed;

        // Mean-centered normalization: safe loop-based min/max (spread crashes on large arrays)
        let minEnergy = smoothedEnergy[0];
        let maxSmoothed = smoothedEnergy[0];
        for (let e of smoothedEnergy) {
            if (e < minEnergy) minEnergy = e;
            if (e > maxSmoothed) maxSmoothed = e;
        }
        maxSmoothed = maxSmoothed || 0.001;
        let avgSmoothed = smoothedEnergy.reduce((a, b) => a + b, 0) / smoothedEnergy.length;

        // Enforce a minimum dynamic energy range to avoid noise amplification on flat/quiet tracks
        let energyRange = (maxSmoothed - minEnergy);
        let isLowDynamicRange = energyRange < 0.12;
        energyRange = Math.max(0.12, energyRange);

        let path = [];
        // Scale slope difficulty based on scroll speed to guarantee climbs/descents are physically navigateable
        let maxDeltaY = 40.0;
        if (this.baseScrollSpeed === 45) {
            maxDeltaY = 30.0; // gentle but still dynamic and fun slopes on calm tracks
        }
        let prevY = 250;

        let totalChunks = Math.floor(levelLengthMs / (windowSec * 1000));
        for (let i = 0; i < totalChunks; i++) {
            let energyVal;
            if (i < smoothedEnergy.length) {
                energyVal = smoothedEnergy[i];
            } else {
                let wrapIdx = i % smoothedEnergy.length;
                energyVal = smoothedEnergy[wrapIdx];
            }
            let norm = 0.5 + ((energyVal - avgSmoothed) / energyRange);
            // Only compress dynamic range to keep the path flat if the song is actually flat/low-dynamic
            let normLimit = isLowDynamicRange ? 0.20 : 0.40;
            norm = Math.max(0.5 - normLimit, Math.min(0.5 + normLimit, norm));

            let timeMs = i * windowSec * 1000;

            // Winding cave bends (large low-frequency curves to keep tunnels non-straight)
            // Dampen winding bends only on flat/low-dynamic tracks.
            let windingMult = isLowDynamicRange ? 0.35 : 1.0;
            let windingBend = (Math.sin(timeMs * 0.00018) * 110 + Math.cos(timeMs * 0.00008) * 55) * windingMult;
            let targetY = yDepthMin + norm * (yDepthMax - yDepthMin) + windingBend;

            // Clamp center-path Y within safe limits to prevent clipping off-screen
            targetY = Phaser.Math.Clamp(targetY, 180, 520);

            let dy = targetY - prevY;
            if (Math.abs(dy) > maxDeltaY) {
                targetY = prevY + Math.sign(dy) * maxDeltaY;
            }

            let introDuration = (750 / this.baseScrollSpeed) * 1000;
            if (timeMs < introDuration) {
                targetY = 250;
            } else if (timeMs < introDuration + 2000) {
                let tRatio = (timeMs - introDuration) / 2000;
                targetY = 250 + (targetY - 250) * tRatio;
            } else if (timeMs > levelLengthMs - 2000) {
                let tRatio = (levelLengthMs - timeMs) / 2000;
                targetY = 250 + (targetY - 250) * tRatio;
            }

            path.push({ time: timeMs, y: targetY, energy: norm });
            prevY = targetY;
        }
        path.push({ time: levelLengthMs, y: 250, energy: 0.2 });
        let collectibles = [];
        let lastColTime = -2000;

        // Reset clusters
        this.clusterTotals = {};
        this.clusterCollected = {};

        // Temporarily set levelData.path so helper methods like getWallOffsets and getEnergyAtTime can be used
        this.levelData = { path: path };

        const getInterpolatedPathY = (timeMs) => {
            if (timeMs <= path[0].time) return path[0].y;
            if (timeMs >= path[path.length - 1].time) return path[path.length - 1].y;
            for (let idx = 0; idx < path.length - 1; idx++) {
                let k0 = path[idx];
                let k1 = path[idx + 1];
                if (timeMs >= k0.time && timeMs <= k1.time) {
                    let ratio = (timeMs - k0.time) / (k1.time - k0.time);
                    return k0.y + (k1.y - k0.y) * ratio;
                }
            }
            return 350;
        };

        const getClampedCollectibleY = (colTime, offset) => {
            let colTimeAtX = colTime + (250 / this.baseScrollSpeed) * 1000;
            let colPathY = getInterpolatedPathY(colTimeAtX);
            let colX = (colTime / 1000) * this.baseScrollSpeed + 250;
            let localEnergy = this.getEnergyAtTime(colTimeAtX);
            let { floorOffset, ceilOffset } = this.getWallOffsets(colX, localEnergy);
            let targetColY = colPathY + offset;
            // Clamp Y to be at least 40px away from ceiling and floor
            return Phaser.Math.Clamp(targetColY, colPathY - ceilOffset + 40, colPathY + floorOffset - 40);
        };

        let forceSpawnThreshold = spacerTime * 1.2;
        let numCollectibleChunks = Math.floor(songLengthMs / (windowSec * 1000));
        for (let i = 1; i < numCollectibleChunks - 1; i++) {
            let timeMs = i * windowSec * 1000;

            let introDuration = (750 / this.baseScrollSpeed) * 1000;
            if (timeMs < introDuration || timeMs > songLengthMs - 1200) continue;

            let energyVal, prevEnergyVal, nextEnergyVal, smoothedEnergyVal;
            if (i < rawEnergy.length) {
                energyVal = rawEnergy[i];
                prevEnergyVal = rawEnergy[i - 1];
                nextEnergyVal = rawEnergy[i + 1];
                smoothedEnergyVal = smoothedEnergy[i];
            } else {
                let wrapIdx = i % rawEnergy.length;
                energyVal = rawEnergy[wrapIdx];
                prevEnergyVal = rawEnergy[(i - 1) % rawEnergy.length];
                nextEnergyVal = rawEnergy[(i + 1) % rawEnergy.length];
                smoothedEnergyVal = smoothedEnergy[wrapIdx];
            }

            let isPeak = (energyVal > prevEnergyVal && energyVal > nextEnergyVal) && (energyVal > maxRawEnergy * 0.22);
            let forceSpawn = (timeMs - lastColTime >= forceSpawnThreshold);

            if (isPeak || forceSpawn) {
                if (timeMs - lastColTime >= spacerTime) {
                    let norm = forceSpawn ? rng() : (smoothedEnergyVal / maxEnergy);
                    let cid = "c_" + i;

                    if (norm < 0.35) {
                        // Pattern 1: Single item at path center
                        collectibles.push({ time: timeMs, y: getClampedCollectibleY(timeMs, 0), clusterId: cid });
                        this.clusterTotals[cid] = 1;
                    } else if (norm < 0.65) {
                        // Pattern 2: Smooth sine wave curve (4 items)
                        this.clusterTotals[cid] = 4;
                        for (let k = 0; k < 4; k++) {
                            let colTime = timeMs + k * 350;
                            // Smooth sine wave offset (balanced to fit safe navigation bounds: Max upward -20, Max downward 24)
                            let rawOffset = Math.sin(k * Math.PI / 2) * 30;
                            let offset = rawOffset < 0 ? Math.max(rawOffset, -20) : Math.min(rawOffset, 24);
                            collectibles.push({ time: colTime, y: getClampedCollectibleY(colTime, offset), clusterId: cid });
                        }
                    } else {
                        // Pattern 3: Steeper ascending or descending slope (5 items)
                        let isAscending = rng() > 0.5;
                        this.clusterTotals[cid] = 5;
                        for (let k = 0; k < 5; k++) {
                            let colTime = timeMs + k * 300;
                            // Interpolate (steeper slope for challenge, scaled to fit safe navigation bounds: Max upward -20, Max downward 24)
                            let ratio = (k / 4) * 2 - 1; // -1 to 1
                            let rawOffset = ratio * (isAscending ? -40 : 40);
                            let offset = rawOffset < 0 ? Math.max(rawOffset, -20) : Math.min(rawOffset, 24);
                            collectibles.push({ time: colTime, y: getClampedCollectibleY(colTime, offset), clusterId: cid });
                        }
                    }
                    // Update lastColTime to avoid overlaps
                    lastColTime = timeMs + 1800;
                }
            }
        }

        let zoneNames = ["Neon Reef", "Gold Ridge", "Magenta Arch", "Abyssal Trench", "Cyan Ascent"];
        let zoneColors = [
            { floor: 0x00ff66, ceil: 0x00f0ff, bg: 0x010a12 },
            { floor: 0xffcc00, ceil: 0xbd00ff, bg: 0x0b0212 },
            { floor: 0xff007f, ceil: 0x4b0082, bg: 0x12010c },
            { floor: 0xff5500, ceil: 0x9900ff, bg: 0x120501 },
            { floor: 0x00ffff, ceil: 0x008080, bg: 0x010d12 }
        ];

        let numZones = zoneNames.length;
        let zoneDuration = levelLengthMs / numZones;
        let zones = [];
        for (let z = 0; z < numZones; z++) {
            let startTime = z * zoneDuration;
            let endTime = (z + 1) * zoneDuration;

            let startIdx = Math.floor(startTime / (windowSec * 1000));
            let endIdx = Math.floor(endTime / (windowSec * 1000));
            let sumY = 0, countY = 0;
            for (let idx = startIdx; idx < endIdx && idx < path.length; idx++) {
                sumY += path[idx].y;
                countY++;
            }
            let avgDepth = countY > 0 ? (sumY / countY) : 300;

            let fHue = Phaser.Display.Color.IntegerToColor(zoneColors[z].floor).h * 360;
            let cHue = Phaser.Display.Color.IntegerToColor(zoneColors[z].ceil).h * 360;
            zones.push({
                startTime: startTime,
                endTime: endTime,
                targetDepth: avgDepth,
                name: zoneNames[z],
                floorColor: zoneColors[z].floor,
                ceilColor: zoneColors[z].ceil,
                floorHue: fHue,
                ceilHue: cHue,
                bgColor: zoneColors[z].bg
            });
        }

        this.levelData = {
            bpm: 60,
            levelLengthMs: levelLengthMs,
            songLengthMs: songLengthMs,
            path: path,
            collectibles: collectibles,
            zones: zones,
            beats: beats
        };
        this.totalCollectibles = collectibles.length;
        this.flowMilestoneInterval = Math.max(6000, Math.min(15000, songLengthMs / 15));
        this.maxPotentialPoints = this.calculateMaxPotentialPoints();
        this.targetEndX = (songLengthMs / 1000) * this.baseScrollSpeed + 250;

        console.log(`Procedural Level Generated! Beats: ${beats.length}, Collectibles: ${this.totalCollectibles}`);
    }

    calculateMaxPotentialPoints() {
        if (!this.levelData || !this.levelData.collectibles) return 0;

        let simMultiplier = 1;
        let simPoints = 0;
        let clusterCounts = {};

        // Sort collectibles chronologically to process in order
        let sortedCollectibles = [...this.levelData.collectibles].sort((a, b) => a.time - b.time);

        let events = [];

        // 1. Flow milestones (every flowMilestoneInterval up to songLengthMs + 2000)
        let interval = this.flowMilestoneInterval || 10000;
        let totalDuration = this.levelData.songLengthMs + 2000;
        for (let t = interval; t <= totalDuration; t += interval) {
            events.push({
                type: 'flow',
                time: t
            });
        }

        // 2. Collectible collection events
        for (let col of sortedCollectibles) {
            events.push({
                type: 'collectible',
                time: col.time,
                clusterId: col.clusterId
            });
        }

        // Sort events chronologically. If times are identical, process collectibles before flow milestones.
        events.sort((a, b) => {
            if (a.time !== b.time) return a.time - b.time;
            return a.type === 'collectible' ? -1 : 1;
        });

        // Run simulation of perfect silt-free run
        for (let ev of events) {
            if (ev.type === 'flow') {
                simMultiplier = Math.min(8, simMultiplier + 1);
                simPoints += 50 * simMultiplier;
            } else if (ev.type === 'collectible') {
                // Base point
                simPoints += 1 * simMultiplier;

                // Cluster progress
                let cid = ev.clusterId;
                if (cid) {
                    if (!clusterCounts[cid]) clusterCounts[cid] = 0;
                    clusterCounts[cid]++;

                    let totalInCluster = this.clusterTotals[cid] || 0;
                    if (clusterCounts[cid] === totalInCluster && totalInCluster > 1) {
                        let bonus = Math.floor((totalInCluster * 1.5) * simMultiplier);
                        simPoints += bonus;
                    }
                }
            }
        }

        return simPoints;
    }

    // --- SELF-TESTING MECHANISMS ---

    runSelfTests() {
        console.log("=== RUNNING SCUBAFLOW DIAGNOSTICS ===");

        // Test 1: Validate loaded Level Config Object
        let config = this.levelData;
        console.assert(config !== null && config !== undefined, "Assertion Failed: levelData is missing");
        console.assert(config.bpm === 60, "Assertion Failed: Mock BPM must be 60");
        console.assert(Array.isArray(config.path) && config.path.length > 0, "Assertion Failed: path keypoints array is invalid or empty");
        console.assert(Array.isArray(config.collectibles), "Assertion Failed: collectibles array is invalid");
        console.assert(Array.isArray(config.zones), "Assertion Failed: depth zones array is invalid");

        // Test 2: Interpolator validation
        let yStart = this.getTargetYAtTime(0);
        let yMid = this.getTargetYAtTime(30000);
        let yEnd = this.getTargetYAtTime(120000);

        console.assert(yStart === 200, `Assertion Failed: Expected y=200 at t=0ms, got ${yStart}`);
        console.assert(yMid === 450, `Assertion Failed: Expected y=450 at t=30000ms, got ${yMid}`);
        console.assert(yEnd === 250, `Assertion Failed: Expected y=250 at t=120000ms, got ${yEnd}`);

        // Test 3: Sinking/rising control behavior
        let mockVolume = 0.5;
        let dtSim = 1.0;

        mockVolume = Math.min(1.0, mockVolume + 3.0 * dtSim);
        console.assert(mockVolume === 1.0, `Assertion Failed: Expect V_lung to be 1.0 after 1s hold, got ${mockVolume}`);

        // Test 4: Drag model
        let testVy = 100;
        let dragCoeff = 2.4;
        testVy *= Math.exp(-dragCoeff * 1.0);
        console.assert(testVy < 10 && testVy > 8, `Assertion Failed: Drag should reduce 100 to ~9 after 1s, got ${testVy.toFixed(1)}`);

        // Test 5: Buoyancy range
        let testSmoothRise = 1.0;
        let testSmoothSink = 0.0;
        let riseAy = (testSmoothRise - 0.5) * -640;
        let sinkAy = (testSmoothSink - 0.5) * -640;
        console.assert(riseAy === -320, `Assertion Failed: Expect rise acceleration -320, got ${riseAy}`);
        console.assert(sinkAy === 320, `Assertion Failed: Expect sink acceleration 320, got ${sinkAy}`);

        // Test 6: Autopilot math sanity checks
        let testPathY = 300;
        let testMinYAllowed = 100;
        let testMaxYAllowed = 500;
        let testClamped = Phaser.Math.Clamp(testPathY, testMinYAllowed, testMaxYAllowed);
        console.assert(testClamped === 300, `Assertion Failed: Autopilot clamping logic failed: expected 300, got ${testClamped}`);

        // Test 7: Procedural level generator force-spawns on silent tracks
        let mockAudio = {
            duration: 30, // 30 seconds
            sampleRate: 44100,
            getChannelData: () => new Float32Array(44100 * 30) // Silent track
        };
        let originalLevelData = this.levelData;
        let originalTotalCollectibles = this.totalCollectibles;
        let originalFlowMilestoneInterval = this.flowMilestoneInterval;
        let originalMaxPotentialPoints = this.maxPotentialPoints;
        let originalBaseScrollSpeed = this.baseScrollSpeed;
        let originalScrollSpeed = this.scrollSpeed;
        let originalClusterTotals = this.clusterTotals;
        let originalClusterCollected = this.clusterCollected;

        this.generateProceduralLevel(mockAudio);

        // Verify collectibles generated on silent track
        console.assert(this.levelData.collectibles.length > 0, `Assertion Failed: Silent tracks must still generate collectibles to avoid empty tunnels`);

        // Check maximum gap between collectibles in the playable region (introDuration to duration - 1.2s)
        let sortedCols = [...this.levelData.collectibles].sort((a, b) => a.time - b.time);
        let lastTime = (750 / this.baseScrollSpeed) * 1000;
        for (let col of sortedCols) {
            let gap = col.time - lastTime;
            console.assert(gap <= 6800, `Assertion Failed: Large gap between collectibles detected: ${gap}ms`);
            lastTime = col.time;
        }

        // Test 8: Deterministic generation and hashing
        // First generation (saved in this.levelData after generateProceduralLevel(mockAudio))
        let run1Collectibles = [...this.levelData.collectibles];

        // Second generation with the exact same mockAudio
        this.generateProceduralLevel(mockAudio);
        let run2Collectibles = [...this.levelData.collectibles];

        console.assert(run1Collectibles.length === run2Collectibles.length, "Assertion Failed: Determinism check - collectible counts differ");
        for (let i = 0; i < run1Collectibles.length; i++) {
            console.assert(run1Collectibles[i].time === run2Collectibles[i].time, `Assertion Failed: Determinism check - collectible time mismatch at index ${i}`);
            console.assert(run1Collectibles[i].y === run2Collectibles[i].y, `Assertion Failed: Determinism check - collectible Y mismatch at index ${i}`);
            console.assert(run1Collectibles[i].clusterId === run2Collectibles[i].clusterId, `Assertion Failed: Determinism check - collectible clusterId mismatch at index ${i}`);
        }

        // Third generation with slightly modified audio data (to verify hash change affects layout)
        let mockAudio2 = {
            duration: 30,
            sampleRate: 44100,
            getChannelData: () => {
                let arr = new Float32Array(44100 * 30);
                arr.fill(0.1); // introduce a consistent difference in the audio data
                return arr;
            }
        };
        this.generateProceduralLevel(mockAudio2);
        let run3Collectibles = [...this.levelData.collectibles];

        // Assert that different audio data produces different level layouts
        let isIdentical = (run1Collectibles.length === run3Collectibles.length);
        if (isIdentical) {
            for (let i = 0; i < run1Collectibles.length; i++) {
                if (run1Collectibles[i].time !== run3Collectibles[i].time ||
                    run1Collectibles[i].y !== run3Collectibles[i].y ||
                    run1Collectibles[i].clusterId !== run3Collectibles[i].clusterId) {
                    isIdentical = false;
                    break;
                }
            }
        }
        console.assert(!isIdentical, "Assertion Failed: Hashing check - different audio data did not produce a different layout");

        // Test 9: Web Audio API time-step and jitter calculation
        let simElapsed = 0;
        let simPrevElapsed = 0;
        let mockAudioCtxTime = 0.0;
        let mockMusicStartTime = 0.0;

        // Frame 1
        simPrevElapsed = simElapsed;
        simElapsed = (mockAudioCtxTime - mockMusicStartTime) * 1000;
        let dt1 = (simElapsed - simPrevElapsed) / 1000;
        if (dt1 < 0) dt1 = 0;

        // Frame 2 (Jitter: Audio clock does not advance)
        simPrevElapsed = simElapsed;
        simElapsed = (mockAudioCtxTime - mockMusicStartTime) * 1000;
        let dt2 = (simElapsed - simPrevElapsed) / 1000;
        if (dt2 < 0) dt2 = 0;

        // Frame 3 (Audio clock advances to 33.3ms)
        mockAudioCtxTime = 0.0333;
        simPrevElapsed = simElapsed;
        simElapsed = (mockAudioCtxTime - mockMusicStartTime) * 1000;
        let dt3 = (simElapsed - simPrevElapsed) / 1000;
        if (dt3 < 0) dt3 = 0;

        let totalDt = dt1 + dt2 + dt3;
        console.assert(Math.abs(totalDt - 0.0333) < 0.0001, `Assertion Failed: Expect total dt to be 0.0333, got ${totalDt}`);

        // Restore original state
        this.levelData = originalLevelData;
        this.totalCollectibles = originalTotalCollectibles;
        this.flowMilestoneInterval = originalFlowMilestoneInterval;
        this.maxPotentialPoints = originalMaxPotentialPoints;
        this.baseScrollSpeed = originalBaseScrollSpeed;
        this.scrollSpeed = originalScrollSpeed;
        this.clusterTotals = originalClusterTotals;
        this.clusterCollected = originalClusterCollected;

        console.log("=== DIAGNOSTICS PASSED: ALL CONTROLS FUNCTIONAL ===");
    }
}

// Global Launcher Function
function startGame() {
    const config = {
        type: Phaser.AUTO,
        parent: 'game-container',
        width: 1200,
        height: 700,
        backgroundColor: '#010410',
        audio: {
            noAudio: true
        },
        scene: [ScubaFlowScene]
    };
    new Phaser.Game(config);
}
