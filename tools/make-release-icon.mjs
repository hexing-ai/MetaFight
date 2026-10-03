// Original cargo-frame / MF monogram; no font, image or third-party dependency.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const shapes = [
  ['#152d39', [[0,0],[512,0],[512,512],[0,512]]],
  ['#315563', [[40,92],[256,40],[472,92],[472,388],[256,472],[40,388]]],
  ['#0e222d', [[62,110],[256,63],[450,110],[450,373],[256,448],[62,373]]],
  ['#b6d1d5', [[100,330],[100,154],[138,154],[186,219],[234,154],[272,154],[272,330],[232,330],[232,224],[186,284],[140,224],[140,330]]],
  ['#ebba60', [[300,330],[300,154],[412,154],[412,194],[342,194],[342,230],[402,230],[402,268],[342,268],[342,330]]],
  ['#ebba60', [[100,356],[412,356],[412,366],[256,422],[100,366]]],
];
const n=512, supersample=2;
function inside(x,y,p) { let yes=false; for(let i=0,j=p.length-1;i<p.length;j=i++) { const a=p[i],b=p[j]; if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) yes=!yes; } return yes; }
const parsed=shapes.map(([c,p])=>[c.match(/\w\w/g).map(v=>parseInt(v,16)),p]);
const raw=Buffer.alloc(n*(1+n*3));
for(let y=0;y<n;y++) for(let x=0;x<n;x++) { const rgb=[0,0,0]; for(let dy=0;dy<supersample;dy++) for(let dx=0;dx<supersample;dx++) {
  let c=parsed[0][0]; for(const [color,p] of parsed) if(inside(x+(dx+.5)/supersample,y+(dy+.5)/supersample,p)) c=color;
  for(let k=0;k<3;k++) rgb[k]+=c[k];
} for(let k=0;k<3;k++) raw[y*(1+n*3)+1+x*3+k]=Math.round(rgb[k]/(supersample*supersample)); }
function crc(data) { let c=0xffffffff; for(const b of data) { c^=b; for(let j=0;j<8;j++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(type,data) { const t=Buffer.from(type),b=Buffer.alloc(data.length+12); b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return b; }
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(n,0);ihdr.writeUInt32BE(n,4);ihdr[8]=8;ihdr[9]=2;
writeFileSync('release/icon.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]));
writeFileSync('release/icon.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'+shapes.map(([fill,points])=>'<polygon fill="'+fill+'" points="'+points.map(p=>p.join(',')).join(' ')+'"/>').join('')+'</svg>\n');
console.log('Original release/icon.png (512×512) and icon.svg generated.');
