/* 오목 AI 윗단계: Rapfi(GPL-3.0, github.com/dhbloo/rapfi)를 Web Worker 에서 돌린다.
 * 빌드는 tools/rapfi (GitHub Actions). 렌주 규칙, Piskvork 프로토콜로 대화한다.
 * 메시지 {id, moves, nodes, strength, nnue} → {id, move} (실패하면 move -1, error)
 *   nodes: 읽을 노드 수 상한(0 = 제한 없음), strength: 0~100 (100 = 전력), nnue: 렌주 신경망 사용
 * 신경망(약 19MB)은 처음 쓸 때 한 번 받아 엔진 파일 시스템에 넣는다. 받는 동안 {id, status} 로 진행률을 알린다.
 */
'use strict';
const DIR='vendor/rapfi/',N=15;
let mod=null,boot=null,nnueLoaded=false,nnueOn=false;
const out=[];
function send(c){out.length=0;mod.sendCommand(c);return out.slice();}
function start(){
  if(!boot)boot=(async()=>{
    importScripts(DIR+'rapfi-single-simd128.js');
    mod=await Rapfi({locateFile:f=>DIR+f,onReceiveStdout:o=>out.push(o),onReceiveStderr:()=>{},onExit:()=>{}});
    for(const c of ['START 15','INFO rule 4','INFO timeout_match 0','INFO timeout_turn 60000','INFO max_memory 0'])send(c);
  })();
  return boot;
}
async function fetchNet(id,name,done,total){
  const r=await fetch(DIR+name);if(!r.ok)throw new Error('신경망을 받지 못했습니다');
  const size=+r.headers.get('content-length')||0,reader=r.body&&r.body.getReader?r.body.getReader():null;
  if(!reader||!size)return new Uint8Array(await r.arrayBuffer());
  const buf=new Uint8Array(size);let at=0,last=-1;
  for(;;){const {done:d,value}=await reader.read();if(d)break;buf.set(value,at);at+=value.length;
    const pct=Math.floor((done+at)/total*100);if(pct!==last){last=pct;self.postMessage({id,status:`최강 AI 신경망 받는 중 ${pct}% (처음 한 번, 약 19MB)`});}}
  return buf;
}
async function useNnue(id,on){
  if(on&&!nnueLoaded){
    const names=['black','white'].map(c=>`mix9svqrenju_bs15_${c}.bin.lz4`),total=19.9e6;let done=0;
    for(const n of names){const data=await fetchNet(id,n,done,total);done+=data.length;mod.FS.writeFile('/'+n,data);}
    nnueLoaded=true;
  }
  if(on!==nnueOn){send('RELOADCONFIG '+(on?'/nnue.toml':'/config.toml'));nnueOn=on;}
}
self.onmessage=async e=>{
  const {id,moves,nodes,strength,nnue}=e.data;
  try{
    await start();await useNnue(id,!!nnue);
    send('INFO max_node '+(nodes||0));send('INFO strength '+(strength==null?100:strength));
    // 판: 놓인 순서대로, 1 = 이번에 둘 쪽 돌, 2 = 상대 돌 (첫 수는 흑)
    const me=moves.length%2;let cmd='BOARD\n';
    moves.forEach((p,i)=>{cmd+=`${p%N},${(p/N)|0},${i%2===me?1:2}\n`;});
    const res=send(cmd+'DONE'),l=res.find(x=>/^\d+,\d+$/.test(x.trim()));
    if(!l)throw new Error('응답 없음');
    const [x,y]=l.trim().split(',').map(Number);
    self.postMessage({id,move:y*N+x});
  }catch(err){self.postMessage({id,move:-1,error:String(err&&err.message||err)});}
};
