import { RAPIER } from '/src/physics';
import world from '/src/physics';
import * as THREE from 'three';
import { scene } from '/src/render';
import camera from '/src/camera';

// player setup

const radius = 0.4;
const halfHeight = 0.9;

const body = world.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, 5, 0)
);

const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
  .setFriction(0.0)
  .setRestitution(0.0);

const collider = world.createCollider(colliderDesc, body);

// char controller

const characterController = world.createCharacterController(0.02); // skin width
characterController.setApplyImpulsesToDynamicBodies(true);
characterController.enableAutostep(0.4, 0.2, true);        // step height
characterController.setMaxSlopeClimbAngle(50 * Math.PI / 180);
characterController.setMinSlopeSlideAngle(35 * Math.PI / 180);

// capsule mesh

const capsuleGeo = new THREE.CapsuleGeometry(radius, halfHeight * 2, 10, 6);
const capsuleMat = new THREE.MeshStandardMaterial({ color: 0xff8800, wireframe: false, transparent: true });
const capsuleMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
capsuleMesh.layers.set(1); // ignore raycasts
scene.add(capsuleMesh);

// input handling

const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  use: false
};


// Interacting with phys ents

const raycaster = new THREE.Raycaster();
let cameraDirection = new THREE.Vector3();
const pointerPos = new THREE.Vector2(0, 0);
let heldEnt = null;

function create_raycast() {
  camera.getWorldDirection(cameraDirection);
  cameraDirection.multiplyScalar(-1);

  raycaster.setFromCamera(pointerPos, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);



  if (intersects.length > 0) {
    THREE.log(intersects[0].object.name);

    if (scene.getObjectByName(intersects[0].object.name) == heldEnt){
      heldEnt = null;
    } else {

    heldEnt = scene.getObjectByName(intersects[0].object.name);

    // Make a new material since the original one is shared between all cubes
    heldEnt.material = new THREE.MeshStandardMaterial({ color: 0x00ff00, wireframe: false, transparent: true });
    heldEnt.material.color.set(new THREE.Color(Math.random(), Math.random(), Math.random()));
    }
  }
}


window.addEventListener('keydown', e => {
  e.preventDefault();
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward  = true; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left     = true; break;
    case 'KeyD': case 'ArrowRight': keys.right    = true; break;
    case 'Space':                   keys.jump     = true; break;
    case 'KeyE':                   keys.use     = true; 
    create_raycast();
    break;
  }
});

window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward  = false; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left     = false; break;
    case 'KeyD': case 'ArrowRight': keys.right    = false; break;
    case 'Space':                   keys.jump     = false; break;
    case 'KeyE':                   keys.use     = false; break;
  }
});

// Called every frame from main

let accumulatedJumpImpulse = false;

export function updatePlayer(deltaTime) {
  const move = new THREE.Vector3();

  if (keys.forward)  move.z -= 1;
  if (keys.backward) move.z += 1;
  if (keys.left)     move.x -= 1;
  if (keys.right)    move.x += 1;

  let desiredVelocity = new THREE.Vector3();

  if (move.lengthSq() > 0) {
    move.normalize();

    // Make movement relative to camera dir
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    camForward.normalize();

    const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0,1,0)).normalize();

    desiredVelocity
      .addScaledVector(camForward, -move.z)   // forward/back
      .addScaledVector(camRight,    move.x);  // left/right

    desiredVelocity.normalize().multiplyScalar(7.5); // walk speed
  }

  // Gravity
  const GRAVITY = 25;
  const movement = {
    x: desiredVelocity.x * deltaTime,
    y: -GRAVITY * deltaTime,
    z: desiredVelocity.z * deltaTime
  };

  // Jump
  if (keys.jump && characterController.computedGrounded() && !accumulatedJumpImpulse) {
    movement.y += 8; // jump impulse
    accumulatedJumpImpulse = true;
  }
  if (!keys.jump) accumulatedJumpImpulse = false; // reset when released

  // Compute movement
  characterController.computeColliderMovement(collider, movement);

  const correctedMovement = characterController.computedMovement();

  // Apply
  const pos = body.translation();
  body.setNextKinematicTranslation(
    {
      x: pos.x + correctedMovement.x,
      y: pos.y + correctedMovement.y,
      z: pos.z + correctedMovement.z
    },
    true
  );

  // Sync capsule mesh and camera
  capsuleMesh.position.set(pos.x, pos.y, pos.z);
  camera.position.set(pos.x, pos.y + halfHeight + radius, pos.z);
}

export { heldEnt };