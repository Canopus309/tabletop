// (오목 단계 측정에 쓴 스크립트. 경로는 빌드 결과 C:/rb/art1, 신경망 C:/rb/net 기준이니 쓸 때 맞게 바꾸세요)
// 오목 단계 측정: 내 엔진(omok/renju.js)과 Rapfi(WASM) 대국
// 사용: node omok-match.js <결과.jsonl> "<A>:<B>:<판수>" ...
//   선수: m3 m4 m5 = 내 엔진 단계 3·4·5,  r<노드수>[s<세기>] = Rapfi 고전 평가 (예: r20000, r5000s60),  n<노드수> = Rapfi 신경망
'use strict';
const fs=require('fs'),path=require('path');
const RJ=require('C:/Claude Code/baduk-ai/omok/renju.js');
const {startRapfi}=require('./rapfi-node.js');
const N=15;
let R=null,nnueOn=null;
async function rapfi(){if(!R){R=await startRapfi();R.send('START 15');R.send('INFO rule 4');R.send('INFO timeout_match 0');R.send('INFO timeout_turn 60000');R.send('INFO max_memory 0');}return R;}
async function useNnue(on){
  const r=await rapfi();if(nnueOn===on)return;
  if(on&&!r.netsWritten){r.netsWritten=true;
    for(const c of ['black','white'])r.mod.FS.writeFile(`/mix9svqrenju_bs15_${c}.bin.lz4`,fs.readFileSync(`C:/rb/net/mix9svq/mix9svqrenju_bs15_${c}.bin.lz4`));
  }
  r.send('RELOADCONFIG '+(on?'/nnue.toml':'/config.toml'));nnueOn=on;
}
async function rapfiMove(moves,spec){
  const r=await rapfi();await useNnue(spec.nnue);
  r.send('INFO max_node '+spec.nodes);r.send('INFO strength '+(spec.str||100));
  const me=moves.length%2;
  let cmd='BOARD\n';moves.forEach((p,i)=>{cmd+=`${p%N},${(p/N)|0},${i%2===me?1:2}\n`;});cmd+='DONE';
  r.lines.length=0;r.send(cmd);
  const l=r.lines.find(x=>/^\d+,\d+$/.test(x.trim()));
  if(!l)throw new Error('Rapfi 응답 없음: '+r.lines.slice(-5).join(' | '));
  const [x,y]=l.trim().split(',').map(Number);return y*N+x;
}
function parse(s){
  if(s[0]==='m')return{kind:'m',level:+s.slice(1)};
  const m=/^([rn])(\d+)(?:s(\d+))?$/.exec(s);if(!m)throw new Error('선수 '+s);
  return{kind:'r',nnue:m[1]==='n',nodes:+m[2],str:m[3]?+m[3]:100};
}
async function move(moves,p){return p.kind==='m'?RJ.chooseMove(moves.slice(),p.level).move:rapfiMove(moves,p);}
// 판마다 다른 시작: 천원 다음 두세 수를 가운데 근처에 무작위로 (금수·5목 아닌 자리)
function opening(rng){
  const ms=[7*N+7],k=1+Math.floor(rng()*2);
  for(let i=0;i<k;i++){for(let t=0;t<50;t++){const x=5+Math.floor(rng()*5),y=5+Math.floor(rng()*5),p=y*N+x;if(!ms.includes(p)){ms.push(p);break;}}}
  return ms;
}
async function game(A,B,aBlack,seed){
  let s=seed>>>0||1;const rng=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
  const moves=opening(rng),g=RJ.Game.from(moves);
  while(moves.length<N*N){
    const blackTurn=moves.length%2===0,p=(blackTurn===aBlack)?A:B;
    const mv=await move(moves,p);
    if(mv<0||g.b[mv]!==RJ.EMPTY){return{res:blackTurn===aBlack?0:1,how:'둘 곳 없음/잘못된 수',plies:moves.length};}
    if(blackTurn&&RJ.isForbidden(g.b,mv)){return{res:aBlack?0:1,how:'흑 금수',plies:moves.length};}
    g.play(mv);moves.push(mv);
    if(g.isWin(mv)){const aWon=blackTurn===aBlack;return{res:aWon?1:0,how:'5목',plies:moves.length};}
  }
  return{res:0.5,how:'무승부',plies:moves.length};
}
(async()=>{
  const [out,...jobs]=process.argv.slice(2);
  for(const job of jobs){
    const [a,b,n]=job.split(':'),A=parse(a),B=parse(b);let sc=0;
    for(let i=0;i<+n;i++){
      const t0=Date.now(),r=await game(A,B,i%2===0,1234+i*7919);sc+=r.res;
      fs.appendFileSync(out,JSON.stringify({a,b,aBlack:i%2===0,...r,ms:Date.now()-t0})+'\n');
      console.log(`${a} vs ${b} ${i+1}/${n} ${i%2===0?'A흑':'A백'} ${r.res===1?'A승':r.res===0?'A패':'무'} (${r.how}, ${r.plies}수, ${((Date.now()-t0)/1000).toFixed(1)}초) 누적 ${sc}/${i+1}`);
    }
  }
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
