// Cosmetic only: never consumes the deterministic gameplay RNG.
export function combatEffects(events, localIndex, quality = 'low') {
  const effects = [];
  for (const e of events) {
    const priority = e.body === localIndex ? 2 : 1;
    if (e.type === 'fire') {
      const near = e.body === localIndex;
      effects.push({ kind:'flash', x:e.x+e.dx*.65-e.dz*(near?.16:0),
        y:e.y+e.dy*.65-(near?.12:0), z:e.z+e.dz*.65+e.dx*(near?.16:0),
        life:3, max:3, size:near?.28:.38, colour:[1,.79,.38], light:near?3:5, priority });
    } else if (e.type === 'impact' || e.type === 'hit') {
      const hit = e.type === 'hit';
      const count = quality === 'medium' ? 3 : 2;
      for (let i=0;i<count;i++) effects.push({kind:'spark', x:e.x,y:e.y,z:e.z,
        vx:(e.nx||0)*2+(Math.random()-.5)*2, vy:1.5+Math.random()*1.5,
        vz:(e.nz||0)*2+(Math.random()-.5)*2, life:10+i*2,max:14,
        size:hit?.075:.09, colour:hit?[1,.88,.56]:[1,.68,.28],priority});
      if (quality === 'medium' && !hit) effects.push({kind:'puff',
        x:e.x+(e.nx||0)*.08,y:e.y+(e.ny||0)*.08,z:e.z+(e.nz||0)*.08,
        life:14,max:14,size:.26,colour:[.52,.56,.58],priority:0});
    }
  }
  return effects;
}

export function limitCombatEffects(effects, quality = 'low') {
  return effects.sort((a,b)=>(b.priority||0)-(a.priority||0)||b.life-a.life).slice(0,quality==='medium'?16:10);
}
