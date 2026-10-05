/**
 * The picture.
 *
 * Three programs and no more. The world is one buffer of pre-lit triangles with
 * a texture per material; everything that moves is boxes with a light value
 * worked out per object; everything on fire is an additive square facing the
 * camera. The only lighting the card does at run time is the four or five things
 * currently glowing, because the rest of it was baked into the walls before the
 * match started - see mesh.js.
 *
 * The renderer never touches the simulation. It is handed a state and a point of
 * view and it draws them; it keeps its own list of sparks and smoke, fed from
 * the events the simulation pushes out, and if it is skipped for a frame nothing
 * about the match changes.
 */

import { combatEffects, limitCombatEffects } from '../metafight/visuals/effects.js';
import {
  FLASH_TICKS, MAX_BODIES, P_EYE, P_HEIGHT, P_RADIUS, TEAMS, TICK_RATE, TRAIL_TICKS, WEAPONS,
} from '../constants.js';
import { toRadians } from '../util.js';
import { loadMap } from '../game/maps.js';
import { buildWorld } from '../game/world.js';
import { buildMesh, sampleLight } from './mesh.js';
import {
  buildBody, buildPickups, buildQuad, buildViewModels, STRIDE,
} from './models.js';
import {
  buffer, compile, getContext, lookAlong, makeTextures, modelMatrix, multiply, perspective,
  whiteTexture,
} from './gl.js';

const MAX_LIGHTS = 8;

/** The colours of the four seats in a free for all. */
export const BODY_COLOURS = [
  [0.95, 0.82, 0.35], [0.45, 0.85, 0.95], [0.85, 0.45, 0.9], [0.55, 0.9, 0.5],
  [0.95, 0.55, 0.3], [0.6, 0.65, 0.95], [0.9, 0.9, 0.9], [0.5, 0.75, 0.6],
];

const WORLD_VS = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
attribute vec3 aLight;
uniform mat4 uViewProj;
varying vec2 vUV;
varying vec3 vLight;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vUV = aUV;
  vLight = aLight;
  vNormal = aNormal;
  vWorld = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const WORLD_FS = `
precision highp float;
varying vec2 vUV;
varying vec3 vLight;
varying vec3 vNormal;
varying vec3 vWorld;
uniform sampler2D uTex;
uniform float uDaylight;
uniform float uSea;
uniform float uTime;
uniform vec3 uCamera;
uniform vec3 uFogColour;
uniform float uFog;
uniform float uExposure;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColour[${MAX_LIGHTS}];
void main() {
  vec3 albedo = texture2D(uTex, vUV).rgb;
  albedo=mix(albedo,pow(albedo,vec3(2.2)),uDaylight);
  if(uSea>.5){
    float wave=sin(vWorld.x*1.7+sin(vWorld.z*2.4)+uTime*.7)*sin(vWorld.z*3.7-uTime*.8);
    albedo=vec3(.025,.15,.24)+vec3(.055,.075,.075)*smoothstep(.30,.95,wave);
  }
  vec3 light = vLight;
  vec3 n = normalize(vNormal);
  // The handful of things actually on fire. Unused slots carry a radius of zero
  // and fall out of the arithmetic rather than out of a branch.
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 d = uLightPos[i].xyz - vWorld;
    float dist = length(d);
    float radius = uLightPos[i].w;
    float fall = max(0.0, 1.0 - dist / max(radius, 0.0001));
    float lam = max(0.0, dot(n, d / max(dist, 0.0001)));
    light += uLightColour[i] * (fall * fall * lam);
  }
  vec3 colour = albedo * light * uExposure;
  float dist = length(vWorld - uCamera);
  float fog = 1.0 - exp(-uFog * dist);
  colour = mix(colour, uFogColour, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(pow(max(colour, 0.0), vec3(0.4545)), 1.0);
}`;

