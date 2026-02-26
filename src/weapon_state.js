import { RAPIER } from '/src/physics';
import world from '/src/physics';
import * as THREE from 'three';
import { scene } from '/src/render';
import camera from '/src/camera';

class weapon {
  constructor(sprite_sheet, maxammo, name) {
    this.sprite_sheet = sprite_sheet;
    this.maxammo = maxammo;
    this.name = name;
  }
}

const testweapon = new weapon('../textures/weaponsprite.png',10,'Test Weapon')

const wp_texture =  new THREE.TextureLoader().load(testweapon.sprite_sheet)

const wp_mat = new THREE.SpriteMaterial({map: wp_texture})
const wp_sprite = new THREE.Sprite( wp_mat );
scene.add( wp_sprite );
wp_sprite.position.set(0,3,0);


export {wp_sprite};    
