import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

await RAPIER.init();

let gravity = { x: 0.0, y: -9.81, z: 0.0 };
//gravity = { x: 0.0, y: 0.0, z: 0.0 };
let world = new RAPIER.World(gravity);

export default world;
export { RAPIER };