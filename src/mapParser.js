/**
 * mapParser.js
 * Quake .map parser — Quake 1 standard and Valve 220 formats.
 * Converts brushes to Three.js geometry and Rapier trimesh colliders.
 *
 * Usage:
 *   import { loadMap, createTextureMaterialFactory } from './mapParser.js';
 *
 *   const getMaterial = createTextureMaterialFactory('./maps/textures/', 'png');
 *   const res = await fetch('./maps/test.map');
 *   loadMap(await res.text(), { getMaterial });
 */

import * as THREE from 'three';
import world, { RAPIER } from '/src/physics';
import { scene } from '/src/render';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Quake units → metres. */
const QUAKE_SCALE = 1 / 32;

/** Tolerance for half-space membership and vertex deduplication. */
const EPSILON = 0.01;

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(src) {
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      tokens.push({ type: 'str', val: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    if ('{}()[]'.includes(ch)) {
      tokens.push({ type: 'punct', val: ch });
      i++;
      continue;
    }

    let j = i;
    while (j < src.length && !/[\s"{}()\[\]\/]/.test(src[j])) j++;
    if (j > i) {
      tokens.push({ type: 'tok', val: src.slice(i, j) });
      i = j;
    } else {
      i++;
    }
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

class MapParser {
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

  num() { return parseFloat(this.next().val); }
  vec3() { return [this.num(), this.num(), this.num()]; }

  parseMap() {
    const entities = [];
    while (this.pos < this.tokens.length) {
      if (this.peek()?.val === '{') {
        entities.push(this.parseEntity());
      } else {
        this.next();
      }
    }
    return entities;
  }

  parseEntity() {
    this.expect('{');
    const entity = { props: {}, brushes: [] };

    while (this.peek()?.val !== '}') {
      if (!this.peek()) break;
      if (this.peek().type === 'str') {
        const key = this.next().val;
        const val = this.next().val;
        entity.props[key] = val;
      } else if (this.peek().val === '{') {
        entity.brushes.push(this.parseBrush());
      } else {
        this.next();
      }
    }

    this.expect('}');
    return entity;
  }

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

    const texture = this.next().val;

    let uvInfo;

    if (this.peek()?.val === '[') {
      // ── Valve 220 ──────────────────────────────────────────────────────────
      // [ uAxis.x uAxis.y uAxis.z xOffset ] [ vAxis.x vAxis.y vAxis.z yOffset ]
      // rotation xScale yScale
      this.next(); // consume '['
      const uAxisX = this.num();
      const uAxisY = this.num();
      const uAxisZ = this.num();
      const xOffset = this.num();
      this.expect(']');

      this.next(); // consume '['
      const vAxisX = this.num();
      const vAxisY = this.num();
      const vAxisZ = this.num();
      const yOffset = this.num();
      this.expect(']');

      const rotation = this.num(); // stored but UV axes already encode it
      const xScale   = this.num();
      const yScale   = this.num();

      uvInfo = {
        format: 'valve220',
        uAxis:   [uAxisX, uAxisY, uAxisZ],
        vAxis:   [vAxisX, vAxisY, vAxisZ],
        xOffset,
        yOffset,
        xScale:  xScale  || 1,
        yScale:  yScale  || 1,
      };
    } else {
      // ── Standard (Quake 1) ─────────────────────────────────────────────────
      // xOffset yOffset rotation xScale yScale
      const xOffset  = this.num();
      const yOffset  = this.num();
      const rotation = this.num();
      const xScale   = this.num();
      const yScale   = this.num();

      uvInfo = {
        format:   'standard',
        xOffset,
        yOffset,
        rotation,
        xScale:   xScale  || 1,
        yScale:   yScale  || 1,
      };
    }

    return buildPlane(p0, p1, p2, texture, uvInfo);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANE MATH
// ─────────────────────────────────────────────────────────────────────────────

function buildPlane(p0, p1, p2, texture, uvInfo) {
  const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const b = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

  const nx = a[1] * b[2] - a[2] * b[1];
  const ny = a[2] * b[0] - a[0] * b[2];
  const nz = a[0] * b[1] - a[1] * b[0];
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

  if (len < 1e-10) {
    return { normal: [0, 1, 0], outNormal: [0, -1, 0], d: 0, texture, uvInfo };
  }

  const normal = [nx / len, ny / len, nz / len];
  const d = normal[0] * p0[0] + normal[1] * p0[1] + normal[2] * p0[2];
  const outNormal = [-normal[0], -normal[1], -normal[2]];

  return { normal, outNormal, d, texture, uvInfo };
}

// ─────────────────────────────────────────────────────────────────────────────
// UV COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute UV coordinates for a vertex in Quake space, respecting the plane's
 * texture projection data (Valve 220 or standard Quake 1).
 *
 * All coordinates are in Quake units; the caller handles Three.js conversion.
 *
 * @param {number[]} v       - Vertex position in Quake space [x, y, z].
 * @param {object}   plane   - Plane with normal and uvInfo.
 * @param {number}   texW    - Texture pixel width  (default 64, used for offset normalisation).
 * @param {number}   texH    - Texture pixel height (default 64).
 * @returns {[number, number]} [u, v]
 */
function computeUV(v, plane, texW = 64, texH = 64) {
  const { uvInfo, normal } = plane;

  if (uvInfo.format === 'valve220') {
    // Valve 220 — explicit texture-space axes stored in the map file.
    // u = dot(vertex, uAxis) / (texW * xScale) + xOffset / texW
    // v = dot(vertex, vAxis) / (texH * yScale) + yOffset / texH
    const { uAxis, vAxis, xOffset, yOffset, xScale, yScale } = uvInfo;

    const u = (v[0] * uAxis[0] + v[1] * uAxis[1] + v[2] * uAxis[2]) / (texW * xScale)
            + xOffset / texW;
    const vCoord = (v[0] * vAxis[0] + v[1] * vAxis[1] + v[2] * vAxis[2]) / (texH * yScale)
            + yOffset / texH;

    return [u, vCoord];
  } else {
    // Standard Quake 1 — axis-aligned projection with rotation & scale.
    // Step 1: pick the best-fit projection axis from the face normal.
    const { xOffset, yOffset, rotation, xScale, yScale } = uvInfo;

    const [anx, any, anz] = normal.map(Math.abs);
    let s, t; // raw projected coords in Quake space

    if (anz >= anx && anz >= any) {
      // Floor / ceiling (dominant Z) → project onto XY
      s =  v[0];
      t =  v[1];
    } else if (anx >= any && anx >= anz) {
      // X-facing wall → project onto YZ
      s =  v[1];
      t =  v[2];
    } else {
      // Y-facing wall → project onto XZ
      s =  v[0];
      t =  v[2];
    }

    // Step 2: apply rotation in the projection plane
    const rad = rotation * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rs =  s * cos - t * sin;
    const rt =  s * sin + t * cos;

    // Step 3: scale and offset
    //   u = rs / (texW * xScale) + xOffset / texW
    //   v = rt / (texH * yScale) + yOffset / texH
    const u      = rs / (texW * xScale) + xOffset / texW;
    const vCoord = rt / (texH * yScale) + yOffset / texH;

    return [u, vCoord];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSG — BRUSH TO POLYGON MESH
// ─────────────────────────────────────────────────────────────────────────────

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

function pointInsideBrush(pt, planes, ei, ej, ek) {
  for (let i = 0; i < planes.length; i++) {
    if (i === ei || i === ej || i === ek) continue;
    const { normal, d } = planes[i];
    const dot = normal[0] * pt[0] + normal[1] * pt[1] + normal[2] * pt[2];
    if (dot < d - EPSILON) return false;
  }
  return true;
}

function buildBrushMesh(planes) {
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

    const cx = unique.reduce((s, p) => s + p[0], 0) / unique.length;
    const cy = unique.reduce((s, p) => s + p[1], 0) / unique.length;
    const cz = unique.reduce((s, p) => s + p[2], 0) / unique.length;

    const n  = planes[i].normal;
    const outN = planes[i].outNormal;
    let tx = 1, ty = 0, tz = 0;
    if (Math.abs(n[0]) > 0.9) { tx = 0; ty = 1; tz = 0; }

    let bx = n[1] * tz - n[2] * ty;
    let by = n[2] * tx - n[0] * tz;
    let bz = n[0] * ty - n[1] * tx;
    const bl = Math.sqrt(bx * bx + by * by + bz * bz);
    if (bl < 1e-10) continue;
    bx /= bl; by /= bl; bz /= bl;

    const t2x = by * n[2] - bz * n[1];
    const t2y = bz * n[0] - bx * n[2];
    const t2z = bx * n[1] - by * n[0];

    const angles = unique.map(p => {
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      return Math.atan2(dx * t2x + dy * t2y + dz * t2z,
                        dx * bx  + dy * by  + dz * bz);
    });
    const order = unique.map((_, idx) => idx).sort((a, b) => angles[a] - angles[b]);
    const poly  = order.map(idx => unique[idx]);

    let winding = 1;
    if (poly.length >= 3) {
      const v0 = poly[0], v1 = poly[1], v2 = poly[2];
      const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
      const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
      const cx = ay*bz - az*by, cy = az*bx - ax*bz, cz = ax*by - ay*bx;
      if (cx*outN[0] + cy*outN[1] + cz*outN[2] < 0) winding = -1;
    }

    for (let j = 1; j < poly.length - 1; j++) {
      triangles.push({
        verts: winding === 1
          ? [poly[0], poly[j],     poly[j + 1]]
          : [poly[0], poly[j + 1], poly[j]],
        normal:  outN,
        planeIndex: i,
      });
    }
  }

  return triangles;
}

// ─────────────────────────────────────────────────────────────────────────────
// COORDINATE CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quake: +X forward, +Y left, +Z up
 * Three.js: +X right, +Y up, -Z forward
 * Mapping: Q(x, y, z) → T(x, z, -y) * QUAKE_SCALE
 */
function quakeToThree(v) {
  return new THREE.Vector3(
     v[0] * QUAKE_SCALE,
     v[2] * QUAKE_SCALE,
    -v[1] * QUAKE_SCALE,
  );
}

function quakeNormalToThree(n) {
  return [n[0], n[2], -n[1]];
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE.JS GEOMETRY BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a BufferGeometry from a list of triangles.
 *
 * @param {Array}   triangles    - Output of buildBrushMesh, filtered to one texture.
 * @param {Array}   planes       - Full plane array for the brush (needed for uvInfo).
 * @param {object}  [texSize]    - { w, h } texture dimensions in pixels; defaults to 64×64.
 *                                 Pass real dimensions from your texture atlas for pixel-perfect
 *                                 alignment. The UV formula normalises by texW / texH so that
 *                                 u=1 always corresponds to one full texture tile width.
 */
function buildThreeGeometry(triangles, planes, texSize = { w: 64, h: 64 }) {
  const positions = [];
  const normals   = [];
  const uvs       = [];

  for (const tri of triangles) {
    const n3 = quakeNormalToThree(tri.normal);

    // Retrieve the originating plane so we can use its uvInfo.
    const plane = planes[tri.planeIndex];

    for (const v of tri.verts) {
      const tv = quakeToThree(v);
      positions.push(tv.x, tv.y, tv.z);
      normals.push(n3[0], n3[1], n3[2]);

      // Compute UVs in Quake coordinate space (before axis-remap / scale).
      // This is intentional: the Quake UV axes are defined in Quake space.
      const [u, vc] = computeUV(v, plane, texSize.w, texSize.h);
      uvs.push(u, vc);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// RAPIER COLLIDER BUILDER
// ─────────────────────────────────────────────────────────────────────────────

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

const _matCache = new Map();

function getDefaultMaterial(textureName) {
  if (!_matCache.has(textureName)) {
    let h = 0;
    for (let i = 0; i < textureName.length; i++) h = (h * 31 + textureName.charCodeAt(i)) >>> 0;
    _matCache.set(textureName, new THREE.MeshStandardMaterial({
      color:     new THREE.Color().setHSL((h % 360) / 360, 0.4, 0.45),
      roughness: 0.9,
      metalness: 0.05,
    }));
  }
  return _matCache.get(textureName);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — LOAD MAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Quake .map string and build Three.js meshes + Rapier colliders.
 *
 * @param {string} mapSource
 * @param {{
 *   scene?        : THREE.Scene,
 *   world?        : object,
 *   RAPIER?       : object,
 *   getMaterial?  : (name: string) => THREE.Material,
 *   getTexSize?   : (name: string) => { w: number, h: number },
 *   castShadow?   : boolean,
 *   receiveShadow?: boolean,
 * }} [options]
 * @returns {{ entities, meshes, colliders, pointEntities }}
 */
export function loadMap(mapSource, options = {}) {
  const {
    scene:       threeScene  = scene,
    world:       rapierWorld = world,
    RAPIER:      rapier      = RAPIER,
    getMaterial               = getDefaultMaterial,
    // Optional: supply real texture pixel dimensions for accurate UV tiling.
    // Signature: (textureName: string) => { w: number, h: number }
    // Automatically picked up from getMaterial.getTexSize if not supplied explicitly
    // (createTextureMaterialFactory attaches it there for backwards compat).
    getTexSize                = getMaterial?.getTexSize ?? (() => ({ w: 64, h: 64 })),
    castShadow                = true,
    receiveShadow             = true,
  } = options;

  const tokens   = tokenize(mapSource);
  const parser   = new MapParser(tokens);
  const entities = parser.parseMap();

  const meshes        = [];
  const colliders     = [];
  const pointEntities = [];

  for (const entity of entities) {
    const classname = entity.props.classname ?? 'unknown';

    if (entity.brushes.length === 0) {
      pointEntities.push(entity);
      continue;
    }

    for (const brush of entity.brushes) {
      const { planes } = brush;
      if (planes.length < 4) continue;

      let triangles;
      try {
        triangles = buildBrushMesh(planes);
      } catch (err) {
        console.warn('[mapParser] Brush CSG failed:', err.message);
        continue;
      }
      if (triangles.length === 0) continue;

      // Group triangles by texture name → one Mesh per texture per brush.
      // Match via planeIndex (exact) rather than normal comparison (fragile).
      const byTex = new Map();
      for (const tri of triangles) {
        const texName = planes[tri.planeIndex]?.texture ?? '__TB_empty';
        if (!byTex.has(texName)) byTex.set(texName, []);
        byTex.get(texName).push(tri);
      }

      for (const [texName, tris] of byTex) {
        const texSize = getTexSize(texName);
        const geo     = buildThreeGeometry(tris, planes, texSize);
        const mat     = getMaterial(texName);
        const mesh    = new THREE.Mesh(geo, mat);

        mesh.castShadow    = castShadow;
        mesh.receiveShadow = receiveShadow;
        mesh.userData.mapEntity  = classname;
        mesh.userData.mapTexture = texName;
        mesh.userData.mapBrush   = true;

        if (threeScene) threeScene.add(mesh);
        meshes.push(mesh);
      }

      const collider = buildRapierCollider(triangles, rapierWorld, rapier);
      if (collider) colliders.push(collider);
    }
  }

  return { entities, meshes, colliders, pointEntities };
}

/**
 * Remove all meshes from the scene and free GPU memory.
 */
export function unloadMap(mapResult, threeScene = scene) {
  for (const mesh of mapResult.meshes) {
    if (threeScene) threeScene.remove(mesh);
    mesh.geometry.dispose();
    if (!mesh.material.userData?.external) mesh.material.dispose();
  }
  mapResult.meshes.length    = 0;
  mapResult.colliders.length = 0;
}

/**
 * Fetch a .map file from a URL and load it.
 */
export async function loadMapFromURL(url, options = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[mapParser] Failed to fetch map: ${res.status} ${res.statusText}`);
  return loadMap(await res.text(), options);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — TEXTURE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a getMaterial function that loads textures from a base path.
 *
 * Files are expected at: baseURL + textureName + '.' + ext
 * e.g. createTextureMaterialFactory('./maps/textures/', 'png')
 *      loads './maps/textures/__TB_empty.png'
 *
 * Falls back to a hashed colour if the file is not found.
 *
 * Backwards-compatible: returns the getMaterial function directly.
 * Real texture pixel dimensions are available via getMaterial.getTexSize(name),
 * and loadMap will use them automatically when you pass getMaterial as an option.
 *
 * @param {string} baseURL    - Base path, trailing slash required.
 * @param {string} [ext='png']
 * @returns {Function} getMaterial — also has a .getTexSize(name) method.
 */
export function createTextureMaterialFactory(baseURL, ext = 'png') {
  const loader   = new THREE.TextureLoader();
  const matCache = new Map();
  const sizeCache = new Map();

  function getMaterial(textureName) {
    if (matCache.has(textureName)) return matCache.get(textureName);

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.05 });

    loader.load(
      `${baseURL}${textureName}.${ext}`,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        mat.map = tex;
        mat.needsUpdate = true;

        // Cache real pixel dimensions so getTexSize can return them.
        // image.naturalWidth/naturalHeight are available once the texture loads.
        const img = tex.image;
        if (img && img.naturalWidth) {
          sizeCache.set(textureName, { w: img.naturalWidth, h: img.naturalHeight });
        }
      },
      undefined,
      () => {
        let h = 0;
        for (let i = 0; i < textureName.length; i++) h = (h * 31 + textureName.charCodeAt(i)) >>> 0;
        mat.color.setHSL((h % 360) / 360, 0.4, 0.45);
        console.warn(`[mapParser] Texture not found: ${baseURL}${textureName}.${ext}`);
      }
    );

    matCache.set(textureName, mat);
    return mat;
  }

  /**
   * Return the pixel dimensions of a texture, if already loaded.
   * Falls back to 64×64 (standard Quake WAD tile size) before the image loads.
   * Pre-warm by calling getMaterial for all textures before loadMap if needed.
   */
  function getTexSize(textureName) {
    return sizeCache.get(textureName) ?? { w: 64, h: 64 };
  }

  // Attach getTexSize as a property so loadMap can pick it up automatically,
  // while the return value remains a plain callable function for backwards compat.
  getMaterial.getTexSize = getTexSize;
  return getMaterial;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — ENTITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an entity "origin" string ("x y z" in Quake space) → Three.js Vector3.
 */
export function parseEntityOrigin(originStr) {
  if (!originStr) return new THREE.Vector3();
  const [x, y, z] = originStr.trim().split(/\s+/).map(Number);
  return quakeToThree([x, y, z]);
}

/**
 * Spawn point entities by classname.
 *
 * spawnEntities(result.pointEntities, {
 *   info_player_start(props, origin) { camera.position.copy(origin); },
 *   light(props, origin) {
 *     const l = new THREE.PointLight(0xffeedd, 1, 10);
 *     l.position.copy(origin);
 *     scene.add(l);
 *     return l;
 *   },
 * });
 */
export function spawnEntities(pointEntities, handlers) {
  const spawned = [];
  for (const entity of pointEntities) {
    const handler = handlers[entity.props.classname];
    if (!handler) continue;
    const origin = parseEntityOrigin(entity.props.origin);
    const result = handler(entity.props, origin);
    if (result != null) spawned.push(result);
  }
  return spawned;
}

// Raw helpers for advanced use
export { buildBrushMesh, buildPlane, computeUV, quakeToThree, tokenize };