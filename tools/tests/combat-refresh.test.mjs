import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatMatch } from '../../src/metafight/match.js';
import { combatInput } from '../../src/metafight/combat-ai.js';
import { placeAtSpawn } from '../../src/game/state.js';
import { step } from '../../src/game/sim.js';
import { visible } from '../../src/game/world.js';
import { BTN } from '../../src/constants.js';
import { CombatFeedback } from '../../src/metafight/presentation.js';
import { combatEffects, limitCombatEffects } from '../../src/metafight/visuals/effects.js';

function fixture() {
  const s=createCombatMatch();
  for (const b of s.bodies) { b.alive=false;b.shield=0;b.human=true;b.respawnAt=999999; }
  Object.assign(s.bodies[0],{alive:true,x:-6,y:0,z:0,yaw:0,health:100000});
  Object.assign(s.bodies[1],{alive:true,x:6,y:0,z:0,yaw:32768});
  return s;
}
test('bots wait through protection and reacquire each target life; flank warning adds reaction time',()=>{
  const front=fixture(),back=fixture(); back.bodies[0].yaw=32768;
  combatInput(front,front.bodies[1]);combatInput(back,back.bodies[1]);
  assert.equal(back.bodies[1].combat.reactAt-front.bodies[1].combat.reactAt,39);
  const bot=front.bodies[1],target=front.bodies[0];front.tick=100;
  target.shield=1;assert.equal(combatInput(front,bot).b&BTN.FIRE,0);assert.equal(bot.combat.target,-1);
  target.shield=0;target.lifeId++;assert.equal(combatInput(front,bot).b&BTN.FIRE,0);
  assert.ok(bot.combat.reactAt>=148);
  front.tick=200;target.lifeId++;
  assert.equal(combatInput(front,bot).b&BTN.FIRE,0);assert.ok(bot.combat.reactAt>=248);
});
test('real bot shots from different attackers are staggered without reducing player damage',()=>{
  const s=fixture();Object.assign(s.bodies[3],{alive:true,x:7,y:0,z:.4,yaw:32768,shield:0});
  s.bodies[1].human=false;s.bodies[3].human=false;
  const shots=[];
  for(let i=0;i<900;i++) {
    step(s,[{b:0}]);
    for(const e of s.events) if(e.type==='fire'&&[1,3].includes(e.body)) shots.push({tick:s.tick,body:e.body});
  }
  assert.ok(shots.length>6);assert.equal(new Set(shots.map(s=>s.body)).size,2);
  for(let i=1;i<shots.length;i++) if(shots[i].body!==shots[i-1].body) assert.ok(shots[i].tick-shots[i-1].tick>=21);
  assert.equal(s.product.bodyDamage,25);assert.equal(s.product.headDamage,50);
});
test('respawn selects a screened team point and clears old crossfire history',()=>{
  const s=fixture(),me=s.bodies[0],enemy=s.bodies[1];
  Object.assign(enemy,{x:-17.5,y:.02,z:-10});
  const exposed=s.map.spawns.find(p=>p.team===0&&p.x===-22&&p.z===-8);
  const screened=s.map.spawns.find(p=>p.team===0&&p.x===-22&&p.z===8);
  assert.equal(visible(s.world,enemy.x,enemy.y+1.62,enemy.z,exposed.x,exposed.y+1.35,exposed.z),true);
  assert.equal(visible(s.world,enemy.x,enemy.y+1.62,enemy.z,screened.x,screened.y+1.35,screened.z),false);
  s.map={...s.map,spawns:[exposed,screened]};me.lastBotShotAt=50;me.lastBotShooter=1;
  placeAtSpawn(s,me);assert.equal(me.z,screened.z);assert.equal(me.lastBotShotAt,null);assert.equal(me.shield,120);
});
test('head hits, side warnings and unknown damage remain accurate and reset on respawn',()=>{
  const s=fixture(),f=new CombatFeedback();s.tick=10;
  Object.assign(s.bodies[1],{x:-6,z:4});
  assert.deepEqual(f.consume(s,[{type:'hit',body:0,victim:1,head:true}]),['headshot']);
  assert.equal(f.view(s,0).headshot,true);assert.equal(f.lastVictim,1);
  f.consume(s,[{type:'hurt',body:0,from:1,amount:25}]);
  assert.equal(f.view(s,0).direction,'右侧');assert.equal(f.view(s,32768).direction,'左侧');
  s.bodies[1].z=-10;assert.equal(f.view(s,0).direction,'右侧');
  f.consume(s,[{type:'hurt',body:0,from:-1}]);assert.equal(f.view(s,0).direction,'');
  f.consume(s,[{type:'spawn',body:0}]);assert.equal(f.view(s,0).hurt,false);assert.equal(f.lastVictim,-1);
});
test('cosmetic impact/muzzle effects use bounded budgets and retain local feedback first',()=>{
  const event={type:'fire',body:0,x:1,y:2,z:3,dx:1,dy:0,dz:0};
  const original=JSON.stringify(event);
  const fx=combatEffects([event,{type:'hit',body:0,x:5,y:1,z:0}],0,'low');
  assert.equal(fx.length,3);assert.equal(fx[0].kind,'flash');assert.ok(fx[0].size<.4);
  assert.equal(JSON.stringify(event),original);
  const many=[...fx,...Array.from({length:30},()=>({...fx[0],priority:1}))];
  assert.equal(limitCombatEffects([...many],'low').length,10);
  assert.equal(limitCombatEffects([...many],'medium').length,16);
  assert.equal(limitCombatEffects([...many],'low')[0].priority,2);
});
