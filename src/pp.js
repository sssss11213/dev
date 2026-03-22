/**
 * ps1Background.js
 * PS1-style procedural skybox with gradient sky and star field.
 * Sets scene.backgroundNode — call initPS1Background(scene) once after scene creation.
 */

import {
  mix,
  float,
  vec2,
  vec3,
  color,
  floor,
  fract,
  sin,
  dot,
  step,
  length,
  atan,
  smoothstep,
  Fn,
  normalWorld,
} from 'three/tsl';

/**
 * Builds the PS1-style background node and applies it to the given scene.
 *
 * @param {THREE.Scene} scene - The Three.js scene to apply the background to.
 * @returns {ShaderNodeObject} The background node (in case you need to reference it).
 */
export function initPS1Background(scene) {
  const ps1Background = Fn(() => {
    // Flip Y coordinate for correct orientation
    const flippedY = normalWorld.y.negate();
    const skyUV = flippedY.mul(0.5).add(0.5);

    // Gradient sky: dark blue at top → purple mid → warm orange/brown at horizon
    const topColor     = color(0x000033); // dark blue night sky
    const midColor     = color(0x330066); // purple
    const horizonColor = color(0x663322); // warm orange/brown horizon

    const skyGradient = mix(
      horizonColor,
      mix(midColor, topColor, skyUV.smoothstep(0.4, 0.9)),
      skyUV.smoothstep(0.0, 0.4)
    );

    // PS1-style stars using spherical coordinates
    const longitude = atan(normalWorld.x, normalWorld.z);
    const latitude  = flippedY.asin();

    const starScale = float(50.0);
    const starUV    = vec2(longitude.mul(starScale), latitude.mul(starScale));
    const starCell  = floor(starUV);

    // Hash for per-cell randomness
    const cellHash = fract(
      sin(dot(starCell, vec2(12.9898, 78.233))).mul(43758.5453)
    );

    // Position within cell (0–1)
    const cellUV    = fract(starUV);
    const toCenter  = cellUV.sub(0.5);
    const distToCenter = length(toCenter);

    // Bright core
    const core = smoothstep(float(0.08), float(0.0), distToCenter);

    // Soft glow
    const glow = smoothstep(float(0.25), float(0.0), distToCenter).mul(0.4);

    // Cross/diamond flare
    const crossX = smoothstep(float(0.15), float(0.0), toCenter.x.abs())
      .mul(smoothstep(float(0.4), float(0.0), toCenter.y.abs()));
    const crossY = smoothstep(float(0.15), float(0.0), toCenter.y.abs())
      .mul(smoothstep(float(0.4), float(0.0), toCenter.x.abs()));
    const cross = crossX.add(crossY).mul(0.3);

    const starShape = core.add(glow).add(cross);

    // Only show cells above the threshold (controls star density)
    const isStar = step(0.85, cellHash);

    // Fade stars in above horizon
    const aboveHorizon = smoothstep(float(-0.2), float(0.1), flippedY);

    // Star intensity: density × horizon fade × shape × brightness variation
    const starIntensity = isStar
      .mul(aboveHorizon)
      .mul(starShape)
      .mul(cellHash.mul(0.6).add(0.4));

    // Slight colour variation: white → light blue
    const starColor = mix(
      vec3(1.0, 1.0, 0.95),
      vec3(0.8, 0.9, 1.0),
      cellHash
    );

    const finalColor = mix(skyGradient, starColor, starIntensity.clamp(0.0, 1.0));
    return finalColor;
  })();

  scene.backgroundNode = ps1Background;
  return ps1Background;
}
