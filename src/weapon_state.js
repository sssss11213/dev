import { RAPIER } from '/src/physics';
import world from '/src/physics';
import * as THREE from 'three';
import { scene } from '/src/render';
import camera from '/src/camera';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let wp_viewmodel = null;
let lastdigitinput = null;
let currentWeapon = null;
let currentSlot = 1;
const clock = new THREE.Clock(true);

// ─── Shooting state ───────────────────────────────────────────────────────────
const shootRaycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0); // always shoot from center
const SHOOT_FORCE = 18;                        // impulse strength on hit
let isReloading = false;
let reloadTimeout = null;

// ─── Weapon class ─────────────────────────────────────────────────────────────
class weapon {
  constructor(sprite_sheet, maxammo, name, reloadTime = 2.0) {
    this.sprite_sheet = sprite_sheet;
    this.maxammo      = maxammo;
    this.ammo         = maxammo;   // current ammo
    this.name         = name;
    this.reloadTime   = reloadTime; // seconds
  }
}

const slots = {
  1: weapon,
  2: weapon,
};

// ─── Input ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  e.preventDefault();
  switch (e.code) {
    case 'Digit1': switchWeapon(1); break;
    case 'Digit2': switchWeapon(2); break;
    case 'KeyR':   startReload();   break;
  }
});

window.addEventListener('mousedown', e => {
  if (e.button === 0) fireWeapon(); // left click
});

// ─── Loader ───────────────────────────────────────────────────────────────────
const loader = new GLTFLoader();
let mixer = null;

export function LoadViewmodel(shouldUpdateMesh, geometry) {
  if (shouldUpdateMesh != true) {
    const testweapon  = new weapon('models/hud/terminal.glb',              10, 'Test Weapon',          2.0);
    const testweapon2 = new weapon('models/exported/viewmodel_galil_F.glb', 30, 'Test Weapon number 2', 2.5);

    loader.load(testweapon.sprite_sheet, function (gltf) {
      wp_viewmodel = gltf.scene;
      wp_viewmodel.scale.set(1, 1, 1);
      wp_viewmodel.position.set(0, 5, 0);
      scene.add(wp_viewmodel);
      console.log("Viewmodel loaded successfully!");
      slots[1] = testweapon;
      slots[2] = testweapon2;
      switchWeapon(2);
    }, undefined, function (error) {
      console.error("An error happened:", error);
    });

  } else {
    loader.load(slots[currentSlot].sprite_sheet, function (gltf) {
      const model = gltf.scene;
      model.position.set(wp_viewmodel.position.x, wp_viewmodel.position.y, wp_viewmodel.position.z);
      model.scale.set(wp_viewmodel.scale.x, wp_viewmodel.scale.y, wp_viewmodel.scale.z);
      scene.remove(wp_viewmodel);
      wp_viewmodel = model;
      scene.add(wp_viewmodel);

      mixer = new THREE.AnimationMixer(model);
      console.log('animations:', gltf.animations.map(c => c.name));
      const clip = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
      if (!clip) {
        console.warn('Idle clip not found, available:', gltf.animations.map(c => c.name));
        return;
      }
      mixer.clipAction(clip).play();
    });
  }
}

// ─── Viewmodel update ─────────────────────────────────────────────────────────
export function updateViewmodel() {
  if (wp_viewmodel != null) {
    wp_viewmodel.position.set(camera.position.x, camera.position.y, camera.position.z);
    wp_viewmodel.quaternion.copy(camera.quaternion);
  }
  if (mixer !== null && mixer !== undefined) {
    mixer.update(clock.getDelta());
  }
}

// ─── Weapon switch ────────────────────────────────────────────────────────────
function switchWeapon(slot) {
  if (slot != lastdigitinput) {
    // cancel any in-progress reload on the old weapon
    if (reloadTimeout) {
      clearTimeout(reloadTimeout);
      reloadTimeout = null;
      isReloading = false;
    }
    THREE.log(slots[slot].name);
    currentWeapon = slots[slot];
    currentSlot   = slot;
    LoadViewmodel(true);
  }
  lastdigitinput = slot;
}

