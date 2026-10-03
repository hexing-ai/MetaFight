import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatFeedback } from '../../src/metafight/presentation.js';
import { FrameBudget, drawingSize, trackGPU } from '../../src/metafight/runtime.js';
import { createCombatMatch } from '../../src/metafight/match.js';
import { createSettings } from '../../src/metafight/platform/settings.js';

test('feedback separates real fire/hit/kill and freezes the damage source at event time',()=>{
  const s=createCombatMatch(),f=new CombatFeedback(),me=s.bodies[0],enemy=s.bodies[1];
  me.shield=0;Object.assign(me,{x:0,z:0});Object.assign(enemy,{x:0,z:5});s.tick=10;
  f.consume(s,[{type:'fire',body:0}]);assert.equal(f.view(s,0).hit,false);
  f.consume(s,[{type:'hit',body:1,victim:0}]);assert.equal(f.view(s,0).hit,false);
  f.consume(s,[{type:'hurt',body:0,from:1}]);enemy.x=20;enemy.z=-5;
  assert.equal(f.view(s,0).angle,Math.PI/2);
  assert.equal(f.view(s,16384).angle,0);
  assert.equal(f.view(s,0).kill,false);
  f.consume(s,[{type:'hit',body:0,victim:1}]);assert.equal(f.view(s,0).hit,true);
  assert.deepEqual(f.consume(s,[{type:'death',body:1,killer:0}]),['kill']);assert.equal(f.view(s,0).kill,true);
  s.tick=101;assert.equal(f.view(s,0).kill,false);assert.equal(f.view(s,0).hurt,false);
  f.consume(s,[{type:'hurt',body:0,from:-1}]);assert.equal(f.view(s,0).angle,null);
  f.reset();assert.equal(f.view(s,0).hit,false);
});
test('empty, reload, protection, death and low health remain distinguishable without audio',()=>{
  const s=createCombatMatch(),me=s.bodies[0],f=new CombatFeedback();
  assert.equal(f.view(s,0).status,'protected');me.shield=0;me.ammo[0]=0;
  assert.equal(f.view(s,0).status,'empty');assert.equal(f.emptyTrigger(true,me),true);
  assert.equal(f.emptyTrigger(true,me),false);f.emptyTrigger(false,me);
  me.reloadUntil=120;assert.equal(f.emptyTrigger(true,me),false);s.tick=60;
  assert.equal(f.view(s,0).status,'reload');assert.equal(f.view(s,0).reloadProgress,.5);
  me.alive=false;assert.equal(f.view(s,0).status,'respawn');
  me.alive=true;me.reloadUntil=0;me.ammo[0]=30;me.health=25;assert.equal(f.view(s,0).status,'danger');
});
test('medium respects pixel caps and degrades to low before reducing scale without losing preference',()=>{
  for(const [w,h] of [[844,390],[3840,2160],[667,320]]){
    const low=drawingSize(w,h,3,1,'low'),mid=drawingSize(w,h,3,1,'medium');
    assert.ok(low.width*low.height<=1000000);assert.ok(mid.width*mid.height<=2000000);
    assert.ok(mid.dpr<=1.5);assert.ok(mid.width>=low.width);
  }
  const b=new FrameBudget();b.setQuality('medium');
  const slow=()=>{let out;for(let i=0;i<50;i++)out=b.sample(110)||out;return out;};
  assert.equal(slow(),'degrade');assert.equal(b.effectiveQuality,'low');assert.equal(b.scale,1);
  assert.equal(slow(),'degrade');assert.equal(b.scale,.75);
  assert.equal(slow(),'degrade');assert.equal(b.scale,.5);
  assert.equal(slow(),'stop');assert.equal(b.preferred,'medium');
});
test('guide and quality persist together, with usable session values after storage failure',async()=>{
  let raw=null;const host={localStorage:{getItem:()=>raw,setItem:(key,v)=>{raw=v;}}};
  const first=await createSettings('web',host);await first.save({guideDone:true,quality:'medium'});
  const reopened=await createSettings('web',host);assert.equal(reopened.value.guideDone,true);assert.equal(reopened.value.quality,'medium');
  host.localStorage.setItem=()=>{throw Error('full');};
  const result=await reopened.save({quality:'low',guideDone:true});assert.equal(result.ok,false);
  assert.equal(reopened.value.guideDone,true);assert.equal(reopened.value.quality,'low');
});
test('GPU handle counts return to zero on disposal and wrappers are restored',()=>{
  const gl={drawElements(){},texImage2D(){}};
  for(const type of ['Buffer','Texture','Shader','Program']){gl['create'+type]=()=>({});gl['delete'+type]=()=>{};}
  const original=gl.createBuffer,tracker=trackGPU(gl);gl.createBuffer();gl.createTexture();
  assert.equal(tracker.resources().buffer,1);tracker.dispose();
  assert.deepEqual(tracker.resources(),{buffer:0,texture:0,program:0,shader:0});assert.equal(gl.createBuffer,original);
});

test('GPU budget accounts for both typed pixels and locally decoded image/canvas uploads',()=>{
  const gl={drawElements(){},texImage2D(){}};
  for(const type of ['Buffer','Texture','Shader','Program']){gl['create'+type]=()=>({});gl['delete'+type]=()=>{};}
  const tracker=trackGPU(gl);
  gl.texImage2D(3553,0,6408,128,128,0,6408,5121,new Uint8Array(128*128*4));
  gl.texImage2D(3553,0,6408,6408,5121,{width:512,height:512});
  assert.equal(tracker.metrics.maxTextureEdge,512);
  assert.ok(Math.abs(tracker.metrics.textureBytes-(128*128+512*512)*4*4/3)<.001);
  assert.doesNotThrow(()=>tracker.end());tracker.dispose();
});
