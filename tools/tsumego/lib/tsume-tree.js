// 문제 하나의 풀이 나무: 사용자 차례마다 정답 수 → [컴퓨터 응수, 다음 마디], 오답 수 → 반박 수
// 좌표는 'ab' (x, y 를 a부터, 19줄 판 기준)
const {T}=require('./tsume-lib.js');
const L=require('./tsume-load.js');
const sg=(b,p)=>{if(p===0)return 'tt';const [x,y]=b.xy(p);return String.fromCharCode(97+x)+String.fromCharCode(97+y);};
function build(def,opts={}){
  const pr=T.fromDiagram(def),b0=pr.board,me=b0.turn,opp=3-me;
  const O={koFree:opp,limit:opts.limit||300000};
  let nodes=0,aborted=false;
  function node(b,depth){
    nodes++;
    const w=T.winningMoves(pr,b,O);if(w.aborted)aborted=true;
    const n={ok:{},bad:{}};
    if(!w.moves.length)return null;
    const win=new Set(w.moves);
    for(const m of w.moves){
      const b1=new L.Board(19);b1.copyFrom(b);b1.play(m);
      if(T.settled(pr,b1,O)||depth>=9){n.ok[sg(b,m)]=['',0];continue;}
      const r=T.toughestReply(pr,b1,{koFree:opp,limit:O.limit});
      const b2=new L.Board(19);b2.copyFrom(b1);
      if(!b2.isLegal(r,opp)){n.ok[sg(b,m)]=['',0];continue;}
      b2.play(r);
      const child=node(b2,depth+1);
      n.ok[sg(b,m)]=child?[sg(b1,r),child]:['',0];
      if(!child)n.broken=true;
    }
    // 오답: 상대가 이기는 응수 (패를 되따내야 하면 'ko')
    for(const m of T.orderedMoves(pr,b,me)){
      if(win.has(m))continue;
      const b1=new L.Board(19);b1.copyFrom(b);b1.play(m);
      const t=T.terminal(pr,b1);
      let r=T.bestReply(pr,b1,{koFree:opp,limit:O.limit});
      n.bad[sg(b,m)]=r===null?'':(b1.isLegal(r,opp)?sg(b1,r):'ko');
    }
    // 영역 밖이나 패스: 상대가 먼저 두는 셈
    const bp=new L.Board(19);bp.copyFrom(b);bp.play(0);
    const rp=T.bestReply(pr,bp,{koFree:opp,limit:O.limit});
    n.pass=rp===null?'':sg(bp,rp);
    return n;
  }
  const root=node(b0,0);
  return {tree:root,nodes,aborted};
}
// 주 수순 (정답 첫 수들을 따라감)
function mainLine(t){const out=[];let n=t;while(n){const k=Object.keys(n.ok)[0];const [r,c]=n.ok[k];out.push(k);if(r)out.push(r);n=c||null;}return out;}
module.exports={build,mainLine};
if(require.main===module){
  const def={id:'오궁',rows:['O...OX','O..OOX','OOoOXX','XXXXX,']};
  const t=Date.now();const r=build(def);console.log(JSON.stringify(r.tree),r.nodes,r.aborted,Date.now()-t+'ms');console.log(mainLine(r.tree).join(' '));
}
