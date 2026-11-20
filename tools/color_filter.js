const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const A = path.join(__dirname, '..', 'client', 'assets');
const dir = path.join(A, 'plant', 'model');

// 极简 PNG 解码(仅支持无 alpha 简化路径? 用 zlib 解 IDAT, 取 RGBA)
function decode(buf){
  // 找 IHDR
  let p = 8; const w=buf.readUInt32BE(16), h=buf.readUInt32BE(20), bit=buf[24], color=buf[25];
  let idat=[];
  p=8;
  while(p<buf.length){ const len=buf.readUInt32BE(p); const type=buf.slice(p+4,p+8).toString(); if(type==='IDAT') idat.push(buf.slice(p+8,p+8+len)); else if(type==='IEND') break; p+=12+len; }
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const channels = color===6?4:color===2?3:color===3?1:0;
  const bpp=channels;
  const out=Buffer.alloc(w*h*4);
  let prev=Buffer.alloc(w*bpp);
  let q=0;
  for(let y=0;y<h;y++){
    const f=raw[q++]; const line=Buffer.alloc(w*bpp);
    for(let x=0;x<w*bpp;x++){
      const a=raw[q++]; const up=prev[x]; let v=a;
      if(f===1) v=(a+line[Math.max(0,x-1)])&255;
      else if(f===2) v=(a+up)&255;
      else if(f===3) v=((a+(((line[Math.max(0,x-1)]+up)>>1))))&255;
      else if(f===4){ const left=line[Math.max(0,x-1)]; const pa=up-left; const pb=prev[Math.min(w*bpp-1,x+1)]-up; const pc=left; const pred=Math.abs(pa)<=Math.abs(pb)&&Math.abs(pa)<=Math.abs(pc)?left:Math.abs(pb)<=Math.abs(pc)?prev[Math.min(w*bpp-1,x+1)]:up; v=(a+pred)&255; }
      line[x]=v;
    }
    for(let x=0;x<w;x++){
      const src=x*bpp; const o=(y*w+x)*4;
      out[o]=line[src]; out[o+1]=line[src+1||src]; out[o+2]=line[src+2||src]; out[o+3]=color===6?line[src+3]:255;
    }
    prev=line;
  }
  return {w,h,out};
}

function classify(r,g,b){
  // 红番茄/草莓, 橙胡萝卜, 黄麦
  if(r>150 && g<120 && b<110) return 'red';
  if(r>180 && g>90 && g<170 && b<90) return 'orange';
  if(r>170 && g>150 && b<110) return 'yellow';
  if(r>180 && g<130 && b>110) return 'pink';
  return null;
}

const res={red:[],orange:[],yellow:[],pink:[]};
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.png'))){
  const buf=fs.readFileSync(path.join(dir,f));
  let img; try{img=decode(buf);}catch(e){continue;}
  const cnt={red:0,orange:0,yellow:0,pink:0};
  for(let i=0;i<img.out.length;i+=4){
    if(img.out[i+3]<40) continue;
    const c=classify(img.out[i],img.out[i+1],img.out[i+2]);
    if(c) cnt[c]++;
  }
  const tot=img.w*img.h;
  for(const k of Object.keys(cnt)) if(cnt[k]/tot>0.04) res[k].push({f,n:cnt[k],ratio:+(cnt[k]/tot).toFixed(2)});
}
for(const k of Object.keys(res)){ res[k].sort((a,b)=>b.ratio-a.ratio); console.log(`\n${k} (${res[k].length})`); res[k].slice(0,8).forEach(r=>console.log(`  ${r.f} ${r.ratio}`)); }
