// src/spriteMixer.js
import * as THREE from 'three';

/**
 * SpriteMixer - handles spritesheet animations with states and triggers
 * 
 * Usage:
 *   const mixer = new SpriteMixer()
 *   const anim = mixer.createAnimation(sprite, texture, cols, rows, totalFrames, fps)
 *   anim.addState('idle',   0,  3)   // name, startFrame, endFrame
 *   anim.addState('shoot',  4,  7)
 *   anim.addState('reload', 8, 15)
 *   anim.setState('idle')
 *   anim.onFinish = (stateName) => { ... }  // fires when a non-looping state ends
 *   mixer.update(dt)  // call in animate loop
 */

export class SpriteAnimation {
  constructor(sprite, texture, cols, rows, totalFrames, fps) {
    this.sprite      = sprite;
    this.texture     = texture;
    this.cols        = cols;
    this.rows        = rows;
    this.totalFrames = totalFrames;
    this.fps         = fps;

    this.states      = {};
    this.currentState = null;
    this.currentFrame = 0;
    this.timer        = 0;
    this.playing      = false;
    this.loop         = true;

    // Callbacks
    this.onFinish     = null;   // called when non-looping anim ends: (stateName) => {}
    this.onFrame      = null;   // called every frame change: (stateName, frameIndex) => {}

    // Init texture for tiling
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1 / cols, 1 / rows);
    texture.colorSpace = THREE.SRGBColorSpace;

    this._setFrame(0);
  }

  /**
   * @param {string} name
   * @param {number} startFrame  - inclusive
   * @param {number} endFrame    - inclusive
   * @param {boolean} loop
   * @param {number} [fps]       - override fps for this state only
   */
  addState(name, startFrame, endFrame, loop = true, fps = null) {
    this.states[name] = { name, startFrame, endFrame, loop, fps };
    return this;
  }

  setState(name, forceRestart = false) {
    const state = this.states[name];
    if (!state) { console.warn(`SpriteMixer: unknown state "${name}"`); return; }
    if (this.currentState?.name === name && !forceRestart) return;

    this.currentState = state;
    this.currentFrame = state.startFrame;
    this.loop         = state.loop;
    this.timer        = 0;
    this.playing      = true;
    this._setFrame(this.currentFrame);
  }

  /** Play a state once then return to returnState */
  trigger(name, returnState) {
    const state = this.states[name];
    if (!state) { console.warn(`SpriteMixer: unknown state "${name}"`); return; }

    this.setState(name, true);
    this.loop = false;

    const prevOnFinish = this.onFinish;
    this.onFinish = (finishedName) => {
      if (prevOnFinish) prevOnFinish(finishedName);
      this.setState(returnState);
      this.onFinish = prevOnFinish; // restore
    };
  }

  pause()  { this.playing = false; }
  resume() { this.playing = true;  }

  update(dt) {
    if (!this.playing || !this.currentState) return;

    const fps = this.currentState.fps ?? this.fps;
    this.timer += dt;

    if (this.timer >= 1 / fps) {
      this.timer = 0;
      this.currentFrame++;

      if (this.currentFrame > this.currentState.endFrame) {
        if (this.loop) {
          this.currentFrame = this.currentState.startFrame;
        } else {
          this.currentFrame = this.currentState.endFrame;
          this.playing = false;
          if (this.onFinish) this.onFinish(this.currentState.name);
          return;
        }
      }

      this._setFrame(this.currentFrame);
      if (this.onFrame) this.onFrame(this.currentState.name, this.currentFrame);
    }
  }

  _setFrame(index) {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    this.texture.offset.set(col / this.cols, 1 - (row + 1) / this.rows);
  }
}

export class SpriteMixer {
  constructor() {
    this.animations = [];
  }

  /**
   * Create a new SpriteAnimation and register it with this mixer.
   * @param {THREE.Sprite} sprite
   * @param {THREE.Texture} texture  - already loaded
   * @param {number} cols            - columns in the spritesheet
   * @param {number} rows            - rows in the spritesheet
   * @param {number} totalFrames     - actual frame count (may be less than cols*rows)
   * @param {number} fps             - default playback speed
   */
  createAnimation(sprite, texture, cols, rows, totalFrames, fps) {
    const anim = new SpriteAnimation(sprite, texture, cols, rows, totalFrames, fps);
    this.animations.push(anim);
    return anim;
  }

  /** Call once per frame in your animate loop */
  update(dt) {
    for (const anim of this.animations) {
      anim.update(dt);
    }
  }

  dispose(anim) {
    this.animations = this.animations.filter(a => a !== anim);
  }
}