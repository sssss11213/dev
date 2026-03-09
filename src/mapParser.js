/**
 * mapParser.js
 * Quake .map parser — Quake 1 standard and Valve 220 formats.
 * Converts brushes to Three.js geometry and Rapier trimesh colliders.
 *
 * Usage:
 *   import { loadMap } from './mapParser.js';
 *   import { scene } from './src/render';
 *   import world from './src/physics';
 *
 *   await loadMap(mapSource, { scene, world });
 */

import * as THREE from 'three';
import world, { RAPIER } from '/src/physics';
import { scene } from '/src/render';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Quake units → metres. 32 qu = 1 m is the standard Quake scale. */
const QUAKE_SCALE = 1 / 8;

/** Tolerance for half-space membership and vertex deduplication. */
const EPSILON = 0.01;

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tokenizes raw .map source text.
 * Handles:
 *   - Line comments (//)
 *   - Quoted strings ("value")
 *   - Punctuation: { } ( ) [ ]
 *   - Numeric / identifier tokens
 *
 * @param {string} src - Raw .map file contents.
 * @returns {{ type: string, val: string }[]}
 */
function tokenize(src) {
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Line comment
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    // Quoted string
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      tokens.push({ type: 'str', val: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // Single-character punctuation (brackets included for Valve 220)
    if ('{}()[]'.includes(ch)) {
      tokens.push({ type: 'punct', val: ch });
      i++;
      continue;
    }

    // Number / identifier (stop at whitespace, quotes, brackets, slash)
    let j = i;
    while (j < src.length && !/[\s"{}()\[\]\/]/.test(src[j])) j++;
    if (j > i) {
      tokens.push({ type: 'tok', val: src.slice(i, j) });
      i = j;
    } else {
      i++; // skip unrecognised character
    }
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

class MapParser {
  /** @param {{ type: string, val: string }[]} tokens */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }

  expect(val) {
    const t = this.next();
    if (!t || t.val !== val) {
      throw new Error(`MapParser: expected '${val}', got '${t?.val}' at token ${this.pos}`);
    }
    return t;
  }

  /** Read one numeric token. */
  num() { return parseFloat(this.next().val); }

  /** Read three consecutive numeric tokens as [x, y, z]. */
  vec3() { return [this.num(), this.num(), this.num()]; }

  // ── Top-level ──────────────────────────────────────────────────────────────

  /**
   * Parse the entire map.
   * @returns {MapEntity[]}
   */
  parseMap() {
    const entities = [];
    while (this.pos < this.tokens.length) {
      if (this.peek()?.val === '{') {
        entities.push(this.parseEntity());
      } else {
        this.next(); // skip stray tokens
      }
    }
    return entities;
  }

  // ── Entity ─────────────────────────────────────────────────────────────────

  parseEntity() {
    this.expect('{');
    /** @type {MapEntity} */
    const entity = { props: {}, brushes: [] };

    while (this.peek()?.val !== '}') {
      if (!this.peek()) break;

      if (this.peek().type === 'str') {
        // Key / value pair: "key" "value"
        const key = this.next().val;
        const val = this.next().val;
        entity.props[key] = val;
      } else if (this.peek().val === '{') {
        entity.brushes.push(this.parseBrush());
      } else {
        this.next(); // skip unexpected token
      }
    }

    this.expect('}');
    return entity;
  }

  // ── Brush ──────────────────────────────────────────────────────────────────

  parseBrush() {
    this.expect('{');
    const planes = [];

    while (this.peek()?.val !== '}') {
      if (!this.peek()) break;
      if (this.peek().val === '(') {
        planes.push(this.parsePlane());
      } else {
        this.next();
      }
    }

    this.expect('}');
    return { planes };
  }

  // ── Plane ──────────────────────────────────────────────────────────────────

  /**
   * Parse one half-space plane definition.
   *
   * Standard format:
   *   ( x y z ) ( x y z ) ( x y z )  TEXTURE  xOff yOff  rot  xSc  ySc
   *
   * Valve 220 format:
   *   ( x y z ) ( x y z ) ( x y z )  TEXTURE  [ ux uy uz xOff ]  [ vx vy vz yOff ]  rot  xSc  ySc
   */
  parsePlane() {
    const readPoint = () => {
      this.expect('(');
      const v = this.vec3();
      this.expect(')');
      return v;
    };

    const p0 = readPoint();
    const p1 = readPoint();
    const p2 = readPoint();

    // Texture name (may be quoted string or bare token)
    const texture = this.next().val;

    // Detect Valve 220 by presence of '['
    if (this.peek()?.val === '[') {
      // Valve 220 UV axes — consume and discard (not needed for mesh/physics)
      this.next();                                          // [
      this.num(); this.num(); this.num();                   // uAxis
      const xOff = this.num();
      this.expect(']');
      this.next();                                          // [
      this.num(); this.num(); this.num();                   // vAxis
      const yOff = this.num();
      this.expect(']');
      this.num(); this.num(); this.num();                   // rot xSc ySc
    } else {
      // Standard: xOff yOff rot xSc ySc
      this.num(); this.num(); this.num(); this.num(); this.num();
    }

    return buildPlane(p0, p1, p2, texture);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANE MATH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a plane (outward normal + d) from three Quake points.
 *
 * Quake uses CW winding when viewed from outside the solid, which means
 * cross(p1-p0, p2-p0) gives an INWARD normal in a right-hand system.
 * We negate it so our normals always point outward, matching Three.js and
 * the standard half-space convention (dot ≥ d  ⟹  inside solid).
 *
 * @param {number[]} p0
 * @param {number[]} p1
 * @param {number[]} p2
 * @param {string}   texture
 * @returns {MapPlane}
 */
function buildPlane(p0, p1, p2, texture) {
  const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const b = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

  // cross(a, b) — Quake's CW winding gives an INWARD-pointing normal
  const nx = a[1] * b[2] - a[2] * b[1];
  const ny = a[2] * b[0] - a[0] * b[2];
  const nz = a[0] * b[1] - a[1] * b[0];
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

  if (len < 1e-10) {
    return { normal: [0, 1, 0], outNormal: [0, -1, 0], d: 0, texture };
  }

  // Inward normal — used for CSG half-space test (dot >= d - ε means inside solid)
  const normal = [nx / len, ny / len, nz / len];

  // d = inward_normal · p0
  const d = normal[0] * p0[0] + normal[1] * p0[1] + normal[2] * p0[2];

  // Outward normal — used only for Three.js face normals / rendering
  const outNormal = [-normal[0], -normal[1], -normal[2]];

  return { normal, outNormal, d, texture };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSG — BRUSH TO POLYGON MESH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intersect three planes and return the point that satisfies all three.
 * Returns null if planes are parallel / near-parallel.
 *
 * @param {MapPlane} pa
 * @param {MapPlane} pb
 * @param {MapPlane} pc
 * @returns {number[] | null}
 */
function intersectThreePlanes(pa, pb, pc) {
  const [a1, b1, c1] = pa.normal, d1 = pa.d;
  const [a2, b2, c2] = pb.normal, d2 = pb.d;
  const [a3, b3, c3] = pc.normal, d3 = pc.d;

  const det = a1 * (b2 * c3 - b3 * c2)
            - b1 * (a2 * c3 - a3 * c2)
            + c1 * (a2 * b3 - a3 * b2);

  if (Math.abs(det) < 1e-8) return null;

  return [
    (d1 * (b2 * c3 - b3 * c2) - b1 * (d2 * c3 - d3 * c2) + c1 * (d2 * b3 - d3 * b2)) / det,
    (a1 * (d2 * c3 - d3 * c2) - d1 * (a2 * c3 - a3 * c2) + c1 * (a2 * d3 - a3 * d2)) / det,
    (a1 * (b2 * d3 - b3 * d2) - b1 * (a2 * d3 - a3 * d2) + d1 * (a2 * b3 - a3 * b2)) / det,
  ];
}

/**
 * Test whether a point lies on the solid side of every plane in the brush,
 * skipping the three planes whose intersection produced this point.
 *
 * Convention: outward normal, solid side is normal·x ≥ d − ε.
 *
 * @param {number[]}   pt
 * @param {MapPlane[]} planes
 * @param {number}     ei  - index to skip
 * @param {number}     ej  - index to skip
 * @param {number}     ek  - index to skip
 * @returns {boolean}
 */
function pointInsideBrush(pt, planes, ei, ej, ek) {
  for (let i = 0; i < planes.length; i++) {
    if (i === ei || i === ej || i === ek) continue;
    const { normal, d } = planes[i];
    const dot = normal[0] * pt[0] + normal[1] * pt[1] + normal[2] * pt[2];
    if (dot < d - EPSILON) return false;
  }
  return true;
}

/**
 * Convert a brush (array of half-space planes) into an array of triangles.
 * Each triangle carries its three vertices (in Quake space) and an outward normal.
 *
 * Algorithm:
 *   1. Find all valid vertices via triple-plane intersection + inside-brush test.
 *   2. Group vertices per face plane.
 *   3. Sort each face polygon's vertices by angle around face centroid.
 *   4. Fan-triangulate each polygon.
 *
 * @param {MapPlane[]} planes
 * @returns {{ verts: number[][], normal: number[] }[]}
 */
function buildBrushMesh(planes) {
  // Collect per-face vertex lists
  const faceVerts = planes.map(() => []);

  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const pt = intersectThreePlanes(planes[i], planes[j], planes[k]);
        if (!pt || !isFinite(pt[0]) || !isFinite(pt[1]) || !isFinite(pt[2])) continue;
        if (!pointInsideBrush(pt, planes, i, j, k)) continue;

        faceVerts[i].push(pt);
        faceVerts[j].push(pt);
        faceVerts[k].push(pt);
      }
    }
  }

  const triangles = [];

  for (let i = 0; i < planes.length; i++) {
    // Deduplicate vertices on this face
    const raw = faceVerts[i];
    const unique = [];
    for (const p of raw) {
      let dup = false;
      for (const q of unique) {
        const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        if (dx * dx + dy * dy + dz * dz < EPSILON * EPSILON) { dup = true; break; }
      }
      if (!dup) unique.push(p);
    }
    if (unique.length < 3) continue;

    // Face centroid
    const cx = unique.reduce((s, p) => s + p[0], 0) / unique.length;
    const cy = unique.reduce((s, p) => s + p[1], 0) / unique.length;
    const cz = unique.reduce((s, p) => s + p[2], 0) / unique.length;

    // Build a tangent frame for angle sorting — use inward normal (same direction as cross product)
    const n    = planes[i].normal;
    const outN = planes[i].outNormal;
    let tx = 1, ty = 0, tz = 0;
    if (Math.abs(n[0]) > 0.9) { tx = 0; ty = 1; tz = 0; }

    // bitangent = n × t
    let bx = n[1] * tz - n[2] * ty;
    let by = n[2] * tx - n[0] * tz;
    let bz = n[0] * ty - n[1] * tx;
    const bl = Math.sqrt(bx * bx + by * by + bz * bz);
    if (bl < 1e-10) continue;
    bx /= bl; by /= bl; bz /= bl;

    // tangent = bitangent × n
    const t2x = by * n[2] - bz * n[1];
    const t2y = bz * n[0] - bx * n[2];
    const t2z = bx * n[1] - by * n[0];

    // Sort by angle around centroid in the face plane
    const angles = unique.map(p => {
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      return Math.atan2(dx * t2x + dy * t2y + dz * t2z,
                        dx * bx  + dy * by  + dz * bz);
    });
    const order = unique.map((_, idx) => idx).sort((a, b) => angles[a] - angles[b]);
    const poly = order.map(idx => unique[idx]);

    // Fan-triangulate. Winding is CCW when viewed along the inward normal,
    // which means CCW when viewed along outward normal from outside = correct for Three.js.
    for (let j = 1; j < poly.length - 1; j++) {
      triangles.push({
        verts: [poly[0], poly[j], poly[j + 1]],
        normal: outN,  // outward normal for Three.js vertex normals
      });
    }
  }

  return triangles;
}

// ─────────────────────────────────────────────────────────────────────────────
// COORDINATE CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Quake-space point to Three.js world space.
 *
 * Quake:     +X forward   +Y left   +Z up
 * Three.js:  +X right     +Y up     −Z forward
 *
 * Mapping:  Q(x, y, z) → T(x, z, −y)  then scale by QUAKE_SCALE.
 *
 * @param {number[]} v - [x, y, z] in Quake units
 * @returns {THREE.Vector3}
 */
function quakeToThree(v) {
  return new THREE.Vector3(
     v[0] * QUAKE_SCALE,
     v[2] * QUAKE_SCALE,
    -v[1] * QUAKE_SCALE,
  );
}

/**
 * Remap a Quake-space normal vector to Three.js space (no scaling).
 *
 * @param {number[]} n
 * @returns {number[]} [nx, ny, nz] in Three.js space
 */
function quakeNormalToThree(n) {
  return [n[0], n[2], -n[1]];
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE.JS GEOMETRY BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a THREE.BufferGeometry from a flat array of triangles.
 *
 * @param {{ verts: number[][], normal: number[] }[]} triangles
 * @returns {THREE.BufferGeometry}
 */
function buildThreeGeometry(triangles) {
  const positions = [];
  const normals   = [];

  for (const tri of triangles) {
    const n3 = quakeNormalToThree(tri.normal);
    for (const v of tri.verts) {
      const tv = quakeToThree(v);
      positions.push(tv.x, tv.y, tv.z);
      normals.push(n3[0], n3[1], n3[2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// RAPIER COLLIDER BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a static Rapier trimesh collider for a brush.
 *
 * @param {{ verts: number[][], normal: number[] }[]} triangles
 * @param {import('@dimforge/rapier3d-compat').World} rapierWorld
 * @param {typeof import('@dimforge/rapier3d-compat')} RAPIER
 * @returns {import('@dimforge/rapier3d-compat').Collider | null}
 */
function buildRapierCollider(triangles, rapierWorld, RAPIER) {
  if (!rapierWorld || !RAPIER || triangles.length === 0) return null;

  const verts   = [];
  const indices = [];

  for (let i = 0; i < triangles.length; i++) {
    const base = i * 3;
    for (const v of triangles[i].verts) {
      const tv = quakeToThree(v);
      verts.push(tv.x, tv.y, tv.z);
    }
    indices.push(base, base + 1, base + 2);
  }

  try {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    const body     = rapierWorld.createRigidBody(bodyDesc);
    const collDesc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(verts),
      new Uint32Array(indices),
    );
    return rapierWorld.createCollider(collDesc, body);
  } catch (err) {
    console.warn('[mapParser] Trimesh collider failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT MATERIAL FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/** Simple per-texture colour palette so distinct surfaces are easy to spot. */
const _texColourCache = new Map();
function texColour(name) {
  if (!_texColourCache.has(name)) {
    // Deterministic hash of texture name → hue
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hue = (h % 360) / 360;
    _texColourCache.set(name, new THREE.Color().setHSL(hue, 0.4, 0.35));
  }
  return _texColourCache.get(name);
}

/** @type {Map<string, THREE.Material>} */
const _matCache = new Map();

/**
 * Return (or create) a MeshStandardMaterial keyed on texture name.
 * Replace this with your own texture-loading logic as needed.
 *
 * @param {string} textureName
 * @returns {THREE.Material}
 */
function getDefaultMaterial(textureName) {
  if (!_matCache.has(textureName)) {
    _matCache.set(textureName, new THREE.MeshStandardMaterial({
      color:    texColour(textureName),
      roughness: 0.9,
      metalness: 0.05,
    }));
  }
  return _matCache.get(textureName);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} MapEntity
 * @property {Record<string, string>} props   - Key/value pairs ("classname", "origin", …)
 * @property {MapBrush[]}             brushes
 */

/**
 * @typedef {Object} MapBrush
 * @property {MapPlane[]} planes
 */

/**
 * @typedef {Object} MapPlane
 * @property {number[]} normal   - Outward unit normal [x, y, z]
 * @property {number}   d        - Plane offset (normal·x = d on the surface)
 * @property {string}   texture  - Texture name from the .map file
 */

/**
 * @typedef {Object} LoadMapOptions
 * @property {THREE.Scene}  [scene]          - If provided, meshes are added automatically.
 * @property {object}       [world]          - Rapier World. If provided, trimesh colliders are created.
 * @property {object}       [RAPIER]         - The Rapier module (e.g. from './src/physics').
 * @property {(name: string) => THREE.Material} [getMaterial] - Override default material factory.
 * @property {boolean}      [castShadow]     - Default true.
 * @property {boolean}      [receiveShadow]  - Default true.
 * @property {boolean}      [skipWorldspawn] - Skip non-worldspawn entities (func_wall etc). Default false.
 */

/**
 * @typedef {Object} LoadMapResult
 * @property {MapEntity[]}   entities     - All parsed entities.
 * @property {THREE.Mesh[]}  meshes       - All generated Three.js meshes.
 * @property {object[]}      colliders    - All generated Rapier colliders.
 * @property {MapEntity[]}   pointEntities - Entities with no brushes (lights, spawns, items…).
 */

/**
 * Parse a Quake .map string and build Three.js meshes + Rapier colliders.
 *
 * @param {string}         mapSource - Raw contents of a .map file.
 * @param {LoadMapOptions} [options]
 * @returns {LoadMapResult}
 */
export function loadMap(mapSource, options = {}) {
  const {
    scene:       threeScene  = scene,     // default to imported scene
    world:       rapierWorld = world,     // default to imported world
    RAPIER:      rapier      = RAPIER,    // default to imported RAPIER
    getMaterial               = getDefaultMaterial,
    castShadow                = true,
    receiveShadow             = true,
    skipWorldspawn            = false,
  } = options;

  // ── Parse ────────────────────────────────────────────────────────────────
  const tokens   = tokenize(mapSource);
  const parser   = new MapParser(tokens);
  const entities = parser.parseMap();

  const meshes        = [];
  const colliders     = [];
  const pointEntities = [];

  // ── Process each entity ──────────────────────────────────────────────────
  for (const entity of entities) {
    const classname = entity.props.classname ?? 'unknown';

    // Collect entities with no brushes (spawn points, lights, items, etc.)
    if (entity.brushes.length === 0) {
      pointEntities.push(entity);
      continue;
    }

    // Optional: skip non-worldspawn brush entities
    if (skipWorldspawn && classname === 'worldspawn') continue;

    // ── Process each brush ─────────────────────────────────────────────────
    for (const brush of entity.brushes) {
      const { planes } = brush;
      if (planes.length < 4) continue; // degenerate — needs ≥ 4 half-spaces

      let triangles;
      try {
        triangles = buildBrushMesh(planes);
      } catch (err) {
        console.warn('[mapParser] Brush CSG failed:', err.message);
        continue;
      }
      if (triangles.length === 0) continue;

      // ── Group triangles by texture for fewer draw calls ──────────────────
      /** @type {Map<string, { verts: number[][], normal: number[] }[]>} */
      const byTex = new Map();
      for (const tri of triangles) {
        // Match tri's outward normal against each plane's outNormal to recover texture name
        let texName = '__TB_empty';
        for (const plane of planes) {
          const n = plane.outNormal, tn = tri.normal;
          if (Math.abs(n[0] - tn[0]) < 0.01 &&
              Math.abs(n[1] - tn[1]) < 0.01 &&
              Math.abs(n[2] - tn[2]) < 0.01) {
            texName = plane.texture;
            break;
          }
        }
        if (!byTex.has(texName)) byTex.set(texName, []);
        byTex.get(texName).push(tri);
      }

      // ── Build one Mesh per texture group ─────────────────────────────────
      for (const [texName, tris] of byTex) {
        const geo  = buildThreeGeometry(tris);
        const mat  = getMaterial(texName);
        const mesh = new THREE.Mesh(geo, mat);

        mesh.castShadow    = castShadow;
        mesh.receiveShadow = receiveShadow;

        // Tag mesh with map metadata for downstream use
        mesh.userData.mapEntity   = classname;
        mesh.userData.mapTexture  = texName;
        mesh.userData.mapBrush    = true;

        if (threeScene) threeScene.add(mesh);
        meshes.push(mesh);
      }

      // ── Rapier trimesh collider (one per brush, covers all faces) ─────────
      const collider = buildRapierCollider(triangles, rapierWorld, rapier);
      if (collider) colliders.push(collider);
    }
  }

  return { entities, meshes, colliders, pointEntities };
}

/**
 * Remove all meshes previously created by loadMap from the scene and
 * drop their geometries and materials from GPU memory.
 *
 * @param {LoadMapResult} mapResult - The object returned by loadMap().
 * @param {THREE.Scene}   [threeScene]
 */
export function unloadMap(mapResult, threeScene = scene) {
  for (const mesh of mapResult.meshes) {
    if (threeScene) threeScene.remove(mesh);
    mesh.geometry.dispose();
    // Only dispose materials we own (i.e. from the default factory)
    if (!mesh.material.userData?.external) {
      mesh.material.dispose();
    }
  }
  mapResult.meshes.length    = 0;
  mapResult.colliders.length = 0;
}

/**
 * Convenience: fetch a .map file from a URL, parse, and load it.
 *
 * @param {string}         url
 * @param {LoadMapOptions} [options]
 * @returns {Promise<LoadMapResult>}
 */
export async function loadMapFromURL(url, options = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[mapParser] Failed to fetch map: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return loadMap(text, options);
}

// Re-export helpers in case the caller wants raw access
export { buildBrushMesh, buildPlane, quakeToThree, tokenize };
