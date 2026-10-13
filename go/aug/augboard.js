/* 증강 규칙을 아는 빠른 바둑판 (증강 바둑 AI 의 수 읽기 · 측정용 무작위 대국에 씀). go/board.js 의 Board 를 이어받는다.
 * 규칙은 go/aug/aug.js 의 AugGame 과 같다 (tools/aug/sim-test.js 가 둘을 맞대어 확인):
 *   inv[색]  무적수를 건 돌 자리 (그 돌과 이어진 무리는 잡히지 않고, 자충으로도 막히지 않음)
 *   bar[색]  결계 점 (상대는 둘 수 없음)
 *   kw       패왕을 가진 색 (패를 바로 되따낼 수 있음. 둘 다 패왕이면 0)
 * board.js 다음에 같은 범위에서 실행한다 (브라우저 스크립트처럼 전역에 AugBoard 를 만든다).
 */
'use strict';
const AUG_MARK=new Int32Array(23*23),AUG_STACK=new Int32Array(23*23);let AUG_STAMP=0;
class AugBoard extends Board{
  constructor(n){super(n);this.inv=[0,0,0];this.bar=[0,0,0];this.kw=0;}
  copyFrom(b){super.copyFrom(b);this.inv[1]=b.inv[1];this.inv[2]=b.inv[2];this.bar[1]=b.bar[1];this.bar[2]=b.bar[2];this.kw=b.kw;}
  // p 의 무리가 무적인가 (무적수를 건 돌이 같은 무리에 있으면)
  isInv(p){
    const c=this.c,col=c[p],m=this.inv[col];if(!m||c[m]!==col)return false;if(m===p)return true;
    if(++AUG_STAMP>2e9){AUG_MARK.fill(0);AUG_STAMP=1;}
    const s=AUG_STAMP,d=this.d;let sp=0;AUG_STACK[sp++]=p;AUG_MARK[p]=s;
    while(sp>0){const q=AUG_STACK[--sp];for(let i=0;i<4;i++){const r=q+d[i];if(c[r]===col&&AUG_MARK[r]!==s){if(r===m)return true;AUG_MARK[r]=s;AUG_STACK[sp++]=r;}}}
    return false;
  }
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
  // 슈퍼선수: 같은 색이 한 수 더 (첫 수 뒤에 부름)
  again(){this.turn=3-this.turn;this.ko=0;}
}
