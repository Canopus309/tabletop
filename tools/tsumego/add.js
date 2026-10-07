// 사활 문제 추가: 생성 후보(pool/*.json)에서 아직 안 쓴 모양을 골라 go/learn/problems.js 의 사활 묶음 끝에 붙인다.
// 이미 있는 문제(번호·풀이·푼 기록)는 건드리지 않는다. 새 문제 번호는 지금 가장 큰 번호 다음부터.
// 사용: node tools/tsumego/add.js [단계별 개수=10]      (진행 기록은 tools/tsumego/PROGRESS.md)
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'../..'),PROB=path.join(ROOT,'go/learn/problems.js');
const {build,mainLine}=require('./lib/tsume-tree.js');
const L=require('./lib/tsume-load.js');
const per=+process.argv[2]||10;

const src=fs.readFileSync(PROB,'utf8'),m=src.match(/^const LEARN=(.*);\s*$/m);
const LEARN=JSON.parse(m[1]),ld=LEARN.sets.find(s=>s.key==='ld');

// 눈자리 모양 서명 (평행 이동 무시, 흑백만 바꾼 같은 모양도 같은 것으로)
function sig(rows,corner){
  const pts=[];rows.forEach((r,y)=>[...r].forEach((c,i)=>{if(c==='.')pts.push([i,y]);}));
  const mx=Math.min(...pts.map(p=>p[0])),my=Math.min(...pts.map(p=>p[1]));
  return (corner?'C':'S')+':'+pts.map(([a,b])=>(a-mx)+','+(b-my)).sort().join(' ');
}
const seen=new Set(ld.items.map(it=>sig(it.rows,!it.at||it.at[0]===0)));
const pool=[];
for(const f of fs.readdirSync(path.join(__dirname,'pool')).filter(f=>f.endsWith('.json')).sort())
  for(const x of JSON.parse(fs.readFileSync(path.join(__dirname,'pool',f))))pool.push(x);
// 단계: 입문 = 한 수로 끝나고 집 자리 5칸 이하 / 초급 = 한 수에 6칸 이상 또는 두 수에 6칸 이하 / 중급 = 그 밖의 두 수 이상
const lvOf=x=>x.moves===1&&x.region<=5?0:(x.moves===1&&x.region>=6)||(x.moves===2&&x.region<=6)?1:2;
const sgxy=s=>[s.charCodeAt(0)-97,s.charCodeAt(1)-97];
// 첫 수의 성격으로 짧은 해설
function autoNote(p,tree){
  const pr=L.T.fromDiagram({id:'x',rows:p.rows,at:p.at}),b=pr.board;
  const k=Object.keys(tree.ok)[0],[x,y]=sgxy(k),mv=b.pt(x,y);
  let nb=0,nw=0;for(const d of b.d){const v=b.c[mv+d];if(v===1)nb++;else if(v===2)nw++;}
  const tail=tree.ok[k][0]?' 그다음 백의 저항에도 침착하게 받으면 됩니다.':'';
  if(p.goal==='kill')return nb===0?'백 집 안의 급소에 치중하는 수가 정답입니다. 백이 어느 쪽으로 받아도 두 집을 만들 수 없습니다.'+tail:'바깥에서 백의 집 넓이를 먼저 줄이는 수가 정답입니다. 집이 좁아지면 백은 두 집을 낼 수 없습니다.'+tail;
  return nw>0?'백이 파고드는 자리를 먼저 막아 집을 넓혀야 삽니다.'+tail:'집 모양의 급소를 먼저 차지해야 두 집이 납니다.'+tail;
}
function makeItem(x,lv,id){
  const p={rows:x.rows,at:x.corner?[0,0]:[4,0],goal:x.mode};
  let r;try{r=build({id,rows:p.rows,at:p.at});}catch(e){return null;}
  if(r.aborted||!r.tree)return null; // 모든 응수를 계산 한도 안에서 못 만드는 것은 뺀다
  const it={id,lv,title:(x.corner?'귀 ':'변 ')+(x.mode==='kill'?'잡기':'살기'),goal:x.mode,rows:x.rows,tree:r.tree,note:autoNote(p,r.tree)};
  if(!x.corner)it.at=p.at;
  // 보여 줄 범위: 그림과 풀이 나무의 모든 수
  let x0=p.at[0],y0=p.at[1],x1=p.at[0]+Math.max(...x.rows.map(s=>s.length))-1,y1=p.at[1]+x.rows.length-1;
  const addS=s=>{if(!s||s==='tt'||s==='ko')return;const [X,Y]=sgxy(s);x0=Math.min(x0,X);x1=Math.max(x1,X);y0=Math.min(y0,Y);y1=Math.max(y1,Y);};
  const walk=n=>{for(const [k,[rr,c]] of Object.entries(n.ok)){addS(k);addS(rr);if(c)walk(c);}for(const [k,v] of Object.entries(n.bad)){addS(k);addS(v);}addS(n.pass);};walk(r.tree);
  it.box=[x0,y0,x1,y1];
  return it;
}
let next=Math.max(...ld.items.map(it=>+it.id.slice(2)))+1;
const added={0:[],1:[],2:[]};
// 잡기·살기, 귀·변이 고루 섞이게 차례로 (어려운 것 먼저)
const order=pool.map((x,i)=>i).sort((a,b)=>pool[b].moves-pool[a].moves||pool[b].region-pool[a].region||a-b);
const bucket={};for(const i of order){const x=pool[i],k=lvOf(x)+x.mode+(x.corner?'C':'S');(bucket[k]=bucket[k]||[]).push(i);}
for(const lv of [0,1,2]){
  const keys=['kill','live'].flatMap(md=>['C','S'].map(c=>lv+md+c));let progress=true;
  while(added[lv].length<per&&progress){
    progress=false;
    for(const k of keys){
      const b=bucket[k]||[];
      while(b.length){
        const x=pool[b.shift()],s=sig(x.rows,x.corner);if(seen.has(s))continue;seen.add(s);
        const it=makeItem(x,lv,'ld'+String(next).padStart(2,'0'));if(!it)continue;
        next++;added[lv].push(it);progress=true;
        process.stderr.write(`${it.id} 단계${lv} ${it.goal} ${mainLine(it.tree).join(' ')}\n`);break;
      }
      if(added[lv].length>=per)break;
    }
  }
}
// 같은 단계 문제들 바로 뒤에 넣는다 (화면 번호는 단계 순서, 문제 id 는 그대로)
for(const lv of [0,1,2])for(const it of added[lv]){
  let at=ld.items.length;for(let i=ld.items.length-1;i>=0;i--)if(ld.items[i].lv<=lv){at=i+1;break;}
  ld.items.splice(at,0,it);
}
fs.writeFileSync(PROB,src.replace(m[0],'const LEARN='+JSON.stringify(LEARN)+';'));
const by={};for(const it of ld.items)by[it.lv]=(by[it.lv]||0)+1;
console.log(`추가 ${added[0].length+added[1].length+added[2].length}문제 (입문 ${added[0].length}, 초급 ${added[1].length}, 중급 ${added[2].length}) · 사활 모두 ${ld.items.length} (단계별 ${JSON.stringify(by)})`);
