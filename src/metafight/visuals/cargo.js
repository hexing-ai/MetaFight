import { Mesh } from './models.js';
import { Builder, MAT } from '../../game/build.js';

export const VISUAL_VERSION = 'cargo-daylight-v3';

// Render-only skin. Never feed decoration into simulation collision or nav.
export function cargoAppearance(base) {
  const faces = base.faces.filter(s => !(s.nonsolid && s.mat===MAT.trim)).map(s => ({ ...s, mat: s.mat === MAT.red || s.mat === MAT.blue ? (s.x1-s.x0===1 ? MAT.panel : MAT.concrete) : s.mat }));
  const fittings = new Mesh();
  const steel=[.29,.34,.34], rope=[.22,.18,.10], white=[.61,.64,.61], dark=[.055,.12,.16];
  const b = new Builder();
  const box = (x0,y0,z0,x1,y1,z1,mat) => b.box(x0,y0,z0,x1,y1,z1,mat,{ nonsolid:true, detail:0.25 });
  for (const s of base.solids.filter(s => s.x1-s.x0===8 && s.z1-s.z0===4)) {
    // Painted corrugation lies within 1.5cm of the unchanged solid surface.
    for (let x=s.x0+0.35;x<s.x1;x+=0.55) for (const z of [s.z0-0.015,s.z1]) box(x,0.16,z,x+0.08,2.48,z+0.015,s.mat);
    for (const x of [s.x0-0.015,s.x1]) for (const z of [s.z0+0.07,s.z1-0.17]) box(x,0.08,z,x+0.015,2.6,z+0.1,MAT.red);
    // Hardware on the end faces, not a new traversable obstacle.
    for (const x of [s.x0-0.02,s.x1]) for (const z of [s.z0+1,s.z0+3]) box(x,0.16,z,x+0.02,2.45,z+0.045,MAT.concrete);
  }
  for (const z of [-8,8]) box(-16,0.012,z,16,0.017,z+0.09,MAT.trim);
  for (let x=-14;x<=14;x+=4) box(x,0.013,-0.07,x+1.25,0.018,0.07,MAT.concrete);
  // All scenery is outside the playable deck or below it.
  box(-260,-3.1,-260,260,-3,260,MAT.blue);
  // Sea ripples are shaded in one material, without giant geometric stripes.
  box(-25,-2.4,-12.5,25,-1.02,12.5,MAT.red);
  for (const z of [-11.92,11.75]) box(-23.6,1.25,z,23.6,1.3,z+0.16,MAT.trim);
  for (const end of [-1,1]) {
    const x=end*31;
    box(x-4,-1,-10,x+4,4,10,MAT.concrete);
    box(x-3,4,-8,x+3,7.2,8,MAT.concrete);
    box(x-3.03,5.55,-7.5,x+3.03,6.7,7.5,MAT.red);
    box(x-3.2,7.2,-8.2,x+3.2,7.5,8.2,MAT.concrete);
    for (let z=-7;z<=7;z+=2) box(x-3.08,5.5,z,x+3.08,6.8,z+0.14,MAT.concrete);
    box(x-0.12,7.5,-0.12,x+0.12,12,0.12,MAT.concrete);
    box(x-0.2,10,-2.2,x+0.2,10.15,2.2,MAT.red);
    box(x-1.1,7.5,4,x+1.1,9.2,5.7,MAT.trim);
  }
  // Rail stanchions, mooring fittings and safety equipment live beyond the
  // existing boundary. They never enter navigation or weapon ray tests.
  for(const z of [-12.10,12.10]) {
    for(let x=-23;x<=23;x+=2.3) fittings.tube([x,1.24,z],[x,2.08,z],.032,.032,white,6);
    for(const y of [1.65,2.08]) fittings.tube([-23.6,y,z],[23.6,y,z],.025,.025,white,6);
    for(const x of [-20,-9,9,20]) {
      for(const dx of [-.26,.26]) {
        fittings.tube([x+dx,.05,z*.95],[x+dx,.55,z*.95],.10,.095,steel,10);
        fittings.tube([x+dx-.15,.49,z*.95],[x+dx+.15,.49,z*.95],.055,.055,steel,8);
      }
      for(let r=.3;r<.53;r+=.085) fittings.ring(x,.075,z*.91,r,.025,rope,'y',16);
    }
    for(const x of [-15,15]) fittings.ring(x,1.08,z*.959,.30,.075,[.76,.14,.025],'x',16);
  }
  for(const s of base.solids.filter(s=>s.x1-s.x0===8 && s.z1-s.z0===4)) {
    // Continuous perimeter frame and recessed door hardware stay flush.
    for(const z of [s.z0-.027,s.z1+.012])for(const y of [.045,2.48])box(s.x0,y,z,s.x1,y+.08,z+.014,MAT.red);
    for(const x of [s.x0-.027,s.x1+.012]) {
      box(x,.08,s.z0+1.98,x+.016,2.5,s.z0+2.01,MAT.red);
      for(const z of [s.z0+.75,s.z0+1.35,s.z0+2.65,s.z0+3.25]){
        fittings.tube([x,.20,z],[x,2.40,z],.023,.023,steel,6);
        for(const y of [.33,1.16,2.2]) fittings.box(x-.012,y,z-.075,x+.025,y+.10,z+.075,steel,.006);
      }
    }
  }
  for(const end of [-1,1]) {
    const x=end*31,front=x-end*4.03;
    // Navy window recesses, portholes, bridge walkway and escape ladders.
    for(let z=-6;z<=6;z+=2) {
      fittings.box(x-3.05,5.64,z-.67,x+3.05,6.65,z+.67,dark,.05);
      fittings.tube([front-.02,1.75,z],[front+.02,1.75,z],.19,.19,dark,12);
      fittings.ring(front,1.75,z,.21,.025,steel,'x',12);
    }
    fittings.box(front-.015,.1,-.62,front+.015,2.32,.62,white,.10);
    fittings.box(front-.023,1.48,-.33,front+.023,2.02,.33,dark,.08);
    for(const z of [7.3,8.1])fittings.tube([front,.1,z],[front,5.0,z],.04,.04,steel,8);
    for(let y=.3;y<5;y+=.32)fittings.tube([front,y,7.3],[front,y,8.1],.024,.024,steel,6);
    for(const z of [-8.35,8.35]) {
      fittings.tube([x-3.4,5.2,z],[x+3.4,5.2,z],.025,.025,white,6);
      for(let dx=-3;dx<=3;dx+=1.5)fittings.tube([x+dx,4.25,z],[x+dx,5.2,z],.026,.026,white,6);
    }
    fittings.tube([x,9.3,0],[x,12.4,0],.08,.035,steel,10);
    fittings.tube([x,11.3,-2],[x,11.3,2],.04,.04,white,8);
    fittings.ellipsoid(x,8.3,-4.5,.50,.55,.50,white,12,6);
    for(const z of [-5,5])fittings.tube([x,8,z],[x,10,z],.022,.014,steel,6);
  }
  for(const s of base.solids.filter(s=>s.x1-s.x0===8 && s.z1-s.z0===4)) {
    const placard=b.box(s.x0+1.0,1.30,s.z0-.034,s.x0+2.55,2.25,s.z0-.031,MAT.rock,{nonsolid:true,detail:.25});
    placard.decal=true;
    const reverse=b.box(s.x1-2.55,1.30,s.z1+.031,s.x1-1.0,2.25,s.z1+.034,MAT.rock,{nonsolid:true,detail:.25});
    reverse.decal=true;
  }
  return { ...base, visualVersion:VISUAL_VERSION, faces:faces.concat(b.solids),
    // Identity preserved: geometry, bounds, spawns and nav are M2's contract.
    solids:base.solids, detailMesh:fittings.done(), ambient:[0.30,0.34,0.37], sky:[0.09,0.29,0.51], fog:0.003,
    daylight:true,
    lights:[] };
}

