// (오목 단계 측정에 쓴 스크립트. 경로는 빌드 결과 C:/rb/art1, 신경망 C:/rb/net 기준이니 쓸 때 맞게 바꾸세요)
// 오목 단계 레이팅 맞추기: m3=1320, m4=1500 을 고정하고 나머지 선수 레이팅을 최대우도(엘로)로
const fs=require('fs');
const rows=['chainA.jsonl','chainB.jsonl'].filter(f=>fs.existsSync(f)).flatMap(f=>fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const fixed={m3:1320,m4:1500};
const players=[...new Set(rows.flatMap(r=>[r.a,r.b]))];
const R={};for(const p of players)R[p]=fixed[p]??1500;
const E=(a,b)=>1/(1+Math.pow(10,(b-a)/400));
for(let it=0;it<4000;it++){
  const g={};for(const p of players)g[p]=0;
  for(const r of rows){const e=E(R[r.a],R[r.b]);const d=r.res-e;g[r.a]+=d;g[r.b]-=d;}
  for(const p of players)if(!(p in fixed))R[p]+=g[p]*2; // 경사 상승
}
const by={};for(const r of rows){const k=r.a+' vs '+r.b;(by[k]=by[k]||[0,0]);by[k][0]+=r.res;by[k][1]++;}
for(const [k,[s,n]] of Object.entries(by))console.log(k.padEnd(22),s+'/'+n);
console.log('---');
for(const p of players.sort((a,b)=>R[a]-R[b]))console.log(p.padEnd(10),Math.round(R[p]));
