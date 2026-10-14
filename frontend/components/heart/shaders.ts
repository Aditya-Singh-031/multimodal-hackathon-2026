/**
 * Shader patches:
 *  - Myocardium: MeshStandardMaterial + onBeforeCompile injecting (a) territory-localized perfusion warning glow
 *    (distance-to-vessel-polyline falloff, pulsed with the heartbeat) and (b) an X-ray mode with Fresnel rim light
 *    and reduced opacity so the coronary tree shows through.
 *  - Coronary tubes: lightweight ShaderMaterial with animated flow pulses whose speed tracks estimated flow,
 *    and dimmed downstream perfusion past a critical lesion.
 */
import * as THREE from "three";
import { GLOW_SAMPLES } from "./anatomy";

export const VESSEL_SLOTS = 4;

export interface SharedPerfusionUniforms {
  [k: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uBeat: THREE.IUniform<number>;
  uXray: THREE.IUniform<number>;
  uPts: THREE.IUniform<THREE.Vector3[]>;
  uGlow: THREE.IUniform<THREE.Vector4[]>;
  uRadius: THREE.IUniform<number>;
}

export function createPerfusionUniforms(): SharedPerfusionUniforms {
  return {
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uXray: { value: 0 },
    uPts: { value: Array.from({ length: VESSEL_SLOTS * GLOW_SAMPLES }, () => new THREE.Vector3(99, 99, 99)) },
    uGlow: { value: Array.from({ length: VESSEL_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uRadius: { value: 0.26 },
  };
}

const SEGS = GLOW_SAMPLES - 1;

const FRAG_HEADER = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uXray;
uniform vec3 uPts[${VESSEL_SLOTS * GLOW_SAMPLES}];
uniform vec4 uGlow[${VESSEL_SLOTS}];
uniform float uRadius;
varying vec3 vNormPos;

float cfSegDist(vec3 p, vec3 a, vec3 b) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

vec3 cfPerfusionDeficit(out float maxStrength) {
  vec3 deficitAcc = vec3(0.0);
  maxStrength = 0.0;
  for (int v = 0; v < ${VESSEL_SLOTS}; v++) {
    vec4 g = uGlow[v];
    if (g.a <= 0.001) continue;
    float d = 1e3;
    for (int i = 0; i < ${SEGS}; i++) {
      d = min(d, cfSegDist(vNormPos, uPts[v * ${GLOW_SAMPLES} + i], uPts[v * ${GLOW_SAMPLES} + i + 1]));
    }
    // Perfusion territory coverage around the coronary tree
    float s = exp(-pow(d / uRadius, 2.0)) * g.a;
    if (s <= 0.001) continue;
    
    // Hypoxic pulse: sluggish, out-of-phase ischemic rhythm
    float hypoxicPulse = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 2.8 - d * 6.0 + float(v) * 1.57));
    
    // Dull dusky purple ischemic tissue coloration
    vec3 duskyPurple = g.rgb;
    deficitAcc += duskyPurple * s * hypoxicPulse;
    maxStrength = max(maxStrength, s);
  }
  return deficitAcc;
}
`;

/** Patch a (cloned) standard material in place. `toNorm` maps mesh-local → normalized heart frame. */
export function patchMyocardium(
  mat: THREE.MeshStandardMaterial,
  shared: SharedPerfusionUniforms,
  toNorm: THREE.Matrix4,
) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uToNorm: { value: toNorm } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 uToNorm;\nvarying vec3 vNormPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvNormPos = (uToNorm * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEADER}`)
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        float cfStrength;
        vec3 cfDeficit = cfPerfusionDeficit(cfStrength);
        float cfThrob = 0.4 + 0.6 * uBeat;
        totalEmissiveRadiance += cfDeficit * (1.8 + 1.2 * cfThrob);`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `#include <opaque_fragment>
        {
          // Anatomical myocardial territory ischemic discoloration: dull dusky purple
          vec3 ischemicTissue = vec3(0.24, 0.08, 0.36);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, ischemicTissue, clamp(cfStrength * 0.78, 0.0, 0.85));

          vec3 cfView = normalize(vViewPosition);
          float cfFres = pow(1.0 - abs(dot(normalize(normal), cfView)), 2.4);
          vec3 cfRim = vec3(0.42, 0.82, 1.0) * cfFres * 1.7;
          vec3 cfX = gl_FragColor.rgb * 0.16 + cfRim + cfDeficit * 2.2;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, cfX, uXray);
          gl_FragColor.a = mix(gl_FragColor.a, clamp(0.04 + cfFres * 0.7 + cfStrength * 0.6, 0.0, 1.0), uXray);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "cardiofusion-perfusion-v2";
  mat.needsUpdate = true;
}

export function createVesselMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color("#34d399") },
      uTime: { value: 0 },
      uSpeed: { value: 0.6 },
      uLesionU: { value: 2 },
      uDownstream: { value: 1 },
      uSelected: { value: 0 },
      uXray: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime, uSpeed, uLesionU, uDownstream, uSelected, uXray;
      varying vec2 vUv;
      void main() {
        float x = vUv.x;
        float hasLesion = step(uLesionU, 1.5);
        float distToLesion = abs(x - uLesionU);
        
        // Continuous hemodynamic wave phase:
        // Normal upstream speed (phase slope ~ 6.0)
        // Decelerated downstream speed (phase slope ~ 14.0 = slower travel)
        // High-velocity acceleration through the lesion pinch (jet effect)
        float trans = smoothstep(-0.04, 0.04, x - uLesionU);
        float basePhase = mix(6.0 * x, 6.0 * uLesionU + 14.0 * (x - uLesionU), trans);
        float pinchJet = 0.35 * exp(-pow(distToLesion / 0.045, 2.0));
        float phase = mix(x * 6.0, basePhase - pinchJet, hasLesion);
        
        float flow = fract(phase - uTime * uSpeed);
        float pulse = smoothstep(0.0, 0.12, flow) * (1.0 - smoothstep(0.12, 0.44, flow));
        
        // Downstream post-stenotic perfusion dimming
        float down = mix(1.0, uDownstream, trans);
        
        // Golden/amber plaque calcification marker glow at constriction
        float plaqueGlow = hasLesion * (1.0 - smoothstep(0.0, 0.035, distToLesion));
        
        vec3 c = uColor * (0.42 + 1.15 * pulse) * down;
        c += vec3(0.98, 0.72, 0.18) * plaqueGlow * 0.95; // golden amber plaque cuff highlight
        c += uColor * uSelected * 0.45;
        
        float a = mix(0.92, 1.0, uXray);
        gl_FragColor = vec4(c, a);
      }`,
  });
}