// Eight 128px deterministic offline materials, one draw group each.
export function cargoPixels(mat, size=128) {
  const colors=[[174,185,183],[54,96,96],[129,72,51],[98,113,119],[196,144,46],[28,43,52],[38,95,122],[103,111,106]];
  const data=new Uint8Array(size*size*4), c=colors[mat];
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    let k=1;
    if(mat===1||mat===2) k=(x%16<3?0.76:x%16<5?1.12:1);
    if(mat===3) k=(x<2||y<2?0.62:x===2||y===2?1.15:1);
    if(mat===6) k=1+0.045*Math.sin(y*0.25+x*0.05);
    const grain=(((x*17+y*31)%19)-9)*0.18;
    const i=(y*size+x)*4;
    for(let j=0;j<3;j++) data[i+j]=Math.max(0,Math.min(255,c[j]*k+grain));
    data[i+3]=255;
  }
  return data;
}
let materialImage = null, materialTask = null;
export function loadCargoMaterials() {
  if (materialImage) return Promise.resolve();
  if (materialTask) return materialTask;
  // Declare offline assets in HTML so the host can register them before any
  // sandboxed game code runs. Reuse that image instead of constructing Image.
  const img = document.getElementById('materialAtlas');
  if (!img) return Promise.reject(new Error('材质资源未声明，请重新打开'));
  if (img.complete) {
    if (!img.naturalWidth) return Promise.reject(new Error('材质加载失败，请重新打开'));
    materialImage=img; return Promise.resolve();
  }
  materialTask = new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);img.removeEventListener('load',loaded);img.removeEventListener('error',failed);};
    const loaded=()=>{cleanup();materialImage=img;resolve();};
    const failed=()=>{cleanup();materialTask=null;reject(new Error('材质加载失败，请重新打开'));};
    const timer=setTimeout(()=>{cleanup();materialTask=null;reject(new Error('材质加载超时，请重新打开'));},8000);
    img.addEventListener('load',loaded);img.addEventListener('error',failed);
  });
  return materialTask;
}
export function cargoTextures(gl) {
  return Array.from({length:8},(_,mat)=>{
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    if(mat===7){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#263c43';ctx.fillRect(0,0,256,256);
      ctx.fillStyle='#e1dfc4';ctx.font='bold 36px monospace';ctx.fillText('MF CARGO',16,65);
      ctx.font='25px monospace';ctx.fillText('SHIP  04',16,105);ctx.fillText('24 860 KG',16,153);
      ctx.fillStyle='#d7ad52';ctx.fillRect(16,184,224,7);ctx.font='17px monospace';ctx.fillText('DECK / KEEP CLEAR',16,226);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    }else if(materialImage && mat<4){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
      const ctx=canvas.getContext('2d'),w=materialImage.width/2,h=materialImage.height/2;
      ctx.drawImage(materialImage,(mat%2)*w,Math.floor(mat/2)*h,w,h,0,0,512,512);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    }else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,128,128,0,gl.RGBA,gl.UNSIGNED_BYTE,cargoPixels(mat));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);return t;
  });
}
