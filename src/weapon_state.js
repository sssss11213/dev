import { RAPIER } from '/src/physics';
import world from '/src/physics';
import * as THREE from 'three';
import { scene } from '/src/render';
import camera from '/src/camera';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mix, mod } from 'three/tsl';

let wp_viewmodel = null;
let lastdigitinput = null;
let currentWeapon = null;
let currentSlot = 1;

const clock = new THREE.Clock(true)

class weapon {
  constructor(sprite_sheet, maxammo, name) {
    this.sprite_sheet = sprite_sheet;
    this.maxammo = maxammo;
    this.name = name;
  }
}

const slots = {
  1: weapon,
  2: weapon
};

window.addEventListener('keydown', e => {
  e.preventDefault();
  //THREE.log(e.code)
  switch (e.code) {
    case 'Digit1':  switchWeapon(1); break;
    case 'Digit2':  switchWeapon(2); break;
  }
});

const loader = new GLTFLoader();

let mixer = null;

export function LoadViewmodel(shouldUpdateMesh,geometry){
  if (shouldUpdateMesh != true){
  const testweapon = new weapon('models/merchant.glb',10,'Test Weapon')
  const testweapon2 = new weapon('models/exported/viewmodel_galil_F.glb',10,'Test Weapon number 2')

  loader.load( testweapon.sprite_sheet, function ( gltf ) {

    // 1. Grab the model from the gltf object
    wp_viewmodel = gltf.scene; 
    
    // 2. Set the scale correctly
    wp_viewmodel.scale.set(1,1,1);
    wp_viewmodel.position.set(0,5,0); 

    // 3. Add it to the scene
    scene.add( wp_viewmodel );

    console.log("Viewmodel loaded successfully!");
    slots[1] = testweapon
    slots[2] = testweapon2 

    switchWeapon(2)

  }, undefined, function ( error ) {
    console.error( "An error happened:", error );
  } );
  }else{
  loader.load( slots[currentSlot].sprite_sheet, function ( gltf ) {
    const model = gltf.scene
    wp_viewmodel.traverse(function (child){
      if (child.isMesh){
        //child.geometry = model.geometry
        model.position.set(wp_viewmodel.position.x,wp_viewmodel.position.y,wp_viewmodel.position.z)
        model.scale.set(wp_viewmodel.scale.x,wp_viewmodel.scale.y,wp_viewmodel.scale.z)
        scene.remove(wp_viewmodel)
        wp_viewmodel = model
        scene.add(wp_viewmodel)
        THREE.log('geometry switched')


        mixer = new THREE.AnimationMixer(model);

        // Option 1: Play the first animation (most common)
        //const action = mixer.clipAction('IdleAnim');
        //const action = mixer.clipAction(gltf.animations[0]);
        THREE.log(mixer.clipAction('Idle'))
        //action.play();
        //action.loop = THREE.LoopRepeat;

        const clips = model.animations;

        const clip = THREE.AnimationClip.findByName( clips, 'IdleAnim' );
        const action = mixer.clipAction( clip );
        //action.play();
        clips.forEach( function ( clipn ) {
          THREE.log(mixer.clipAction(clipn).name)
        } );

      }
    })
  });
  } 
}

function updateViewmodel(){
  if (wp_viewmodel != null){
    wp_viewmodel.position.set(camera.position.x,camera.position.y,camera.position.z)

    wp_viewmodel.quaternion.copy(camera.quaternion);

    if (mixer != null){
    mixer.update( clock.getDelta );
    }
  }
  else{
    THREE.warn('Viewmodel is not loaded')
  }
}

function switchWeapon(slot){
  if (slot != lastdigitinput){
    THREE.log(slots[slot].name)
    currentWeapon = slots[slot]
    currentSlot = slot
    LoadViewmodel(true)
  }
  lastdigitinput = slot;
}

function fireWeapon(){
  let cameraDirection = new THREE.Vector3();

  // orient the mouse plane to the camera
  camera.getWorldDirection(cameraDirection);
  cameraDirection.multiplyScalar(-1);
  //mousePlane.lookAt(cameraDirection);

  raycaster.setFromCamera(pointerPos, camera);
  const intersects = raycaster.intersectObjects(
    //[mousePlane],
    [floor],
    false
  );
  if (intersects.length > 0) {
    mousePos.copy(intersects[0].point);
    //mousePlane.position.set(intersects[0].point.x, intersects[0].point.y, intersects[0].point.z);
  }
}

export {wp_viewmodel};
export { updateViewmodel };
export { currentSlot };