const MODEL_VS = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColour;
attribute float aGlow;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uWalk;
varying vec3 vLocal;
varying vec3 vColour;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vGlow;
void main() {
  vec3 p=aPos, n=aNormal;
  if(aGlow<-.5){
    float a=uWalk*(aGlow< -1.5 ? -1.0 : 1.0),c=cos(a),s=sin(a);
    vec2 leg=vec2(p.x,p.y-.89);
    p.xy=vec2(c*leg.x-s*leg.y,s*leg.x+c*leg.y)+vec2(0.0,.89);
    n.xy=vec2(c*n.x-s*n.y,s*n.x+c*n.y);
  }
  vLocal=aPos;
  vec4 world = uModel * vec4(p, 1.0);
  vWorld = world.xyz;
  vColour = aColour;
  vGlow = max(0.0,aGlow);
  vNormal = mat3(uModel) * n;
  gl_Position = uViewProj * world;
}`;

const MODEL_FS = `
precision highp float;
varying vec3 vLocal;
uniform float uDaylight;
varying vec3 vColour;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vGlow;
uniform vec3 uTint;
uniform vec3 uBase;
uniform vec3 uCamera;
uniform vec3 uFogColour;
uniform float uFog;
uniform float uExposure;
uniform float uAlpha;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColour[${MAX_LIGHTS}];
void main() {
  vec3 n = normalize(vNormal);
  // A little sky in the top faces so a body reads as solid even in flat light.
  vec3 light = uBase * (0.62 + 0.38 * max(0.0, n.y));
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 d = uLightPos[i].xyz - vWorld;
    float dist = length(d);
    float fall = max(0.0, 1.0 - dist / max(uLightPos[i].w, 0.0001));
    float lam = max(0.0, dot(n, d / max(dist, 0.0001)));
    light += uLightColour[i] * (fall * fall * lam);
  }
  light += uDaylight*vec3(.44,.40,.33)*max(0.0,dot(n,normalize(vec3(-.46,.82,.34))));
  vec3 base = vColour * uTint;
  // Subtle weave and edge sheen on original equipment, at no texture cost.
  float weave=.97+.03*sin(vLocal.y*240.0)*sin(vLocal.z*230.0);
  base *= mix(1.0,weave,uDaylight);
  vec3 halfDir=normalize(normalize(uCamera-vWorld)+normalize(vec3(-.46,.82,.34)));
  light += uDaylight*.16*pow(max(0.0,dot(n,halfDir)),24.0);
  vec3 colour = base * light * uExposure + base * vGlow * 0.85;
  float dist = length(vWorld - uCamera);
  float fog = 1.0 - exp(-uFog * dist);
  colour = mix(colour, uFogColour, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(pow(max(colour, 0.0), vec3(0.4545)), uAlpha);
}`;

const SPRITE_VS = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uViewProj;
uniform vec3 uCentre;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
varying vec2 vUV;
void main() {
  vUV = aUV;
  vec3 world = uCentre + uRight * (aPos.x * uSize) + uUp * (aPos.y * uSize);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const SPRITE_FS = `
precision highp float;
varying vec2 vUV;
uniform vec3 uColour;
uniform float uAlpha;
void main() {
  vec2 d = vUV - 0.5;
  float r = length(d) * 2.0;
  float a = max(0.0, 1.0 - r);
  a = a * a;
  gl_FragColor = vec4(uColour * a * uAlpha, a * uAlpha);
}`;

const SKY_VS = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos.xy * 2.0, 0.9999, 1.0);
}`;

const SKY_FS = `
precision highp float;
varying vec2 vUV;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uHorizon;
uniform float uDaylight;
void main() {
  float t = clamp((vUV.y - uHorizon) * 1.6 + 0.5, 0.0, 1.0);
  vec3 c = mix(uBottom, uTop, t);
  float cloud=sin(vUV.x*27.0+sin(vUV.y*19.0))*sin(vUV.y*33.0+sin(vUV.x*11.0));
  float haze=smoothstep(.27,.8,cloud)*smoothstep(.02,.2,t)*(1.0-smoothstep(.45,.95,t));
  c=mix(c,vec3(.70,.76,.78),haze*.25*uDaylight);
  gl_FragColor = vec4(pow(max(c, 0.0), vec3(0.4545)), 1.0);
}`;

export class Renderer {
  constructor(canvas, appearance = {}) {
    this.canvas = canvas;
    this.gl = getContext(canvas);
    if (!this.gl) throw new Error('This game needs WebGL, and this browser has not got it.');
    const gl = this.gl;

    this.world = compile(gl, WORLD_VS, WORLD_FS);
    this.model = compile(gl, MODEL_VS, MODEL_FS);
    this.sprite = compile(gl, SPRITE_VS, SPRITE_FS);
    this.sky = compile(gl, SKY_VS, SKY_FS);

    this.textures = (appearance.textures || makeTextures)(gl);
    this.white = whiteTexture(gl);

    this.teamMeshes = appearance.bodies ? appearance.bodies.map(m => upload(gl, m)) : null;
    this.bodyMesh = this.teamMeshes ? this.teamMeshes[0] : upload(gl, buildBody());
    this.viewModels = (appearance.weapons || buildViewModels()).map((m) => upload(gl, m));
    this.viewScale = appearance.viewScale || 0.30;
    this.pickups = {};
    const pickups = buildPickups();
    for (const key of Object.keys(pickups)) this.pickups[key] = upload(gl, pickups[key]);
    this.quad = upload(gl, buildQuad(), 10);

    this.viewProj = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.modelM = new Float32Array(16);
    this.partM = new Float32Array(16);
    this.tmpM = new Float32Array(16);

    this.lightPos = new Float32Array(MAX_LIGHTS * 4);
    this.lightColour = new Float32Array(MAX_LIGHTS * 3);

    this.effects = [];
    this.bodyLight = [];
    for (let i = 0; i < MAX_BODIES; i++) this.bodyLight.push({ colour: [0.2, 0.2, 0.2], at: -999 });

    this.time = 0;
    this.eyeY = 0;
    this.bob = 0;
    this.kick = 0;
    this.roll = 0;
    this.map = null;
  }

