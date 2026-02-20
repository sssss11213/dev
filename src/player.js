import { RAPIER } from '/src/physics';
import world from '/src/physics';
import * as THREE from 'three';



export function get_player(){
    const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.newDynamic().setTranslation(0,5,0)
    );

    const colliderDesc = new RAPIER.ColliderDesc(
    new RAPIER.Ball(12)
    ).setTranslation(0, 0,0);


    const collider = world.createCollider(colliderDesc, body.handle);

    const direction = {
        x: 0,
        y: 0,
    };

    window.addEventListener("keydown", (e) => {
    switch (e.key) {
        case "w": {
        direction.y = -1;
        break;
        }
        case "s": {
        direction.y = 1;
        break;
        }
        case "a": {
        direction.x = -1;
        break;
        }
        case "d": {
        direction.x = 1;
        break;
        }
    }
    });

    window.addEventListener("keyup", (e) => {
    switch (e.key) {
        case "w": {
        direction.y = 0;
        break;
        }
        case "s": {
        direction.y = 0;
        break;
        }
        case "a": {
        direction.x = 0;
        break;
        }
        case "d": {
        direction.x = 0;
        break;
        }
    }
    });

    const MOVE_SPEED = 80;

    const updatePlayer = () => {
    body.setLinvel(
        { x: direction.x * MOVE_SPEED, y: direction.y * MOVE_SPEED },
        true
    );
    };

    return updatePlayer();

}

//export default get_player;
//export {colliderDesc}

