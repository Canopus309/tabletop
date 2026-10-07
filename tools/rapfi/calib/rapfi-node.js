// (오목 단계 측정에 쓴 스크립트. 경로는 빌드 결과 C:/rb/art1, 신경망 C:/rb/net 기준이니 쓸 때 맞게 바꾸세요)
// Rapfi(WASM)를 Node 에서 띄워 Piskvork 프로토콜로 대화하는 도우미 (오목 단계 측정용)
'use strict';
const path=require('path');
const BUILD='C:/rb/art1';
async function startRapfi(){
  const factory=require(path.join(BUILD,'rapfi-single-simd128.js'));
  let waiting=null;const lines=[];
  const mod=await factory({
    locateFile:f=>path.join(BUILD,f),
    onReceiveStdout:o=>{lines.push(o);if(waiting)waiting();},
    onReceiveStderr:o=>{},
    onExit:()=>{},
  });
  const send=c=>mod.sendCommand(c);
  // 응답 한 줄을 기다린다 (MESSAGE/DEBUG/INFO 줄은 건너뜀). 단일 스레드라 sendCommand 가 끝나면 응답이 이미 와 있다
  const take=re=>{for(let i=0;i<lines.length;i++){const l=lines[i];if(re.test(l)){lines.splice(0,i+1);return l;}}return null;};
  return{mod,send,take,lines};
}
module.exports={startRapfi};
