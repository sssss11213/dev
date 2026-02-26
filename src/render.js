import * as THREE from 'three';

export const scene = new THREE.Scene();

export   const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    shadowMap: true,
  });

renderer.setSize( window.innerWidth, window.innerHeight );
renderer.shadowMap.enabled = true;
//renderer.shadowMap.type = THREE.PCFSoftShadowMap;
//renderer.shadowMap.type = THREE.VSMShadowMap

document.body.appendChild( renderer.domElement );