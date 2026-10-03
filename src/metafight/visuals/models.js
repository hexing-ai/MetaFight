// Original faceted equipment. Linear colors match the renderer's gamma output.
export class Mesh {
  constructor(){this.v=[];this.i=[];this.tag=0;}
  tri(a,b,c,col){
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;
    const base=this.v.length/10;
    for(const p of [a,b,c])this.v.push(...p,...n.map(x=>x/l),...col,this.tag);
    this.i.push(base,base+1,base+2);
  }
  box(x0,y0,z0,x1,y1,z1,col,bevel=0.02){
    const c=Math.min(bevel,(x1-x0)/3,(z1-z0)/3);
    const r=[[x0+c,z0],[x1-c,z0],[x1,z0+c],[x1,z1-c],[x1-c,z1],[x0+c,z1],[x0,z1-c],[x0,z0+c]];
    const lo=r.map(p=>[p[0],y0,p[1]]),hi=r.map(p=>[p[0],y1,p[1]]);
    for(let i=0;i<8;i++){const j=(i+1)%8;this.tri(lo[i],hi[i],hi[j],col);this.tri(lo[i],hi[j],lo[j],col);}
    for(let i=1;i<7;i++){this.tri(hi[0],hi[i+1],hi[i],col);this.tri(lo[0],lo[i],lo[i+1],col);}return this;
  }
  // Elliptic rings produce rounded helmets, fabric folds and anatomical limbs.
  ellipsoid(cx,cy,cz,rx,ry,rz,col,segments=12,rings=6){
    const at=(i,j)=>{const a=i/segments*Math.PI*2,b=j/rings*Math.PI;return[cx+rx*Math.sin(b)*Math.cos(a),cy+ry*Math.cos(b),cz+rz*Math.sin(b)*Math.sin(a)];};
    for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
      const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);
      const tint=col.map(v=>v*(.91+.09*Math.cos(j*2.4+i*.7)));
      if(j>0)this.tri(a,b,c,tint);if(j<rings-1)this.tri(a,c,d,tint);
    }return this;
  }
  tube(a,b,r0,r1,col,segments=10,caps=true){
    const v=b.map((n,i)=>n-a[i]),l=Math.hypot(...v),d=v.map(n=>n/l);
    const t=Math.abs(d[1])<.9?[0,1,0]:[1,0,0];
    let u=[d[1]*t[2]-d[2]*t[1],d[2]*t[0]-d[0]*t[2],d[0]*t[1]-d[1]*t[0]];
    const ul=Math.hypot(...u);u=u.map(n=>n/ul);
    const w=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]];
    const at=(p,r,i)=>p.map((n,j)=>n+r*(u[j]*Math.cos(i/segments*Math.PI*2)+w[j]*Math.sin(i/segments*Math.PI*2)));
    for(let i=0;i<segments;i++){
      const p=at(a,r0,i),q=at(a,r0,i+1),r=at(b,r1,i+1),s=at(b,r1,i);
      this.tri(p,q,r,col);this.tri(p,r,s,col);if(caps){this.tri(a,q,p,col);this.tri(b,s,r,col);}
    }return this;
  }
  ring(cx,cy,cz,radius,thick,col,axis='x',segments=20){
    for(let i=0;i<segments;i++){
      const point=t=>axis==='x'?[cx,cy+Math.cos(t)*radius,cz+Math.sin(t)*radius]:[cx+Math.cos(t)*radius,cy,cz+Math.sin(t)*radius];
      this.tube(point(i/segments*Math.PI*2),point((i+1)/segments*Math.PI*2),thick,thick,axis==='x'&&i%5===0?[.72,.73,.63]:col,5,false);
    }return this;
  }
  done(){return{vertices:new Float32Array(this.v),indices:new Uint16Array(this.i),count:this.i.length,parts:[]};}
}
const suit=[0.10,0.135,0.12],vest=[0.055,0.07,0.075],metal=[0.06,0.078,0.095],black=[0.023,0.032,0.042],skin=[0.32,0.21,0.145];
export function cargoBody(team){
  const m=new Mesh(),badge=team?[.045,.24,.65]:[.57,.035,.025];
  // Body faces +X. Organic cloth volumes beneath hard armour plates.
  m.ellipsoid(-.015,1.16,0,.18,.31,.255,suit);
  m.ellipsoid(-.08,.91,0,.15,.13,.22,suit,10,4);
  m.box(.12,1.0,-.205,.215,1.38,.205,vest,.035);
  m.box(-.22,1.01,-.20,-.13,1.39,.20,vest,.035);
  for(const z of [-.19,.16])m.box(-.12,1.36,z,.20,1.41,z+.035,black,.01);
  for(const y of [1.05,1.14,1.23])m.box(.215,y,-.18,.222,y+.017,.18,suit,.003);
  for(const z of [-.13,0,.13])m.box(.22,1.03,z-.05,.27,1.2,z+.05,suit,.012);
  m.tube([0,1.38,0],[0,1.49,0],.08,.075,skin);
  m.ellipsoid(.018,1.57,0,.112,.145,.109,skin);
  m.ellipsoid(-.015,1.64,0,.146,.153,.145,vest);
  m.box(.11,1.57,-.105,.137,1.63,.105,black,.012);
  m.box(.135,1.587,-.095,.142,1.62,.095,[.10,.19,.20],.007);
  m.ellipsoid(.075,1.515,0,.068,.055,.085,black,10,4);
  for(const z of [-.14,.14])m.ellipsoid(-.02,1.565,z,.06,.066,.022,black,8,4);
  m.box(-.16,.86,-.23,.17,.94,.23,black,.015);
  for(const z of [-.24,.24]) {
    m.ellipsoid(-.01,1.29,z,.115,.14,.10,suit,10,5);
    m.tube([0,1.29,z],[.06,1.09,z*1.2],.082,.066,suit);
    m.tube([.06,1.09,z*1.2],[.36,1.15,-.12],.063,.046,suit);
    m.ellipsoid(.34,1.16,-.13,.075,.055,.052,vest,8,4);
    m.box(-.06,1.27,z-.09,.065,1.35,z+.09,badge,.015);
  }
  for(const z of [-.12,.12]){
    m.tag=z<0?-1:-2;
    m.ellipsoid(-.03,.69,z,.117,.245,.112,suit,10,5);
    m.tube([-.045,.60,z],[.035,.39,z],.099,.082,suit);
    m.ellipsoid(.10,.46,z,.043,.084,.078,vest,8,4);
    m.tube([.0,.39,z],[-.055,.13,z],.081,.065,suit);
    m.box(-.135,.025,z-.086,.19,.16,z+.086,black,.06);
    m.box(-.13,.02,z-.085,.195,.052,z+.085,metal,.03);
    m.tag=0;
  }
  m.box(.23,1.16,-.18,.61,1.25,-.10,metal,.015);
  m.tube([.60,1.205,-.14],[.86,1.205,-.14],.023,.018,black,8);
  m.box(.35,1.03,-.18,.42,1.17,-.11,black,.01);
  return m.done();
}
export function cargoRifle(){
  const m=new Mesh(),steel=[.13,.16,.17],polymer=[.037,.047,.042];
  // Stock, receiver, tapered fore-end, cylindrical barrel and perforated brake.
  m.box(-.58,-.13,-.076,-.18,.055,.076,polymer,.03);
  m.box(-.58,-.16,-.085,-.52,.055,.085,black,.016);
  m.tube([-.35,.005,0],[.0,.005,0],.055,.053,steel);
  m.box(-.19,-.115,-.08,.40,.085,.08,metal,.022);
  m.box(-.16,.035,-.073,.39,.095,.073,steel,.014);
  m.box(.39,-.066,-.063,.92,.069,.063,polymer,.02);
  m.tube([.89,.015,0],[1.18,.015,0],.024,.019,steel,12);
  m.tube([1.16,.015,0],[1.26,.015,0],.037,.031,black,12);
  for(let x=1.17;x<1.25;x+=.027)m.box(x,.009,.028,x+.012,.025,.033,steel,.003);
  m.tube([-.01,-.09,0],[-.10,-.32,0],.05,.048,polymer,8);
  m.box(.18,-.29,-.043,.32,-.10,.043,black,.016);
  m.box(.14,-.39,-.045,.29,-.27,.045,metal,.016);
  for(let x=.19;x<.30;x+=.035)m.box(x,-.27,.043,x+.009,-.12,.046,steel,.002);
  m.box(.0,-.17,-.045,.15,-.151,.045,steel,.004);
  m.box(.13,-.15,-.045,.15,-.10,.045,steel,.004);
  // Reflex sight is an open frame, not an opaque block in the sight line.
  for(const z of [-.048,.034])m.box(-.065,.10,z,.045,.21,z+.014,black,.005);
  m.box(-.065,.204,-.048,.045,.224,.048,steel,.005);
  m.box(-.065,.096,-.048,.045,.115,.048,steel,.005);
  for(let x=-.12;x<.9;x+=.056)m.box(x,.088,-.052,x+.023,.106,.052,steel,.003);
  for(let x=.44;x<.89;x+=.075){
    m.box(x,-.024,.063,x+.042,.025,.066,black,.003);
    m.box(x,-.024,-.066,x+.042,.025,-.063,black,.003);
  }
  m.box(-.06,-.023,.081,.15,.042,.085,black,.004);
  m.tube([.05,.01,.082],[.05,.01,.094],.012,.01,steel,8);
  m.box(.13,.016,.083,.25,.045,.089,steel,.003);
  m.box(.83,.07,-.013,.855,.145,.013,black,.003);
  // Rounded sleeves, wrists and glove fingers instead of rectangular arms.
  m.tube([-.69,-.50,.23],[-.19,-.27,.09],.115,.073,suit,12);
  m.ellipsoid(-.12,-.22,.035,.11,.085,.077,vest,12,5);
  m.tube([-.61,-.51,-.34],[.33,-.22,-.12],.10,.065,suit,12);
  m.ellipsoid(.42,-.135,-.047,.14,.068,.083,vest,12,5);
  for(let i=0;i<4;i++)m.tube([.32+i*.045,-.15,.005],[.33+i*.045,-.065,.05],.018,.016,polymer,6);
  for(let i=0;i<3;i++)m.ellipsoid(-.09+i*.037,-.19,.085,.022,.045,.021,polymer,8,4);
  return m.done();
}
