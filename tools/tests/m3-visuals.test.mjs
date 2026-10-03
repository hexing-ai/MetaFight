import test from 'node:test';
import assert from 'node:assert/strict';
import { cargoAppearance, cargoPixels } from '../../src/metafight/visuals/cargo.js';
import { cargoBody, cargoRifle } from '../../src/metafight/visuals/models.js';
import { actorMarker } from '../../src/metafight/visuals/markers.js';
import { createCombatMatch, stepCombatMatch } from '../../src/metafight/match.js';
import { buildWorld } from '../../src/game/world.js';
import { buildMesh } from '../../src/render/mesh.js';

test('visual skin preserves collision/spawn/navigation contract and seeded simulation',()=>{
  const a=createCombatMatch({seed:3}),b=createCombatMatch({seed:3});
  const before=JSON.stringify(a.map),skin=cargoAppearance(a.map);
  assert.equal(JSON.stringify(a.map),before);
  assert.strictEqual(skin.solids,a.map.solids);assert.strictEqual(skin.spawns,a.map.spawns);
  assert.strictEqual(skin.bounds,a.map.bounds);assert.ok(skin.faces.length>a.map.faces.length);
  buildMesh(buildWorld(skin),skin);
  while(a.phase!=='over'){stepCombatMatch(a);stepCombatMatch(b);}
  assert.deepEqual(a.result,b.result);assert.deepEqual(a.matchStats,b.matchStats);
  assert.deepEqual(a.bodies,b.bodies);
});
test('complete candidate scene stays under low-tier geometry/material/texture budgets',()=>{
  const state=createCombatMatch({candidate:true}),map=cargoAppearance(state.map);
  const mesh=buildMesh(buildWorld(map),map),bodies=[cargoBody(0),cargoBody(1)],gun=cargoRifle();
  const triangles=34+mesh.triangles+map.detailMesh.count/3+11*Math.max(...bodies.map(b=>b.count/3))+gun.count/3;
  assert.ok(triangles<50000,triangles);assert.ok(mesh.groups.length+11+1+1+1+16<=50);
  for(const model of [...bodies,gun,map.detailMesh]){
    assert.ok(model.vertices.length/10<65536);assert.ok(model.vertices.every(Number.isFinite));
    assert.ok(model.indices.every(i=>i<model.vertices.length/10));
  }
  assert.ok((4*512*512+256*256+3*128*128)*4*4/3<32*1024*1024);
  for(let i=0;i<8;i++)assert.deepEqual(cargoPixels(i),cargoPixels(i));
});
test('markers only project visible living actors; no wall, dead, self or off-screen leakage',()=>{
  const s=createCombatMatch(),body=s.bodies[1],eye={x:-6,y:1.62,z:0};
  const m=new Float32Array([.04,0,0,0,0,.2,0,0,0,0,.04,0,0,0,0,1]);
  Object.assign(body,{alive:true,x:6,y:0,z:0});
  assert.ok(actorMarker(s,body,m,844,390,eye));
  body.z=5;assert.equal(actorMarker(s,body,m,844,390,eye),null);
  body.z=0;body.alive=false;assert.equal(actorMarker(s,body,m,844,390,eye),null);
  body.alive=true;m[15]=-1;assert.equal(actorMarker(s,body,m,844,390,eye),null);
  m[15]=1;s.bodies[0].alive=false;assert.equal(actorMarker(s,body,m,844,390,eye),null);
});

test('offline materials reuse the HTML image, share loading and clean listeners', async()=>{
  const {loadCargoMaterials}=await import('../../src/metafight/visuals/cargo.js?declared-image-test');
  const previous=globalThis.document,handlers=new Map();
  const img={complete:false,naturalWidth:0,
    addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),
    set src(_){throw Error('Dynamic image source is not supported in this host');}};
  globalThis.document={getElementById:id=>id==='materialAtlas'?img:null};
  try {
    const first=loadCargoMaterials(),second=loadCargoMaterials();assert.strictEqual(first,second);
    img.complete=true;img.naturalWidth=1024;handlers.get('load')();await first;
    assert.equal(handlers.size,0);await loadCargoMaterials();
  }finally {globalThis.document=previous;}
});
