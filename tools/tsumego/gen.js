// 사활 문제 자동 생성: 눈자리 모양 + 수비 벽 + 공격 벽, 변형(빈틈·이미 둔 돌)을 섞어 계산기로 거른다
const {check}=require('./lib/tsume-lib.js');
const fs=require('fs');
let seed=+process.argv[2]||1;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return ((seed>>>0)%1e9)/1e9;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const K=(x,y)=>x+','+y;
function polyomino(k,maxY,x0,x1,corner){
  const cells=new Map();const sx=corner?Math.floor(rnd()*2):x0+Math.floor(rnd()*(x1-x0));cells.set(K(sx,0),[sx,0]);
  let guard=0;
  while(cells.size<k&&guard++<200){const [x,y]=pick([...cells.values()]);const [dx,dy]=pick([[1,0],[-1,0],[0,1],[0,-1]]);const nx=x+dx,ny=y+dy;
    if(ny<0||ny>maxY||nx<(corner?0:x0)||nx>x1)continue;cells.set(K(nx,ny),[nx,ny]);}
  return cells.size===k?cells:null;
}
const N8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]],N4=[[1,0],[-1,0],[0,1],[0,-1]];
function gen(corner){
  const k=3+Math.floor(rnd()*5);
  const I=polyomino(k,rnd()<0.6?1:2,corner?0:3,corner?5:8,corner);if(!I)return null;
  const inB=(x,y)=>y>=0&&x>=0;
  const D=new Map();
  for(const [x,y] of I.values())for(const [dx,dy] of N8){const nx=x+dx,ny=y+dy;if(inB(nx,ny)&&!I.has(K(nx,ny)))D.set(K(nx,ny),[nx,ny]);}
  const gap=new Map(),A=new Map(),Ain=new Map(),Din=new Map();
  // 변형
  const ops=Math.floor(rnd()*3);
  for(let o=0;o<ops;o++){
    const r=rnd();
    if(r<0.45){ // 첫 줄 끝의 수비 돌을 빈칸으로 (젖힐 자리)
      const c=[...D.values()].filter(([x,y])=>y===0);if(c.length){const [x,y]=pick(c);D.delete(K(x,y));gap.set(K(x,y),[x,y]);}
    }else if(r<0.7){ // 수비 벽 한 칸을 빈칸으로 (약점)
      const [x,y]=pick([...D.values()]);D.delete(K(x,y));gap.set(K(x,y),[x,y]);
    }else if(r<0.85){ // 눈자리에 공격 돌
      const [x,y]=pick([...I.values()]);I.delete(K(x,y));Ain.set(K(x,y),[x,y]);
    }else{ // 눈자리에 수비 돌
      const [x,y]=pick([...I.values()]);I.delete(K(x,y));Din.set(K(x,y),[x,y]);
    }
  }
  // 영역 밖 한 칸 더: 첫 줄 끝 바깥 (공격이 젖힐 수도, 수비가 넓힐 수도)
  if(rnd()<0.4){const c=[...D.values()].filter(([x,y])=>y===0);if(c.length){const [x,y]=pick(c);for(const dx of [1,-1]){const nx=x+dx;if(inB(nx,0)&&!D.has(K(nx,0))&&!I.has(K(nx,0))&&!gap.has(K(nx,0))&&!Ain.has(K(nx,0))){gap.set(K(nx,0),[nx,0]);break;}}}}
  const inner=new Map([...I,...D,...gap,...Ain,...Din]);
  for(const [x,y] of inner.values())for(const [dx,dy] of N8){const nx=x+dx,ny=y+dy;if(inB(nx,ny)&&!inner.has(K(nx,ny)))A.set(K(nx,ny),[nx,ny]);}
  // 수비 돌이 하나로 이어졌는지
  const Ds=new Map([...D,...Din]);if(!Ds.size)return null;
  const first=Ds.keys().next().value,seen=new Set([first]),st=[first];
  while(st.length){const [x,y]=st.pop().split(',').map(Number);for(const [dx,dy] of N4){const kk=K(x+dx,y+dy);if(Ds.has(kk)&&!seen.has(kk)){seen.add(kk);st.push(kk);}}}
  if(seen.size!==Ds.size)return null;
  let mx=0,my=0;for(const [x,y] of [...inner.values(),...A.values()]){mx=Math.max(mx,x);my=Math.max(my,y);}
  const rows=[];
  const tgt=[...D.values()].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
  for(let y=0;y<=my;y++){let s='';for(let x=0;x<=mx;x++){const kk=K(x,y);s+=I.has(kk)||gap.has(kk)?'.':D.has(kk)||Din.has(kk)?(tgt&&x===tgt[0]&&y===tgt[1]?'o':'O'):A.has(kk)||Ain.has(kk)?'X':',';}rows.push(s);}
  return rows;
}
const swap=rows=>rows.map(r=>r.replace(/[XOxo]/g,c=>({X:'O',O:'X',x:'o',o:'x'})[c]));
const canon=rows=>rows.join('/');
const transpose=rows=>{const h=rows.length,w=Math.max(...rows.map(r=>r.length));const out=[];for(let x=0;x<w;x++){let s='';for(let y=0;y<h;y++)s+=rows[y][x]||',';out.push(s);}return out;};
const seenK=new Set(),found=[];
const want=+process.argv[3]||400;
for(let it=0;it<want;it++){
  const corner=rnd()<0.6;
  const rows=gen(corner);if(!rows)continue;
  const region=rows.join('').split('.').length-1;if(region<3||region>11)continue;
  for(const mode of ['kill','live']){
    const R=mode==='kill'?rows:swap(rows);
    const ck=canon(R);if(seenK.has(ck))continue;seenK.add(ck);if(corner)seenK.add(canon(transpose(R)));
    const def={id:mode+it,rows:R,at:corner?[0,0]:[4,0]};
    let r;try{r=check(def,{limit:150000});}catch(e){continue;}
    if(r.aborted||r.leak||r.strict.length!==1||r.normal.length!==1||r.oppFirst!=='win'||r.broken)continue;
    const moves=Math.ceil(r.line.length/2);
    found.push({mode,corner,rows:R,answer:r.names(r.strict),line:r.names(r.line),moves,multi:r.multi||0,region,ms:r.ms});
  }
}
fs.writeFileSync(require('path').join(__dirname,'pool','gen-'+(process.argv[2]||1)+'.json'),JSON.stringify(found));
const by={};for(const f of found)by[f.moves]=(by[f.moves]||0)+1;
console.log('후보',found.length,'수수별',JSON.stringify(by));
