/* 증강 규칙을 아는 빠른 바둑판 (증강 바둑 AI 의 수 읽기 · 측정용 무작위 대국에 씀). go/board.js 의 Board 를 이어받는다.
 * 규칙은 go/aug/aug.js 의 AugGame 과 같다 (tools/aug/sim-test.js 가 둘을 맞대어 확인):
 *   inv[색]  무적수를 건 돌 자리 (그 돌과 이어진 무리는 잡히지 않고, 자충으로도 막히지 않음)
 *   bar[색]  결계 점 (상대는 둘 수 없음)
 *   kw       패왕을 가진 색 (패를 바로 되따낼 수 있음. 둘 다 패왕이면 0)
 *   turnNo   끝난 차례 수 (부르는 쪽이 turnEnd 로 늘림. 슈퍼선수의 두 수도 한 차례)
 *   para     공수부대 {col, p, prot: 이 차례 수까지 보호, check: 끝난 차례 수가 이것이 되면 활로 확인}
 *   resv     양자택일 · 예약수 {col, pts, at: 끝난 차례 수가 이것이 되면 예약점에 돌}
 * board.js 다음에 같은 범위에서 실행한다 (브라우저 스크립트처럼 전역에 AugBoard 를 만든다).
 */
'use strict';
const AUG_MARK=new Int32Array(23*23),AUG_STACK=new Int32Array(23*23);let AUG_STAMP=0;
const AUG_TMPS={};const AUG_TMP=n=>AUG_TMPS[n]||(AUG_TMPS[n]=new AugBoard(n)); // 규칙 확인용 빈 판 (판 크기마다 하나)
class AugBoard extends Board{
  constructor(n){super(n);this.inv=[0,0,0];this.bar=[0,0,0];this.kw=0;this.turnNo=0;this.para=null;this.resv=null;}
  copyFrom(b){super.copyFrom(b);this.inv[1]=b.inv[1];this.inv[2]=b.inv[2];this.bar[1]=b.bar[1];this.bar[2]=b.bar[2];this.kw=b.kw;this.turnNo=b.turnNo;this.para=b.para;this.resv=b.resv;}
  // 벽: col 쪽 변의 1선을 내 돌로 (대국 시작 때)
  wall(col){for(const p of augWallPts(this.n,col)){this.c[p]=col;this.delE(p);}}

