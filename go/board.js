/* 바둑판 규칙 (착수·따내기·패·자충 금지·집 계산). 대국 화면, 학습 화면, AI가 함께 쓴다 */
'use strict';
const EMPTY=0,BLACK=1,WHITE=2,EDGE=3,PASS=0;
const MAXS=23*23;
const MARK=new Int32Array(MAXS),LMARK=new Int32Array(MAXS),STACK=new Int32Array(MAXS);
let STAMP=0,LASTLIB=0;

// 판 크기별로 공유하는 상수 (탐색 트리의 노드마다 보드를 복사하므로 메모리를 아낀다)
const BOARD_CONST={};
class Board{
  constructor(n){
    this.n=n;const W=n+2;this.W=W;this.size=W*W;
    const K=BOARD_CONST[n]||(BOARD_CONST[n]=(()=>{const pts=new Int16Array(n*n);let k=0;for(let y=1;y<=n;y++)for(let x=1;x<=n;x++)pts[k++]=y*W+x;return{pts,d:[1,-1,W,-W],dg:[W+1,W-1,1-W,-1-W]};})());
    this.c=new Uint8Array(this.size).fill(EDGE);
    this.pts=K.pts;
    this.empty=new Int16Array(n*n);this.eidx=new Int16Array(this.size);this.ne=0;
    for(const p of K.pts){this.c[p]=EMPTY;this.addE(p);}
    this.d=K.d;this.dg=K.dg;
    this.ko=0;this.turn=BLACK;this.passes=0;this.caps=[0,0,0];this.last=-1;this.moveNum=0;
  }
  static fromState(st){
    const b=new Board(st.n);
    for(const p of st.setup)b.place(p,BLACK);
    if(st.setup.length)b.turn=WHITE;
    for(const m of st.moves)b.play(m);
    return b;
  }
  copyFrom(b){
    this.c.set(b.c);this.empty.set(b.empty);this.eidx.set(b.eidx);this.ne=b.ne;
    this.ko=b.ko;this.turn=b.turn;this.passes=b.passes;this.caps[1]=b.caps[1];this.caps[2]=b.caps[2];
    this.last=b.last;this.moveNum=b.moveNum;
  }
  xy(p){return [p%this.W-1,(p/this.W|0)-1];}
  pt(x,y){return (y+1)*this.W+x+1;}
  addE(p){this.eidx[p]=this.ne;this.empty[this.ne++]=p;}
  delE(p){const i=this.eidx[p],q=this.empty[--this.ne];this.empty[i]=q;this.eidx[q]=i;}
  place(p,col){this.c[p]=col;this.delE(p);}
  // 그룹의 활로 수 (max에 도달하면 중단). 마지막으로 찾은 활로는 LASTLIB
  libs(p,max){
    if(STAMP>2e9){MARK.fill(0);LMARK.fill(0);STAMP=0;}
    const c=this.c,col=c[p],d=this.d,s=++STAMP;
    let sp=0,n=0;STACK[sp++]=p;MARK[p]=s;
    while(sp>0){
      const q=STACK[--sp];
      for(let i=0;i<4;i++){
        const r=q+d[i],v=c[r];
        if(v===EMPTY){if(LMARK[r]!==s){LMARK[r]=s;n++;LASTLIB=r;if(n>=max)return n;}}
        else if(v===col&&MARK[r]!==s){MARK[r]=s;STACK[sp++]=r;}
      }
    }
    return n;
  }
  remove(p){
    const c=this.c,col=c[p],d=this.d;let sp=0,n=1;
    STACK[sp++]=p;c[p]=EMPTY;this.addE(p);
    while(sp>0){const q=STACK[--sp];for(let i=0;i<4;i++){const r=q+d[i];if(c[r]===col){c[r]=EMPTY;this.addE(r);n++;STACK[sp++]=r;}}}
    return n;
  }
  isLegal(p,col){
    if(p===PASS)return true;
    const c=this.c;if(c[p]!==EMPTY||p===this.ko)return false;
    const d=this.d,opp=3-col;
    for(let i=0;i<4;i++)if(c[p+d[i]]===EMPTY)return true;
    for(let i=0;i<4;i++){
      const r=p+d[i],v=c[r];
      if(v===col){if(this.libs(r,2)>=2)return true;}
      else if(v===opp){if(this.libs(r,2)===1)return true;}
    }
    return false;
  }
  play(p){
    const col=this.turn;
    this.moveNum++;this.turn=3-col;this.last=p;
    if(p===PASS){this.passes++;this.ko=0;return 0;}
    const c=this.c,d=this.d,opp=3-col;
    c[p]=col;this.delE(p);
    let cap=0,capPos=0;
    for(let i=0;i<4;i++){const r=p+d[i];if(c[r]===opp&&this.libs(r,1)===0){cap+=this.remove(r);capPos=r;}}
    this.caps[col]+=cap;this.ko=0;this.passes=0;
    if(cap===1){
      let single=true;for(let i=0;i<4;i++)if(c[p+d[i]]===col)single=false;
      if(single&&this.libs(p,2)===1)this.ko=capPos;
    }
    return cap;
  }
  isEye(p,col){
    const c=this.c,d=this.d,dg=this.dg;
    for(let i=0;i<4;i++){const v=c[p+d[i]];if(v!==col&&v!==EDGE)return false;}
    let bad=0,edge=0;
    for(let i=0;i<4;i++){const v=c[p+dg[i]];if(v===EDGE)edge=1;else if(v===3-col)bad++;}
    return edge?bad===0:bad<=1;
  }
  isSelfAtari(p,col){
    const c=this.c,d=this.d;let emp=0;
    for(let i=0;i<4;i++)if(c[p+d[i]]===EMPTY)emp++;
    if(emp>=2)return false;
    c[p]=col;
    for(let i=0;i<4;i++){const r=p+d[i];if(c[r]===3-col&&this.libs(r,1)===0){c[p]=EMPTY;return false;}}
    const res=this.libs(p,2)<2;c[p]=EMPTY;return res;
  }
  playoutMove(rng){
    const col=this.turn,c=this.c,d=this.d,last=this.last;
    if(last>0&&c[last]===3-col){
      // 방금 둔 상대 돌이 단수면 따낸다
      if(this.libs(last,2)===1){const l=LASTLIB;if(this.isLegal(l,col))return l;}
      // 내 돌이 단수에 몰렸으면 달아난다
      for(let i=0;i<4;i++){const r=last+d[i];
        if(c[r]===col&&this.libs(r,2)===1){const l=LASTLIB;if(this.isLegal(l,col)&&!this.isSelfAtari(l,col))return l;}}
    }
    const e=this.empty,ei=this.eidx;let n=this.ne;
    while(n>0){
      const i=rng()*n|0,p=e[i];
      if(this.isLegal(p,col)&&!this.isEye(p,col)&&!(rng()<0.9&&this.isSelfAtari(p,col)))return p;
      n--;const t=e[n];e[n]=p;e[i]=t;ei[p]=n;ei[t]=i;
    }
    return PASS;
  }
  ownerAt(p){
    const v=this.c[p];if(v===BLACK)return 1;if(v===WHITE)return -1;
    let b=0,w=0;for(let j=0;j<4;j++){const u=this.c[p+this.d[j]];if(u===BLACK)b=1;else if(u===WHITE)w=1;}
    return b&&!w?1:w&&!b?-1:0;
  }
  score(komi){let s=0;const pts=this.pts;for(let i=0;i<pts.length;i++)s+=this.ownerAt(pts[i]);return s-komi;}
}
