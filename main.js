import * as THREE from 'three';
import camera from './src/camera';
import { scene, renderer } from './src/render';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import world from './src/physics';
import { RAPIER } from './src/physics';

// some vars
const raycaster = new THREE.Raycaster();
const pointerPos = new THREE.Vector2(0, 0);
const mousePos = new THREE.Vector3(0, 0, 0);










// Take mouse control
var canvas = document.querySelector('canvas');
canvas.onclick = function() {
  canvas.requestPointerLock();
}

// Cube setup
const geometry = new THREE.BoxGeometry(1,1,1)

const material = new THREE.MeshPhongMaterial({
  color: 0xFF0000,    // red (can also use a CSS color string here)
  flatShading: true,
});






//Physics testing
const density = 1.0;
const phys_ents = []

function create_cube(mousePos) {

  const range = 12;

  let x = Math.random() * range - range * 0.5;
  let y = Math.random() * range - range * 0.5 + 3;
  let z = Math.random() * range - range * 0.5;

  const cube = new THREE.Mesh( geometry, material );
  scene.add( cube );

  let rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    // .setLinearDamping(1)
    // .setAngularDamping(1);
  let rigid = world.createRigidBody(rigidBodyDesc);
  let points = geometry.attributes.position.array;
  let colliderDesc = RAPIER.ColliderDesc.convexHull(points).setDensity(density);
  world.createCollider(colliderDesc, rigid);
  
  function update(mousePos) {
  rigid.resetForces(true);
  let { x, y, z } = rigid.translation();
  let pos = new THREE.Vector3(x, y, z);
  //let dir = pos.clone().sub(new THREE.Vector3(0,5,0)).normalize();
  let dir = pos.clone().sub(new THREE.Vector3(mousePos.x, mousePos.y, 0)).normalize();
  let q = rigid.rotation();
  let rote = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  cube.rotation.setFromQuaternion(rote);
  rigid.addForce(dir.multiplyScalar(-5), true);
  cube.position.set(x, y, z);
  }
  return update;
}


// make 10 cubes
for (let i = 0; i < 10; i++) {
let new_cube = create_cube();
phys_ents.push(new_cube);
}


// Add directional and ambiuent light
function add_ambient_light() {
  const color = 0xFFFFFF;
  const intensity = 1;
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(0, 10, 0);
  light.target.position.set(-5, 0, 0);
  scene.add(light);
  scene.add(light.target);
}

const color = 0xFFFFFF;
const intensity = 0.5;
const light = new THREE.AmbientLight(color, intensity);
scene.add(light);
add_ambient_light()



document.querySelector('#app').appendChild(renderer.domElement);

let moveSpeed = 0.1
let mouseSensitivity = 0.002
let keys = {}
let pitch = 0, yaw = 0

// Mouse look
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement) {
    yaw -= e.movementX * mouseSensitivity
    pitch -= e.movementY * mouseSensitivity
    pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch))
    camera.rotation.set(pitch, yaw, 0, 'YXZ')
  }
})

const mousePlaneGeo = new THREE.PlaneGeometry(48, 48, 48, 48);
const mousePlaneMat = new THREE.MeshBasicMaterial({
  wireframe: true,
  color: 0x00ff00,
  transparent: true,
  opacity: 0.0
});

const mousePlane = new THREE.Mesh(mousePlaneGeo, mousePlaneMat);
mousePlane.position.set(0, 0, 0.2);
scene.add(mousePlane);

let cameraDirection = new THREE.Vector3();
function handleRaycast() {
  // orient the mouse plane to the camera
  camera.getWorldDirection(cameraDirection);
  cameraDirection.multiplyScalar(-1);
  mousePlane.lookAt(cameraDirection);

  raycaster.setFromCamera(pointerPos, camera);
  const intersects = raycaster.intersectObjects(
    [mousePlane],
    false
  );
  if (intersects.length > 0) {
    mousePos.copy(intersects[0].point);
  }
}


//Update main game loop
function animate() {

  //cube.rotation.x += 0.01;
  //cube.rotation.y += 0.01;

  world.step();
  handleRaycast();

  //Loop thru phys ents and update them
  var arrayLength = phys_ents.length;
  for (var i = 0; i < arrayLength; i++) {
    phys_ents[i](mousePos);
  }

  renderer.render( scene, camera );
}
renderer.setAnimationLoop( animate );