"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ArrowLeft,
  CheckCircle2,
  Heart,
  Moon,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";

// ============================================================================
// 1. MATHEMATICAL HILL HEIGHT PROFILE
// ============================================================================
export function getHillElevation(x: number, z: number): number {
  // Gentle rolling crest on right (x ~ 6 to 9) and soft valley on left
  const wave1 = Math.sin(x * 0.14) * 1.45;
  const wave2 = Math.cos(z * 0.16) * 1.15;
  const crest = Math.exp(-Math.pow((x - 7.5) * 0.25, 2) - Math.pow((z + 2.5) * 0.25, 2)) * 1.35;
  const bowl = -0.012 * (x * x + z * z);
  return wave1 + wave2 + crest + bowl - 1.2;
}

// ============================================================================
// 2. ZERO-DEPENDENCY WEB AUDIO API SYNTHESIZER
// ============================================================================
class SanctuaryAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private lfoGain: GainNode | null = null;
  private lfoOsc: OscillatorNode | null = null;
  private chimeInterval: ReturnType<typeof setInterval> | null = null;
  public isMuted = false;
  public isNight = false;

  private init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();

    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // Filtered Breeze (Continuous Wind Sound)
    // 3-second noise buffer
    const bufferSize = this.ctx.sampleRate * 3;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    // Pink noise integration for gentle breeze
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }

    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;

    // Resonant lowpass filter for gentle rolling wind gusts
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.setValueAtTime(260, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(2.2, this.ctx.currentTime);

    // LFO to oscillate wind filter cutoff frequency (breathing cadence)
    this.lfoOsc = this.ctx.createOscillator();
    this.lfoOsc.type = "sine";
    this.lfoOsc.frequency.setValueAtTime(0.22, this.ctx.currentTime); // ~4.5s cycle

    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.setValueAtTime(140, this.ctx.currentTime);

    this.lfoOsc.connect(this.lfoGain);
    this.lfoGain.connect(this.windFilter.frequency);

    this.noiseSource.connect(this.windFilter);
    this.windFilter.connect(this.masterGain);

    this.noiseSource.start();
    this.lfoOsc.start();

    // Night crickets / meditative chime scheduler
    this.chimeInterval = setInterval(() => {
      if (this.isNight && !this.isMuted) {
        this.playSoftNightPing();
      }
    }, 2400);
  }

  private playSoftNightPing() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Pentatonic scale frequencies for soothing harmonic resonance
    const pitches = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5, E5, G5, C6, E6
    const freq = pitches[Math.floor(Math.random() * pitches.length)];

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);

    // Soft chime envelope
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 1.9);
  }

  public playBreakCompleteBowl() {
    this.init();
    if (!this.ctx || !this.masterGain) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    const now = this.ctx.currentTime;
    // Harmonic singing bowl triad: 432 Hz, 648 Hz, 864 Hz
    [432, 648, 864].forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.09 / (idx + 1), now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 4.0);
    });
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    this.updateGain();
  }

  public setNightMode(night: boolean) {
    this.isNight = night;
    if (this.windFilter && this.ctx) {
      // At night wind becomes deeper and softer
      const targetFreq = night ? 180 : 280;
      this.windFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 1.2);
    }
  }

  public start() {
    this.init();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    this.updateGain();
  }

  private updateGain() {
    if (!this.ctx || !this.masterGain) return;
    const target = this.isMuted ? 0.0001 : 0.28;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }

  public destroy() {
    if (this.chimeInterval) clearInterval(this.chimeInterval);
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        // cleanup ignore
      }
      this.ctx = null;
    }
  }
}

// Shared Cursor State in 3D
interface SanctuaryCursorContext {
  pos: THREE.Vector3;
  active: boolean;
  movedNonce: number;
}

// ============================================================================
// 3. 3D MEADOW SCENE COMPONENTS
// ============================================================================

