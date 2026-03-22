/**
 * render.js
 * WebGPU renderer + retro post-processing pipeline.
 *
 * Exports:
 *   scene       - THREE.Scene
 *   renderer    - THREE.WebGPURenderer
 *   renderPipeline - THREE.RenderPipeline (call renderPipeline.render() in your loop)
 *   retroUniforms  - live-tweakable uniform values for the retro effects
 */

import * as THREE from 'three/webgpu';
import {
  pass,
  uniform,
  posterize,
  screenSize,
  replaceDefaultUV,
} from 'three/tsl';

import { retroPass }     from 'three/examples/jsm/tsl/display/RetroPassNode.js';
import { bayerDither }   from 'three/examples/jsm/tsl/math/Bayer.js';
import { scanlines, vignette, colorBleeding, barrelUV } from 'three/examples/jsm/tsl/display/CRT.js';
import { circle }        from 'three/examples/jsm/tsl/display/Shape.js';


// ─── Scene ───────────────────────────────────────────────────────────────────

export const scene = new THREE.Scene();

// ─── Renderer ────────────────────────────────────────────────────────────────

export const renderer = new THREE.WebGPURenderer({
  antialias: true,
  alpha: true,
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

document.body.appendChild(renderer.domElement);

// ─── Retro uniforms (tweak at runtime via retroUniforms.xxx.value = n) ───────

export const retroUniforms = {
  colorDepthSteps:  uniform(32),       // PS1 15-bit: 32 levels per channel
  scanlineIntensity: uniform(0.3),
  scanlineDensity:  uniform(1),        // 1 = full screen resolution
  scanlineSpeed:    uniform(0.0),      // 0 = static scanlines
  vignetteIntensity: uniform(0.3),
  bleeding:         uniform(0.001),
  curvature:        uniform(0.02),
  affineDistortion: uniform(0),
};

// ─── Pipeline ─────────────────────────────────────────────────────────────────
// NOTE: camera is passed in via initRenderPipeline() because it may not exist
// at module evaluation time. Call this once after your camera is ready.

export let renderPipeline = null;
export let retroPass_node = null; // exposed so you can call retroPass_node.dispose() on env change

/**
 * Call once after camera is created.
 * @param {THREE.PerspectiveCamera} camera
 */
export function initRenderPipeline(camera) {
  const {
    colorDepthSteps,
    scanlineIntensity,
    scanlineDensity,
    scanlineSpeed,
    vignetteIntensity,
    bleeding,
    curvature,
    affineDistortion,
  } = retroUniforms;

  const distortedUV    = barrelUV(curvature);
  const distortedDelta = circle(curvature.add(0.1).mul(10), 1).mul(curvature).mul(0.05);

  const retro = retroPass(scene, camera, { affineDistortion });
  retroPass_node = retro;

  let pipeline = retro;
  pipeline = replaceDefaultUV(distortedUV, pipeline);
  pipeline = colorBleeding(pipeline, bleeding.add(distortedDelta));
  pipeline = bayerDither(pipeline, colorDepthSteps);
  pipeline = posterize(pipeline, colorDepthSteps);
  pipeline = vignette(pipeline, vignetteIntensity, 0.6);
  pipeline = scanlines(pipeline, scanlineIntensity, screenSize.y.mul(scanlineDensity), scanlineSpeed);

  renderPipeline = new THREE.RenderPipeline(renderer);
  renderPipeline.outputNode = pipeline;

  return renderPipeline;
}


//for hud 2d scene
export const hudScene = new THREE.Scene();
export const hudCamera = new THREE.OrthographicCamera(
    0, 1920,   // left, right  — fixed 1920px wide always
    1080, 0,   // top, bottom  — fixed 1080px tall always
    0, 10
);


// ─── Resize ───────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});