  // p 의 무리가 무적인가 (무적수를 건 돌이 같은 무리에 있으면)
  isInv(p){
    const c=this.c,col=c[p],P=this.para;
    if(P&&P.col===col&&this.turnNo<=P.prot&&c[P.p]===col&&this.sameChain(p,P.p))return true;
    const m=this.inv[col];if(!m||c[m]!==col)return false;if(m===p)return true;
    if(++AUG_STAMP>2e9){AUG_MARK.fill(0);AUG_STAMP=1;}
    const s=AUG_STAMP,d=this.d;let sp=0;AUG_STACK[sp++]=p;AUG_MARK[p]=s;
    while(sp>0){const q=AUG_STACK[--sp];for(let i=0;i<4;i++){const r=q+d[i];if(c[r]===col&&AUG_MARK[r]!==s){if(r===m)return true;AUG_MARK[r]=s;AUG_STACK[sp++]=r;}}}
    return false;
  }
  // p 와 q 가 같은 무리인가
  sameChain(p,q){
    if(p===q)return true;const c=this.c,col=c[p],d=this.d;if(c[q]!==col)return false;
    if(++AUG_STAMP>2e9){AUG_MARK.fill(0);AUG_STAMP=1;}
    const s=AUG_STAMP;let sp=0;AUG_STACK[sp++]=p;AUG_MARK[p]=s;
    while(sp>0){const x=AUG_STACK[--sp];for(let i=0;i<4;i++){const r=x+d[i];if(c[r]===col&&AUG_MARK[r]!==s){if(r===q)return true;AUG_MARK[r]=s;AUG_STACK[sp++]=r;}}}
    return false;
  }
  // 한 차례가 끝남 (부르는 쪽이 부른다): 공수부대 기한 확인
  turnEnd(){
    this.turnNo++;const P=this.para;
    if(P&&this.turnNo===P.check){this.para=null;if(this.c[P.p]===P.col&&this.libs(P.p,1)===0&&!this.isInv(P.p))this.caps[3-P.col]+=this.remove(P.p);}
    const R=this.resv; // 예약점에 돌 (이제 R.col 차례)
    if(R&&this.turnNo===R.at){this.resv=null;for(const p of R.pts)if(this.c[p]===EMPTY&&this.isLegal(p,R.col)){this.turn=R.col;this.play(p);this.turn=R.col;this.ko=0;}this.ko=0;this.last=-1;}
  }
  // 양자택일 · 예약수: 예약하고 차례를 넘긴다
  reserve(pts){this.resv={col:this.turn,pts,at:this.turnNo+2};this.endTurn();}
  // 예약수: 예약만 (이어서 그 차례 수를 둔다)
  reserveOnly(q){this.resv={col:this.turn,pts:[q],at:this.turnNo+2};}
  isLegal(p,col){
    if(p===PASS)return true;
    const c=this.c;if(c[p]!==EMPTY)return false;
    if(this.bar[3-col]===p)return false;
    if(p===this.ko&&this.kw!==col)return false;
    const d=this.d,opp=3-col;
    for(let i=0;i<4;i++)if(c[p+d[i]]===EMPTY)return true;
    for(let i=0;i<4;i++){
      const r=p+d[i],v=c[r];
      if(v===col){if(this.libs(r,2)>=2)return true;}
      else if(v===opp){if(this.libs(r,2)===1&&!this.isInv(r))return true;}
    }
    // 무적 무리에 이어지는 수는 활로가 없어도 둘 수 있다
    if(this.inv[col])for(let i=0;i<4;i++){const r=p+d[i];if(c[r]===col&&this.isInv(r))return true;}
    return false;
  }
  play(p){
    const col=this.turn;
    this.moveNum++;this.turn=3-col;this.last=p;
    if(p===PASS){this.passes++;this.ko=0;return 0;}
    const c=this.c,d=this.d,opp=3-col;
    c[p]=col;this.delE(p);
    let cap=0,capPos=0;
    for(let i=0;i<4;i++){const r=p+d[i];if(c[r]===opp&&this.libs(r,1)===0&&!this.isInv(r)){cap+=this.remove(r);capPos=r;}}
    this.caps[col]+=cap;this.ko=0;this.passes=0;
    if(cap===1){
      let single=true;for(let i=0;i<4;i++)if(c[p+d[i]]===col)single=false;
      if(single&&this.libs(p,2)===1)this.ko=capPos;
    }
    return cap;
  }
  // 저격 (2026-10-13 부터): q 의 돌 한 점을 들어낸다. 차례는 그대로 (이어서 그 차례의 수를 둔다)
  pluck(q){this.c[q]=EMPTY;this.addE(q);this.caps[this.turn]++;this.ko=0;}
  // 예전 저격: q 의 돌 한 점을 들어내고 차례를 넘긴다 (예전 기보 · 측정 도구용)
  snipe(q){const col=this.turn;this.c[q]=EMPTY;this.addE(q);this.caps[col]++;this.ko=0;this.passes=0;this.moveNum++;this.turn=3-col;this.last=-1;}
  // 맞바꾸기 뒤 정리 (AugGame.settle 과 같음): 둘레의 활로 없는 상대 무리를 따내고, 내 무리가 활로 없이 남으면 -1
  settle(col,pts){
    const c=this.c,d=this.d,opp=3-col,near=new Set();
    for(const p of pts){near.add(p);for(let i=0;i<4;i++)near.add(p+d[i]);}
    let cap=0;
    for(const r of near)if(c[r]===opp&&this.libs(r,1)===0&&!this.isInv(r))cap+=this.remove(r);
    this.caps[col]+=cap;
    for(const r of near)if(c[r]===col&&this.libs(r,1)===0&&!this.isInv(r))return -1;
    return cap;
  }
  endTurn(){this.moveNum++;this.turn=3-this.turn;this.ko=0;this.passes=0;this.last=-1;}
  // 맞바꾸기: 내 돌 a 와 상대 돌 q 의 자리를 바꾸고 차례를 넘긴다. 규칙에 어긋나면 false (판은 그대로)
  canSwap(a,q){
    const col=this.turn;if(this.c[a]!==col||this.c[q]!==3-col||this.isInv(a)||this.isInv(q))return false;
    const t=AUG_TMP(this.n);t.copyFrom(this);t.c[a]=3-col;t.c[q]=col;return t.settle(col,[a,q])>=0;
  }
  swap(a,q){const col=this.turn;this.c[a]=3-col;this.c[q]=col;this.settle(col,[a,q]);this.endTurn();}
  // 거울수: p 에 두고, 대칭점이 비어 있고 둘 수 있으면 같은 색으로 한 점 더 (차례는 한 번 넘어감)
  mirrorPt(p){const [x,y]=this.xy(p);return this.pt(this.n-1-x,this.n-1-y);}
  mirror(p){const col=this.turn;this.play(p);const q=this.mirrorPt(p);if(q!==p&&this.isLegal(q,col)){this.turn=col;this.play(q);}}
  // 증식: 내 돌 p 둘레의 빈 점(상대 결계 빼고)을 모두 내 돌로
  growPts(p){const col=this.c[p],out=[];for(let i=0;i<4;i++){const r=p+this.d[i];if(this.c[r]===EMPTY&&this.bar[3-col]!==r)out.push(r);}return out;}
  canGrow(p){const col=this.turn;if(this.c[p]!==col)return false;const pts=this.growPts(p);if(!pts.length)return false;const t=AUG_TMP(this.n);t.copyFrom(this);for(const r of pts){t.c[r]=col;t.delE(r);}return t.settle(col,pts)>=0;}
  grow(p){const col=this.turn,pts=this.growPts(p);for(const r of pts){this.c[r]=col;this.delE(r);}this.settle(col,pts);this.endTurn();}
  // 순간이동: 내 돌 a 를 빈 점 q 로 (무적수를 건 돌이면 무적도 따라감)
  canTeleport(a,q){const col=this.turn;if(this.c[a]!==col||this.c[q]!==EMPTY||this.bar[3-col]===q)return false;const t=AUG_TMP(this.n);t.copyFrom(this);t.c[a]=EMPTY;t.addE(a);t.c[q]=col;t.delE(q);if(t.inv[col]===a)t.inv[col]=q;return t.settle(col,[q])>=0;}
  teleport(a,q){const col=this.turn;this.c[a]=EMPTY;this.addE(a);this.c[q]=col;this.delE(q);if(this.inv[col]===a)this.inv[col]=q;this.settle(col,[q]);this.endTurn();this.last=q;}
  // 공수부대: 자살수 자리도 됨. 상대의 다음 차례 동안 그 무리는 잡히지 않음 (turnEnd 로 기한 확인)
  paraPlay(q){this.para={col:this.turn,p:q,prot:this.turnNo+1,check:this.turnNo+3};this.play(q);}
  // 슈퍼선수: 같은 색이 한 수 더 (첫 수 뒤에 부름)
  again(){this.turn=3-this.turn;this.ko=0;}
}