/** Custom shaders for instanced grass blades with wind sway + cursor repulsion bending */
const grassVertexShader = `
  uniform float uTime;
  uniform vec3 uCursorPos;
  uniform float uCursorActive;
  uniform float uNightLerp;

  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vHeight;
  varying vec3 vWorldPos;

  void main() {
    vColor = aColor;
    float h = clamp(position.y, 0.0, 1.5);
    vHeight = h;

    // Transform blade base root position into world space
    vec4 worldOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 localPos = vec4(position, 1.0);
    vec4 worldPos = instanceMatrix * localPos;

    // 1. Natural Wind Sway (undulating waves rolling across meadow)
    float windWave = sin(uTime * 2.4 + worldOrigin.x * 0.42 + worldOrigin.z * 0.32) * 0.24;
    float gust = sin(uTime * 4.6 + worldOrigin.x * 0.85) * 0.09;
    float totalSway = (windWave + gust) * (h * h);

    // 2. Interactive Cursor Repulsion (parts and sweeps blades away from cursor)
    vec2 bladeXZ = worldOrigin.xz;
    vec2 cursorXZ = uCursorPos.xz;
    float d = distance(bladeXZ, cursorXZ);
    float repelRadius = 2.4;

    vec2 repelDir = vec2(0.0);
    float repelAmount = 0.0;
    if (d < repelRadius && uCursorActive > 0.05) {
      repelDir = normalize(bladeXZ - cursorXZ + vec2(0.001, 0.001));
      float falloff = 1.0 - smoothstep(0.0, repelRadius, d);
      repelAmount = falloff * 0.95 * (h * h) * uCursorActive;
    }

    worldPos.x += totalSway * 0.65 + repelDir.x * repelAmount;
    worldPos.z += totalSway * 0.38 + repelDir.y * repelAmount;
    // Blade tip lowers toward ground when physically pressed/bent
    worldPos.y -= (abs(totalSway) * 0.12 + repelAmount * 0.4);

    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const grassFragmentShader = `
  uniform float uNightLerp;
  varying vec3 vColor;
  varying float vHeight;
  varying vec3 vWorldPos;

  void main() {
    // Day gradient: deep meadow root to sunlit lime tip
    vec3 dayRoot = vColor * 0.48;
    vec3 dayTip = vColor * 1.25;
    vec3 dayCol = mix(dayRoot, dayTip, clamp(vHeight, 0.0, 1.0));

    // Dusk golden-coral warmth
    vec3 duskCol = mix(dayCol * vec3(1.15, 0.82, 0.65), vec3(0.85, 0.45, 0.3), 0.28);

    // Deep moonlit night palette (cool midnight cyan-emerald sheen)
    vec3 nightRoot = vec3(0.04, 0.12, 0.08);
    vec3 nightTip = vec3(0.12, 0.38, 0.26);
    vec3 nightCol = mix(nightRoot, nightTip, clamp(vHeight, 0.0, 1.0));

    vec3 finalCol;
    if (uNightLerp < 0.45) {
      finalCol = mix(dayCol, duskCol, uNightLerp / 0.45);
    } else {
      finalCol = mix(duskCol, nightCol, (uNightLerp - 0.45) / 0.55);
    }

    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

/** Rolling Curved Grass Hill Mesh */
function MeadowHill({
  cursorRef,
  onPointerMoveHill,
}: {
  cursorRef: React.MutableRefObject<SanctuaryCursorContext>;
  onPointerMoveHill: (pt: THREE.Vector3) => void;
}) {
  const { geometry } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(54, 46, 72, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getHillElevation(x, z));
    }
    geo.computeVertexNormals();
    return { geometry: geo };
  }, []);

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      onPointerMove={(e) => {
        e.stopPropagation();
        onPointerMoveHill(e.point);
      }}
    >
      <meshStandardMaterial
        color="#22642a"
        roughness={0.92}
        metalness={0.02}
      />
    </mesh>
  );
}

/** Instanced Grass Blades (10,000 blades with custom sway + touch repulsion) */
function InstancedGrass({
  cursorRef,
  nightLerp,
}: {
  cursorRef: React.MutableRefObject<SanctuaryCursorContext>;
  nightLerp: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const COUNT = 11000;

  const { bladeGeo, material, colorsArray } = useMemo(() => {
    // Single tapered blade ribbon (base 0.11, mid 0.08, tip 0.01, height 0.95)
    const geo = new THREE.PlaneGeometry(0.12, 0.95, 1, 4);
    geo.translate(0, 0.475, 0); // anchor at root

    const mat = new THREE.ShaderMaterial({
      vertexShader: grassVertexShader,
      fragmentShader: grassFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uCursorPos: { value: new THREE.Vector3(999, 999, 999) },
        uCursorActive: { value: 0 },
        uNightLerp: { value: 0 },
      },
      side: THREE.DoubleSide,
    });

    const colors = new Float32Array(COUNT * 3);
    const palette = [
      new THREE.Color("#4ade80"), // Emerald vibrant
      new THREE.Color("#22c55e"), // Spring grass
      new THREE.Color("#16a34a"), // Deep meadow
      new THREE.Color("#86efac"), // Sunlit lime
      new THREE.Color("#65a30d"), // Warm olive green
    ];

    for (let i = 0; i < COUNT; i++) {
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(colors, 3));
    return { bladeGeo: geo, material: mat, colorsArray: colors };
  }, [COUNT]);

  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < COUNT; i++) {
      // Distribution concentrated in active visual area
      const x = (Math.random() - 0.5) * 36;
      const z = (Math.random() - 0.5) * 28 + 2;
      const y = getHillElevation(x, z);

      dummy.position.set(x, y, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.rotation.x = (Math.random() - 0.5) * 0.2;
      dummy.rotation.z = (Math.random() - 0.5) * 0.2;

      const scaleY = 0.75 + Math.random() * 0.6;
      const scaleXZ = 0.85 + Math.random() * 0.35;
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [COUNT]);

  useFrame((state) => {
    if (!material) return;
    material.uniforms.uTime.value = state.clock.getElapsedTime();
    material.uniforms.uCursorPos.value.lerp(cursorRef.current.pos, 0.28);
    material.uniforms.uCursorActive.value = cursorRef.current.active ? 1.0 : 0.0;
    material.uniforms.uNightLerp.value = nightLerp;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[bladeGeo, material, COUNT]}
      frustumCulled={false}
    />
  );
}

