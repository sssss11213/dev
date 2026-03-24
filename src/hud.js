import { RAPIER } from '/src/physics';
import world from '/src/physics';
import * as THREE from 'three';
import { scene, renderer, initRenderPipeline, renderPipeline } from '/src/render';
import camera from '/src/camera';
import { health } from './player';
import { suit } from './player';

import { hudScene, hudCamera } from '/src/render';
import { Text } from 'troika-three-text';
const w = window.innerWidth
const h = window.innerHeight

let bibi_active = false;
let bibi = null;

let heart = null;
let crosshair = null;

var spriteMixer = SpriteMixer();

const loader = new THREE.TextureLoader();

function img_rect(texture, pos, w, h) {
    return new Promise((resolve) => {
        loader.load(texture, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
            });
            const sprite = new THREE.Sprite(material);
            sprite.position.set(pos.x, pos.y, pos.z);
            if (w && h) {
                sprite.scale.set(w, h, 1);
            } else {
                sprite.scale.set(300, 400, 1);
            }
            hudScene.add(sprite);
            resolve(sprite); // resolve instead of return
        });
    });
}

async function initHUD() {
    heart = await img_rect('textures/hud/heart.png', new THREE.Vector3(95, 180, 0), 256 / 2.4, 306 / 2.4);
    crosshair = await img_rect(
    'textures/hud/crosshair.png',
    new THREE.Vector3(960, 540, 0),
    188,
    128
    );

    heart.material.color.setRGB(0, 35, 0.1);
}

export function spawn_bibi() {
    loader.load('textures/hud/yahu_idle.png', (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });

        const sprite = new THREE.Sprite(material);

        // In ortho -1 to 1 space:
        // center = (0, 0), bottom-left = (-1, -1), top-right = (1, 1)
       // sprite.position.set(-0.7, 0.7, 0);  // bottom-left area

        const sprite_scale = 0.5;

        sprite.position.set(190, 930, 0);  // 100px from left, 100px from bottom
        sprite.scale.set(400, 400, 1);     // 200x200 pixels

        hudScene.add(sprite);
        bibi_active = true;
        bibi = sprite
    });
}


let currentbibi = 'textures/hud/yahu_idle.png';
let lastbibi = '';

let lastTime = 0;
let bibiTimer = 0;

let heartTimer = 0;

let frameCount = 0;

export function animate_hud(dt) {
    if (!bibi_active) return;
    const now = performance.now();
    const realDt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    bibiTimer += realDt;
    heartTimer += realDt;

    // bibi animation
    if (bibiTimer >= 0.2) {
        bibiTimer = 0;
        currentbibi = currentbibi === 'textures/hud/yahu_idle.png' 
            ? 'textures/hud/yahu_speak.png' 
            : 'textures/hud/yahu_idle.png';
    }

    if (currentbibi !== lastbibi) {
        lastbibi = currentbibi;
        loader.load(currentbibi, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            bibi.material.map = texture;
            bibi.material.needsUpdate = true;
        });
    }

    // heart animation — independent
    if (heartTimer >= 0.05) {
        heartTimer = 0;
        frameCount = frameCount >= 15 ? 0 : frameCount + 1;

        if (heart != null) {
            const pad = String(frameCount).padStart(4, '0');
            loader.load('textures/hud/heart/' + pad + '.png', (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                heart.material.map = texture;
                heart.material.needsUpdate = true;
            });
        }
    }
}

initHUD();

//const health_filled = img_rect('textures/hud/liquid.png', new THREE.Vector3((w / 2) + 780,846,0),210,48)

const display = img_rect('textures/hud/display.png', new THREE.Vector3(162, 228, -1), 346, 476);

const profile = img_rect(
    'textures/hud/profile.png',
    new THREE.Vector3(
        1920 - 245,    // right edge - half width - margin
        1080 - 160,    // top edge  - half height - margin
        -1                  // z = in front
    ),
    512, 512
);

const health_sprite = img_rect(
    'textures/hud/syringe.png',
    new THREE.Vector3(
        1920 - 160,    // right edge - half width - margin
        1080 - 400,    // top edge  - half height - margin
        -1                  // z = in front
    ),
    256 * 1.2, 256 * 1.2
);

const suit_sprite = img_rect(
    'textures/hud/syringe.png',
    new THREE.Vector3(
        1920 - 160,    // right edge - half width - margin
        1080 - 460,    // top edge  - half height - margin
        -1                  // z = in front
    ),
    256 * 1.2, 256 * 1.2
);