// ─── Reload ───────────────────────────────────────────────────────────────────
function startReload() {
  if (!currentWeapon)              return;
  if (isReloading)                 return;
  if (currentWeapon.ammo === currentWeapon.maxammo) return;

  isReloading = true;
  console.log(`Reloading ${currentWeapon.name}... (${currentWeapon.reloadTime}s)`);

  reloadTimeout = setTimeout(() => {
    if (currentWeapon) {
      currentWeapon.ammo = currentWeapon.maxammo;
      console.log(`Reloaded! Ammo: ${currentWeapon.ammo}/${currentWeapon.maxammo}`);
    }
    isReloading   = false;
    reloadTimeout = null;
  }, currentWeapon.reloadTime * 1000);
}

// ─── Fire ─────────────────────────────────────────────────────────────────────
function fireWeapon() {
  if (!currentWeapon)      return;
  if (isReloading)         { console.log('Reloading...'); return; }
  if (currentWeapon.ammo <= 0) {
    console.log('Empty! Press R to reload.');
    startReload(); // auto-reload when empty
    return;
  }

  currentWeapon.ammo--;
  console.log(`Fire! Ammo: ${currentWeapon.ammo}/${currentWeapon.maxammo}`);

  // Cast ray from screen center along camera direction
  shootRaycaster.setFromCamera(screenCenter, camera);
  const allMeshes = [];
  scene.traverse(obj => { if (obj.isMesh) allMeshes.push(obj); });

  const hits = shootRaycaster.intersectObjects(allMeshes, false);

  for (const hit of hits) {
    const obj = hit.object;

    // Walk up to find the root of the hit object (in case it's inside a GLTF group)
    let root = obj;
    while (root.parent && root.parent !== scene) root = root.parent;

    // Check if this is a phys_ent by matching name pattern on the root or the mesh
    const physName = findPhysName(obj);
    if (physName) {
      applyShootImpulse(physName, hit.point);
      break; // only push the first thing hit
    }
  }

  // Auto-reload when empty after last shot
  if (currentWeapon.ammo <= 0) {
    startReload();
  }
}

// ─── Find phys_ent name anywhere in an object's ancestry ─────────────────────
function findPhysName(obj) {
  let current = obj;
  while (current) {
    if (current.name && /^phys_ent\d+$/.test(current.name)) {
      return current.name;
    }
    current = current.parent;
  }
  return null;
}

// ─── Apply impulse to the matching Rapier body ───────────────────────────────
function applyShootImpulse(physName, hitPoint) {
  // Extract the index from "phys_entN"
  const index = parseInt(physName.replace('phys_ent', ''), 10);

  // Walk all rigid bodies in the world to find the matching one
  // Rapier bodies don't store names natively — we match by index via userData
  // so we need to find the Three.js mesh first, then get its rigid body
  // The mesh name matches physName directly
  const mesh = scene.getObjectByName(physName);
  if (!mesh || !mesh.userData.rigidBody) {
    console.warn(`No rigidBody userData on ${physName}. Make sure to set mesh.userData.rigidBody = rigid when creating phys_ents.`);
    return;
  }

  const rigid = mesh.userData.rigidBody;

  // Direction: from hit point outward along the ray (camera forward)
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir); // forward direction

  const impulse = {
    x: dir.x * SHOOT_FORCE,
    y: dir.y * SHOOT_FORCE,
    z: dir.z * SHOOT_FORCE,
  };

  rigid.applyImpulse(impulse, true);
  console.log(`Hit ${physName}, applied impulse`, impulse);
}

// ─── Ammo getter (for HUD use) ────────────────────────────────────────────────
export function getAmmo() {
  if (!currentWeapon) return { ammo: 0, maxAmmo: 0 };
  return { ammo: currentWeapon.ammo, maxAmmo: currentWeapon.maxammo };
}

export function getIsReloading() { return isReloading; }

export { wp_viewmodel, updateViewmodel as default, currentSlot };