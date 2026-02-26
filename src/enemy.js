import { RAPIER } from '/src/physics';
import world from '/src/physics';
import * as THREE from 'three';
import { scene } from '/src/render';
import camera from '/src/camera';
import { heldEnt } from './player';

class enemy {
  constructor(sprite_sheet, health, name, anim_length) {
    this.sprite_sheet = sprite_sheet;
    this.health = health;
    this.name = name;
    this.anim_length = anim_length;
  }
}

const testenemy = new enemy('../textures/spritesheet.png',100,'Test Enemy',3)

const enemy_texture =  new THREE.TextureLoader().load(testenemy.sprite_sheet)

enemy_texture.offset.set(200 / 300,0)
//offset pixels / image width

const enemy_mat = new THREE.SpriteMaterial({map: enemy_texture})
const enemy_sprite = new THREE.Sprite( enemy_mat );
scene.add( enemy_sprite );  
enemy_sprite.position.set(0,-7.5,0);
enemy_sprite.scale.set(5,5,5)


export {testenemy};    
