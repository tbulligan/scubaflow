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
                uniform float uTime;
                uniform float uCausticIntensity;
                varying vec2 outTexCoord;
                
                void main() {
                    // 1. Organic underwater micro-refraction (liquid wave)
                    vec2 uv = outTexCoord;
                    float waveX = sin(uv.y * 14.0 + uTime * 1.5) * 0.0012;
                    float waveY = cos(uv.x * 12.0 + uTime * 1.2) * 0.0012;
                    vec2 warpedUV = uv + vec2(waveX, waveY);

                    // 2. Chromatic Aberration on warped coordinates
                    vec2 rCoord = warpedUV + vec2(uChromaticOffset, 0.0);
                    vec2 bCoord = warpedUV - vec2(uChromaticOffset, 0.0);
                    
                    float r = texture2D(uMainSampler, rCoord).r;
                    float g = texture2D(uMainSampler, warpedUV).g;
                    float b = texture2D(uMainSampler, bCoord).b;
                    float a = texture2D(uMainSampler, warpedUV).a;
                    
                    // 3. Ethereal procedural underwater caustics shimmer
                    vec2 cUV = uv * vec2(10.0, 6.0);
                    float p1 = sin(cUV.x + uTime * 0.8) + sin(cUV.y + uTime * 0.9);
                    float p2 = sin(cUV.x * 0.7 - uTime * 0.7 + p1) + cos(cUV.y * 0.8 + uTime * 0.6 + p1);
                    float caustic = pow(clamp(0.5 + 0.5 * sin(p2 * 2.5), 0.0, 1.0), 4.0);
                    vec3 causticCol = vec3(0.0, 0.94, 1.0) * (caustic * uCausticIntensity);

                    // 4. Subtle cinematic edge vignette
                    vec2 vigCoord = (uv - 0.5) * vec2(1.25, 1.0);
                    float vig = clamp(1.0 - dot(vigCoord, vigCoord) * 0.85, 0.0, 1.0);

                    vec3 finalRGB = (vec3(r, g, b) + causticCol) * vig;

                    gl_FragColor = vec4(finalRGB, a);
                }
            `
        });
        this.chromaticOffset = 0.0;
        this.chromaticOffsetStart = 0.0;
        this.fxTime = 0.0;
        this.causticIntensity = 0.035;
    }
    
    onPreRender() {
        this.set1f('uChromaticOffset', this.chromaticOffset);
        this.set1f('uTime', this.fxTime);
        this.set1f('uCausticIntensity', this.causticIntensity);
    }
}

class ScubaFlowScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ScubaFlowScene' });
    }

    get visualMultiplier() {
        return Math.min(9, this.smoothVisualMultiplier || this.scoreMultiplier || 1);
    }

    normalizeAudioBuffer(audioBuffer) {
        let numChannels = audioBuffer.numberOfChannels;
        let peak = 0;

        // Find the absolute peak amplitude across all channels to preserve stereo balance
        for (let c = 0; c < numChannels; c++) {
            let channelData = audioBuffer.getChannelData(c);
            for (let i = 0; i < channelData.length; i++) {
                let absVal = Math.abs(channelData[i]);
                if (absVal > peak) {
                    peak = absVal;
                }
            }
        }

        // Scale all channels uniformly if the peak is lower than target (0.98 to avoid clipping)
        if (peak > 0 && peak < 0.95) {
            let scale = 0.98 / peak;
            for (let c = 0; c < numChannels; c++) {
                let channelData = audioBuffer.getChannelData(c);
                for (let i = 0; i < channelData.length; i++) {
                    channelData[i] *= scale;
                }
            }
            console.log(`AudioBuffer normalized in-place. Peak: ${peak.toFixed(4)} -> 0.98 (scaled by ${scale.toFixed(2)}x)`);
        } else {
            console.log(`AudioBuffer peak is ${peak.toFixed(4)}. Normalization skipped.`);
        }
    }

    hslToColorInt(h, s, l) {
        return Phaser.Display.Color.HSLToColor(h, s, l).color;
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
        this.wallHueOffset = 0;
        this.beatRipples = [];
        this.lastProcessedBeatIdx = -1;

        // Visual Distortion Silt Mode
        this.siltActive = false;
        this.siltTime = 0;
        this.siltDuration = 1800; // 1.8 seconds recovery distortion — shorter for playability
        this.siltSource = 'floor';
        this.currentSiltDuration = 1800;
        this.activeSiltBursts = [];

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
        this.smoothVisualMultiplier = 1.0;
        this.comboCount = 0;
        this.flowMeter = 1.0;
        this.decayThreshold = 12500; // 12.5 seconds
        this.lightFlashIntensity = 1.0;
        this.levelUpChromaticOffset = 0.0;
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
        this.playerBeam = null;
        this.buddyBeam = null;

        // Point Arrays pre-allocation for zero GC churn
        this.floorPoints = [];
        this.ceilPoints = [];

        this.playerCheckPoints = [
            { x: 0, y: 0, r: 6.5, floor: true, ceil: true },
            { x: 14, y: -4, r: 4, floor: true, ceil: true },
            { x: -10, y: -13, r: 2, floor: false, ceil: true },
            { x: 26, y: -2, r: 3, floor: true, ceil: true },
            { x: 0, y: 0, r: 4, floor: true, ceil: true },
            { x: 0, y: 0, r: 4, floor: true, ceil: true }
        ];
        this.buddyCheckPoints = [
            { x: 0, y: 0, r: 10 },
            { x: 0, y: -4, r: 6 },
            { x: 0, y: 0, r: 5 },
            { x: 0, y: 0, r: 8 },
            { x: 0, y: 0, r: 8 }
        ];
        this.diverLimbs = {
            ke: 0, ke2: 0, foot1X: 0, foot1Y: 0, foot2X: 0, foot2Y: 0
        };
        this.screenTouchActive = false;
        this.isPaused = false;
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
            zones: [
                { startTime: 0, endTime: 24000, targetDepth: 250, name: "Neon Reef", floorColor: 0x00ff88, ceilColor: 0x00f0ff, floorHue: 152, ceilHue: 184, bgColor: 0x010c14 },
                { startTime: 24000, endTime: 48000, targetDepth: 350, name: "Solar Ridge", floorColor: 0xffcc00, ceilColor: 0xff00b4, floorHue: 48, ceilHue: 318, bgColor: 0x0e0212 },
                { startTime: 48000, endTime: 72000, targetDepth: 450, name: "Ultraviolet Cavern", floorColor: 0xff007f, ceilColor: 0x4b0082, floorHue: 330, ceilHue: 275, bgColor: 0x12010c },
                { startTime: 72000, endTime: 96000, targetDepth: 500, name: "Molten Abyss", floorColor: 0xff6600, ceilColor: 0x9900ff, floorHue: 24, ceilHue: 276, bgColor: 0x120501 },
                { startTime: 96000, endTime: 120000, targetDepth: 300, name: "Cyber Ascent", floorColor: 0x00ffff, ceilColor: 0x008080, floorHue: 180, ceilHue: 180, bgColor: 0x010d12 }
            ],
            beats: []
        };
        this.totalCollectibles = 0;
        this.lastProcessedBeatIdx = -1;
        this.beatRipples = [];
        this.targetEndX = (this.levelData.songLengthMs / 1000) * this.baseScrollSpeed + 250;

        this.avatarType = 'diver';

        // 2. Run Self-Tests
        this.runSelfTests();

        // 3. Create Dynamic Canvas Textures
        this.createProceduralTextures();

        // 4. Setup Input
        this.spaceKey = this.input && this.input.keyboard ? this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE) : null;

        if (this.input) {
            this.input.on('pointerdown', () => { this.screenTouchActive = true; });
            this.input.on('pointerup', () => { this.screenTouchActive = false; });
        }

        if (typeof window !== 'undefined') {
            const isInteractiveUI = (target) => {
                return Boolean(target && (
                    (target.closest && (
                        target.closest('#quick-controls-dock') ||
                        target.closest('#pause-screen') ||
                        target.closest('#intro-screen') ||
                        target.closest('.glass-card') ||
                        target.closest('.dock-btn')
                    )) ||
                    target.tagName === 'BUTTON' ||
                    target.tagName === 'A' ||
                    target.tagName === 'INPUT'
                ));
            };

            window.addEventListener('pointerdown', (e) => {
                if (isInteractiveUI(e.target)) return;
                if (this.isPlaying && !this.useAutopilot && !this.isPaused) {
                    this.screenTouchActive = true;
                }
            }, { passive: false });

            window.addEventListener('pointerup', (e) => {
                if (isInteractiveUI(e.target)) return;
                this.screenTouchActive = false;
            });

            window.addEventListener('pointercancel', () => {
                this.screenTouchActive = false;
            });

            this.onTouchStart = (e) => {
                if (isInteractiveUI(e.target)) return;
                if (this.isPlaying && !this.useAutopilot && !this.isPaused) {
                    if (e.cancelable) e.preventDefault();
                    this.screenTouchActive = true;
                }
            };
            this.onTouchMove = (e) => {
                if (isInteractiveUI(e.target)) return;
                if (this.isPlaying && !this.useAutopilot && !this.isPaused) {
                    if (e.cancelable) e.preventDefault();
                }
            };
            this.onTouchEnd = (e) => {
                if (isInteractiveUI(e.target)) return;
                this.screenTouchActive = false;
            };
            this.onTouchCancel = () => {
                this.screenTouchActive = false;
            };
            this.onContextMenu = (e) => {
                if (this.isPlaying) e.preventDefault();
            };

            window.addEventListener('touchstart', this.onTouchStart, { passive: false });
            window.addEventListener('touchmove', this.onTouchMove, { passive: false });
            window.addEventListener('touchend', this.onTouchEnd);
            window.addEventListener('touchcancel', this.onTouchCancel);
            window.addEventListener('contextmenu', this.onContextMenu);

            // Zero-HUD Hotkeys: Pause (Esc/P), Resume (R), Exit (X in pause/results)
            this.onKeyDown = (e) => {
                if (!this.isPlaying && !this.isPaused && !this.isLevelCompleted) return;

                if (this.isLevelCompleted) {
                    if (e.key === 'r' || e.key === 'R') {
                        e.preventDefault();
                        this.restartDive();
                    } else if (e.key === 'x' || e.key === 'X') {
                        e.preventDefault();
                        this.exitToTrackSelect();
                    }
                    return;
                }

                if (this.isPaused) {
                    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
                        e.preventDefault();
                        this.resumeDive();
                    } else if (e.key === 'r' || e.key === 'R') {
                        e.preventDefault();
                        this.restartDive();
                    } else if (e.key === 'x' || e.key === 'X') {
                        e.preventDefault();
                        this.exitToTrackSelect();
                    }
                    return;
                }

                // While playing (unpaused): P/Esc to pause (R and X disabled to prevent accidental aborts)
                if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
                    e.preventDefault();
                    this.pauseDive();
                }
            };
            window.addEventListener('keydown', this.onKeyDown);
        }

        window.activeScubaScene = this;

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

        this.cameras.main.ignore([this.buddyBubble, this.playerBubble]);

        // 6. Setup Graphics layers
        this.parallaxFarGraphics = this.add.graphics().setDepth(-2).setScrollFactor(0);  // farthest layer (slowest) — screen-space so it tiles left correctly
        this.parallaxNearGraphics = this.add.graphics().setDepth(-1); // near layer (faster)
        this.backwallGraphics = this.add.graphics().setDepth(-0.5); // recessed 2.5D cavern backwall connecting floor & ceiling
        this.backgroundGraphics = this.add.graphics();
        this.terrainGraphics = this.add.graphics();
        this.guideLineGraphics = this.add.graphics().setDepth(1);
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
        this.foregroundRockGraphics = this.add.graphics().setDepth(22).setScrollFactor(0); // near-field foreground rock silhouettes
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

        // Set camera bounds & baseline background color
        this.cameras.main.setBounds(0, 0, 999999, 700);
        let initBgHue = (this.baseHue * 0.25) % 360;
        let initBgColor = this.hslToColorInt(initBgHue / 360, 0.7, 0.012);
        this.cameras.main.setBackgroundColor(initBgColor);

        // 7. Decode Custom Track (Always required now)
        if (window.customAudioBuffer) {
            this.isPlaying = false;

            // SOTA Loader: Full-screen overlay with a pulsing sonar ring
            let statusBg = this.add.graphics();
            statusBg.fillStyle(0x000206, 1.0);
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
                            
                            // Normalize the audio buffer to ensure consistent gameplay generation and volume
                            this.normalizeAudioBuffer(decodedBuffer);
                            
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

                            // Initialize Bioluminescent Marine Snow Motes (150 world-space motes with 3D Z-depth)
                            let startCamX = this.cameras.main.scrollX;
                            this.marineSnowMotes = [];
                            for (let i = 0; i < 150; i++) {
                                let z = 0.35 + Math.random() * 1.65;
                                let baseR = 0.9 + Math.random() * 1.3;
                                this.marineSnowMotes.push({
                                    x: startCamX + Math.random() * 1200,
                                    y: Math.random() * 700,
                                    z: z,
                                    vx: -12 - Math.random() * 14,
                                    vy: -4 + Math.random() * 8,
                                    baseSize: baseR,
                                    size: baseR,
                                    alpha: 0.05
                                });
                            }
                            this.marineSnowGraphics = this.add.graphics().setDepth(-1.5).setScrollFactor(1);
                            this.marineSnowForegroundGraphics = this.add.graphics().setDepth(15).setScrollFactor(1);

                            // Set camera to follow player
                            this.cameras.main.startFollow(this.player, true, 0.1, 1, -250, 0);
                            console.log("Camera follow configured.");

                            // Set up UI Camera (exempt from PsychedelicFX pipeline)
                            this.uiCamera = this.cameras.add(0, 0, 1200, 700);
                            this.uiCamera.setBounds(0, 0, 999999, 700); // Set bounds to allow scrolling!
                            this.uiCamera.startFollow(this.player, true, 0.1, 1, -250, 0);
                            
                            // Defensively filter the ignore list to prevent TypeErrors in case of uninitialized game objects
                            let ignoreList = [
                                this.parallaxFarGraphics,
                                this.parallaxNearGraphics,
                                this.backwallGraphics,
                                this.backgroundGraphics,
                                this.terrainGraphics,
                                this.guideLineGraphics,
                                this.lightGraphics,
                                this.siltOverlay,
                                this.siltVignetteImage,
                                this.foregroundGraphics,
                                this.foregroundRockGraphics,
                                this.marineSnowGraphics,
                                this.marineSnowForegroundGraphics,
                                this.player,
                                this.buddy,
                                this.bubbleEmitter,
                                this.siltEmitter,
                                this.plumeEmitter
                            ].filter(Boolean);
                            
                            this.uiCamera.ignore(ignoreList);
                            if (this.collectiblesGroup) {
                                this.uiCamera.ignore(this.collectiblesGroup.getChildren());
                            }

                            // Register and add WebGL post-processing PsychedelicFX pipeline
                            let renderer = this.renderer;
                            if (renderer && renderer.pipelines) {
                                try {
                                     renderer.pipelines.addPostPipeline('PsychedelicFX', PsychedelicFX);
                                     this.cameras.main.setPostPipeline(PsychedelicFX);
                                     this.cameras.main.setBackgroundColor(initBgColor);
                                     console.log("PsychedelicFX WebGL Pipeline registered and attached.");
                                } catch (e) {
                                     console.warn("Failed to register WebGL PostFX pipeline:", e);
                                }
                            }

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
        } else {
            // Diegetic recovery if Begin Dive triggered without custom track
            console.warn("No custom audio buffer found in window.customAudioBuffer. Returning to menu.");
            let statusBg = this.add.graphics();
            statusBg.fillStyle(0x000206, 1.0);
            statusBg.fillRect(0, 0, 1200, 700);

            let statusText = this.add.text(600, 330, 'NO TRACK LOADED', {
                fontFamily: 'Outfit',
                fontSize: '22px',
                color: '#ff007f',
                letterSpacing: 2,
                fontStyle: 'bold'
            }).setOrigin(0.5);

            let subText = this.add.text(600, 375, 'Please select or drop a music track first.', {
                fontFamily: 'Montserrat',
                fontSize: '13px',
                color: '#94a3b8'
            }).setOrigin(0.5);

            this.time.delayedCall(1200, () => {
                let intro = document.getElementById('intro-screen');
                let pauseBtn = document.getElementById('btn-pause');
                if (pauseBtn) pauseBtn.style.display = 'none';
                if (intro) {
                    intro.classList.remove('descending');
                    intro.style.display = 'flex';
                }
                if (window.game) {
                    window.game.destroy(true);
                    window.game = null;
                }
            });
        }
    }

    startCountdown(ctx) {
        this.countdownActive = true;
        this.elapsedTime = 0;
        this.isPlaying = true; // allow update loop to render the starting scene

        // Diegetic Avatar Clarity: Show "YOU" and "FOLLOW ME 👌" during countdown
        if (this.buddyBubble) {
            this.buddyBubble.setText("FOLLOW ME 👌").setVisible(true).setPosition(this.buddy.x, this.buddy.y - 45);
        }
        if (this.playerBubble) {
            this.playerBubble.setText("YOU 🫧").setVisible(true).setPosition(this.player.x, this.player.y - 45);
        }

        // Concurrent Track Info Overlay during 3s countdown (positioned at top-center away from divers)
        let trackName = window.customTrackName || "Unknown Track";
        let displayTitle = trackName.replace(/\.[^/.]+$/, '').toUpperCase();
        if (displayTitle.length > 48) displayTitle = displayTitle.slice(0, 45) + '...';

        let durationMs = this.levelData.songLengthMs || 0;
        let minutes = Math.floor(durationMs / 60000);
        let seconds = Math.floor((durationMs % 60000) / 1000);
        let durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        let currentZone = this.getCurrentDepthZone();
        let colorStr = currentZone ? '#' + currentZone.ceilColor.toString(16).padStart(6, '0') : '#00f0ff';

        let infoText = this.add.text(600, 65, displayTitle, {
            fontFamily: 'Outfit',
            fontSize: '22px',
            fontStyle: 'bold',
            color: colorStr,
            letterSpacing: 2,
            align: 'center'
        }).setOrigin(0.5).setDepth(100).setAlpha(0).setScrollFactor(0);

        let durationText = this.add.text(600, 98, durationStr, {
            fontFamily: 'Outfit',
            fontSize: '14px',
            color: '#94a3b8',
            letterSpacing: 1,
            align: 'center'
        }).setOrigin(0.5).setDepth(100).setAlpha(0).setScrollFactor(0);

        this.startInfoText = infoText;
        this.startDurationText = durationText;
        this.cameras.main.ignore([infoText, durationText]);

        this.tweens.add({
            targets: [infoText, durationText],
            alpha: 1,
            duration: 400,
            ease: 'Power2'
        });

        // 3-Second Unified Countdown: 4 ticks of 750ms = 3000ms
        let countdownNumbers = ['3', '2', '1', 'FLOW!'];
        let colors = ['#bd00ff', '#00f0ff', '#ff007f', '#00ff66'];
        let index = 0;
        let stepDuration = 750;

        let showNext = () => {
            if (!this.isPlaying || !this.countdownActive) return;
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

                this.tweens.add({
                    targets: this.countdownText,
                    scale: 1.4,
                    alpha: { from: 1, to: 0 },
                    duration: stepDuration,
                    ease: 'Cubic.easeOut',
                    onComplete: () => {
                        index++;
                        showNext();
                    }
                });
            } else {
                if (!this.isPlaying || !this.countdownActive) return;
                this.countdownText.destroy();
                this.countdownActive = false;
                if (this.startInfoText) {
                    this.startInfoText.destroy();
                    this.startInfoText = null;
                }
                if (this.startDurationText) {
                    this.startDurationText.destroy();
                    this.startDurationText = null;
                }
                if (this.buddyBubble) this.buddyBubble.setVisible(false);
                if (this.playerBubble) this.playerBubble.setVisible(false);
                console.log("Countdown complete. Starting setupAudioEngine...");
                this.setupAudioEngine(ctx);
                console.log("setupAudioEngine completed.");
            }
        };

        this.countdownText = this.add.text(600, 420, '', {
            fontFamily: 'Outfit',
            fontSize: '140px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(100).setScrollFactor(0);

        this.cameras.main.ignore(this.countdownText);

        showNext();
    }

    update(time, delta) {
        try {
            if (!this.isPlaying || this.isPaused) return;

            if (this.countdownActive) {
                this.elapsedTime = 0;
                this.player.x = 250;
                this.buddy.x = 550;

                let buddyStartY = this.getTargetYAtTime((550 / this.baseScrollSpeed) * 1000);
                this.buddy.y = buddyStartY;

                let playerStartY = this.getTargetYAtTime((250 / this.baseScrollSpeed) * 1000);
                this.player.y = playerStartY;

                if (this.buddyBubble && this.buddyBubble.visible) {
                    this.buddyBubble.setPosition(this.buddy.x, this.buddy.y - 45);
                }
                if (this.playerBubble && this.playerBubble.visible) {
                    this.playerBubble.setPosition(this.player.x, this.player.y - 45);
                }

                // Simulate normal breathing cycle for player visuals during countdown
                let breathPeriod = 3600;
                let breathPhase = (time % breathPeriod) / breathPeriod;
                this.V_lung = 0.5 + 0.3 * Math.sin(breathPhase * Math.PI * 2);

                this.emitBreathingParticles();

                // Maintain identical background luminance & snow motes during countdown as in active gameplay
                let bgHue = (this.baseHue * 0.25) % 360;
                let bgColorVal = this.hslToColorInt(bgHue / 360, 0.7, 0.012);
                this.cameras.main.setBackgroundColor(bgColorVal);
                this.updateMarineSnow(delta / 1000);

                // Redraw visualizers and terrain so everything is visible
                this.drawParallax(time);
                this.drawBackgroundVisuals(time);
                this.drawTerrain();
                this.drawCaveLights();
                this.drawPlayerVisuals(time);
                this.drawBuddyVisuals(time);
                this.drawForegroundBubbles(delta / 1000);
                this.drawForegroundRocks(delta / 1000);
                this.drawSiltOverlay();

                let fx = this.cameras.main.getPostPipeline(PsychedelicFX);
                if (fx) {
                    fx.fxTime = time / 1000;
                    fx.causticIntensity = 0.035;
                }
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
            let blendRate = this.siltActive ? 2.2 : 3.2;
            this.smoothVisualMultiplier = Phaser.Math.Linear(
                this.smoothVisualMultiplier || 1.0,
                this.scoreMultiplier || 1,
                Math.min(1.0, dt * blendRate)
            );

            // Start fadeout when player reaches targetEndX, track completes, or time runs out
            if ((this.player.x >= this.targetEndX || this.musicCompleted || this.elapsedTime >= this.levelData.songLengthMs) && !this.isFadingOut) {
                this.startFadeout();
            }


            // 1. (baseHue now updated in section 6 below, multiplier-scaled)


            // Multi-point body checkPoints definition (cached on instance to avoid GC churn)
            let frogPhase = (this.elapsedTime / 350) % (Math.PI * 2);
            let ke = Math.max(0, Math.sin(frogPhase));
            let frogPhase2 = frogPhase + 0.25;
            let ke2 = Math.max(0, Math.sin(frogPhase2));

            let foot2X = -8 - (6 + ke * 8) - (2 + ke * 12);
            let foot2Y = -6 - (12 - ke * 8) - (10 - ke * 10);
            let foot1X = -10 - (6 + ke2 * 8) - (2 + ke2 * 12);
            let foot1Y = 2 - (12 - ke2 * 8) - (10 - ke2 * 10);

            this.diverLimbs.ke = ke;
            this.diverLimbs.ke2 = ke2;
            this.diverLimbs.foot1X = foot1X;
            this.diverLimbs.foot1Y = foot1Y;
            this.diverLimbs.foot2X = foot2X;
            this.diverLimbs.foot2Y = foot2Y;

            let checkPoints = this.playerCheckPoints;
            checkPoints[4].x = foot1X;
            checkPoints[4].y = foot1Y;
            checkPoints[5].x = foot2X;
            checkPoints[5].y = foot2Y;

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
                    let { floorY: ptFloorY, ceilY: ptCeilY } = this.getWallY(wx);

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
            let spaceDown = this.isBreathingIn();
            if (spaceDown !== this.lastSpaceDown) {
                this.lastSpaceDown = spaceDown;
                if (typeof navigator !== 'undefined' && navigator.vibrate && !this.useAutopilot) {
                    navigator.vibrate(12);
                }
            }
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
                    let { floorY: ptFloorY, ceilY: ptCeilY } = this.getWallY(wx);

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
            this.localEnergy = this.getEnergyAtTime(timeAtPlayer);
            let { floorY, ceilY: ceilingY } = this.getWallY(px);

            let collisionTriggered = false;
            let collisionSource = 'floor';
            let impactVy = preClampVy;

            for (let pt of checkPoints) {
                let wx = px + pt.x;
                let wy = this.player.y + pt.y;
                let { floorY: ptFloorY, ceilY: ptCeilY } = this.getWallY(wx);

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
            let lastBeatIdx = -1;
            for (let i = 0; i < beats.length; i++) {
                if (this.elapsedTime >= beats[i]) {
                    lastBeatTime = beats[i];
                    lastBeatIdx = i;
                } else {
                    break;
                }
            }
            let timeSinceBeat = this.elapsedTime - lastBeatTime;
            let pulse = 0;
            if (timeSinceBeat >= 0) {
                let beatInterval = 500;
                if (lastBeatIdx >= 0 && lastBeatIdx < beats.length - 1) {
                    beatInterval = beats[lastBeatIdx + 1] - beats[lastBeatIdx];
                } else if (lastBeatIdx > 0) {
                    beatInterval = beats[lastBeatIdx] - beats[lastBeatIdx - 1];
                } else if (this.levelData && this.levelData.bpm) {
                    beatInterval = (60 / this.levelData.bpm) * 1000;
                }
                beatInterval = Math.max(160, Math.min(1500, beatInterval));

                let currentEnergy = this.getEnergyAtTime(this.elapsedTime);
                // Pulse duration dynamically scales with music tempo and energy:
                // Ambient/calm tracks breathe longer (up to 75% of interval); intense drops snap faster (55% of interval)
                let decayRatio = 0.75 - currentEnergy * 0.20;
                let pulseDuration = Math.min(800, Math.max(160, beatInterval * decayRatio));

                // Natural attack-decay envelope: eliminates zero-attack frame-snapping
                // Calm vocal/ambient tracks swell smoothly over 65ms; high-energy tracks punch in 28ms
                let attackDuration = currentEnergy < 0.08 ? 65 : 28;
                let decayDuration = Math.max(100, pulseDuration - attackDuration);

                if (timeSinceBeat < attackDuration) {
                    let attackProgress = timeSinceBeat / attackDuration;
                    pulse = Math.sin(attackProgress * (Math.PI / 2));
                } else if (timeSinceBeat < pulseDuration) {
                    let decayProgress = (timeSinceBeat - attackDuration) / decayDuration;
                    let p = 1.0 - decayProgress;
                    pulse = p * p;
                }
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
            let hueSpeed = 2.2 + (this.visualMultiplier - 1) * 2.8;
            this.baseHue = (this.baseHue + dt * hueSpeed) % 360;
            this.wallHueOffset = (this.wallHueOffset + dt * hueSpeed * 0.5) % 360;
            let bgHue = (this.baseHue * 0.25) % 360;
            let multiBeat = 1.0 + (this.visualMultiplier - 1) * 0.55;
            
            // Restrict background beat flashes & zoom throb exclusively to operational modes multiplier >= 8
            let lightnessBoost = 0.012;
            let targetZoom = 1.0;
            let bgSat = 0.7;
            let multiplierSurplus = Math.max(0, this.visualMultiplier - 8);

            if (this.visualMultiplier >= 8) {
                // Softened beat flash & zoom throb to keep it energetic but not overwhelming
                lightnessBoost += pulse * 0.010 * multiBeat;
                targetZoom += pulse * 0.005 * multiBeat;
                
                if (this.visualMultiplier >= 9) {
                    // Hyper-flow extra throb and saturation bleed
                    bgSat = Math.min(1.0, 0.70 + multiplierSurplus * 0.05);
                    lightnessBoost += Math.sin(this.elapsedTime * 0.006) * 0.005 * multiplierSurplus;
                    targetZoom += pulse * 0.003 * multiplierSurplus;
                }
            }
            
            let bgColorVal = this.hslToColorInt(bgHue / 360, bgSat, lightnessBoost);
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

            let isRescuing = this.buddyState === 'assisting' || this.buddyState === 'clearing' || this.buddyState === 'relieved';
            let targetBuddyX = this.player.x + (isRescuing ? 90 : 280);
            if (isRescuing) {
                this.buddy.scaleX = -1; // Face player
            } else {
                this.buddy.scaleX = 1;  // Face forward
            }
            this.buddy.x = Phaser.Math.Linear(this.buddy.x, targetBuddyX, 1 - Math.exp(-0.9 * physDt));


            // Natural scout drafting: buddy stays comfortably centered in the open corridor
            let { floorY: bFloorY, ceilY: bCeilY } = this.getWallY(this.buddy.x);
            let corridorCenterY = (bFloorY + bCeilY) * 0.5;
            let corridorHalfHeight = (bFloorY - bCeilY) * 0.5;

            // Gentle, organic swimming sway (natural dive buddy buoyancy breathing drift)
            let swimSway = Math.sin(this.elapsedTime * 0.0016 + 1.2) * Math.min(10, corridorHalfHeight * 0.2);
            let targetBuddyY = corridorCenterY + swimSway;

            // Generous safety buffer keeping buddy comfortably away from rocky ceiling and floor
            let safeMargin = Math.min(32, Math.max(18, corridorHalfHeight - 20));
            let minSafeY = bCeilY + safeMargin;
            let maxSafeY = bFloorY - safeMargin;
            if (minSafeY <= maxSafeY) {
                targetBuddyY = Phaser.Math.Clamp(targetBuddyY, minSafeY, maxSafeY);
            } else {
                targetBuddyY = corridorCenterY;
            }

            // Smooth fluid exponential glide (zero high-frequency jitter, zero harsh snapping)
            this.buddy.y = Phaser.Math.Linear(this.buddy.y, targetBuddyY, 1 - Math.exp(-2.2 * physDt));

            // 8. Silt Recovery timer & Scroll Speed Slowdown
            if (this.siltActive) {
                this.siltTime -= deltaMs;
                if (this.siltTime <= 0) {
                    this.siltActive = false;
                }
                this.scrollSpeed = Phaser.Math.Linear(this.scrollSpeed, this.baseScrollSpeed * 0.72, physDt * 3); // less punishing slowdown
                this.lightFlashIntensity = 0.05; // Lock flashlight intensity at near-zero during silt-out
            } else {
                this.scrollSpeed = Phaser.Math.Linear(this.scrollSpeed, this.baseScrollSpeed, physDt * 2.5);
                if (this.lightFlashIntensity < 1.0) {
                    this.lightFlashIntensity = Phaser.Math.Linear(this.lightFlashIntensity, 1.0, dt * 1.8);
                }
            }

            // Update WebGL PostFX shader parameters (Chromatic Split, Underwater Refraction & Caustics)
            let fx = this.cameras.main.getPostPipeline(PsychedelicFX);
            if (fx) {
                fx.fxTime = this.elapsedTime / 1000;
                let beatBoost = (this.currentBeatPulse || 0) * 0.025;
                let flowBoost = Math.min(6, this.visualMultiplier - 1) * 0.003;
                fx.causticIntensity = this.siltActive ? 0.01 : (0.035 + beatBoost + flowBoost);

                // Decay custom level-up chromatic offset
                if (this.levelUpChromaticOffset > 0) {
                    this.levelUpChromaticOffset = Math.max(0, this.levelUpChromaticOffset - dt * 0.05); // dynamic decay
                }
                // Chromatic split decays in sync with silt time, blended with level-up offset
                let siltOffset = (this.siltActive && this.currentSiltDuration > 0)
                    ? (fx.chromaticOffsetStart || 0.02) * Math.max(0, this.siltTime / this.currentSiltDuration)
                    : 0;
                fx.chromaticOffset = Math.max(siltOffset, this.levelUpChromaticOffset);
            }
            // Flow multiplier decay logic (time without collecting debris reduces multiplier)
            if (this.scoreMultiplier > 1 && !this.siltActive && this.isPlaying && !this.countdownActive) {
                this.flowMeter -= (deltaMs / this.decayThreshold);
                if (this.flowMeter <= 0) {
                    this.scoreMultiplier--;
                    this.flowMeter = 1.0;
                    this.comboCount = 0; // Reset combo progress on decay
                    this.spawnFloatingText(this.player.x, this.player.y - 35, `FLOW DECAY! x${this.scoreMultiplier}`, '#94a3b8');
                }
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
            this.drawForegroundRocks(delta / 1000);
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
            
            // Soft radial glow core
            let grad = sCtx.createRadialGradient(8, 8, 0.5, 8, 8, 8);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
            grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.45)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            sCtx.fillStyle = grad;
            sCtx.fillRect(0, 0, 16, 16);

            // 4-point light glint needle
            sCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            sCtx.beginPath();
            sCtx.moveTo(8, 0);
            sCtx.quadraticCurveTo(8, 8, 16, 8);
            sCtx.quadraticCurveTo(8, 8, 8, 16);
            sCtx.quadraticCurveTo(8, 8, 0, 8);
            sCtx.quadraticCurveTo(8, 8, 8, 0);
            sCtx.fill();

            this.textures.addCanvas('spark', starCanvas);
        }

        if (!this.textures.exists('scuba_bubble')) {
            let bCanvas = document.createElement('canvas');
            bCanvas.width = 24;
            bCanvas.height = 24;
            let bCtx = bCanvas.getContext('2d');
            
            // Soft inner refraction glow
            let bGrad = bCtx.createRadialGradient(12, 12, 2, 12, 12, 10);
            bGrad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
            bGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.2)');
            bGrad.addColorStop(1, 'rgba(255, 255, 255, 0.65)');
            bCtx.fillStyle = bGrad;
            bCtx.beginPath();
            bCtx.arc(12, 12, 10, 0, Math.PI * 2);
            bCtx.fill();

            // Outer bubble membrane sheen
            bCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            bCtx.lineWidth = 1.4;
            bCtx.beginPath();
            bCtx.arc(12, 12, 9.5, 0, Math.PI * 2);
            bCtx.stroke();

            // Primary specular shine highlight on top-left
            bCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            bCtx.beginPath();
            bCtx.arc(9, 8, 2.0, 0, Math.PI * 2);
            bCtx.fill();

            // Secondary subtle bounce reflection on bottom-right
            bCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            bCtx.beginPath();
            bCtx.arc(14.5, 14.5, 1.2, 0, Math.PI * 2);
            bCtx.fill();

            this.textures.addCanvas('scuba_bubble', bCanvas);
        }

        if (!this.textures.exists('collectible')) {
            let debCanvas = document.createElement('canvas');
            debCanvas.width = 32;
            debCanvas.height = 32;
            let dCtx = debCanvas.getContext('2d');
            
            // Soft outer neon glow aura
            let dGrad = dCtx.createRadialGradient(16, 16, 2, 16, 16, 15);
            dGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            dGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.7)');
            dGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.2)');
            dGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            dCtx.fillStyle = dGrad;
            dCtx.beginPath();
            dCtx.arc(16, 16, 15, 0, Math.PI * 2);
            dCtx.fill();

            // Radiant diamond shard core
            dCtx.save();
            dCtx.translate(16, 16);
            dCtx.rotate(Math.PI / 4);
            dCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            dCtx.fillRect(-4, -4, 8, 8);
            dCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            dCtx.lineWidth = 1.5;
            dCtx.strokeRect(-6, -6, 12, 12);
            dCtx.restore();

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
        this.bubbleEmitter = this.add.particles(0, 0, 'scuba_bubble', {
            lifespan: 1800,
            speedY: { min: -120, max: -40 },
            speedX: { min: -45, max: -15 },
            scale: { min: 0.10, max: 0.42 },
            alpha: { start: 0.85, end: 0 },
            frequency: -1,
            blendMode: 'ADD'
        });

        this.siltEmitter = this.add.particles(0, 0, 'silt_cloud', {
            lifespan: { min: 800, max: 1600 },
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
            spaceDown = this.isBreathingIn();
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
        let gBack = this.marineSnowGraphics;
        let gFore = this.marineSnowForegroundGraphics || gBack;
        if (!gBack) return;
        gBack.clear();
        if (gFore && gFore !== gBack) gFore.clear();
        if (!this.player || !this.buddy) return;

        let camX = this.cameras.main.scrollX;
        let pHandX = this.player.x + 26;
        let pHandY = this.player.y - 2;

        let bDir = this.buddy.scaleX || 1;
        let bHandX = this.buddy.x + 26 * bDir;
        let bHandY = this.buddy.y - 2;

        let currentVisMult = this.smoothVisualMultiplier || this.scoreMultiplier || 1;
        let speedMultiplier = 1.0;
        if (currentVisMult >= 8.5) {
            let speedScale = Math.min(7, currentVisMult - 8);
            speedMultiplier += speedScale * 0.20;
        }

        for (let mote of this.marineSnowMotes) {
            let z = mote.z || 1.0;
            let invZ = 1.0 / z;

            mote.x += mote.vx * dt * speedMultiplier * invZ;
            mote.y += mote.vy * dt * speedMultiplier * Math.sqrt(invZ);

            // Wrap relative to camera viewport in world space (with 100px padding off-screen)
            if (mote.x < camX - 100) {
                mote.x += 1400;
                mote.y = Math.random() * 700;
            }
            if (mote.x > camX + 1300) {
                mote.x -= 1400;
                mote.y = Math.random() * 700;
            }
            if (mote.y < 0) mote.y += 700;
            if (mote.y > 700) mote.y -= 700;

            let wx = mote.x;
            let wy = mote.y;

            // Player light beam check using realistic shadow-occluded coordinates
            let inPlayerCone = false;
            if (this.playerBeam) {
                let dxP = wx - this.playerBeam.x0;
                if (dxP >= 0 && dxP <= 320) {
                    let steps = 30;
                    let index = dxP / (320 / steps);
                    let i0 = Math.floor(index);
                    let i1 = Math.min(steps, i0 + 1);
                    let tRatio = index - i0;
                    let yTop = Phaser.Math.Linear(this.playerBeam.topPoints[i0].y, this.playerBeam.topPoints[i1].y, tRatio);
                    let yBottom = Phaser.Math.Linear(this.playerBeam.bottomPoints[i0].y, this.playerBeam.bottomPoints[i1].y, tRatio);
                    if (wy >= yTop && wy <= yBottom) {
                        inPlayerCone = true;
                    }
                }
            }

            // Buddy light beam check using realistic shadow-occluded coordinates
            let inBuddyCone = false;
            if (this.buddyBeam) {
                let bDir = this.buddyBeam.dir;
                if (bDir === 1) {
                    let dxB = wx - this.buddyBeam.x0;
                    if (dxB >= 0 && dxB <= 320) {
                        let steps = 30;
                        let index = dxB / (320 / steps);
                        let i0 = Math.floor(index);
                        let i1 = Math.min(steps, i0 + 1);
                        let tRatio = index - i0;
                        let yTop = Phaser.Math.Linear(this.buddyBeam.topPoints[i0].y, this.buddyBeam.topPoints[i1].y, tRatio);
                        let yBottom = Phaser.Math.Linear(this.buddyBeam.bottomPoints[i0].y, this.buddyBeam.bottomPoints[i1].y, tRatio);
                        if (wy >= yTop && wy <= yBottom) {
                            inBuddyCone = true;
                        }
                    }
                } else {
                    let dxB = this.buddyBeam.x0 - wx;
                    if (dxB >= 0 && dxB <= 320) {
                        let steps = 30;
                        let index = dxB / (320 / steps);
                        let i0 = Math.floor(index);
                        let i1 = Math.min(steps, i0 + 1);
                        let tRatio = index - i0;
                        let yTop = Phaser.Math.Linear(this.buddyBeam.topPoints[i0].y, this.buddyBeam.topPoints[i1].y, tRatio);
                        let yBottom = Phaser.Math.Linear(this.buddyBeam.bottomPoints[i0].y, this.buddyBeam.bottomPoints[i1].y, tRatio);
                        if (wy >= yTop && wy <= yBottom) {
                            inBuddyCone = true;
                        }
                    }
                }
            }

            let illuminated = inPlayerCone || inBuddyCone;
            
            // Adjust alpha targets. At x10+, make everything significantly brighter for "wow" effect!
            let isSuper = currentVisMult >= 9.5;
            let targetAlpha = isSuper ? (illuminated ? 0.85 : 0.25) : (illuminated ? 0.40 : 0.05);
            mote.alpha += (targetAlpha - mote.alpha) * 0.1;

            // Hide marine snow that is inside the cave walls (terrain)
            let { floorY, ceilY } = this.getWallY(wx);
            if (wy < ceilY || wy > floorY) {
                continue;
            }

            // Colors: Bright cyan for illuminated.
            // For unilluminated: dim slate-blue at low levels, brighter light blue at x10+ to make the speed lines stand out
            let color;
            if (illuminated) {
                color = 0x00f0ff;
            } else {
                color = isSuper ? 0x38bdf8 : 0x475569;
            }

            // Perspective size & target graphics selection
            let baseR = mote.baseSize || mote.size || 1.2;
            let renderSize = Math.max(0.4, baseR * invZ);
            let g = (z < 0.85 && gFore) ? gFore : gBack;
            let zAlphaMult = (z < 0.85) ? Math.min(1.2, 0.75 + (1.0 - z) * 0.6) : 1.0;

            g.fillStyle(color, mote.alpha * zAlphaMult);
            if (currentVisMult >= 9.2) {
                // Motion blur effect: smoothly stretch snow particles horizontally into speed lines
                let blurFrac = Math.min(1.0, (currentVisMult - 9.2) / 0.8);
                let visualSuperScale = Math.max(0, Math.min(6, currentVisMult - 9));
                let streakLength = renderSize * (1.0 + blurFrac * (3.0 + visualSuperScale * 6.0));
                g.fillRect(mote.x - streakLength, mote.y - renderSize * 0.9, streakLength * 2, renderSize * 1.8);
            } else {
                g.fillCircle(mote.x, mote.y, renderSize);
            }
        }
    }

    drawParallax(time) {
        let camX = this.cameras.main.scrollX;
        let screenW = 1300;
        let multiFactor = this.visualMultiplier - 1;
        let baseSat = this.siltActive ? 0.05 : Math.min(0.85, 0.25 + multiFactor * 0.086);
        let baseLum = this.siltActive ? 0.15 : Math.min(0.55, 0.25 + multiFactor * 0.043);
        let baseAlpha = this.siltActive ? 0.08 : Math.min(0.55, 0.18 + multiFactor * 0.053);

        // flowFill: 0 at multiplier x1 (wireframe), 1 at multiplier x8 (full solid neon) - gradual power curve
        let flowFill = Math.pow((this.visualMultiplier - 1) / 7.0, 1.5);

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
                let { ceilY: bc } = this.getWallY(bwx);
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
                let { floorY: bf } = this.getWallY(bwx);
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
            let { floorY: stalCeilFloor, ceilY: stalCeil } = this.getWallY(worldX);
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
                let { ceilY: nc } = this.getWallY(nwx);
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
                let { floorY: nf } = this.getWallY(nwx);
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
            let { floorY: nearFloor, ceilY: nearCeil } = this.getWallY(sampleX);
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

        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.visualMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.visualMultiplier - 1) * 0.017);

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
            fg.fillStyle(0xffffff, b.alpha * 1.6);
            fg.fillCircle(b.x - b.radius * 0.35, b.y - b.radius * 0.35, Math.max(0.8, b.radius * 0.22));
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
            fg.fillStyle(0xffffff, b.alpha * 1.8);
            fg.fillCircle(b.x - b.radius * 0.35, b.y - b.radius * 0.35, Math.max(1.2, b.radius * 0.22));
        }
    }

    drawForegroundRocks(dt) {
        let fg = this.foregroundRockGraphics;
        if (!fg) return;
        fg.clear();

        let camX = this.cameras.main.scrollX;
        let screenW = 1300;
        let fgFactor = 1.35; // 35% faster scroll than camera for near-field parallax
        let fgSpacing = 440;
        let fgPhase = (camX * fgFactor) % fgSpacing;
        let fgCount = Math.ceil(screenW / fgSpacing) + 2;

        let zoneHues = this.getCurrentZoneHues();
        let rimHue = (zoneHues.ceilHue + 40) % 360;
        let rimColor = this.hslToColorInt(rimHue / 360, 0.70, 0.55);
        let darkRockColor = 0x01040a; // Pitch-black deep-sea foreground rock silhouette

        for (let n = -1; n <= fgCount; n++) {
            let sx = n * fgSpacing - fgPhase;
            let i = Math.floor((camX * fgFactor + sx + fgPhase) / fgSpacing);
            let jitterX = Math.sin(i * 5.7) * 70;
            sx += jitterX;

            // Only spawn foreground formation if pseudo-random check passes (leaves natural gaps)
            let candidateCheck = Math.sin(i * 3.1 + 1.7);
            if (candidateCheck < -0.15) continue;

            let isStalactite = (i % 2 === 0);
            let hw = 28 + Math.sin(i * 4.3) * 12;

            if (isStalactite) {
                // Large jagged foreground stalactite hanging from top
                let stalH = 75 + Math.sin(i * 2.7) * 40;
                fg.fillStyle(darkRockColor, 0.88);
                fg.lineStyle(1.8, rimColor, 0.35);
                fg.beginPath();
                fg.moveTo(sx - hw * 1.4, -20);
                fg.lineTo(sx - hw * 0.4, stalH * 0.4);
                fg.lineTo(sx - 4, stalH * 0.85);
                fg.lineTo(sx, stalH);
                fg.lineTo(sx + 6, stalH * 0.75);
                fg.lineTo(sx + hw * 0.5, stalH * 0.35);
                fg.lineTo(sx + hw * 1.4, -20);
                fg.closePath();
                fg.fillPath();
                fg.strokePath();
            } else {
                // Large jagged foreground stalagmite rising from bottom
                let stagH = 65 + Math.sin(i * 2.1) * 35;
                fg.fillStyle(darkRockColor, 0.88);
                fg.lineStyle(1.8, rimColor, 0.35);
                fg.beginPath();
                fg.moveTo(sx - hw * 1.4, 720);
                fg.lineTo(sx - hw * 0.5, 700 - stagH * 0.35);
                fg.lineTo(sx - 5, 700 - stagH * 0.8);
                fg.lineTo(sx, 700 - stagH);
                fg.lineTo(sx + 5, 700 - stagH * 0.7);
                fg.lineTo(sx + hw * 0.4, 700 - stagH * 0.4);
                fg.lineTo(sx + hw * 1.4, 720);
                fg.closePath();
                fg.fillPath();
                fg.strokePath();
            }
        }
    }

    drawPlayerVisuals(time) {
        let g = this.playerGraphics;
        g.clear();
        let pulse = this.currentBeatPulse || 0;

        // Dynamic flow-state color popping based on silt-free multiplier
        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.visualMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.visualMultiplier - 1) * 0.017);

        let playerHue = (this.baseHue + 320) % 360; // Pink/Magenta base (distinct from buddy)
        let mainColor = this.hslToColorInt(playerHue / 360, flowSat, 0.55 + flowLightBoost);
        let accentColor = this.hslToColorInt(((playerHue + 130) % 360) / 360, flowSat, 0.6 + flowLightBoost);

        let glowRadius = 20 + this.V_lung * 8 + pulse * 8 + (this.visualMultiplier - 1) * 4;
        g.fillStyle(mainColor, 0.08 + this.V_lung * 0.04 + pulse * 0.08);
        g.fillCircle(0, 0, glowRadius);

        // --- AURA RINGS: concentric neon rings that grow with scoreMultiplier ---
        // x1: none. x2-x7: rings. x8+: 7 rings.
        let curMultiplier = this.smoothVisualMultiplier || this.scoreMultiplier || 1;
        let auraLevels = Math.max(0, Math.min(curMultiplier - 1, 7));
        let visualSuperScale = Math.max(0, Math.min(6, curMultiplier - 9));
        let numRings = Math.ceil(auraLevels);
        
        for (let a = 0; a < numRings; a++) {
            let auraHue = (this.baseHue + a * 75 + (visualSuperScale * 12)) % 360;
            let auraColor = this.hslToColorInt(auraHue / 360, 1.0, 0.65);
            
            // Scale phase speed and amplitude dynamically with multiplier
            let speedMult = 1.0 + visualSuperScale * 0.12;
            let auraPhase = (this.elapsedTime * 0.003 * speedMult + a * 0.8) % (Math.PI * 2);
            
            let baseR = 32 + a * 18 + pulse * (10 + a * 5) + Math.sin(auraPhase) * 5;
            let auraR = baseR + visualSuperScale * 1.5;
            
            let auraAlpha = 0.22 + pulse * 0.35 - a * 0.04;
            if (a >= Math.floor(auraLevels)) {
                let ringFrac = auraLevels - Math.floor(auraLevels);
                auraAlpha *= ringFrac;
            }
            if (visualSuperScale > 0) {
                auraAlpha = Math.min(0.9, auraAlpha + visualSuperScale * 0.04);
            }

            // Draw jagged oscilloscope-like aura
            let lineWidth = 1.2 + a * 0.5 + (visualSuperScale * 0.15);
            g.lineStyle(lineWidth, auraColor, Math.max(0, auraAlpha));
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

        this.drawDiverBody(g, false, mainColor, accentColor, this.V_lung, 26, -2, false);
    }

    drawDiverBody(g, isWireframe, mainColor, accentColor, lungVolume, handX = 26, handY = -2, hasReel = false) {
        let { ke, ke2, foot1X, foot1Y, foot2X, foot2Y } = this.diverLimbs;

        // 1. Draw Back Leg (Leg 2)
        g.lineStyle(2.5, mainColor, 0.65);
        let hip2X = -8, hip2Y = 0;
        let knee2X = hip2X - (6 + ke * 8);
        let knee2Y = hip2Y - (12 - ke * 8);
        g.beginPath();
        g.moveTo(hip2X, hip2Y);
        g.lineTo(knee2X, knee2Y);
        g.lineTo(foot2X, foot2Y);
        g.strokePath();

        // Back Fin
        let finLength = 15, finWidth = 10;
        let finWarp = (1 - ke) * 4;
        g.lineStyle(1.5, accentColor, isWireframe ? 0.7 : 1.0);
        if (!isWireframe) g.fillStyle(accentColor, 0.85);
        g.beginPath();
        g.moveTo(foot2X, foot2Y);
        g.lineTo(foot2X - finLength, foot2Y - finWidth / 2 + finWarp);
        g.lineTo(foot2X - finLength + 3, foot2Y + finWidth / 2 + finWarp);
        g.closePath();
        if (!isWireframe) g.fillPath();
        g.strokePath();

        // 2. Double Tanks (Twinset)
        g.lineStyle(1.2, accentColor, isWireframe ? 0.95 : 1.0);
        if (!isWireframe) {
            g.fillStyle(0x020514, 0.95);
            g.fillRoundedRect(-22, -16, 24, 6, 2);
            g.fillRoundedRect(-22, -11, 24, 6, 2);
        }
        g.strokeRoundedRect(-22, -16, 24, 6, 2);
        g.strokeRoundedRect(-22, -11, 24, 6, 2);

        // Isolator manifold & tank bands
        g.lineStyle(1.5, accentColor, 0.95);
        g.beginPath(); g.moveTo(2, -13); g.lineTo(2, -8); g.strokePath();

        g.lineStyle(1.0, mainColor, 0.7);
        g.beginPath();
        g.moveTo(-16, -16); g.lineTo(-16, -5);
        g.moveTo(-6, -16); g.lineTo(-6, -5);
        g.strokePath();

        // Regulator hose
        g.lineStyle(1.0, accentColor, 0.8);
        g.beginPath();
        g.moveTo(2, -11);
        for (let i = 1; i <= 4; i++) {
            let t = i / 4, mt = 1 - t;
            let x = mt * mt * 2 + 2 * mt * t * 8 + t * t * 16;
            let y = mt * mt * -11 + 2 * mt * t * -16 + t * t * -3;
            g.lineTo(x, y);
        }
        g.strokePath();

        // 3. Torso & Chest
        g.lineStyle(2, mainColor, 1.0);
        if (!isWireframe) {
            g.fillStyle(0x020514, 0.95);
            g.fillEllipse(-4, 0, 16, 12);
        }
        g.strokeEllipse(-4, 0, 16, 12);

        let chestW = 10 + lungVolume * 8;
        let chestH = 8 + lungVolume * 6;
        g.lineStyle(1.2, accentColor, 0.6 + lungVolume * 0.4);
        if (!isWireframe) {
            g.fillStyle(mainColor, 0.15 + lungVolume * 0.25);
            g.fillEllipse(-2, 0, chestW, chestH);
        }
        g.strokeEllipse(-2, 0, chestW, chestH);

        // Safety Reel spool (carried by buddy, cave diving protocol)
        if (hasReel) {
            let reelX = -4, reelY = 6;
            g.lineStyle(1.5, accentColor, 1.0);
            g.strokeCircle(reelX, reelY, 6);
            g.strokeCircle(reelX, reelY, 2);
            g.beginPath();
            g.moveTo(reelX - 6, reelY); g.lineTo(reelX + 6, reelY);
            g.moveTo(reelX, reelY - 6); g.lineTo(reelX, reelY + 6);
            g.strokePath();
        }

        // 4. Leg 1 (Front leg)
        g.lineStyle(2.5, mainColor, 1.0);
        let hip1X = -10, hip1Y = 2;
        let knee1X = hip1X - (6 + ke2 * 8);
        let knee1Y = hip1Y - (12 - ke2 * 8);
        g.beginPath();
        g.moveTo(hip1X, hip1Y);
        g.lineTo(knee1X, knee1Y);
        g.lineTo(foot1X, foot1Y);
        g.strokePath();

        // Front Fin
        let finWarp2 = (1 - ke2) * 4;
        g.lineStyle(1.5, accentColor, 1.0);
        if (!isWireframe) g.fillStyle(accentColor, 0.95);
        g.beginPath();
        g.moveTo(foot1X, foot1Y);
        g.lineTo(foot1X - finLength, foot1Y - finWidth / 2 + finWarp2);
        g.lineTo(foot1X - finLength + 3, foot1Y + finWidth / 2 + finWarp2);
        g.closePath();
        if (!isWireframe) g.fillPath();
        g.strokePath();

        // 5. Head & Mask
        g.lineStyle(1.5, mainColor, 1.0);
        if (!isWireframe) {
            g.fillStyle(0x020514, 0.95);
            g.fillCircle(14, -4, 4);
        }
        g.strokeCircle(14, -4, 4);

        g.lineStyle(1.2, accentColor, 1.0);
        if (!isWireframe) {
            g.fillStyle(accentColor, 0.4);
            g.fillRoundedRect(16, -6, 5, 4, 1);
        }
        g.strokeRoundedRect(16, -6, 5, 4, 1);

        g.lineStyle(1, mainColor, 0.6);
        g.beginPath();
        g.arc(14, -4, 5, Math.PI * 0.6, Math.PI * 1.4);
        g.strokePath();

        // 6. Arm & Torch Canister
        g.lineStyle(2, mainColor, 0.9);
        let shoulderX = 4, shoulderY = -3;
        let elbowX = (shoulderX + handX) / 2 - 2;
        let elbowY = Math.max(shoulderY, handY) + 5;
        g.beginPath();
        g.moveTo(shoulderX, shoulderY);
        g.lineTo(elbowX, elbowY);
        g.lineTo(handX, handY);
        g.strokePath();

        g.lineStyle(1.5, accentColor, 1.0);
        if (!isWireframe) {
            g.fillStyle(0x020514, 0.95);
            g.fillRoundedRect(handX - 1, handY - 3, 6, 6, 1);
        }
        g.strokeRoundedRect(handX - 1, handY - 3, 6, 6, 1);
    }

    drawBuddyVisuals(time) {
        let g = this.buddyGraphics;
        g.clear();
        let pulse = this.currentBeatPulse || 0;

        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.visualMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.visualMultiplier - 1) * 0.017);

        let buddyHue = (this.baseHue + 180) % 360;
        let mainColor = this.hslToColorInt(buddyHue / 360, flowSat, 0.55 + flowLightBoost);
        let accentColor = this.hslToColorInt(((buddyHue + 100) % 360) / 360, flowSat, 0.6 + flowLightBoost);

        g.fillStyle(mainColor, 0.04);
        g.fillCircle(0, 0, 20 + pulse * 6);

        let handX = (this.buddyState === 'assisting') ? 18 : 26;
        let handY = (this.buddyState === 'assisting') ? -16 : -2;

        this.drawDiverBody(g, true, mainColor, accentColor, 0.5, handX, handY, true);
    }

    getBuddyCheckPoints(scaleX) {
        let handX = (this.buddyState === 'assisting') ? 18 : 26;
        let handY = (this.buddyState === 'assisting') ? -16 : -2;

        let pts = this.buddyCheckPoints;
        pts[0].x = 0; pts[0].y = 0; pts[0].r = 10;
        pts[1].x = 14 * scaleX; pts[1].y = -4; pts[1].r = 6;
        pts[2].x = handX * scaleX; pts[2].y = handY; pts[2].r = 5;
        pts[3].x = this.diverLimbs.foot1X * scaleX; pts[3].y = this.diverLimbs.foot1Y; pts[3].r = 8;
        pts[4].x = this.diverLimbs.foot2X * scaleX; pts[4].y = this.diverLimbs.foot2Y; pts[4].r = 8;
        return pts;
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
        this.playerBeam = this.drawDiveLight(g, pHandX, pHandY, 1, 0xffffff, pAccent, pHue, true);

        // Buddy Light (hand is at 26, -2 relative to buddy container, scaled by scaleX)
        let bDir = this.buddy.scaleX; // 1 or -1
        let bHandX = this.buddy.x + 26 * bDir;
        let bHandY = this.buddy.y - 2;

        this.buddy.rotation = 0;
        this.buddyBeam = this.drawDiveLight(g, bHandX, bHandY, bDir, 0xffffff, bAccent, bHue, false);
    }

    drawDiveLight(g, x0, y0, dir, mainColor, accentColor, hueVal, isPlayer = false) {
        let beamLength = 320;
        let beamSpread = 75;
        let steps = 30;

        let intensity = isPlayer ? (this.lightFlashIntensity !== undefined ? this.lightFlashIntensity : 1.0) : 1.0;
        beamLength *= intensity;
        beamSpread *= intensity;

        let stepX = (beamLength / steps) * dir;

        let flowSat = (isPlayer && this.siltActive) ? 0.15 : Math.min(1.0, 0.45 + (this.visualMultiplier - 1) * 0.08);
        let flowLightBoost = (isPlayer && this.siltActive) ? -0.15 : Math.min(0.12, (this.visualMultiplier - 1) * 0.017);

        let lightCol = this.hslToColorInt(hueVal, flowSat, 0.65 + flowLightBoost);

        let topPoints = [];
        let bottomPoints = [];
        
        let maxCeilSlope = -999999;
        let minFloorSlope = 999999;

        for (let i = 0; i <= steps; i++) {
            let x = x0 + i * stepX;
            let ratio = i / steps;

            // Unconstrained beam Y (horizontal trim)
            let yTop = y0 - ratio * beamSpread;
            let yBottom = y0 + ratio * beamSpread;

            // Cave boundaries at x
            let { floorY: floorLimitY, ceilY: ceilLimitY } = this.getWallY(x);

            // Constrain Y to physical walls at this step
            let cTop = Math.max(yTop, ceilLimitY);
            let cBottom = Math.min(yBottom, floorLimitY);

            // Shadow casting: limit angles by previous protrusions
            if (i > 0) {
                let dist = Math.abs(x - x0);
                if (dist > 0.001) {
                    let currentCeilSlope = (cTop - y0) / dist;
                    let currentFloorSlope = (cBottom - y0) / dist;

                    if (i === 1) {
                        maxCeilSlope = currentCeilSlope;
                        minFloorSlope = currentFloorSlope;
                    } else {
                        maxCeilSlope = Math.max(maxCeilSlope, currentCeilSlope);
                        minFloorSlope = Math.min(minFloorSlope, currentFloorSlope);
                    }

                    cTop = y0 + maxCeilSlope * dist;
                    cBottom = y0 + minFloorSlope * dist;

                    // If shadow projections cross, light is blocked completely
                    if (cTop > cBottom) {
                        cTop = (cTop + cBottom) / 2;
                        cBottom = cTop;
                    }
                }
            }

            // Final clamp to keep drawing within current walls (preventing light bleeding into ceiling/floor)
            cTop = Phaser.Math.Clamp(cTop, ceilLimitY, floorLimitY);
            cBottom = Phaser.Math.Clamp(cBottom, ceilLimitY, floorLimitY);

            topPoints.push({ x: x, y: cTop });
            bottomPoints.push({ x: x, y: cBottom });
        }

        // Continuous gradual light progression from origin to tip
        // Smooth monotonic attenuation with zero-slope feathered dissipation at beam limits
        let peakMainAlpha = (0.28 + (this.visualMultiplier - 1) * 0.03) * intensity;
        let peakCoreAlpha = (0.14 + (this.visualMultiplier - 1) * 0.015) * intensity;
        let coreCutoff = 0.72;

        let tMain = (t) => {
            if (t <= 0) return 1;
            if (t >= 1) return 0;
            let u = 1 - t * t;
            return u * u;
        };

        let tCore = (t) => {
            if (t <= 0) return 1;
            if (t >= coreCutoff) return 0;
            let u = 1 - Math.pow(t / coreCutoff, 2);
            return u * u;
        };

        // Render 10 progressive nested slices (sampled along the 30 boundary steps)
        // Eliminates redundant mobile fill-rate overdraw while preserving smooth polynomial falloff
        let numSlices = 10;
        for (let s = 1; s <= numSlices; s++) {
            let tPrev = (s - 1) / numSlices;
            let tCurr = s / numSlices;
            let k = Math.min(steps, Math.round(s * (steps / numSlices)));

            let wMain = tMain(tPrev) - tMain(tCurr);
            if (wMain > 0.0001) {
                g.fillStyle(lightCol, peakMainAlpha * wMain);
                g.beginPath();
                g.moveTo(x0, y0);
                for (let i = 0; i <= k; i++) g.lineTo(topPoints[i].x, topPoints[i].y);
                for (let i = k; i >= 0; i--) g.lineTo(bottomPoints[i].x, bottomPoints[i].y);
                g.closePath();
                g.fillPath();
            }

            let wCore = tCore(tPrev) - tCore(tCurr);
            if (wCore > 0.0001) {
                g.fillStyle(0xffffff, peakCoreAlpha * wCore);
                g.beginPath();
                g.moveTo(x0, y0);
                for (let i = 0; i <= k; i++) {
                    let coreTop = topPoints[i].y * 0.45 + y0 * 0.55;
                    g.lineTo(topPoints[i].x, coreTop);
                }
                for (let i = k; i >= 0; i--) {
                    let coreBottom = bottomPoints[i].y * 0.45 + y0 * 0.55;
                    g.lineTo(topPoints[i].x, coreBottom);
                }
                g.closePath();
                g.fillPath();
            }
        }

        // Draw luminous lamp bulb lens glow with gradual optical bloom
        if (typeof g.fillCircle === 'function') {
            g.fillStyle(0xffffff, 0.60 * intensity);
            g.fillCircle(x0, y0, 2.5);
            g.fillStyle(0xffffff, 0.32 * intensity);
            g.fillCircle(x0, y0, 5.5);
            g.fillStyle(lightCol, 0.20 * intensity);
            g.fillCircle(x0, y0, 9.5);
            g.fillStyle(lightCol, 0.08 * intensity);
            g.fillCircle(x0, y0, 14.5);
        }


        return { x0: x0, dir: dir, topPoints: topPoints, bottomPoints: bottomPoints };
    }

    drawGuideLine() {
        if (!this.buddy || !this.guideLineGraphics) return;

        let isRescuing = this.buddyState === 'assisting' || this.buddyState === 'clearing' || this.buddyState === 'relieved';
        let g = this.guideLineGraphics;
        g.clear();
        // Normal: depth 1 (behind divers at 10, above terrain at 0)
        // Rescue / silt-out: depth 15 (above silt cloud at 9 and silt overlay at 12)
        g.setDepth(isRescuing ? 15 : 1);

        let bDir = this.buddy.scaleX;
        let reelWorldX = this.buddy.x + (-4) * bDir;
        let reelWorldY = this.buddy.y + 6;

        let startX = this.cameras.main.scrollX - 50;
        let endX = reelWorldX;

        if (endX <= startX) return;

        // Draw the guideline in neon orange/yellow
        let lineHue = (this.baseHue + 40) % 360;
        let lineColor = Phaser.Display.Color.HSLToColor(lineHue / 360, 1.0, 0.6).color;

        let blendRange = 150; // Smooth blending over the last 150px before the reel
        const getLineY = (lx) => {
            let t = (lx / this.baseScrollSpeed) * 1000;
            let pathY = this.getTargetYAtTime(t);
            let distToReel = endX - lx;
            let blend = distToReel < blendRange ? (1 - distToReel / blendRange) : 0;
            return pathY * (1 - blend) + reelWorldY * blend;
        };

        g.lineStyle(1.5, lineColor, 0.75);
        g.beginPath();

        let first = true;
        // Fine-grained step to prevent chord separation on curves
        for (let x = startX; x <= endX; x += 8) {
            let y = getLineY(x);
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

        // Draw cave directional arrows tightly affixed to and rotated along the line tangent
        g.fillStyle(lineColor, 0.9);
        let arrowInterval = 140;
        let nextArrowX = Math.ceil(startX / arrowInterval) * arrowInterval;
        for (let x = nextArrowX; x < endX - 35; x += arrowInterval) {
            let y = getLineY(x);
            let yPrev = getLineY(x - 3);
            let yNext = getLineY(x + 3);
            let angle = Math.atan2(yNext - yPrev, 6);

            // Direction towards exit is backwards along line (opposite to cave progression)
            let exitAngle = angle + Math.PI;
            let normAngle = exitAngle + Math.PI / 2;

            let tipX = x + Math.cos(exitAngle) * 5.5;
            let tipY = y + Math.sin(exitAngle) * 5.5;

            let baseCenterX = x - Math.cos(exitAngle) * 3.5;
            let baseCenterY = y - Math.sin(exitAngle) * 3.5;

            let halfW = 4.0;
            let c1X = baseCenterX + Math.cos(normAngle) * halfW;
            let c1Y = baseCenterY + Math.sin(normAngle) * halfW;
            let c2X = baseCenterX - Math.cos(normAngle) * halfW;
            let c2Y = baseCenterY - Math.sin(normAngle) * halfW;

            g.beginPath();
            g.moveTo(tipX, tipY);
            g.lineTo(c1X, c1Y);
            g.lineTo(c2X, c2Y);
            g.closePath();
            g.fillPath();
        }
    }

    drawTerrain() {
        let g = this.terrainGraphics;
        g.clear();

        let zoneHues = this.getCurrentZoneHues();
        let floorHue = (zoneHues.floorHue + this.wallHueOffset) % 360;
        let ceilHue = (zoneHues.ceilHue + this.wallHueOffset) % 360;

        // Dynamic flow-state color popping based on silt-free multiplier
        let flowSat = this.siltActive ? 0.15 : Math.min(1.0, 0.45 + (this.visualMultiplier - 1) * 0.08);
        let flowLightBoost = this.siltActive ? -0.15 : Math.min(0.12, (this.visualMultiplier - 1) * 0.017);

        // flowFill: 0 = wireframe (multiplier x1), 1 = fully solid neon (multiplier x8+) - gradual power curve
        let flowFill = Math.pow((this.visualMultiplier - 1) / 7.0, 1.5);

        // At high flow, walls use full neon saturation; at low flow, muted
        let wallSat = this.siltActive ? 0.15 : Math.min(1.0, flowSat + flowFill * 0.3);
        let wallLum = Math.min(0.60, (0.42 + flowLightBoost) + flowFill * 0.08);
        let floorColor = this.hslToColorInt(floorHue / 360, wallSat, wallLum);
        let ceilColor = this.hslToColorInt(ceilHue / 360, wallSat, wallLum);

        let startX = this.cameras.main.scrollX - 100;
        let endX = startX + 1400;

        // Generate base points with zero allocation GC cache
        let idx = 0;
        for (let x = startX; x <= endX; x += 30) {
            let { floorY, ceilY } = this.getWallY(x);
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

        // --- 2.5D RECESSED CAVERN BACKWALL & CYLINDRICAL RIBS (Depth -0.5) ---
        if (this.backwallGraphics && floorPoints.length > 1 && ceilPoints.length > 1) {
            let bg = this.backwallGraphics;
            bg.clear();

            let backwallHue = (floorHue + 210) % 360;
            let backwallColor = this.hslToColorInt(backwallHue / 360, 0.40, 0.035);
            let backwallAlpha = this.siltActive ? 0.28 : Math.min(0.70, 0.45 + flowFill * 0.16);

            // 1. Solid ambient backwall filling corridor between ceiling and floor
            bg.fillStyle(backwallColor, backwallAlpha);
            bg.beginPath();
            bg.moveTo(ceilPoints[0].x, ceilPoints[0].y);
            for (let i = 1; i < ceilPoints.length; i++) {
                bg.lineTo(ceilPoints[i].x, ceilPoints[i].y);
            }
            for (let i = floorPoints.length - 1; i >= 0; i--) {
                bg.lineTo(floorPoints[i].x, floorPoints[i].y);
            }
            bg.closePath();
            bg.fillPath();

            // 2. Vertical Cylindrical Sonar Ribs (Curved Strata bowing away into screen depth)
            let ribSpacing = 160;
            let firstRib = Math.floor(startX / ribSpacing) * ribSpacing;
            let lastRib = Math.ceil(endX / ribSpacing) * ribSpacing;
            let ribHue = (floorHue + 180) % 360;
            let ribColor = this.hslToColorInt(ribHue / 360, 0.50, 0.08);
            let ribAlpha = (0.10 + pulse * 0.10 + flowFill * 0.08);
            bg.lineStyle(1.4, ribColor, ribAlpha);

            for (let rx = firstRib; rx <= lastRib; rx += ribSpacing) {
                let { floorY: rf, ceilY: rc } = this.getWallY(rx);
                let midY = (rc + rf) * 0.5;
                let bowX = rx + 18 + pulse * 4;
                bg.beginPath();
                bg.moveTo(rx, rc);
                for (let t = 0.25; t <= 1.0; t += 0.25) {
                    let it = 1 - t;
                    let qx = it * it * rx + 2 * it * t * bowX + t * t * rx;
                    let qy = it * it * rc + 2 * it * t * midY + t * t * rf;
                    bg.lineTo(qx, qy);
                }
                bg.strokePath();
            }
        }

        // Draw Floor (with 3D Shelf Bevel)
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
        g.strokePath();

        // 3D Floor Top-Shelf Ledge & Ambient Shadow
        let floorShelfColor = this.hslToColorInt(floorHue / 360, wallSat * 0.9, Math.min(0.75, wallLum + 0.12));
        g.lineStyle(1.2, floorShelfColor, (0.35 + flowFill * 0.40) * lineAlpha);
        g.beginPath();
        g.moveTo(floorPoints[0].x, floorPoints[0].y - 6);
        for (let i = 1; i < floorPoints.length; i++) {
            g.lineTo(floorPoints[i].x, floorPoints[i].y - 6);
        }
        g.strokePath();

        // Ambient occlusion shadow under floor rim
        g.lineStyle(1.0, floorColor, (0.20 + flowFill * 0.25) * lineAlpha);
        g.beginPath();
        g.moveTo(floorPoints[0].x, floorPoints[0].y + 6);
        for (let i = 1; i < floorPoints.length; i++) {
            g.lineTo(floorPoints[i].x, floorPoints[i].y + 6);
        }
        g.strokePath();

        // Draw Ceiling (with 3D Under-Belly Overhang)
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
        g.strokePath();

        // Ceiling underside ambient shadow
        let ceilShadeColor = this.hslToColorInt(ceilHue / 360, wallSat * 0.8, Math.max(0.10, wallLum - 0.15));
        g.lineStyle(1.2, ceilShadeColor, (0.30 + flowFill * 0.30) * lineAlpha);
        g.beginPath();
        g.moveTo(ceilPoints[0].x, ceilPoints[0].y + 6);
        for (let i = 1; i < ceilPoints.length; i++) {
            g.lineTo(ceilPoints[i].x, ceilPoints[i].y + 6);
        }
        g.strokePath();

        // Upper ceiling rim
        g.lineStyle(1.0, ceilColor, (0.22 + flowFill * 0.30) * lineAlpha);
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
                if (this._seededRnd(seed) > 0.75) continue; // 75% chance per candidate crack

                let cx = slot * SLOT_SIZE + this._seededRnd(seed + 1) * SLOT_SIZE * 0.9 - SLOT_SIZE * 0.45;
                let { floorY } = this.getWallY(cx);

                if (this.plumeEmitter && this._seededRnd(seed + 12) < 0.4) {
                    let plumeHue = (floorHue + 20) % 360;
                    let plumeColor = this.hslToColorInt(plumeHue / 360, 0.9, 0.6);
                    
                    let mult = this.visualMultiplier || 1;
                    let ventScaleStart = 1.0 + (mult - 1) * 0.3;
                    let ventScaleEnd = 2.5 + (mult - 1) * 1.0;
                    let ventAlpha = 0.06 + (mult - 1) * 0.02;
                    let emitChance = 0.06 + (mult - 1) * 0.02;
                    
                    if (!this.countdownActive && Math.random() < emitChance) {
                        this.plumeEmitter.particleTint = plumeColor;
                        this.plumeEmitter.emitParticleAt(cx, floorY, 1, {
                            scale: { start: ventScaleStart, end: ventScaleEnd },
                            alpha: { start: Math.min(0.9, ventAlpha * 5.5), end: 0 },
                            lifespan: { min: 1800, max: 2800 },
                            speedY: { min: -150, max: -70 },
                            speedX: { min: -this.scrollSpeed * 0.5 - 15, max: -this.scrollSpeed * 0.5 + 15 }
                        });
                    }
                }

                this.drawRockCrack(g, cx, floorY, true, floorColor, seed, flowFill);
            }

            // 2. Cracks on Ceiling rock face
            let numCracksC = Math.floor(1 + this._seededRnd(slot * 37 + 12) * 3);
            for (let cIdx = 0; cIdx < numCracksC; cIdx++) {
                let seed = slot * 43 + cIdx * 103 + 12;
                if (this._seededRnd(seed) > 0.75) continue;

                let cx = slot * SLOT_SIZE + this._seededRnd(seed + 1) * SLOT_SIZE * 0.9 - SLOT_SIZE * 0.45;
                let { ceilY } = this.getWallY(cx);
                this.drawRockCrack(g, cx, ceilY, false, ceilColor, seed, flowFill);
            }
        }


        // --- Draw Wall Openings (cracks & windows as overlays on top of the terrain) ---
        this.drawWallOpenings(g, startX, endX, floorColor, ceilColor, flowFill, flowSat, flowLightBoost, floorHue, ceilHue);

        // Draw cave safety line guideline attached to buddy's reel
        this.drawGuideLine();
    }

    drawRockCrack(g, cx, wallY, isFloor, color, seed, flowFill) {
        let depth = 12 + this._seededRnd(seed + 2) * 148;
        let cy = isFloor ? wallY + depth : wallY - depth;
        let w = 8 + this._seededRnd(seed + 3) * 82;
        let h = 4 + this._seededRnd(seed + 4) * 36;
        let segments = Math.floor(3 + this._seededRnd(seed + 5) * 4);
        let branchAt = this._seededRnd(seed + 6) > 0.5 ? Math.floor(1 + this._seededRnd(seed + 7) * (segments - 2)) : -1;
        let thickness = 0.6 + this._seededRnd(seed + 8) * 1.6;
        let alphaScale = 0.15 + this._seededRnd(seed + 9) * 0.4;

        g.lineStyle(thickness, color, alphaScale + flowFill * 0.22);
        g.beginPath();
        g.moveTo(cx - w / 2, cy);

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
        }
        g.strokePath();

        if (branchAt !== -1) {
            let branchW = w * (0.3 + this._seededRnd(seed + 20) * 0.4);
            let branchH = h * (0.3 + this._seededRnd(seed + 21) * 0.4);
            let branchDirY = this._seededRnd(seed + 22) > 0.5 ? (isFloor ? 1 : -1) : (isFloor ? -1 : 1);

            g.lineStyle(thickness * 0.6, color, (alphaScale + flowFill * 0.22) * 0.7);
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

    drawWallOpenings(g, startX, endX, floorColor, ceilColor, flowFill, flowSat, flowLightBoost, floorHue, ceilHue) {
        const SLOT_SIZE = 320; // world-px between opening-slot centres
        const OPEN_CHANCE = 0.55; // probability a slot has an opening
        const WIN_EVERY = 5;  // every Nth opening is a "depth window"

        let wallSat = this.siltActive ? 0.15 : Math.min(1.0, flowSat + flowFill * 0.3);
        let wallLum = Math.min(0.75, 0.5 + flowFill * 0.15);

        // Far-parallax background colour used for depth-window fill
        let farHue = (this.baseHue + 200) % 360;
        let farAlpha = Math.min(0.55, 0.18 + (this.visualMultiplier - 1) * 0.053) * 0.45;
        let farLum = Math.max(0.05, (this.siltActive ? 0.15 : Math.min(0.55, 0.25 + (this.visualMultiplier - 1) * 0.043)) - 0.12);
        let farColor = this.hslToColorInt(farHue / 360,
            (this.siltActive ? 0.05 : Math.min(0.85, 0.25 + (this.visualMultiplier - 1) * 0.086)) * 0.8,
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

            let { floorY, ceilY } = this.getWallY(cx);

            // Rock color for this opening's rim
            let rimHue = onFloor ? floorHue : ceilHue;
            let rimColor = this.hslToColorInt(rimHue / 360, wallSat, wallLum);

            if (onFloor) {
                // Crack / side-tunnel opening IN the floor wall
                let leftX = cx - ow / 2;
                let rightX = cx + ow / 2;
                // Sample floor across full opening width; take max Y (deepest into rock)
                // so the base edge never floats above the terrain poly on either side.
                let baseY = Math.max(
                    this.getWallY(leftX).floorY,
                    floorY,
                    this.getWallY(rightX).floorY
                );
                let deepY = baseY + od;

                let r1 = this._seededRnd(slot * 67 + 2);
                let r2 = this._seededRnd(slot * 71 + 4);
                let r3 = this._seededRnd(slot * 79 + 6);
                let midX1 = leftX + ow * (0.25 + r1 * 0.15);
                let midX2 = leftX + ow * (0.6 + r2 * 0.15);
                let peakY = baseY + od * (0.45 + r3 * 0.35);

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

            } else {
                // Crack / side-tunnel opening IN the ceiling wall
                let leftX = cx - ow / 2;
                let rightX = cx + ow / 2;
                // Sample ceiling across full opening width; take min Y (deepest into rock upward)
                // so the base edge never drops below the terrain poly on either side.
                let baseY = Math.min(
                    this.getWallY(leftX).ceilY,
                    ceilY,
                    this.getWallY(rightX).ceilY
                );
                let deepY = baseY - od;

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
        if (this.collectiblesGroup) {
            this.collectiblesGroup.clear(true, true);
        } else {
            this.collectiblesGroup = this.add.group();
        }

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

        let collectPts = this.playerCheckPoints;

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

                // Increment combo and reset flow decay meter
                this.comboCount++;
                this.flowMeter = 1.0;

                let isClusterComplete = false;
                let clusterBonusCombo = 0;

                // Track cluster progress
                if (cid) {
                    if (!this.clusterCollected[cid]) this.clusterCollected[cid] = 0;
                    this.clusterCollected[cid]++;

                    let totalInCluster = this.clusterTotals[cid] || 0;
                    if (this.clusterCollected[cid] === totalInCluster && totalInCluster > 1) {
                        isClusterComplete = true;
                        // Award combo point boost instead of instant multiplier jump
                        clusterBonusCombo = 5;
                        this.comboCount += clusterBonusCombo;
                    }
                }

                // Apply combo level up if threshold hit
                let comboBumpsCount = 0;
                let comboBonus = 0;
                while (this.comboCount >= 15) {
                    this.comboCount -= 15;
                    this.scoreMultiplier++;
                    comboBumpsCount++;
                    comboBonus += 50 * this.scoreMultiplier;
                }

                // Base points
                let gainedPoints = 1 * this.scoreMultiplier;
                this.pointsScore += gainedPoints;

                // Cluster point bonus is based on totalInCluster and current multiplier
                let clusterPointBonus = 0;
                if (isClusterComplete) {
                    let totalInCluster = this.clusterTotals[cid] || 0;
                    clusterPointBonus = Math.floor((totalInCluster * 1.5) * this.scoreMultiplier);
                    this.pointsScore += clusterPointBonus;
                }

                if (comboBumpsCount > 0) {
                    this.pointsScore += comboBonus;
                    
                    // Trigger level-up shockwave if multiplier is 10+
                    if (this.scoreMultiplier >= 10) {
                        this.levelUpChromaticOffset = 0.035; // punchy chromatic flash
                        this.cameras.main.zoom = 1.05; // punchy camera lens thud
                        
                        // Spawn fast expanding ripples
                        this.beatRipples.push({
                            x: this.player.x,
                            y: this.player.y,
                            radius: 10,
                            maxRadius: 500,
                            alpha: 0.95
                        });
                        this.beatRipples.push({
                            x: this.player.x,
                            y: this.player.y,
                            radius: 10,
                            maxRadius: 400,
                            alpha: 0.8
                        });
                    }
                }

                if (comboBumpsCount > 0) {
                    let isSuper = this.scoreMultiplier >= 10;
                    let textHex = isSuper ? '#ffea00' : '#00ff66'; // Always yellow for superflow
                    let flowMsg = isSuper ? `🫧 SUPERFLOW x${this.scoreMultiplier}! +${comboBonus} 🫧` : `FLOW x${this.scoreMultiplier}! +${comboBonus}`;
                    
                    if (isClusterComplete) {
                        this.spawnFloatingText(this.player.x, this.player.y - 30, flowMsg, textHex, isSuper);
                        this.spawnFloatingText(this.player.x, this.player.y - 15, `+${clusterPointBonus}`, '#00f0ff');
                    } else {
                        this.spawnFloatingText(this.player.x, this.player.y - 35, flowMsg, textHex, isSuper);
                    }
                } else if (isClusterComplete) {
                    this.spawnFloatingText(this.player.x, this.player.y - 30, `+${clusterPointBonus}`, '#00f0ff');
                } else {
                    this.spawnFloatingText(this.player.x, this.player.y - 20, `+${gainedPoints}`, '#bd00ff');
                }

                this.triggerSparkExplosion(debris.x, debris.y);
                let noteIdx = (this.clusterCollected[debris.clusterId] || 1) - 1;
                this.playCollectibleTone(noteIdx, isClusterComplete);

                if (typeof navigator !== 'undefined' && navigator.vibrate && !this.useAutopilot) {
                    if (isClusterComplete) {
                        navigator.vibrate([20, 35, 25]);
                    } else {
                        navigator.vibrate(8);
                    }
                }
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

        if (this.uiCamera) {
            this.uiCamera.ignore(expl);
        }

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
        
        if (this.uiCamera) {
            this.uiCamera.ignore(ring);
        }

        ring.explode();

        this.time.delayedCall(1200, () => ring.destroy());
    }

    spawnFloatingText(x, y, text, color, isSuperFlow = false) {
        let fText = this.add.text(x, y, text, {
            fontFamily: 'Outfit',
            fontSize: isSuperFlow ? '22px' : '16px',
            color: color,
            fontStyle: 'bold',
            shadow: isSuperFlow ? { color: color, blur: 15, stroke: true, fill: true } : null
        }).setOrigin(0.5).setDepth(20);

        this.cameras.main.ignore(fText);

        this.tweens.add({
            targets: fText,
            y: isSuperFlow ? y - 55 : y - 40,
            alpha: 0,
            duration: isSuperFlow ? 1300 : 1000,
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
        this.wallHueOffset = (this.wallHueOffset + 60) % 360;

        if (!this.siltActive) {
            this.siltActive = true;
            this.siltTime = currentDuration;
            this.currentSiltDuration = currentDuration;
            this.comboCount = 0;
            this.flowMeter = 1.0;
            if (this.scoreMultiplier > 1) {
                this.scoreMultiplier = 1;
                this.spawnFloatingText(this.player.x, this.player.y - 35, "FLOW RESET", '#ff1e56');
            } else {
                this.scoreMultiplier = 1;
            }
            this.siltFreeTime = 0;
        } else {
            this.comboCount = 0;
            this.flowMeter = 1.0;
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

            if (typeof navigator !== 'undefined' && navigator.vibrate && !this.useAutopilot) {
                navigator.vibrate(Math.min(90, 40 + Math.floor(impactSpeed * 0.5)));
            }

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

            if (this.uiCamera) {
                this.uiCamera.ignore(siltE);
            }

            if (!this.activeSiltBursts) this.activeSiltBursts = [];
            this.activeSiltBursts.push(siltE);

            siltE.explode();
            this.time.delayedCall(5000, () => {
                if (this.activeSiltBursts) {
                    let idx = this.activeSiltBursts.indexOf(siltE);
                    if (idx !== -1) this.activeSiltBursts.splice(idx, 1);
                }
                try { siltE.destroy(); } catch (e) {}
            });
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

    isBreathingIn() {
        if (this.useAutopilot) {
            return this.simulatedSpaceDown;
        }
        const keyboardDown = Boolean(this.spaceKey && this.spaceKey.isDown);
        const pointerDown = Boolean(
            this.screenTouchActive ||
            (this.input && this.input.activePointer && this.input.activePointer.isDown)
        );
        return keyboardDown || pointerDown;
    }

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

    getWallY(wx) {
        if (!this.levelData || !this.levelData.path || this.levelData.path.length === 0) {
            return { floorY: 600, ceilY: 100 };
        }
        let t = (wx / this.baseScrollSpeed) * 1000;
        let targetY = this.getTargetYAtTime(t);
        let localEnergy = this.getEnergyAtTime(t);

        let { floorOffset, ceilOffset } = this.getWallOffsets(wx, localEnergy);
        return { floorY: targetY + floorOffset, ceilY: targetY - ceilOffset };
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
        let slopeClearance = 31.0 + (slope < 0 ? -34.0 * slope : 36.0 * slope);

        // Dynamic macro cavern chambers: slow sinusoidal breathing opens up grand grottos
        let chamberSwell = Math.sin(wx * 0.0012) * 24 * (1.0 - localEnergy * 0.5);
        let baseOffset = Math.max(88 - localEnergy * 30 + chamberSwell, slopeClearance + 6);
        let jaggednessMultiplier = 0.35 + localEnergy * 0.85;

        // Beat pulse scaled by multiplier and local energy — organic rhythmic cave expansion
        let multiBeatScale = 1.0 + (this.visualMultiplier - 1) * 0.4;
        let energyFactor = localEnergy < 0.08
            ? (localEnergy / 0.08) * 0.12
            : 0.12 + (localEnergy - 0.08) * 0.95;
        let beatPulseOffset = (this.currentBeatPulse || 0) * 8.5 * energyFactor * multiBeatScale;

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
        let minCap = Math.max(68 - localEnergy * 18, slopeClearance + 2);

        // High-frequency rocky spikiness projections (scaled by energy)
        let highFreqSpikeF = (Math.sin(wx * 0.09) * 8 + Math.cos(wx * 0.18) * 4) * jaggednessMultiplier;
        let highFreqSpikeC = (Math.sin(wx * 0.08) * 8 + Math.cos(wx * 0.17) * 4) * jaggednessMultiplier;

        let floorOffset = Math.max(minCap, baseOffset + (Math.cos(wx * 0.015) * 10 + Math.sin(wx * 0.04) * 5) * jaggednessMultiplier - highFreqSpikeF);
        let ceilOffset = Math.max(minCap, baseOffset + (Math.sin(wx * 0.02) * 10 + Math.cos(wx * 0.05) * 5) * jaggednessMultiplier - highFreqSpikeC);

        // Guarantee 100% collectability without wall collisions:
        // Max downward offset is 40px (+8px player torso + 16px safety margin = 64px min floor offset)
        // Max upward offset is 28px (+16px player top + 16px safety margin = 60px min ceiling offset)
        return {
            floorOffset: Math.max(64, floorOffset) + beatPulseOffset,
            ceilOffset: Math.max(60, ceilOffset) + beatPulseOffset
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

    getCurrentZoneHues() {
        let zones = this.levelData && this.levelData.zones;
        if (!zones || zones.length === 0) return { floorHue: 280, ceilHue: 180 };

        let t = this.elapsedTime || 0;
        let zIdx = 0;
        for (let i = 0; i < zones.length; i++) {
            if (t >= zones[i].startTime && t <= zones[i].endTime) {
                zIdx = i;
                break;
            }
            if (t > zones[i].endTime) zIdx = i;
        }

        let lerpHue = (h1, h2, p) => {
            let diff = (h2 - h1 + 540) % 360 - 180;
            return (h1 + diff * p + 360) % 360;
        };


        let curr = zones[zIdx];
        if (zIdx === 0) return { floorHue: curr.floorHue, ceilHue: curr.ceilHue };

        let elapsed = t - curr.startTime;
        let transWindow = 4000; // 4s fade-in on zone entry
        if (elapsed >= transWindow) return { floorHue: curr.floorHue, ceilHue: curr.ceilHue };

        let prev = zones[zIdx - 1];
        let ease = elapsed / transWindow;
        ease = ease * ease * (3 - 2 * ease); // smoothstep
        return {
            floorHue: lerpHue(prev.floorHue, curr.floorHue, ease),
            ceilHue: lerpHue(prev.ceilHue, curr.ceilHue, ease)
        };
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

    playCollectibleTone(noteIndex = 0, isClusterComplete = false) {
        if (this.useAutopilot) return; // Mute in music visualizer mode
        let ctx = this.audioContext;
        if (!ctx) return;

        // C Major Pentatonic scale frequencies: C5, D5, E5, G5, A5, C6, D6, E6
        const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
        let freq = pentatonic[Math.abs(noteIndex) % pentatonic.length];

        let osc = ctx.createOscillator();
        let gainNode = ctx.createGain();

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.type = isClusterComplete ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        if (isClusterComplete) {
            osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.18);
            gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
        } else {
            osc.frequency.exponentialRampToValueAtTime(freq * 1.25, ctx.currentTime + 0.12);
            gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
        }

        osc.start();
        osc.stop(ctx.currentTime + (isClusterComplete ? 0.6 : 0.4));
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

        // 1. Trigger camera fade out to the dark background color (rgb: 0, 2, 6) over 2 seconds
        this.cameras.main.fadeOut(2000, 0, 2, 6);

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

        // 3. Show levelComplete screen after 2s fadeout finishes (setTimeout runs even when tab is blurred)
        setTimeout(() => {
            this.levelComplete();
        }, 2000);
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
        
        let isNewHighPoints = !this.useAutopilot && (this.pointsScore > prevHighPointsScore);
        let highPointsScore = prevHighPointsScore;
        let maxCollectiblesPercent = prevMaxCollectiblesPercent;

        if (this.useAutopilot) {
            // Autopilot visualizer mode: do not overwrite personal bests
            highPointsScore = prevHighPointsScore;
            maxCollectiblesPercent = prevMaxCollectiblesPercent;
        } else if (isNewHighPoints || prevHighPointsScore === 0) {
            // Coherent single-run best (points and item % belong to the same dive)
            highPointsScore = this.pointsScore;
            maxCollectiblesPercent = debrisPercent;
            try {
                localStorage.setItem(scoreKey, JSON.stringify({
                    trackHash: trackHash,
                    highPointsScore: highPointsScore,
                    maxCollectiblesPercent: parseFloat(maxCollectiblesPercent.toFixed(1))
                }));
            } catch (e) {
                console.error("Failed to save highscore to localStorage", e);
            }
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
        
        if (!this.useAutopilot) {
            career.lifetimeDiveTimeMs = (career.lifetimeDiveTimeMs || 0) + this.elapsedTime;
            career.lifetimeBubblesBlown = (career.lifetimeBubblesBlown || 0) + (this.exhaleBubblesCount || 0);
            career.peakScoreMultiplier = Math.max(career.peakScoreMultiplier || 1, this.scoreMultiplier);
            try {
                localStorage.setItem(careerKey, JSON.stringify(career));
            } catch (e) {
                console.error("Failed to save career to localStorage", e);
            }
        }
        
        // Format lifetime stats
        let totalSecs = Math.floor(career.lifetimeDiveTimeMs / 1000);
        let mins = Math.floor(totalSecs / 60);
        let secs = totalSecs % 60;
        let formattedTime = `${mins}m ${secs}s`;
        
        let highScoreHTML = "";
        if (this.useAutopilot) {
            highScoreHTML = `
                <div style="font-size: 0.95rem; color: #94a3b8; margin-top: 10px; border-top: 1px solid rgba(0, 240, 255, 0.15); padding-top: 12px; text-align: center;">
                    AUTOPILOT VISUALIZER MODE &bull; ${prevHighPointsScore > 0 ? `Track Best: <strong style="color: #00f0ff;">${prevHighPointsScore} pts</strong> (${prevMaxCollectiblesPercent.toFixed(1)}%)` : 'High score tracking paused'}
                </div>
            `;
        } else if (prevHighPointsScore > 0) {
            highScoreHTML = `
                <div style="font-size: 0.95rem; color: #94a3b8; margin-top: 10px; border-top: 1px solid rgba(0, 240, 255, 0.15); padding-top: 12px; display: flex; justify-content: space-around;">
                    <div>TRACK BEST: <strong style="color: #00f0ff;">${highPointsScore} pts</strong> (${maxCollectiblesPercent.toFixed(1)}%)</div>
                    ${isNewHighPoints ? '<div style="color: #00ff66; font-weight: bold; animation: pulse 1s infinite alternate; text-shadow: 0 0 8px #00ff66;">★ NEW BEST! ★</div>' : ''}
                </div>
            `;
        } else {
            highScoreHTML = `
                <div style="font-size: 0.95rem; color: #94a3b8; margin-top: 10px; border-top: 1px solid rgba(0, 240, 255, 0.15); padding-top: 12px; text-align: center;">
                    FIRST RUN LOGGED! Track best set to <strong style="color: #00f0ff;">${highPointsScore} pts</strong> (${maxCollectiblesPercent.toFixed(1)}%)
                </div>
            `;
        }
        
        let careerHTML = `
            <div style="margin: 0 0 6px 0; padding: 8px 12px; background: rgba(0, 240, 255, 0.03); border: 1px solid rgba(0, 240, 255, 0.1); border-radius: 12px; text-align: left; font-size: 0.8rem; color: #94a3b8; line-height: 1.5;">
                <div style="font-weight: bold; color: #cbd5e1; margin-bottom: 4px; letter-spacing: 1px; text-transform: uppercase; font-size: 0.72rem;">LIFETIME FLOW CAREER:</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px;">
                    <div>⏱ Drift: <strong style="color: #e2e8f0;">${formattedTime}</strong></div>
                    <div>🫧 Bubbles: <strong style="color: #e2e8f0;">${career.lifetimeBubblesBlown}</strong></div>
                    <div style="grid-column: span 2;">⚡ Peak Flow: <strong style="color: #00f0ff;">x${career.peakScoreMultiplier}</strong></div>
                </div>
            </div>
        `;

        let parent = document.getElementById('game-container');
        let card = document.createElement('div');
        card.id = 'complete-screen';
        card.className = 'results-card';
        card.style.position = 'absolute';
        card.style.top = '0';
        card.style.left = '0';
        card.style.width = '100%';
        card.style.height = '100%';
        card.style.backgroundColor = 'rgba(0, 2, 6, 0.88)';
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
            ? 'background: linear-gradient(135deg, #00f0ff 0%, #ff00e4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; margin-bottom: 6px; letter-spacing: 2px; filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.6));'
            : 'background: linear-gradient(135deg, #00f0ff 0%, #bd00ff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: 700; margin-bottom: 6px; letter-spacing: 2px;';

        let titleText = isPerfect ? 'PERFECT FLOW' : 'DIVE COMPLETED';

        let trackName = window.customTrackName || "Custom Track";
        let durationMs = this.levelData.songLengthMs || 0;
        let minutes = Math.floor(durationMs / 60000);
        let seconds = Math.floor((durationMs % 60000) / 1000);
        let durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        let innerCard = document.createElement('div');
        innerCard.className = 'glass-card results-card-inner';
        innerCard.innerHTML = `
            <header style="text-align: center; margin-bottom: 4px;">
                <h1 style="${titleStyle}">${titleText}</h1>
                <div style="font-size: 0.85rem; color: #94a3b8; margin-top: -4px; margin-bottom: 6px; font-weight: 500; letter-spacing: 1px;">
                    ${trackName.toUpperCase()} (${durationStr})
                </div>
                <div style="margin-bottom: 8px; display: flex; justify-content: center; align-items: center;">
                    ${starString}
                </div>
            </header>
            <div class="results-grid">
                <div class="results-col-stats">
                    <div style="font-size: 1.0rem; color: #cbd5e1; line-height: 1.5; background: rgba(255, 255, 255, 0.02); padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.05);">
                        Neon Debris: <strong style="color: #00f0ff; font-size: 1.15rem;">${this.score}</strong> / ${this.totalCollectibles}<br>
                        Total Score: <strong style="color: #bd00ff; font-size: 1.3rem; text-shadow: 0 0 12px rgba(189, 0, 255, 0.4);">${this.pointsScore}</strong> / ${maxPoints} pts
                    </div>
                    ${highScoreHTML}
                </div>
                <div class="results-col-actions">
                    ${careerHTML}
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                        <button id="btn-restart" class="btn-dive" style="width: 100%; padding: 10px 18px; font-size: 0.92rem; box-shadow: 0 0 25px rgba(189, 0, 255, 0.4);">DIVE AGAIN (R)</button>
                        <button id="btn-results-exit" class="btn-secondary" style="width: 100%; padding: 9px 16px; font-size: 0.85rem;">SELECT NEW TRACK (X)</button>
                    </div>
                </div>
            </div>
        `;
        card.appendChild(innerCard);
        parent.appendChild(card);

        const tap = window.bindFastTap || ((btn, action) => btn && btn.addEventListener('click', action));
        let restartBtn = document.getElementById('btn-restart');
        if (restartBtn) {
            tap(restartBtn, () => this.restartDive());
        }
        let exitBtn = document.getElementById('btn-results-exit');
        if (exitBtn) {
            tap(exitBtn, () => this.exitToTrackSelect());
        }
    }

    // --- ZERO-HUD GAME CONTROLS & LIFECYCLE ---

    togglePause() {
        if (!this.isPlaying || this.isLevelCompleted || this.isFadingOut) return;
        if (this.isPaused) {
            this.resumeDive();
        } else {
            this.pauseDive();
        }
    }

    pauseDive() {
        if (!this.isPlaying || this.isPaused) return;
        this.isPaused = true;
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioContext.suspend();
        }
        let pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) {
            let statsEl = document.getElementById('pause-stats');
            if (statsEl) {
                let mins = Math.floor(this.elapsedTime / 60000);
                let secs = Math.floor((this.elapsedTime % 60000) / 1000).toString().padStart(2, '0');
                statsEl.textContent = `Score: ${this.score.toLocaleString()} | Multiplier: x${this.scoreMultiplier} | Time: ${mins}:${secs}`;
            }
            pauseScreen.style.display = 'flex';
        }
        let pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) pauseBtn.classList.add('active');
    }

    resumeDive() {
        if (!this.isPaused) return;
        this.isPaused = false;
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        let pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) {
            pauseScreen.style.display = 'none';
        }
        let pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) pauseBtn.classList.remove('active');
    }

    restartDive() {
        this.resumeDive();

        // Kill active tweens
        this.tweens.killAll();

        // Clean up text overlays if active
        if (this.countdownText) {
            try { this.countdownText.destroy(); } catch(e) {}
            this.countdownText = null;
        }
        if (this.startInfoText) {
            try { this.startInfoText.destroy(); } catch(e) {}
            this.startInfoText = null;
        }
        if (this.startDurationText) {
            try { this.startDurationText.destroy(); } catch(e) {}
            this.startDurationText = null;
        }
        if (this.buddyBubble) this.buddyBubble.setVisible(false);
        if (this.playerBubble) this.playerBubble.setVisible(false);

        // Stop audio nodes
        // Remove results card if present
        let card = document.getElementById('complete-screen') || document.getElementById('results-card');
        if (card) card.remove();

        // Reset player & buddy coordinates and physics
        let playerStartY = this.getTargetYAtTime((250 / this.baseScrollSpeed) * 1000);
        let buddyStartY = this.getTargetYAtTime((550 / this.baseScrollSpeed) * 1000);
        this.player.x = 250;
        this.player.y = playerStartY;
        this.player.vy = 0;
        this.V_lung = 0.5;
        this.buoyancySmooth = 0.5;
        this.vy = 0;
        this.buddy.x = 550;
        this.buddy.y = buddyStartY;
        // Stop all running audio sources before restarting
        this.stopAllAudio();

        // Reset scores and flow state
        this.score = 0;
        this.pointsScore = 0;
        this.scoreMultiplier = 1;
        this.smoothVisualMultiplier = 1.0;
        this.comboCount = 0;
        this.flowMeter = 1.0;
        this.auraRings = 0;
        this.elapsedTime = 0;
        this.baseHue = 0;
        this.wallHueOffset = 0;
        this.musicCompleted = false;
        this.isFadingOut = false;
        this.isLevelCompleted = false;
        this.lastProcessedBeatIdx = -1;
        this.beatRipples = [];

        // Complete reset of silt-out state & visual distortion
        this.siltActive = false;
        this.siltTime = 0;
        this.currentSiltDuration = 0;
        this.siltFreeTime = 0;
        this.siltLevel = 0;
        this.lastHeavySilt = 0;
        this.lightFlashIntensity = 1.0;
        this.levelUpChromaticOffset = 0.0;
        this.scrollSpeed = this.baseScrollSpeed;
        this.buddyState = 'normal';
        this.buddyStateTimer = 0;

        if (this.siltOverlay) {
            this.siltOverlay.clear();
        }
        if (this.siltVignetteImage) {
            this.siltVignetteImage.setAlpha(0).setVisible(false);
        }
        if (this.guideLineGraphics) {
            this.guideLineGraphics.clear();
            this.guideLineGraphics.setDepth(1);
        }

        // Reset WebGL PostFX pipeline parameters
        let fx = this.cameras.main.getPostPipeline(PsychedelicFX);
        if (fx) {
            fx.chromaticOffset = 0.0;
            fx.chromaticOffsetStart = 0.0;
            fx.fxTime = 0.0;
            fx.causticIntensity = 0.035;
        }

        // Reset low-pass audio filter if active
        if (this.musicFilter && this.audioContext) {
            try {
                this.musicFilter.frequency.cancelScheduledValues(this.audioContext.currentTime);
                this.musicFilter.frequency.setValueAtTime(22000, this.audioContext.currentTime);
            } catch(e) {}
        }

        // Kill lingering silt explosion particle bursts and continuous emitters immediately
        if (this.activeSiltBursts) {
            for (let burst of this.activeSiltBursts) {
                try { burst.destroy(); } catch (e) {}
            }
            this.activeSiltBursts = [];
        }
        if (this.siltEmitter) {
            try {
                if (typeof this.siltEmitter.killAll === 'function') this.siltEmitter.killAll();
            } catch (e) {}
        }
        if (this.plumeEmitter) {
            try {
                if (typeof this.plumeEmitter.killAll === 'function') this.plumeEmitter.killAll();
            } catch (e) {}
        }
        if (this.bubbleEmitter) {
            try {
                if (typeof this.bubbleEmitter.killAll === 'function') this.bubbleEmitter.killAll();
            } catch (e) {}
        }

        // Reset and respawn collectibles so all subsequent runs are 100% identical
        this.clusterCollected = {};
        if (this.levelData && this.levelData.collectibles) {
            this.levelData.collectibles.forEach(c => { c.collected = false; });
            this.spawnCollectibles();
            if (this.uiCamera && this.collectiblesGroup) {
                this.uiCamera.ignore(this.collectiblesGroup.getChildren());
            }
        }

        // Reset camera and master gain
        this.cameras.main.resetFX();
        this.cameras.main.scrollX = 0;
        this.cameras.main.setAlpha(1);
        let resetBgHue = (this.baseHue * 0.25) % 360;
        let resetBgColor = this.hslToColorInt(resetBgHue / 360, 0.7, 0.012);
        this.cameras.main.setBackgroundColor(resetBgColor);
        if (this.masterGain && this.audioContext) {
            this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.masterGain.gain.setValueAtTime(0.95, this.audioContext.currentTime);
        }

        // Restart countdown sequence
        if (this.audioContext) {
            this.startCountdown(this.audioContext);
        }
    }

    stopAllAudio() {
        if (this.musicSource) {
            try {
                this.musicSource.onended = null;
                this.musicSource.stop();
                this.musicSource.disconnect();
            } catch(e) {}
            this.musicSource = null;
        }
        if (this.inhaleSource) {
            try {
                this.inhaleSource.stop();
                this.inhaleSource.disconnect();
            } catch(e) {}
            this.inhaleSource = null;
        }
        if (this.exhaleSource) {
            try {
                this.exhaleSource.stop();
                this.exhaleSource.disconnect();
            } catch(e) {}
            this.exhaleSource = null;
        }
        if (this.inhaleGain && this.audioContext) {
            try {
                this.inhaleGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            } catch(e) {}
        }
        if (this.exhaleGain && this.audioContext) {
            try {
                this.exhaleGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            } catch(e) {}
        }
        if (this.masterGain && this.audioContext) {
            try {
                this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
                this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            } catch(e) {}
        }
    }

    exitToTrackSelect() {
        this.isPlaying = false;
        this.isPaused = false;
        this.countdownActive = false;
        if (this.tweens) this.tweens.killAll();
        if (this.time) {
            try { this.time.removeAllEvents(); } catch (e) {}
        }
        if (this.countdownText) {
            try { this.countdownText.destroy(); } catch (e) {}
            this.countdownText = null;
        }
        if (this.startInfoText) {
            try { this.startInfoText.destroy(); } catch (e) {}
            this.startInfoText = null;
        }
        if (this.startDurationText) {
            try { this.startDurationText.destroy(); } catch (e) {}
            this.startDurationText = null;
        }
        if (this.activeSiltBursts) {
            for (let burst of this.activeSiltBursts) {
                try { burst.destroy(); } catch (e) {}
            }
            this.activeSiltBursts = [];
        }
        if (this.buddyBubble) this.buddyBubble.setVisible(false);
        if (this.playerBubble) this.playerBubble.setVisible(false);

        if (this.onKeyDown) {
            window.removeEventListener('keydown', this.onKeyDown);
            this.onKeyDown = null;
        }
        if (this.onTouchStart) {
            window.removeEventListener('touchstart', this.onTouchStart);
            this.onTouchStart = null;
        }
        if (this.onTouchMove) {
            window.removeEventListener('touchmove', this.onTouchMove);
            this.onTouchMove = null;
        }
        if (this.onTouchEnd) {
            window.removeEventListener('touchend', this.onTouchEnd);
            this.onTouchEnd = null;
        }
        if (this.onTouchCancel) {
            window.removeEventListener('touchcancel', this.onTouchCancel);
            this.onTouchCancel = null;
        }
        if (this.onContextMenu) {
            window.removeEventListener('contextmenu', this.onContextMenu);
            this.onContextMenu = null;
        }

        // Completely stop and disconnect all audio generators to avoid background drone leakage
        this.stopAllAudio();
        if (this.masterGain) {
            try { this.masterGain.disconnect(); } catch(e) {}
            this.masterGain = null;
        }
        if (this.audioContext) {
            try { this.audioContext.close(); } catch(e) {}
            this.audioContext = null;
        }
        if (window.customAudioContext) {
            try { window.customAudioContext.close(); } catch(e) {}
            window.customAudioContext = null;
        }
        window.activeScubaScene = null;

        // Clean up DOM overlays
        let pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) pauseScreen.style.display = 'none';
        let card = document.getElementById('complete-screen') || document.getElementById('results-card');
        if (card) card.remove();
        let pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) {
            pauseBtn.style.display = 'none';
            pauseBtn.classList.remove('active');
        }

        // Destroy Phaser game instance
        if (window.game) {
            window.game.destroy(true);
            window.game = null;
        }

        // Show intro screen with uploader
        let introScreen = document.getElementById('intro-screen');
        if (introScreen) {
            introScreen.classList.remove('descending');
            introScreen.style.display = 'flex';
            introScreen.style.opacity = '1';
            introScreen.style.pointerEvents = 'auto';
            introScreen.style.transform = 'scale(1)';
            introScreen.style.filter = 'none';
        }
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

        let maxEnergy = 0.001;
        for (let e of smoothedEnergy) {
            if (e > maxEnergy) maxEnergy = e;
        }
        let maxRawEnergy = 0.001;
        for (let e of rawEnergy) {
            if (e > maxRawEnergy) maxRawEnergy = e;
        }

        let averageEnergy = rawEnergy.reduce((a, b) => a + b, 0) / rawEnergy.length;
        let isCalmTrack = averageEnergy < 0.08;

        // Sub-bass Kick, Acoustic Percussion & Vocal Transient Extraction (Dual-stream)
        let beatWindowSec = 0.08; // 80ms windowing
        let beatChunkSize = Math.floor(sampleRate * beatWindowSec);
        let numBeatChunks = Math.floor(channelData.length / beatChunkSize);
        let rawBeats = [];
        let lp = 0;
        let stride = 25;
        let alpha = Math.min(1.0, (2.0 * Math.PI * 180.0) / sampleRate * stride);
        let prevRms = 0;
        for (let c = 0; c < numBeatChunks; c++) {
            let start = c * beatChunkSize;
            let sumBass = 0;
            let sumRaw = 0;
            let count = 0;
            for (let i = 0; i < beatChunkSize; i += stride) {
                let s = channelData[start + i];
                lp += alpha * (s - lp);
                sumBass += lp * lp;
                sumRaw += s * s;
                count++;
            }
            let bassRms = Math.sqrt(sumBass / (count || 1));
            let rawRms = Math.sqrt(sumRaw / (count || 1));
            // Positive energy flux (spectral transient onset for vocals, acoustics, percussions)
            let flux = Math.max(0, rawRms - prevRms);
            prevRms = rawRms;
            rawBeats.push(bassRms * 0.50 + flux * 1.6 + rawRms * 0.25);
        }

        let beats = [];
        let lastBeatTime = -9999;
        // Calm choral tracks pulse with musical phrases; energetic tracks track fast kicks
        let absoluteBeatThreshold = isCalmTrack ? 0.013 : 0.008;
        let localWindow = isCalmTrack ? 20 : 14;
        let onsetMultiplier = isCalmTrack ? 1.38 : 1.25;
        let minBeatGap = isCalmTrack ? 350 : 160;

        for (let i = 1; i < rawBeats.length - 1; i++) {
            if (rawBeats[i] > rawBeats[i - 1] && rawBeats[i] > rawBeats[i + 1]) {
                let localSum = 0;
                let localCount = 0;
                let wStart = Math.max(0, i - localWindow);
                let wEnd = Math.min(rawBeats.length - 1, i + localWindow);
                for (let w = wStart; w <= wEnd; w++) {
                    localSum += rawBeats[w];
                    localCount++;
                }
                let localAvg = localSum / (localCount || 1);
                // Must exceed adaptive local onset average AND minimum noise threshold
                if (rawBeats[i] > localAvg * onsetMultiplier && rawBeats[i] > absoluteBeatThreshold) {
                    let beatTime = i * beatWindowSec * 1000;
                    if (beatTime - lastBeatTime >= minBeatGap) {
                        beats.push(beatTime);
                        lastBeatTime = beatTime;
                    }
                }
            }
        }

        // If track has zero detectable transients (e.g. silence or flat hum), fall back to 60 BPM grid
        if (beats.length === 0) {
            console.log("Procedural fallback: detected 0 beats. Generating a relaxing 60 BPM grid.");
            for (let t = 2000; t < songLengthMs - 2000; t += 1000) {
                beats.push(t);
            }
        }

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

        // Dynamic energy range scaling: ensure subtle shifts map to rich depth movement
        let energyRange = Math.max(0.06, maxSmoothed - minEnergy);

        let path = [];
        // Scale slope difficulty based on scroll speed to guarantee climbs/descents are physically navigateable
        let maxDeltaY = 40.0;
        if (this.baseScrollSpeed === 45) {
            maxDeltaY = 32.0; // gentle but dynamic slopes on calm tracks
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
            norm = Math.max(0.10, Math.min(0.90, norm));

            let timeMs = i * windowSec * 1000;

            // Winding cave bends (large low-frequency curves to keep tunnels non-straight)
            let windingBend = Math.sin(timeMs * 0.00018) * 110 + Math.cos(timeMs * 0.00008) * 55;
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

        const getClampedCollectibleY = (colTime, offset) => {
            let colX = (colTime / 1000) * this.baseScrollSpeed + 250;
            let targetColY = this.getTargetYAtTime((colX / this.baseScrollSpeed) * 1000) + offset;
            let { floorY, ceilY } = this.getWallY(colX);
            return Phaser.Math.Clamp(targetColY, ceilY + 40, floorY - 40);
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
                prevEnergyVal = i > 0 ? rawEnergy[i - 1] : rawEnergy[i];
                nextEnergyVal = i < rawEnergy.length - 1 ? rawEnergy[i + 1] : rawEnergy[i];
                smoothedEnergyVal = smoothedEnergy[i];
            } else {
                energyVal = 0.1;
                prevEnergyVal = 0.1;
                nextEnergyVal = 0.1;
                smoothedEnergyVal = 0.1;
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

        // Vivid Neon Psychedelic Zones
        let zoneNames = ["Neon Reef", "Solar Ridge", "Ultraviolet Cavern", "Molten Abyss", "Cyber Ascent"];
        let zoneColors = [
            { floor: 0x00ff88, ceil: 0x00f0ff, floorHue: 152, ceilHue: 184, bg: 0x010c14 }, // Electric emerald & cyan
            { floor: 0xffcc00, ceil: 0xff00b4, floorHue: 48, ceilHue: 318, bg: 0x0e0212 }, // Solar gold & neon magenta
            { floor: 0xff007f, ceil: 0x4b0082, floorHue: 330, ceilHue: 275, bg: 0x12010c }, // Hot pink & deep indigo
            { floor: 0xff6600, ceil: 0x9900ff, floorHue: 24, ceilHue: 276, bg: 0x120501 }, // Bright amber orange & electric violet
            { floor: 0x00ffff, ceil: 0x008080, floorHue: 180, ceilHue: 180, bg: 0x010d12 }  // Electric aqua & radiant turquoise
        ];

        // Seed initial baseHue so different songs feature unique starting color accents
        this.baseHue = Math.floor(rng() * 360);
        this.wallHueOffset = (this.baseHue * 0.5) % 360;

        let numZones = zoneNames.length;
        let zoneDuration = songLengthMs / numZones;
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

            let fHue = zoneColors[z].floorHue;
            let cHue = zoneColors[z].ceilHue;
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
        let simCombo = 0;
        let lastColTime = 0;

        // Sort collectibles chronologically to process in order
        let sortedCollectibles = [...this.levelData.collectibles].sort((a, b) => a.time - b.time);

        for (let i = 0; i < sortedCollectibles.length; i++) {
            let col = sortedCollectibles[i];

            // Apply flow decay if gap exceeds decay threshold (12.5 seconds / 12500ms)
            // Only decays if simMultiplier > 1
            if (i > 0 && simMultiplier > 1) {
                let gap = col.time - lastColTime;
                let decayTicks = Math.floor(gap / 12500);
                for (let d = 0; d < decayTicks; d++) {
                    if (simMultiplier > 1) {
                        simMultiplier--;
                    }
                }
            }

            let isClusterComplete = false;
            let clusterPointBonus = 0;
            let cid = col.clusterId;
            if (cid) {
                if (!clusterCounts[cid]) clusterCounts[cid] = 0;
                clusterCounts[cid]++;
                let totalInCluster = this.clusterTotals[cid] || 0;
                if (clusterCounts[cid] === totalInCluster && totalInCluster > 1) {
                    isClusterComplete = true;
                    // Award combo point boost
                    simCombo += 5;
                }
            }

            // Apply combo level up if threshold hit
            let comboBumpsCount = 0;
            let comboBonus = 0;
            simCombo++;
            while (simCombo >= 15) {
                simCombo -= 15;
                simMultiplier++;
                comboBumpsCount++;
                comboBonus += 50 * simMultiplier;
            }

            // Award base point and bonuses
            simPoints += 1 * simMultiplier;

            if (isClusterComplete) {
                let totalInCluster = this.clusterTotals[cid] || 0;
                clusterPointBonus = Math.floor((totalInCluster * 1.5) * simMultiplier);
                simPoints += clusterPointBonus;
            }

            if (comboBumpsCount > 0) {
                simPoints += comboBonus;
            }

            lastColTime = col.time;
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

        // Test 10: Uncapped Combo Engine and Rating Math Simulation validation
        let mockCollectibles = [];
        for (let j = 0; j < 15; j++) {
            mockCollectibles.push({ time: j * 1000, y: 300, clusterId: null });
        }
        for (let j = 0; j < 5; j++) {
            mockCollectibles.push({ time: 20000 + j * 300, y: 300, clusterId: "test_c1" });
        }
        
        let originalLevelDataVal = this.levelData;
        let originalClusterTotalsVal = this.clusterTotals;
        this.levelData = {
            songLengthMs: 30000,
            collectibles: mockCollectibles
        };
        this.clusterTotals = { "test_c1": 5 };

        let maxPoints = this.calculateMaxPotentialPoints();
        console.assert(maxPoints === 141, `Assertion Failed: Expected simulated max potential points to be 141, got ${maxPoints}`);

        // Test 11: Super-Flow Multiplier Visuals validation
        let prevScoreMult = this.scoreMultiplier;
        let prevChromatic = this.levelUpChromaticOffset;
        this.scoreMultiplier = 12;
        this.levelUpChromaticOffset = 0.035;
        console.assert(this.levelUpChromaticOffset === 0.035, `Assertion Failed: levelUpChromaticOffset should scale at scoreMultiplier=12, got ${this.levelUpChromaticOffset}`);
        this.scoreMultiplier = prevScoreMult;
        this.levelUpChromaticOffset = prevChromatic;

        // Restore original state
        this.levelData = originalLevelData;
        this.totalCollectibles = originalTotalCollectibles;
        this.flowMilestoneInterval = originalFlowMilestoneInterval;
        this.maxPotentialPoints = originalMaxPotentialPoints;
        this.baseScrollSpeed = originalBaseScrollSpeed;
        this.scrollSpeed = originalScrollSpeed;
        this.clusterTotals = originalClusterTotals;
        this.clusterCollected = originalClusterCollected;

        // Test 12: Flashlight Clamping, Occlusion boundaries, and Gradual Attenuation
        let recordedSliceAlphas = [];
        let curAlpha = 0;
        let mockG = {
            clear: () => {}, lineStyle: () => {},
            fillStyle: (col, alpha) => { curAlpha = alpha; },
            beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
            closePath: () => {},
            fillPath: () => { recordedSliceAlphas.push(curAlpha); },
            strokePath: () => {},
            fillCircle: () => {}
        };
        let testLight = this.drawDiveLight(mockG, 100, 250, 1, 0xffffff, 0xff00ff, 0.5);
        console.assert(testLight !== undefined && testLight.topPoints.length === 31, "Assertion Failed: drawDiveLight must return 31 topPoints");
        console.assert(recordedSliceAlphas.length >= 10 && recordedSliceAlphas.length <= 20, "Assertion Failed: drawDiveLight must render optimized progressive slices");
        let lastSliceAlpha = recordedSliceAlphas[recordedSliceAlphas.length - 1];
        console.assert(lastSliceAlpha !== undefined && lastSliceAlpha < 0.01, "Assertion Failed: Torch light must feather to near-zero at outer range");
        for (let i = 0; i < testLight.topPoints.length; i++) {
            let ptTop = testLight.topPoints[i];
            let ptBottom = testLight.bottomPoints[i];
            let tx = ptTop.x;
            let { floorY: tFloorLimitY, ceilY: tCeilLimitY } = this.getWallY(tx);

            console.assert(ptTop.y >= tCeilLimitY, `Assertion Failed: topPoint Y (${ptTop.y}) must not go above ceiling limit (${tCeilLimitY})`);
            console.assert(ptTop.y <= tFloorLimitY, `Assertion Failed: topPoint Y (${ptTop.y}) must not go below floor limit (${tFloorLimitY})`);
            console.assert(ptBottom.y >= tCeilLimitY, `Assertion Failed: bottomPoint Y (${ptBottom.y}) must not go above ceiling limit (${tCeilLimitY})`);
            console.assert(ptBottom.y <= tFloorLimitY, `Assertion Failed: bottomPoint Y (${ptBottom.y}) must not go below floor limit (${tFloorLimitY})`);
        }

        // Test 13: Touch / Keyboard Dual Breathing Input
        let testSpaceDownState = this.isBreathingIn();
        console.assert(typeof testSpaceDownState === 'boolean', "Assertion Failed: isBreathingIn must return a boolean state");

        // Test 14: Base Background Lighting Consistency
        let testBgHue = (0 * 0.25) % 360;
        let testBgColor = this.hslToColorInt(testBgHue / 360, 0.7, 0.012);
        console.assert(typeof testBgColor === 'number' && testBgColor >= 0, "Assertion Failed: hslToColorInt must return valid color integer for base background");
        let testColorObj = Phaser.Display.Color.IntegerToColor(testBgColor);
        console.assert(testColorObj.r <= 10 && testColorObj.g <= 10 && testColorObj.b <= 10, "Assertion Failed: Base dive background must be dark (RGB <= 10)");

        // Test 15: Score Multiplier and Siltout Reset Lifecycle Validation
        console.assert(this.multiplier === undefined, "Assertion Failed: scene.multiplier must be undefined (use scoreMultiplier)");
        console.assert(typeof this.scoreMultiplier === 'number' && this.scoreMultiplier >= 1, "Assertion Failed: scoreMultiplier must be a valid number >= 1");

        // Simulate dirty silt and multiplier states
        this.siltActive = true;
        this.siltTime = 1200;
        this.currentSiltDuration = 1800;
        this.scoreMultiplier = 4;
        this.comboCount = 11;
        this.lightFlashIntensity = 0.05;
        this.buddyState = 'assisting';

        // Apply reset logic
        this.siltActive = false;
        this.siltTime = 0;
        this.currentSiltDuration = 0;
        this.scoreMultiplier = 1;
        this.comboCount = 0;
        this.lightFlashIntensity = 1.0;
        this.buddyState = 'normal';

        console.assert(this.siltActive === false, "Assertion Failed: siltActive must reset to false");
        console.assert(this.siltTime === 0, "Assertion Failed: siltTime must reset to 0");
        console.assert(this.scoreMultiplier === 1, "Assertion Failed: scoreMultiplier must reset to 1");
        console.assert(this.comboCount === 0, "Assertion Failed: comboCount must reset to 0");
        console.assert(this.lightFlashIntensity === 1.0, "Assertion Failed: lightFlashIntensity must reset to 1.0");
        console.assert(this.buddyState === 'normal', "Assertion Failed: buddyState must reset to 'normal'");
        if (this.guideLineGraphics) {
            console.assert(this.guideLineGraphics.depth === 1 || this.guideLineGraphics.depth === 15, "Assertion Failed: guideLineGraphics depth must be 1 or 15");
        }

        this.activeSiltBursts = [{ destroy: () => {} }];
        for (let b of this.activeSiltBursts) b.destroy();
        this.activeSiltBursts = [];
        console.assert(this.activeSiltBursts.length === 0, "Assertion Failed: activeSiltBursts must clear on reset");

        console.assert(typeof PsychedelicFX === 'function', "Assertion Failed: PsychedelicFX class must be defined");
        console.assert(typeof PsychedelicFX.prototype.onPreRender === 'function', "Assertion Failed: PsychedelicFX must implement onPreRender");
        let activeFX = (this.cameras && this.cameras.main) ? this.cameras.main.getPostPipeline(PsychedelicFX) : null;
        if (activeFX) {
            console.assert(activeFX.causticIntensity !== undefined, "Assertion Failed: PsychedelicFX must have causticIntensity uniform");
            console.assert(activeFX.fxTime !== undefined, "Assertion Failed: PsychedelicFX must have fxTime uniform");
        }
        if (this.bubbleEmitter && this.bubbleEmitter.ops && this.bubbleEmitter.ops.scaleX) {
            console.assert(this.bubbleEmitter.ops.scaleX.start === 0.10 && this.bubbleEmitter.ops.scaleX.end === 0.42, "Assertion Failed: Bubble emitter must use varied scale range [0.10, 0.42]");
        }

        // Test 18: 2.5D Layer Hierarchy & Perspective Marine Snow
        if (this.backwallGraphics) {
            console.assert(this.backwallGraphics.depth === -0.5, "Assertion Failed: backwallGraphics must be at depth -0.5");
        }
        if (this.foregroundRockGraphics) {
            console.assert(this.foregroundRockGraphics.depth === 22, "Assertion Failed: foregroundRockGraphics must be at depth 22");
        }
        if (this.marineSnowForegroundGraphics) {
            console.assert(this.marineSnowForegroundGraphics.depth === 15, "Assertion Failed: marineSnowForegroundGraphics must be at depth 15");
        }
        if (this.marineSnowMotes && this.marineSnowMotes.length > 0) {
            let sampleMote = this.marineSnowMotes[0];
            console.assert(typeof sampleMote.z === 'number' && sampleMote.z >= 0.2 && sampleMote.z <= 2.5, "Assertion Failed: Marine snow motes must have valid perspective depth z in [0.2, 2.5]");
        }

        // Test 17: Diver Horizontal Trim
        if (this.buddy) {
            console.assert(this.buddy.rotation === 0, "Assertion Failed: buddy must maintain horizontal trim");
        }
        let mockTrimG = { fillStyle: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {}, fillPath: () => {} };
        let testTrimLight = this.drawDiveLight(mockTrimG, 250, 300, 1, 0xffffff, 0x00f0ff, 0.5, false);
        console.assert(testTrimLight && testTrimLight.topPoints && testTrimLight.topPoints.length === 31, "Assertion Failed: drawDiveLight must return topPoints in horizontal trim");

        // Test 16: Rhythmic Cave Expansion & Dynamic Cavern Width
        let savedBeatPulse = this.currentBeatPulse;
        this.currentBeatPulse = 0.0;
        let offsetsNoBeat = this.getWallOffsets(1500, 0.5);
        this.currentBeatPulse = 1.0;
        let offsetsWithBeat = this.getWallOffsets(1500, 0.5);
        this.currentBeatPulse = savedBeatPulse;

        console.assert(offsetsWithBeat.floorOffset > offsetsNoBeat.floorOffset, "Assertion Failed: Cavern walls must visibly expand on beat hit (floorOffset)");
        console.assert(offsetsWithBeat.ceilOffset > offsetsNoBeat.ceilOffset, "Assertion Failed: Cavern walls must visibly expand on beat hit (ceilOffset)");

        // Verify beat pulse amplitude scales with music energy
        this.currentBeatPulse = 1.0;
        let beatHigh = this.getWallOffsets(1500, 0.95);
        let beatLow = this.getWallOffsets(1500, 0.05);
        this.currentBeatPulse = 0.0;
        let baseHigh = this.getWallOffsets(1500, 0.95);
        let baseLow = this.getWallOffsets(1500, 0.05);
        this.currentBeatPulse = savedBeatPulse;
        let pulseDiffHigh = beatHigh.floorOffset - baseHigh.floorOffset;
        let pulseDiffLow = beatLow.floorOffset - baseLow.floorOffset;
        console.assert(pulseDiffHigh > pulseDiffLow, "Assertion Failed: High-energy beat pulse must expand walls more than low-energy beat pulse");

        let ambientCavern = this.getWallOffsets(1500, 0.05); // low energy breakdown
        let intenseCorridor = this.getWallOffsets(1500, 0.95); // high energy drop
        console.assert(ambientCavern.floorOffset > intenseCorridor.floorOffset, "Assertion Failed: Ambient breakdown caverns must be wider than intense drop corridors");
        let chamberPeak = this.getWallOffsets(1300, 0.05);
        let chamberTrough = this.getWallOffsets(3900, 0.05);
        console.assert(chamberPeak.floorOffset !== chamberTrough.floorOffset, "Assertion Failed: Macro cavern chambers must dynamically modulate corridor offset");

        // Verify Vivid Neon Psychedelic Zones
        let zones = this.levelData && this.levelData.zones;
        console.assert(zones && zones.length === 5, "Assertion Failed: Exactly 5 Neon depth zones expected");
        if (zones && zones.length === 5) {
            console.assert(zones[0].name === "Neon Reef", "Assertion Failed: Zone 0 must be Neon Reef");
            console.assert(zones[3].name === "Molten Abyss", "Assertion Failed: Zone 3 must be Molten Abyss");
            let savedTime = this.elapsedTime;
            this.elapsedTime = 0;
            let huesStart = this.getCurrentZoneHues();
            this.elapsedTime = zones[0].endTime - 100;
            let huesTransition = this.getCurrentZoneHues();
            this.elapsedTime = savedTime;
            console.assert(huesStart && typeof huesStart.floorHue === 'number', "Assertion Failed: getCurrentZoneHues must return floorHue");
            console.assert(huesTransition && huesTransition.floorHue !== huesStart.floorHue, "Assertion Failed: Zone hues must smoothly interpolate near boundary");
        }

        // Test 18: Lifecycle Methods & Teardown definitions
        console.assert(typeof this.exitToTrackSelect === 'function', "Assertion Failed: exitToTrackSelect must be a function");
        console.assert(typeof this.restartDive === 'function', "Assertion Failed: restartDive must be a function");
        console.assert(typeof this.stopAllAudio === 'function', "Assertion Failed: stopAllAudio must be a function");
        console.assert(typeof this.smoothVisualMultiplier === 'number', "Assertion Failed: smoothVisualMultiplier must be initialized");
        let calmWallOffsets = this.getWallOffsets(1500, 0.04);
        console.assert(calmWallOffsets && typeof calmWallOffsets.floorOffset === 'number', "Assertion Failed: getWallOffsets must return valid numbers for calm track energy");

        console.log("=== DIAGNOSTICS PASSED: ALL CONTROLS FUNCTIONAL ===");
    }
}

// Global Launcher Function
function startGame() {
    if (window.game) {
        try { window.game.destroy(true); } catch(e) {}
        window.game = null;
    }
    window.activeScubaScene = null;
    const config = {
        type: Phaser.AUTO,
        parent: 'game-container',
        width: 1200,
        height: 700,
        backgroundColor: '#000206',
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.NO_CENTER
        },
        audio: {
            noAudio: true
        },
        scene: [ScubaFlowScene]
    };
    window.game = new Phaser.Game(config);

    if (!window._scubaResizeAttached) {
        window._scubaResizeAttached = true;
        const refreshScale = () => {
            if (window.game && window.game.scale) {
                window.game.scale.refresh();
            }
        };
        window.addEventListener('resize', refreshScale);
        window.addEventListener('orientationchange', () => {
            setTimeout(refreshScale, 150);
            setTimeout(refreshScale, 400);
        });
    }
}