  /** Build and upload an arena. The slow part is the light, and it is once. */
  setMap(key, mapData) {
    const gl = this.gl;
    const map = mapData || loadMap(key);
    const world = buildWorld(map);
    const mesh = buildMesh(world, map);
    if (this.mapBuffers) {
      gl.deleteBuffer(this.mapBuffers.vertex);
      gl.deleteBuffer(this.mapBuffers.index);
    }
    this.mapBuffers = {
      vertex: buffer(gl, gl.ARRAY_BUFFER, mesh.vertices),
      index: buffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices),
      groups: mesh.groups,
    };
    if(this.detailMesh){gl.deleteBuffer(this.detailMesh.vertex);gl.deleteBuffer(this.detailMesh.index);}
    this.detailMesh=map.detailMesh ? upload(gl,map.detailMesh) : null;
    this.map = map;
    this.worldGeom = world;
    this.mesh = mesh;
    this.effects.length = 0;
    for (const entry of this.bodyLight) entry.at = -999;
    return mesh;
  }

  resize(width, height, dpr) {
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  // --- What the simulation just did ------------------------------------------

  /**
   * Turn a tick's worth of events into things to look at.
   *
   * Everything here is decoration: it has a position, a lifetime and no opinion
   * about the match. Which is why it can be dropped on a slow frame, and why the
   * simulation never asks what happened to it.
   */
  addEvents(state, events, localIndex, options = {}) {
    if (state.product && this.teamMeshes) {
      for (const e of events) if (e.type === 'fire' && e.body === localIndex) this.kick = Math.min(1.2, this.kick + .52);
      this.effects = limitCombatEffects(this.effects.concat(combatEffects(events, localIndex, options.quality)), options.quality);
      return;
    }
    for (const e of events) {
      if (e.type === 'fire') {
        const weapon = WEAPONS[e.weapon];
        this.effects.push({
          kind: 'flash', x: e.x + e.dx * 0.5, y: e.y + e.dy * 0.5, z: e.z + e.dz * 0.5,
          life: FLASH_TICKS, max: FLASH_TICKS, size: weapon.kind === 'projectile' ? 1.6 : 1.0,
          colour: weapon.light, light: 9,
        });
        if (e.body === localIndex) this.kick = Math.min(1.4, this.kick + weapon.kick * 0.22 + 0.25);
      } else if (e.type === 'trail') {
        this.effects.push({
          kind: 'trail', x: e.x, y: e.y, z: e.z, x2: e.x2, y2: e.y2, z2: e.z2,
          life: TRAIL_TICKS, max: TRAIL_TICKS, colour: WEAPONS[e.weapon].light,
        });
      } else if (e.type === 'impact') {
        for (let i = 0; i < 5; i++) {
          this.effects.push({
            kind: 'spark', x: e.x, y: e.y, z: e.z,
            vx: e.nx * 2 + (Math.random() - 0.5) * 3,
            vy: e.ny * 2 + Math.random() * 2.5,
            vz: e.nz * 2 + (Math.random() - 0.5) * 3,
            life: 16 + Math.random() * 12, max: 28, colour: [1, 0.75, 0.4], size: 0.09,
          });
        }
        this.effects.push({
          kind: 'puff', x: e.x + e.nx * 0.1, y: e.y + e.ny * 0.1, z: e.z + e.nz * 0.1,
          life: 22, max: 22, size: 0.5, colour: [0.5, 0.48, 0.45],
        });
      } else if (e.type === 'hit') {
        for (let i = 0; i < 6; i++) {
          this.effects.push({
            kind: 'spark', x: e.x, y: e.y, z: e.z,
            vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4,
            life: 14 + Math.random() * 10, max: 24, colour: [1.0, 0.3, 0.25], size: 0.08,
          });
        }
      } else if (e.type === 'explode') {
        this.effects.push({
          kind: 'blast', x: e.x, y: e.y, z: e.z, life: 26, max: 26,
          size: 4.2, colour: [1.0, 0.62, 0.28], light: 16,
        });
        for (let i = 0; i < 14; i++) {
          this.effects.push({
            kind: 'spark', x: e.x, y: e.y, z: e.z,
            vx: (Math.random() - 0.5) * 14, vy: Math.random() * 9 - 1, vz: (Math.random() - 0.5) * 14,
            life: 20 + Math.random() * 24, max: 44, colour: [1, 0.6, 0.25], size: 0.12,
          });
        }
      } else if (e.type === 'death') {
        for (let i = 0; i < 10; i++) {
          this.effects.push({
            kind: 'spark', x: e.x, y: e.y + 1, z: e.z,
            vx: (Math.random() - 0.5) * 6, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 6,
            life: 24 + Math.random() * 20, max: 44, colour: [0.9, 0.25, 0.2], size: 0.1,
          });
        }
      } else if (e.type === 'spawn' || e.type === 'pad') {
        this.effects.push({
          kind: 'blast', x: e.x, y: e.y + 0.9, z: e.z, life: 18, max: 18,
          size: 2.0, colour: e.type === 'pad' ? [0.4, 0.8, 1.0] : [0.6, 0.9, 1.0], light: 7,
        });
      } else if (e.type === 'pickup') {
        this.effects.push({
          kind: 'blast', x: e.x, y: e.y, z: e.z, life: 14, max: 14,
          size: 1.4, colour: [0.7, 1.0, 0.8], light: 5,
        });
      }
    }
  }

  step(dt) {
    this.time += dt;
    const keep = [];
    for (const fx of this.effects) {
      fx.life -= dt * TICK_RATE;
      if (fx.life <= 0) continue;
      if (fx.kind === 'spark') {
        fx.vy -= 20 * dt;
        fx.x += fx.vx * dt;
        fx.y += fx.vy * dt;
        fx.z += fx.vz * dt;
      }
      keep.push(fx);
    }
    this.effects = keep;
    this.kick *= Math.max(0, 1 - dt * 9);
  }

  // --- Drawing ---------------------------------------------------------------

  draw(state, opts) {
    const gl = this.gl;
    const map = this.map;
    const body = state.bodies[opts.index];
    const dead = body && !body.alive;
    // The simulation moves in whole ticks and the screen does not, so
    // everything is drawn between where it was and where it is. Without this a
    // hundred and twenty hertz monitor shows sixty hertz of movement twice.
    this.alpha = opts.alpha === undefined ? 1 : opts.alpha;

    // Where the eye is. The height is chased rather than set, so walking up a
    // staircase is a climb rather than a series of jolts - the one thing a step
    // up of half a metre a frame would otherwise do to a first person camera.
    const targetY = lerpTo(body.py, body.y, this.alpha) + P_EYE;
    if (Math.abs(targetY - this.eyeY) > 2.2) this.eyeY = targetY;
    else this.eyeY += (targetY - this.eyeY) * Math.min(1, opts.dt * 16);

    const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
    this.bob += opts.dt * (2.0 + speed * 1.15);
    const bobAmount = body.onGround && !opts.reducedMotion ? Math.min(1, speed / 9) * 0.055 : 0;
    const eyeX = lerpTo(body.px, body.x, this.alpha);
    const eyeY = this.eyeY + Math.sin(this.bob * 2) * bobAmount
      + (dead ? -1.0 : 0);
    const eyeZ = lerpTo(body.pz, body.z, this.alpha);
    this.cameraEye = { x: eyeX, y: eyeY, z: eyeZ };

    const yaw = toRadians(opts.yaw);
    const pitch = toRadians(opts.pitch) + (state.product || opts.reducedMotion ? 0 : this.kick * 0.06);
    const cp = Math.cos(pitch);
    const dx = Math.cos(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = Math.sin(yaw) * cp;

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    // Ninety degrees across, whatever shape the window is: a wide window shows
    // more of the room, a tall one does not show less of it.
    const fovX = (opts.fov || 90) * Math.PI / 180;
    const fovY = 2 * Math.atan(Math.tan(fovX / 2) / Math.max(0.6, aspect));
    perspective(this.proj, fovY, aspect, 0.04, 420);
    lookAlong(this.view, eyeX, eyeY, eyeZ, dx, dy, dz);
    multiply(this.viewProj, this.proj, this.view);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.clearColor(map.sky[0], map.sky[1], map.sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.gatherLights(state, eyeX, eyeY, eyeZ);
    this.drawSky(dy);
    this.drawWorld(eyeX, eyeY, eyeZ);
    if(this.detailMesh){
      const u=this.beginModels(eyeX,eyeY,eyeZ);
      this.bindModel(this.detailMesh);modelMatrix(this.modelM,0,0,0,0);
      gl.uniformMatrix4fv(u.uModel,false,this.modelM);
      gl.uniform3f(u.uTint,1,1,1);gl.uniform3f(u.uBase,.95,1.0,1.06);
      gl.drawElements(gl.TRIANGLES,this.detailMesh.count,gl.UNSIGNED_SHORT,0);
    }
    this.drawBodies(state, opts, eyeX, eyeY, eyeZ);
    this.drawThings(state, eyeX, eyeY, eyeZ);
    this.drawEffects(eyeX, eyeY, eyeZ);
    if (!dead) this.drawViewModel(state, body, eyeX, eyeY, eyeZ, dx, dy, dz, opts);
  }

  /** The eight brightest things on fire, nearest the camera. */
  gatherLights(state, ex, ey, ez) {
    const found = [];
    for (const fx of this.effects) {
      if (!fx.light) continue;
      const k = fx.life / fx.max;
      found.push({
        x: fx.x, y: fx.y, z: fx.z, r: fx.light * (fx.kind === 'blast' ? 0.6 + k * 0.4 : k),
        cr: fx.colour[0] * k * 1.5, cg: fx.colour[1] * k * 1.5, cb: fx.colour[2] * k * 1.5,
        d: (fx.x - ex) ** 2 + (fx.y - ey) ** 2 + (fx.z - ez) ** 2,
      });
    }
    for (const p of state.projectiles) {
      const weapon = WEAPONS[p.weapon];
      found.push({
        x: p.x, y: p.y, z: p.z, r: 7,
        cr: weapon.light[0] * 0.9, cg: weapon.light[1] * 0.9, cb: weapon.light[2] * 0.9,
        d: (p.x - ex) ** 2 + (p.y - ey) ** 2 + (p.z - ez) ** 2,
      });
    }
    found.sort((a, b) => a.d - b.d);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = found[i];
      this.lightPos[i * 4] = l ? l.x : 0;
      this.lightPos[i * 4 + 1] = l ? l.y : 0;
      this.lightPos[i * 4 + 2] = l ? l.z : 0;
      this.lightPos[i * 4 + 3] = l ? l.r : 0;
      this.lightColour[i * 3] = l ? l.cr : 0;
      this.lightColour[i * 3 + 1] = l ? l.cg : 0;
      this.lightColour[i * 3 + 2] = l ? l.cb : 0;
    }
  }

  drawSky(lookY) {
    const gl = this.gl;
    const map = this.map;
    const { program, uniforms, attribs } = this.sky;
    gl.useProgram(program);
    gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.vertex);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quad.index);
    gl.enableVertexAttribArray(attribs.aPos);
    gl.vertexAttribPointer(attribs.aPos, 3, gl.FLOAT, false, 10 * 4, 0);
    gl.enableVertexAttribArray(attribs.aUV);
    gl.vertexAttribPointer(attribs.aUV, 2, gl.FLOAT, false, 10 * 4, 6 * 4);
    const top = map.outdoor ? [map.sky[0] * 1.3, map.sky[1] * 1.35, map.sky[2] * 1.5] : map.sky;
    gl.uniform3f(uniforms.uTop, top[0], top[1], top[2]);
    if(map.daylight) gl.uniform3f(uniforms.uBottom,.55,.65,.70);
    else gl.uniform3f(uniforms.uBottom, map.sky[0] * 0.55, map.sky[1] * 0.6, map.sky[2] * 0.7);
    gl.uniform1f(uniforms.uDaylight,map.daylight?1:0);
    gl.uniform1f(uniforms.uHorizon, 0.5 - lookY * 0.4);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
  }

  drawWorld(ex, ey, ez) {
    const gl = this.gl;
    const map = this.map;
    const { program, uniforms, attribs } = this.world;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mapBuffers.vertex);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.mapBuffers.index);
    const stride = 11 * 4;
    gl.enableVertexAttribArray(attribs.aPos);
    gl.vertexAttribPointer(attribs.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(attribs.aNormal);
    gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(attribs.aUV);
    gl.vertexAttribPointer(attribs.aUV, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(attribs.aLight);
    gl.vertexAttribPointer(attribs.aLight, 3, gl.FLOAT, false, stride, 32);

    gl.uniformMatrix4fv(uniforms.uViewProj, false, this.viewProj);
    gl.uniform3f(uniforms.uCamera, ex, ey, ez);
    gl.uniform3f(uniforms.uFogColour, map.sky[0] * 0.9, map.sky[1] * 0.9, map.sky[2]);
    gl.uniform1f(uniforms.uFog, map.fog);
    gl.uniform1f(uniforms.uExposure, 1.15);
    gl.uniform4fv(uniforms.uLightPos, this.lightPos);
    gl.uniform3fv(uniforms.uLightColour, this.lightColour);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(uniforms.uTex, 0);
    gl.uniform1f(uniforms.uDaylight,map.daylight?1:0);
    gl.uniform1f(uniforms.uTime,this.time);

    for (const group of this.mapBuffers.groups) {
      gl.uniform1f(uniforms.uSea,map.daylight && group.mat===6?1:0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[group.mat] || this.textures[0]);
      gl.drawElements(gl.TRIANGLES, group.count, gl.UNSIGNED_INT, group.offset * 4);
    }
  }

  /** Set up the model program once, then draw as many boxes as we like. */
  beginModels(ex, ey, ez) {
    const gl = this.gl;
    const { program, uniforms } = this.model;
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.uViewProj, false, this.viewProj);
    gl.uniform3f(uniforms.uCamera, ex, ey, ez);
    gl.uniform3f(uniforms.uFogColour, this.map.sky[0] * 0.9, this.map.sky[1] * 0.9, this.map.sky[2]);
    gl.uniform1f(uniforms.uFog, this.map.fog);
    gl.uniform1f(uniforms.uExposure, 1.15);
    gl.uniform1f(uniforms.uAlpha, 1);
    gl.uniform1f(uniforms.uWalk,0);
    gl.uniform1f(uniforms.uDaylight,this.map.daylight?1:0);
    gl.uniform4fv(uniforms.uLightPos, this.lightPos);
    gl.uniform3fv(uniforms.uLightColour, this.lightColour);
    return uniforms;
  }

  bindModel(mesh) {
    const gl = this.gl;
    const { attribs } = this.model;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertex);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    const stride = STRIDE * 4;
    gl.enableVertexAttribArray(attribs.aPos);
    gl.vertexAttribPointer(attribs.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(attribs.aNormal);
    gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(attribs.aColour);
    gl.vertexAttribPointer(attribs.aColour, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(attribs.aGlow);
    gl.vertexAttribPointer(attribs.aGlow, 1, gl.FLOAT, false, stride, 36);
  }

  /** What colour the light is where this thing is standing. Cached: it is a
   *  handful of rays, and a body does not move far in a tenth of a second. */
  lightAt(index, x, y, z) {
    const entry = this.bodyLight[index] || (this.bodyLight[index] = { colour: [0.2, 0.2, 0.2], at: -999 });
    if (this.time - entry.at > 0.1) {
      entry.at = this.time;
      sampleLight(this.worldGeom, this.map, x, y + 1.0, z, entry.colour);
    }
    return entry.colour;
  }

  drawBodies(state, opts, ex, ey, ez) {
    const gl = this.gl;
    const uniforms = this.beginModels(ex, ey, ez);
    this.bindModel(this.bodyMesh);
    const teams = state.flags.length > 0 || state.config.mode !== 'dm';

    for (const body of state.bodies) {
      if (!body.alive) continue;
      if (body.index === opts.index && !opts.thirdPerson) continue;
      const bx = lerpTo(body.px, body.x, this.alpha);
      const by = lerpTo(body.py, body.y, this.alpha);
      const bz = lerpTo(body.pz, body.z, this.alpha);
      const dxb = bx - ex;
      const dzb = bz - ez;
      if (dxb * dxb + dzb * dzb > 250 * 250) continue;

      const tint = teams && body.team >= 0
        ? mixColour(TEAMS[body.team].colour, 0.72)
        : mixColour(BODY_COLOURS[body.index % BODY_COLOURS.length], 0.9);
      if (this.teamMeshes) gl.uniform3f(uniforms.uTint, 1, 1, 1);
      else gl.uniform3f(uniforms.uTint, tint[0], tint[1], tint[2]);
      const light = this.lightAt(body.index, bx, by, bz);
      // Just spawned, and briefly untouchable: lit from inside so that it reads
      // across the room without a label.
      const shield = body.shield > 0 ? 0.5 + 0.5 * Math.sin(this.time * 22) : 0;
      gl.uniform3f(uniforms.uBase, light[0] + shield * 0.5, light[1] + shield * 0.7,
        light[2] + shield * 0.9);

      const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
      const swing = Math.sin(this.time * 9 + body.index) * Math.min(1, speed / 8) * 0.62;
      const yawR = toRadians(body.pyaw === undefined ? body.yaw
        : body.pyaw + shortWay(body.pyaw, body.yaw) * this.alpha);
      const pitchR = toRadians(body.pitch);

      if (state.product) {
        // Vertex-tagged legs animate within one character draw.
        // No reduction in actors, collision, navigation or weapon workload.
        const mesh = this.teamMeshes ? this.teamMeshes[body.team] : this.bodyMesh;
        if (this.teamMeshes) this.bindModel(mesh);
        gl.uniform1f(uniforms.uWalk,this.teamMeshes?swing:0);
        modelMatrix(this.modelM, bx, by, bz, yawR);
        gl.uniformMatrix4fv(uniforms.uModel, false, this.modelM);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
        continue;
      }

      for (const part of this.bodyMesh.parts) {
        let angle = 0;
        if (part.name === 'legR') angle = swing;
        else if (part.name === 'legL') angle = -swing;
        else if (part.name === 'armR' || part.name === 'gun') angle = -swing * 0.45 - pitchR * 0.55;
        else if (part.name === 'armL') angle = swing * 0.45;
        else if (part.name === 'head') angle = -pitchR * 0.8;
        else if (part.name === 'torso') angle = -Math.min(0.18, speed * 0.012);

        partTransform(this.partM, part.pivot, angle);
        modelMatrix(this.modelM, bx, by, bz, yawR);
        multiply(this.tmpM, this.modelM, this.partM);
        gl.uniformMatrix4fv(uniforms.uModel, false, this.tmpM);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, part.offset * 2);
      }
    }
  }

  drawThings(state, ex, ey, ez) {
    const gl = this.gl;
    const uniforms = this.beginModels(ex, ey, ez);
    const spin = this.time * 1.6;
    const hover = Math.sin(this.time * 2.2) * 0.09;

    for (const item of state.items) {
      if (!item.live) continue;
      // A gun on the floor is drawn as that gun, turning over. It is the same
      // mesh you see in your own hands, which means you can tell a rocket
      // launcher from a rail rifle across the room without a label on it.
      const mesh = item.type === 'weapon'
        ? (this.viewModels[item.weapon] || this.viewModels[0])
        : (this.pickups[item.type] || this.pickups.ammo);
      const scale = item.type === 'weapon' ? 0.62 : 1;
      this.bindModel(mesh);
      const light = this.lightAt(MAX_BODIES - 1, item.x, item.y, item.z);
      gl.uniform3f(uniforms.uBase, light[0] + 0.25, light[1] + 0.25, light[2] + 0.25);
      const tint = item.type === 'weapon' ? weaponTint(item.weapon) : [1, 1, 1];
      gl.uniform3f(uniforms.uTint, tint[0], tint[1], tint[2]);
      modelMatrix(this.modelM, item.x, item.y + hover, item.z, spin, scale, scale, scale);
      gl.uniformMatrix4fv(uniforms.uModel, false, this.modelM);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    for (const flag of state.flags) {
      if (flag.status === 'carried') continue;
      this.bindModel(this.pickups.flag);
      const colour = TEAMS[flag.team].colour;
      gl.uniform3f(uniforms.uTint, colour[0], colour[1], colour[2]);
      gl.uniform3f(uniforms.uBase, 0.8, 0.8, 0.9);
      modelMatrix(this.modelM, flag.x, flag.y + 0.35 + hover * 0.4, flag.z, this.time * 0.6);
      gl.uniformMatrix4fv(uniforms.uModel, false, this.modelM);
      gl.drawElements(gl.TRIANGLES, this.pickups.flag.count, gl.UNSIGNED_SHORT, 0);
    }
    // A carried flag rides on the shoulder of whoever has it.
    for (const flag of state.flags) {
      if (flag.status !== 'carried') continue;
      const carrier = state.bodies[flag.carrier];
      if (!carrier || !carrier.alive) continue;
      this.bindModel(this.pickups.flag);
      const colour = TEAMS[flag.team].colour;
      gl.uniform3f(uniforms.uTint, colour[0], colour[1], colour[2]);
      gl.uniform3f(uniforms.uBase, 0.9, 0.9, 1.0);
      modelMatrix(this.modelM, carrier.x, carrier.y + 1.5, carrier.z, toRadians(carrier.yaw) + 0.4);
      gl.uniformMatrix4fv(uniforms.uModel, false, this.modelM);
      gl.drawElements(gl.TRIANGLES, this.pickups.flag.count, gl.UNSIGNED_SHORT, 0);
    }

    for (const p of state.projectiles) {
      this.bindModel(this.pickups.rocket);
      gl.uniform3f(uniforms.uTint, 1, 1, 1);
      gl.uniform3f(uniforms.uBase, 0.7, 0.7, 0.8);
      const yaw = Math.atan2(p.vz, p.vx);
      modelMatrix(this.modelM, lerpTo(p.px, p.x, this.alpha), lerpTo(p.py, p.y, this.alpha),
        lerpTo(p.pz, p.z, this.alpha), yaw);
      gl.uniformMatrix4fv(uniforms.uModel, false, this.modelM);
      gl.drawElements(gl.TRIANGLES, this.pickups.rocket.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  drawEffects(ex, ey, ez) {
    const gl = this.gl;
    const { program, uniforms, attribs } = this.sprite;
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.vertex);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quad.index);
    gl.enableVertexAttribArray(attribs.aPos);
    gl.vertexAttribPointer(attribs.aPos, 3, gl.FLOAT, false, 10 * 4, 0);
    gl.enableVertexAttribArray(attribs.aUV);
    gl.vertexAttribPointer(attribs.aUV, 2, gl.FLOAT, false, 10 * 4, 6 * 4);
    gl.uniformMatrix4fv(uniforms.uViewProj, false, this.viewProj);

    // The camera's own axes, so every sprite faces it squarely.
    const rx = this.view[0];
    const ry = this.view[4];
    const rz = this.view[8];
    const ux = this.view[1];
    const uy = this.view[5];
    const uz = this.view[9];
    gl.uniform3f(uniforms.uRight, rx, ry, rz);
    gl.uniform3f(uniforms.uUp, ux, uy, uz);

    for (const fx of this.effects) {
      const k = fx.life / fx.max;
      if (fx.kind === 'trail') {
        // A rail shot: a line of sprites down it, thinning as it fades.
        const dx = fx.x2 - fx.x;
        const dy = fx.y2 - fx.y;
        const dz = fx.z2 - fx.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const steps = Math.max(2, Math.min(90, Math.round(len / 1.1)));
        gl.uniform3f(uniforms.uColour, fx.colour[0], fx.colour[1], fx.colour[2]);
        gl.uniform1f(uniforms.uAlpha, k * 0.5);
        gl.uniform1f(uniforms.uSize, 0.22 + (1 - k) * 0.15);
        for (let i = 1; i <= steps; i++) {
          const t = i / (steps + 1);
          gl.uniform3f(uniforms.uCentre, fx.x + dx * t, fx.y + dy * t, fx.z + dz * t);
          gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }
        continue;
      }
      let size = fx.size || 1;
      let alpha = k;
      if (fx.kind === 'blast') { size *= 0.5 + (1 - k) * 0.9; alpha = k * 0.85; } else if (fx.kind === 'flash') { size *= 0.7 + k * 0.6; alpha = k; } else if (fx.kind === 'puff') { size *= 0.6 + (1 - k) * 1.4; alpha = k * 0.4; }
      gl.uniform3f(uniforms.uColour, fx.colour[0], fx.colour[1], fx.colour[2]);
      gl.uniform1f(uniforms.uAlpha, alpha);
      gl.uniform1f(uniforms.uSize, size);
      gl.uniform3f(uniforms.uCentre, fx.x, fx.y, fx.z);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * The gun in your hands.
   *
   * Drawn in the world rather than in a layer of its own, at arm's length in
   * front of the camera, with the depth buffer cleared first so that it is never
   * inside the wall you are standing against.
   */
  drawViewModel(state, body, ex, ey, ez, dx, dy, dz, opts) {
    const gl = this.gl;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const uniforms = this.beginModels(ex, ey, ez);
    const mesh = this.viewModels[body.weapon] || this.viewModels[0];
    this.bindModel(mesh);

    // The gun in your hands is lit by the room, but only partly: it is thirty
    // centimetres from the eye and a room bright enough to see across is a room
    // that would render it white. So it gets a fixed key light plus a share of
    // wherever it is standing, which keeps it dark, readable, and still
    // obviously in the same building.
    const light = this.lightAt(body.index, body.x, body.y, body.z);
    const flash = body.flash > 0 ? body.flash / FLASH_TICKS : 0;
    const share = (v) => 0.34 + Math.min(1.4, v) * 0.30;
    gl.uniform3f(uniforms.uBase, share(light[0]) + flash * 1.4, share(light[1]) + flash * 1.1,
      share(light[2]) + flash * 0.7);
    gl.uniform3f(uniforms.uTint, 1, 1, 1);

    const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
    const motion = opts.reducedMotion ? 0 : 1;
    const recoil = this.kick * motion;
    const sway = motion * Math.sin(this.bob) * Math.min(1, speed / 9) * 0.035;
    const swayY = motion * Math.abs(Math.cos(this.bob)) * Math.min(1, speed / 9) * 0.03;
    const back = recoil * (this.teamMeshes ? .18 : .13);
    const reloadDip = motion && this.teamMeshes && body.reloadUntil ? Math.sin(Math.PI*Math.max(0,Math.min(1,(body.reloadUntil-state.tick)/120))) : 0;
    const drop = recoil * 0.045 + reloadDip*.12;

    // Right, up and forward from the camera, so the gun hangs off the view.
    const rx = this.view[0];
    const ry = this.view[4];
    const rz = this.view[8];
    const ux = this.view[1];
    const uy = this.view[5];
    const uz = this.view[9];
    // Held at arm's length rather than against the lens. A gun drawn a hand's
    // width from the eye is a gun that fills half the picture, whatever it is
    // scaled to - the distance does the work, not the size.
    const px = ex + dx * (0.78 - back) + rx * (0.26 + sway) + ux * (-0.24 - swayY - drop);
    const py = ey + dy * (0.78 - back) + ry * (0.26 + sway) + uy * (-0.24 - swayY - drop);
    const pz = ez + dz * (0.78 - back) + rz * (0.26 + sway) + uz * (-0.24 - swayY - drop);

    // The model is built along +x, so it is turned to face the way the camera
    // is and then pitched by hand.
    const yaw = Math.atan2(dz, dx);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
    viewModelTransform(this.modelM, px, py, pz, yaw + (this.teamMeshes ? -.08 : 0), pitch - recoil * (this.teamMeshes ? .30 : .22) - reloadDip*.40, this.viewScale);
    gl.uniformMatrix4fv(uniforms.uModel, false, this.modelM);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
}

// --- Small helpers -----------------------------------------------------------

function upload(gl, mesh, stride = STRIDE) {
  return {
    vertex: buffer(gl, gl.ARRAY_BUFFER, mesh.vertices),
    index: buffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices),
    count: mesh.count,
    parts: mesh.parts,
    stride,
  };
}

/** Turn a part about its pivot, in the model's own space. */
function partTransform(out, pivot, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // A turn about the model's z axis: facing +x, that swings a limb forwards.
  out[0] = c; out[1] = s; out[2] = 0; out[3] = 0;
  out[4] = -s; out[5] = c; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = pivot[0] - (c * pivot[0] - s * pivot[1]);
  out[13] = pivot[1] - (s * pivot[0] + c * pivot[1]);
  out[14] = 0;
  out[15] = 1;
  return out;
}

/** Position, yaw and pitch: the only place in the game that needs both. */
function viewModelTransform(out, x, y, z, yaw, pitch, scale = 1) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const k = scale;
  out[0] = cy * cp * k; out[1] = sp * k; out[2] = sy * cp * k; out[3] = 0;
  out[4] = -cy * sp * k; out[5] = cp * k; out[6] = -sy * sp * k; out[7] = 0;
  out[8] = -sy * k; out[9] = 0; out[10] = cy * k; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/** Between where it was and where it is, when we know where it was. */
function lerpTo(from, to, alpha) {
  if (from === undefined) return to;
  return from + (to - from) * alpha;
}

/** The short way round between two yaws, in yaw units. */
function shortWay(from, to) {
  let d = (to - from) % 65536;
  if (d > 32768) d -= 65536;
  if (d < -32768) d += 65536;
  return d;
}

function mixColour(colour, towards) {
  return [
    colour[0] * towards + (1 - towards),
    colour[1] * towards + (1 - towards),
    colour[2] * towards + (1 - towards),
  ];
}

function weaponTint(index) {
  const w = WEAPONS[index] || WEAPONS[0];
  return [0.6 + w.light[0] * 0.5, 0.6 + w.light[1] * 0.4, 0.6 + w.light[2] * 0.4];
}
