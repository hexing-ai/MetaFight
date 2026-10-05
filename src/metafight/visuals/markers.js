import { visible } from '../../game/world.js';

export function actorMarker(state, body, matrix, width, height, eye) {
  if (!body.alive || body.index===0 || !state.bodies[0].alive) return null;
  // Test actual body visibility, not its floating label; never show through cover.
  if (!visible(state.world,eye.x,eye.y,eye.z,body.x,body.y+1.35,body.z)) return null;
  const x=body.x,y=body.y+2.03,z=body.z,m=matrix;
  const w=m[3]*x+m[7]*y+m[11]*z+m[15];if(w<=0)return null;
  const nx=(m[0]*x+m[4]*y+m[8]*z+m[12])/w,ny=(m[1]*x+m[5]*y+m[9]*z+m[13])/w;
  if(Math.abs(nx)>.94||Math.abs(ny)>.88)return null;
  const distance=Math.hypot(body.x-eye.x,body.z-eye.z);
  return{opacity:distance>25?.65:1,x:(nx+1)*width/2,y:(1-ny)*height/2,team:body.team};
}
