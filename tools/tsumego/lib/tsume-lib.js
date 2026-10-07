// 문제 검증: 정답(패 없이), 일반 규칙 정답, 백 먼저 두면 백 성공인지, 주 수순
const {T,name}=require('./tsume-load.js');
function check(def,opts={}){
  const pr=T.fromDiagram(def),b=pr.board,me=b.turn,opp=3-me;
  const t0=Date.now();
  const strict=T.winningMoves(pr,b,{koFree:opp,limit:opts.limit||300000});
  const normal=T.winningMoves(pr,b,{koFree:0,limit:opts.limit||300000});
  // 상대가 먼저 두면 상대가 이기는가 (문제가 급한가)
  const b2=new (require('./tsume-load.js').Board)(b.n);b2.copyFrom(b);b2.turn=opp;
  const oppFirst=T.status(pr,b2,{koFree:0,limit:opts.limit||300000});
  // 경계 검사: 수비 돌·영역 칸 옆에 영역 밖 빈칸이 있으면 안 된다
  const reg=new Set(pr.region),def3=3-pr.attacker;let leak=0;
  // 영역에는 돌 자리도 들어 있으므로, 영역의 빈칸과 수비 돌만 본다 (공격 벽이 바깥과 닿는 것은 괜찮다)
  for(const p of b.pts){if(!((reg.has(p)&&b.c[p]===0)||b.c[p]===def3))continue;for(const d of b.d){const r=p+d;if(b.c[r]===0&&!reg.has(r))leak++;}}
  const res={id:def.id,strict:strict.moves,normal:normal.moves,oppFirst,aborted:strict.aborted||normal.aborted,nodes:strict.nodes+normal.nodes,leak,ms:0,line:[]};
  if(strict.moves.length&&!res.aborted){
    // 주 수순
    const L=require('./tsume-load.js');let cur=new L.Board(b.n);cur.copyFrom(b);
    let mv=strict.moves[0];
    for(let ply=0;ply<24;ply++){
      res.line.push(mv);cur.play(mv);
      if(T.settled(pr,cur,{koFree:opp}))break;
      const r=T.toughestReply(pr,cur,{koFree:opp});res.line.push(r);cur.play(r);
      const w=T.winningMoves(pr,cur,{koFree:opp});if(!w.moves.length){res.broken=true;break;}
      if(w.moves.length>1)res.multi=(res.multi||0)+1;
      mv=w.moves[0];
    }
  }
  res.ms=Date.now()-t0;
  res.names=x=>x.map(m=>m===0?'패스':name(b,m)).join(' ');
  return res;
}
module.exports={check,T,name};