/** Scattered Colorful Wildflowers (Yellow, Pink, White, Lavender florets) */
function Wildflowers() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const COUNT = 480;

  const { flowerGeo, flowerMat } = useMemo(() => {
    // Cute stylized 5-petal floret
    const geo = new THREE.CylinderGeometry(0.12, 0.16, 0.08, 6);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.05,
    });
    return { flowerGeo: geo, flowerMat: mat };
  }, []);

  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    const colors = [
      new THREE.Color("#facc15"), // Yellow buttercup
      new THREE.Color("#f472b6"), // Pink primrose
      new THREE.Color("#ffffff"), // White chamomile
      new THREE.Color("#c084fc"), // Lavender violet
    ];

    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() - 0.5) * 32;
      const z = (Math.random() - 0.5) * 24 + 1.5;
      const y = getHillElevation(x, z) + 0.35 + Math.random() * 0.2;

      dummy.position.set(x, y, z);
      dummy.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.rotation.z = Math.random() * Math.PI;

      const s = 0.7 + Math.random() * 0.7;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, colors[i % colors.length]);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [COUNT]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[flowerGeo, flowerMat, COUNT]}
      frustumCulled={false}
    />
  );
}

/** Stylized 3D Lone Oak Tree (Trunk + Clustered Foliage Spheres) */
function LoneOakTree({ nightLerp }: { nightLerp: number }) {
  const treeX = 7.8;
  const treeZ = -2.8;
  const treeY = getHillElevation(treeX, treeZ);

  const foliageColor = useMemo(() => {
    const day = new THREE.Color("#15803d");
    const dusk = new THREE.Color("#78350f");
    const night = new THREE.Color("#0d2e1b");
    if (nightLerp < 0.45) {
      return day.clone().lerp(dusk, nightLerp / 0.45);
    }
    return dusk.clone().lerp(night, (nightLerp - 0.45) / 0.55);
  }, [nightLerp]);

  return (
    <group position={[treeX, treeY, treeZ]}>
      {/* Twisted Trunk */}
      <mesh position={[0, 2.0, 0]} castShadow>
        <cylinderGeometry args={[0.38, 0.72, 4.2, 10]} />
        <meshStandardMaterial color="#452a1a" roughness={0.9} />
      </mesh>
      {/* Organic Branches */}
      <mesh position={[-0.6, 3.2, 0.2]} rotation={[0.4, 0.2, 0.6]}>
        <cylinderGeometry args={[0.22, 0.35, 2.2, 8]} />
        <meshStandardMaterial color="#452a1a" roughness={0.9} />
      </mesh>
      <mesh position={[0.7, 3.4, -0.3]} rotation={[-0.3, -0.2, -0.5]}>
        <cylinderGeometry args={[0.2, 0.32, 2.4, 8]} />
        <meshStandardMaterial color="#452a1a" roughness={0.9} />
      </mesh>

      {/* Clustered Foliage Spheres */}
      <group position={[0, 4.4, 0]}>
        <mesh position={[0, 0.6, 0]}>
          <sphereGeometry args={[1.75, 16, 16]} />
          <meshStandardMaterial color={foliageColor} roughness={0.8} />
        </mesh>
        <mesh position={[-1.2, 0.2, 0.5]}>
          <sphereGeometry args={[1.35, 14, 14]} />
          <meshStandardMaterial color={foliageColor} roughness={0.8} />
        </mesh>
        <mesh position={[1.3, 0.4, -0.4]}>
          <sphereGeometry args={[1.4, 14, 14]} />
          <meshStandardMaterial color={foliageColor} roughness={0.8} />
        </mesh>
        <mesh position={[0.4, 1.3, 0.7]}>
          <sphereGeometry args={[1.2, 14, 14]} />
          <meshStandardMaterial color={foliageColor} roughness={0.8} />
        </mesh>
        <mesh position={[-0.5, 1.2, -0.8]}>
          <sphereGeometry args={[1.25, 14, 14]} />
          <meshStandardMaterial color={foliageColor} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

/** Drifting Volumetric Cloud Puffs */
function DriftingClouds({ nightLerp }: { nightLerp: number }) {
  const cloudsRef = useRef<THREE.Group>(null);

  const cloudColor = useMemo(() => {
    const day = new THREE.Color("#ffffff");
    const dusk = new THREE.Color("#fbcfe8");
    const night = new THREE.Color("#1e293b");
    if (nightLerp < 0.45) return day.clone().lerp(dusk, nightLerp / 0.45);
    return dusk.clone().lerp(night, (nightLerp - 0.45) / 0.55);
  }, [nightLerp]);

  const clouds = useMemo(() => {
    return [
      { x: -18, y: 11, z: -18, scale: 1.4, speed: 0.25 },
      { x: -4, y: 13, z: -24, scale: 1.8, speed: 0.18 },
      { x: 12, y: 10, z: -16, scale: 1.2, speed: 0.22 },
      { x: 26, y: 12, z: -22, scale: 1.5, speed: 0.2 },
    ];
  }, []);

  useFrame((_, delta) => {
    if (!cloudsRef.current) return;
    cloudsRef.current.children.forEach((child, idx) => {
      child.position.x += clouds[idx].speed * delta * 2.5;
      if (child.position.x > 36) {
        child.position.x = -36;
      }
    });
  });

  return (
    <group ref={cloudsRef}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={[c.scale, c.scale * 0.65, c.scale]}>
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[2.0, 12, 12]} />
            <meshStandardMaterial color={cloudColor} transparent opacity={0.7} roughness={0.9} />
          </mesh>
          <mesh position={[-1.4, -0.3, 0.2]}>
            <sphereGeometry args={[1.4, 10, 10]} />
            <meshStandardMaterial color={cloudColor} transparent opacity={0.65} roughness={0.9} />
          </mesh>
          <mesh position={[1.4, -0.2, -0.2]}>
            <sphereGeometry args={[1.5, 10, 10]} />
            <meshStandardMaterial color={cloudColor} transparent opacity={0.65} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Night Fireflies: awaken & swirl upward specifically from grass blades hovered over by user cursor */
function NightFireflies({
  cursorRef,
  nightLerp,
}: {
  cursorRef: React.MutableRefObject<SanctuaryCursorContext>;
  nightLerp: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const COUNT = 110;

  // Particle state arrays
  const state = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const vels = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);
    const active = new Uint8Array(COUNT);

    const gold = new THREE.Color("#fde047");
    const lime = new THREE.Color("#bef264");

    for (let i = 0; i < COUNT; i++) {
      // 35 ambient background fireflies, the rest interactive cursor spawns
      const isAmbient = i < 35;
      const x = (Math.random() - 0.5) * 30;
      const z = (Math.random() - 0.5) * 22;
      const y = getHillElevation(x, z) + 0.4 + Math.random() * 2.5;

      pos[i * 3 + 0] = x;
      pos[i * 3 + 1] = isAmbient ? y : -999;
      pos[i * 3 + 2] = z;

      vels[i * 3 + 0] = (Math.random() - 0.5) * 0.15;
      vels[i * 3 + 1] = 0.25 + Math.random() * 0.45;
      vels[i * 3 + 2] = (Math.random() - 0.5) * 0.15;

      life[i] = isAmbient ? Math.random() : 0;
      active[i] = isAmbient ? 1 : 0;

      const c = Math.random() > 0.5 ? gold : lime;
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    return { pos, colors, vels, life, active, nextSpawnIdx: 35 };
  }, [COUNT]);

  const lastSpawnTime = useRef(0);

  useFrame((clockState, delta) => {
    if (!pointsRef.current || nightLerp < 0.15) {
      if (pointsRef.current) pointsRef.current.visible = false;
      return;
    }
    pointsRef.current.visible = true;

    const t = clockState.clock.getElapsedTime();
    const cur = cursorRef.current;

    // Interactive Hover Spawn: when user sweeps pointer across grass, awaken firefly at cursor
    if (cur.active && cur.pos.y > -50 && t - lastSpawnTime.current > 0.055) {
      lastSpawnTime.current = t;
      const idx = state.nextSpawnIdx;
      state.nextSpawnIdx = 35 + ((state.nextSpawnIdx - 35 + 1) % (COUNT - 35));

      state.pos[idx * 3 + 0] = cur.pos.x + (Math.random() - 0.5) * 0.6;
      state.pos[idx * 3 + 1] = cur.pos.y + 0.15;
      state.pos[idx * 3 + 2] = cur.pos.z + (Math.random() - 0.5) * 0.6;

      state.vels[idx * 3 + 0] = (Math.random() - 0.5) * 0.3;
      state.vels[idx * 3 + 1] = 0.45 + Math.random() * 0.5;
      state.vels[idx * 3 + 2] = (Math.random() - 0.5) * 0.3;

      state.life[idx] = 1.0;
      state.active[idx] = 1;
    }

    // Update all active fireflies
    for (let i = 0; i < COUNT; i++) {
      if (state.active[i] === 0) continue;

      // Swirling sine spiral motion
      state.pos[i * 3 + 0] += state.vels[i * 3 + 0] * delta + Math.sin(t * 3.0 + i) * 0.015;
      state.pos[i * 3 + 1] += state.vels[i * 3 + 1] * delta;
      state.pos[i * 3 + 2] += state.vels[i * 3 + 2] * delta + Math.cos(t * 3.0 + i) * 0.015;

      if (i < 35) {
        // Ambient fireflies loop smoothly
        state.life[i] = (Math.sin(t * 2.0 + i) + 1) * 0.5;
        const groundY = getHillElevation(state.pos[i * 3 + 0], state.pos[i * 3 + 2]);
        if (state.pos[i * 3 + 1] > groundY + 3.8) {
          state.pos[i * 3 + 1] = groundY + 0.3;
        }
      } else {
        // Cursor-spawned fireflies fade upward
        state.life[i] -= delta * 0.38;
        if (state.life[i] <= 0) {
          state.active[i] = 0;
          state.pos[i * 3 + 1] = -999;
        }
      }
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[state.pos, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[state.colors, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.28}
        vertexColors
        transparent
        opacity={Math.min(1.0, nightLerp * 1.35)}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/** Starfield for Night Sky */
function NightStarfield({ nightLerp }: { nightLerp: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const COUNT = 650;

  const [positions, colors] = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.75 + 0.15); // upper dome
      const r = 50 + Math.random() * 10;
      pos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) + 2;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const bright = 0.65 + Math.random() * 0.35;
      col[i * 3 + 0] = bright;
      col[i * 3 + 1] = bright;
      col[i * 3 + 2] = 1.0;
    }
    return [pos, col];
  }, [COUNT]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const opacity = Math.max(0, (nightLerp - 0.25) / 0.75);
    (pointsRef.current.material as THREE.PointsMaterial).opacity = opacity;
    pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.005;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.35} vertexColors transparent opacity={0} depthWrite={false} />
    </points>
  );
}

/** Glowing Moon with Soft Halo */
function GlowingMoon({ nightLerp }: { nightLerp: number }) {
  const opacity = Math.max(0, (nightLerp - 0.3) / 0.7);

  return (
    <group position={[-14, 21, -30]}>
      {/* Moon Core */}
      <mesh>
        <sphereGeometry args={[2.4, 24, 24]} />
        <meshBasicMaterial color="#f8fafc" transparent opacity={opacity} />
      </mesh>
      {/* Soft Luminous Outer Halo */}
      <mesh>
        <sphereGeometry args={[3.8, 20, 20]} />
        <meshBasicMaterial
          color="#93c5fd"
          transparent
          opacity={opacity * 0.25}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/** Sky Dome & Lighting Interpolation (Morning -> Dusk -> Night) */
function SkyEnvironment({ nightLerp }: { nightLerp: number }) {
  const { scene } = useThree();

  useEffect(() => {
    // 3-point color interpolation: Morning -> Dusk -> Deep Night
    const mTop = new THREE.Color("#38bdf8"); // bright azure morning
    const mBot = new THREE.Color("#bae6fd"); // light morning horizon

    const dTop = new THREE.Color("#c084fc"); // dusk purple
    const dBot = new THREE.Color("#fb923c"); // dusk sunset orange

    const nTop = new THREE.Color("#090d16"); // deep moonlit night
    const nBot = new THREE.Color("#1e1b4b"); // midnight violet

    let curTop: THREE.Color;
    let curBot: THREE.Color;

    if (nightLerp < 0.45) {
      const alpha = nightLerp / 0.45;
      curTop = mTop.clone().lerp(dTop, alpha);
      curBot = mBot.clone().lerp(dBot, alpha);
    } else {
      const alpha = (nightLerp - 0.45) / 0.55;
      curTop = dTop.clone().lerp(nTop, alpha);
      curBot = dBot.clone().lerp(nBot, alpha);
    }

    scene.background = curTop;
    scene.fog = new THREE.Fog(curBot, 18, 52);
  }, [nightLerp, scene]);

  // Lighting calculations
  const sunIntensity = Math.max(0.08, (1 - nightLerp) * 1.6);
  const moonIntensity = Math.max(0.05, nightLerp * 0.65);
  const ambientIntensity = THREE.MathUtils.lerp(0.85, 0.22, nightLerp);

  return (
    <>
      <ambientLight intensity={ambientIntensity} color={nightLerp > 0.5 ? "#93c5fd" : "#ffffff"} />
      {/* Golden Sun */}
      <directionalLight
        position={[14, 18 - nightLerp * 12, 10]}
        intensity={sunIntensity}
        color={nightLerp > 0.25 ? "#f97316" : "#fef08a"}
        castShadow
      />
      {/* Cool Moonlight */}
      <directionalLight
        position={[-14, 20, -18]}
        intensity={moonIntensity}
        color="#bfdbfe"
      />
      <GlowingMoon nightLerp={nightLerp} />
      <NightStarfield nightLerp={nightLerp} />
    </>
  );
}

// ============================================================================
// 4. MAIN TOUCH GRASS SANCTUARY OVERLAY EXPORT
// ============================================================================
export interface TouchGrassSanctuaryProps {
  open: boolean;
  onClose: () => void;
  onApplyVagalCalm?: () => void;
}

export default function TouchGrassSanctuary({
  open,
  onClose,
  onApplyVagalCalm,
}: TouchGrassSanctuaryProps) {
  // Time Mode State: "morning" vs "night"
  const [timeMode, setTimeMode] = useState<"morning" | "night">("morning");
  const [nightLerp, setNightLerp] = useState(0); // 0 (morning) -> 1 (night)

  // Audio Engine State
  const audioRef = useRef<SanctuaryAudioEngine | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);

  // 1-Minute Break Mode State
  const [breakActive, setBreakActive] = useState(false);
  const [breakSecondsLeft, setBreakSecondsLeft] = useState(60);
  const [breakCompleted, setBreakCompleted] = useState(false);

  // Custom Floating Hand Cursor State
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 });
  const [handTilt, setHandTilt] = useState(0);
  const [isPointerHovering, setIsPointerHovering] = useState(false);
  const prevMouseX = useRef(0);

  // 3D Pointer Raycasting
  const cursor3DRef = useRef<SanctuaryCursorContext>({
    pos: new THREE.Vector3(999, 999, 999),
    active: false,
    movedNonce: 0,
  });

  // Initialize or teardown audio
  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.destroy();
        audioRef.current = null;
      }
      setBreakActive(false);
      setBreakCompleted(false);
      setBreakSecondsLeft(60);
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new SanctuaryAudioEngine();
    }
  }, [open]);

  // Audio mute & night mode sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setMute(!soundEnabled);
      audioRef.current.setNightMode(timeMode === "night");
    }
  }, [soundEnabled, timeMode]);

  // Break Countdown Timer
  useEffect(() => {
    if (!breakActive || breakSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      setBreakSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setBreakActive(false);
          setBreakCompleted(true);
          audioRef.current?.playBreakCompleteBowl();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [breakActive, breakSecondsLeft]);

  // Smooth ~1.8s interpolation for day/dusk/night
  useEffect(() => {
    if (!open) return;
    let animId: number;
    const target = timeMode === "night" ? 1.0 : 0.0;
    const step = () => {
      setNightLerp((prev) => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.005) return target;
        // ~1.8s transition at 60fps
        return prev + diff * 0.038;
      });
      animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [timeMode, open]);

  // Custom Cursor Tracker
  const handleMouseMoveWindow = useCallback((e: React.MouseEvent) => {
    const x = e.clientX;
    const y = e.clientY;
    const dx = x - prevMouseX.current;
    prevMouseX.current = x;

    setMousePos({ x, y });
    setHandTilt(THREE.MathUtils.clamp(dx * 0.7, -35, 35));

    // Check if hovering interactive buttons or links
    const target = e.target as HTMLElement | null;
    const isInteractive = Boolean(
      target?.closest("button, a, input, [role='button'], .cursor-pointer")
    );
    setIsPointerHovering(isInteractive);
  }, []);

  const handlePointerMoveHill = useCallback((pt: THREE.Vector3) => {
    cursor3DRef.current.pos.copy(pt);
    cursor3DRef.current.active = true;
    cursor3DRef.current.movedNonce++;
  }, []);

  const handleStartBreak = () => {
    setBreakSecondsLeft(60);
    setBreakActive(true);
    setBreakCompleted(false);
    if (!soundEnabled) {
      setSoundEnabled(true);
      audioRef.current?.start();
    }
  };

  const handleEndBreak = () => {
    setBreakActive(false);
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) audioRef.current?.start();
  };

  if (!open) return null;

  return (
    <div
      id="touch-grass-sanctuary"
      role="dialog"
      aria-modal="true"
      aria-label="Touch Grass Cardiac Stress-Reduction Sanctuary"
      className="fixed inset-0 z-50 overflow-hidden select-none cursor-none bg-slate-950 transition-opacity duration-500"
      onMouseMove={handleMouseMoveWindow}
      onMouseLeave={() => {
        cursor3DRef.current.active = false;
      }}
    >
      {/* =====================================================================
          1. THREE.JS 3D MEADOW CANVAS
          ===================================================================== */}
      <Canvas
        camera={{ position: [0, 4.2, 10.5], fov: 48, near: 0.1, far: 80 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        className="w-full h-full block"
      >
        <SkyEnvironment nightLerp={nightLerp} />
        <MeadowHill cursorRef={cursor3DRef} onPointerMoveHill={handlePointerMoveHill} />
        <InstancedGrass cursorRef={cursor3DRef} nightLerp={nightLerp} />
        <Wildflowers />
        <LoneOakTree nightLerp={nightLerp} />
        <DriftingClouds nightLerp={nightLerp} />
        <NightFireflies cursorRef={cursor3DRef} nightLerp={nightLerp} />
      </Canvas>

      {/* =====================================================================
          2. CUSTOM CARTOON-HAND SVG CURSOR OVERLAY
          ===================================================================== */}
      <div
        className="pointer-events-none fixed z-50 transition-transform duration-75 ease-out"
        style={{
          left: `${mousePos.x}px`,
          top: `${mousePos.y}px`,
          transform: `translate(-25%, -25%) rotate(${handTilt}deg)`,
        }}
      >
        {isPointerHovering ? (
          // Pointing finger hand for buttons
          <svg
            width="42"
            height="42"
            viewBox="0 0 48 48"
            fill="none"
            className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
          >
            <path
              d="M18 14V6a4 4 0 0 1 8 0v16h2a4 4 0 0 1 8 0v8a14 14 0 0 1-28 0v-8a4 4 0 0 1 8 0v-8"
              fill="#fde047"
              stroke="#854d0e"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <circle cx="22" cy="10" r="1.5" fill="#ca8a04" />
          </svg>
        ) : (
          // Brushing open cartoon hand for grass
          <svg
            width="52"
            height="52"
            viewBox="0 0 64 64"
            fill="none"
            className="drop-shadow-[0_6px_16px_rgba(0,0,0,0.5)]"
          >
            {/* Soft cartoon palm and 5 fingers sweeping through grass */}
            <path
              d="M24 18C24 15 26 13 29 13C32 13 34 15 34 18V28C34 28 35 21 38 21C41 21 43 23 43 26V31C43 31 45 25 48 25C51 25 53 27 53 30V40C53 50 44 58 32 58C21 58 14 50 14 41V35C14 32 16 30 19 30C21 30 23 31 24 33V18Z"
              fill="#fef08a"
              stroke="#a16207"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {/* Palm crease highlight */}
            <path
              d="M25 43C28 47 36 47 41 43"
              stroke="#ca8a04"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {/* Sparkle touch wake */}
            <circle cx="34" cy="18" r="2" fill="#ffffff" />
          </svg>
        )}
      </div>

      {/* =====================================================================
          3. TOP NAVIGATION & STATUS BAR
          ===================================================================== */}
      <div className="absolute top-0 left-0 right-0 p-5 flex items-center justify-between pointer-events-none z-40">
        {/* Top-Left: Back to CardioFusion Pill */}
        <button
          type="button"
          id="sanctuary-back-btn"
          onClick={onClose}
          className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/60 hover:bg-slate-900/85 text-white/90 hover:text-white border border-white/20 backdrop-blur-xl shadow-xl transition-all active:scale-95 text-xs font-semibold cursor-pointer"
        >
          <ArrowLeft size={14} />
          <span>Back to CardioFusion</span>
        </button>

        {/* Top-Center: Break Countdown Pill (Visible during break) */}
        {breakActive && (
          <div
            id="sanctuary-break-countdown"
            className="pointer-events-auto flex items-center gap-3 px-5 py-2 rounded-full bg-emerald-950/70 border border-emerald-400/40 text-emerald-200 backdrop-blur-xl shadow-2xl animate-fade-in"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold tracking-wide">
              🍃 Vagal Reset in Progress · {Math.floor(breakSecondsLeft / 60)}:
              {(breakSecondsLeft % 60).toString().padStart(2, "0")}
            </span>
            <button
              type="button"
              id="sanctuary-end-break-btn"
              onClick={handleEndBreak}
              className="ml-2 px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white/80 hover:text-white transition-all cursor-pointer"
            >
              end
            </button>
          </div>
        )}

        {/* Break Completed Notification */}
        {breakCompleted && !breakActive && (
          <div
            id="sanctuary-break-complete-badge"
            className="pointer-events-auto flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-500/25 border border-emerald-400/50 text-emerald-200 backdrop-blur-xl shadow-2xl text-xs font-bold animate-bounce"
          >
            <CheckCircle2 size={16} className="text-emerald-400" />
            <span>✓ 60s Vagal Calm Complete · Sympathetic Tone Lowered</span>
          </div>
        )}

        {/* Top-Right: Quick Action "Apply Calm to What-If (-8 mmHg BP)" */}
        <div className="flex items-center gap-3">
          {onApplyVagalCalm && (
            <button
              type="button"
              id="sanctuary-apply-calm-btn"
              onClick={() => {
                onApplyVagalCalm();
              }}
              className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-emerald-600/90 to-teal-600/90 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(16,185,129,0.35)] border border-emerald-300/40 backdrop-blur-xl transition-all active:scale-95 cursor-pointer"
            >
              <Heart size={14} className="text-rose-200 animate-pulse" />
              <span>Apply Calm to What-If (−8 mmHg BP)</span>
            </button>
          )}

          <button
            type="button"
            id="sanctuary-close-x-btn"
            onClick={onClose}
            className="pointer-events-auto p-2 rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white border border-white/15 backdrop-blur-lg transition-all cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* =====================================================================
          4. CENTER HERO TYPOGRAPHY (Hidden smoothly during active break)
          ===================================================================== */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center pointer-events-none transition-all duration-700 ease-out z-30 ${
          breakActive ? "opacity-0 scale-95 pointer-events-none" : "opacity-100 scale-100"
        }`}
      >
        <div className="text-center max-w-xl mx-auto px-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-semibold mb-4 backdrop-blur-md shadow-lg">
            <Sparkles size={13} className="text-emerald-400" />
            <span>Interactive 3D Meadow Sanctuary</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)] leading-tight mb-3">
            touch grass —
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-amber-200">
              without leaving your desk
            </span>
          </h2>

          <p className="text-xs sm:text-sm text-white/80 max-w-md mx-auto mb-6 leading-relaxed drop-shadow-md">
            60-second parasympathetic vagal reset · lowers sympathetic heart rate, relaxes arterial tone, and attenuates systolic BP.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              id="sanctuary-start-break-btn"
              onClick={handleStartBreak}
              className="pointer-events-auto flex items-center gap-2.5 px-6 py-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-extrabold text-sm shadow-[0_8px_30px_rgba(16,185,129,0.4)] border border-emerald-300/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <span>🍃</span>
              <span>try a break</span>
            </button>

            {onApplyVagalCalm && (
              <button
                type="button"
                id="sanctuary-hero-apply-btn"
                onClick={onApplyVagalCalm}
                className="pointer-events-auto flex items-center gap-2 px-5 py-3 rounded-full bg-slate-900/70 hover:bg-slate-900/90 text-white/90 hover:text-white font-semibold text-xs border border-white/20 backdrop-blur-xl shadow-lg transition-all active:scale-95 cursor-pointer"
              >
                <Zap size={14} className="text-amber-300" />
                <span>Simulate Calm (−8 mmHg)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* =====================================================================
          5. BOTTOM GLASSMORPHI PILL CONTROLLER
          ===================================================================== */}
      <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center pointer-events-none z-40">
        <div className="pointer-events-auto flex items-center gap-3 p-1.5 rounded-full bg-slate-900/70 border border-white/15 backdrop-blur-2xl shadow-[0_12px_36px_rgba(0,0,0,0.5)]">
          {/* Day / Night Switcher */}
          <div className="flex items-center bg-black/40 rounded-full p-1 border border-white/5">
            <button
              type="button"
              id="sanctuary-mode-morning-btn"
              onClick={() => setTimeMode("morning")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                timeMode === "morning"
                  ? "bg-gradient-to-r from-sky-400 to-blue-500 text-white shadow-md"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Sun size={13} className="text-amber-200" />
              <span>☀️ Morning</span>
            </button>
            <button
              type="button"
              id="sanctuary-mode-night-btn"
              onClick={() => setTimeMode("night")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                timeMode === "night"
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Moon size={13} className="text-amber-200" />
              <span>🌙 Night</span>
            </button>
          </div>

          <div className="w-[1px] h-5 bg-white/10" />

          {/* Web Audio Ambient Breeze & Crickets Toggle */}
          <button
            type="button"
            id="sanctuary-audio-toggle-btn"
            onClick={handleToggleSound}
            aria-label={soundEnabled ? "Mute Ambient Meadow Audio" : "Play Ambient Meadow Audio"}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all border cursor-pointer ${
              soundEnabled
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40 shadow-inner"
                : "bg-white/5 text-white/60 hover:text-white border-white/10"
            }`}
          >
            {soundEnabled ? (
              <>
                <Volume2 size={14} className="text-emerald-400 animate-pulse" />
                <span>Audio On</span>
              </>
            ) : (
              <>
                <VolumeX size={14} />
                <span>Audio Muted</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
