/* 증강 바둑 규칙: 대국 시작 때 고른 증강(능력) 하나씩을 가지고 두는 바둑. go/board.js 의 Board 위에서 동작한다.
 *
 * 증강 (한 사람에 하나, '한 번' 표시는 대국 중 한 번만)
 *   패왕     늘 켜짐. 패에서 상대 돌을 바로 되따낼 수 있다 (두 사람 모두 패왕이면 서로 지워져 보통 패 규칙)
 *   되감기   한 번. 내 직전 수와 상대의 응수를 함께 되돌리고 다시 둔다 (바로 앞 상대 차례가 되감기였으면 못 씀)
 *   저격     한 번. 판 위 상대 돌 한 점을 들어내고, 그 차례에 수도 둔다 (무적인 돌은 안 됨). 2026-10-13 전에는 수 대신이었다
 *   슈퍼선수 한 번. 내 차례에 두 수를 연달아 둔다 (패스는 안 됨)
 *   무적수   한 번. 내 돌 하나를 무적으로: 그 돌과 이어진 돌(나중에 이은 돌 포함)은 활로가 없어도 잡히지 않는다. 쓴 차례에 수도 둔다
 *   결계     한 번. 빈 점 하나를 상대가 끝까지 둘 수 없는 점으로. 그 점에 붙은 내 돌은 그 점이 활로로 남아 잡히지 않는다. 쓴 차례에 수도 둔다
 *
 * 증강 정하기 (경매, 2026-10): 증강 둘을 공개하고 두 사람이 번갈아 덤을 부른다. 마지막에 높게 부른 사람이 먼저 고르고
 *   부른 만큼 상대에게 덤으로 준다 → 덤 = 7.5 + (흑이 낙찰이면 +값, 백이면 -값). 공정한 값은 두 사람이 정하므로 덤표가 필요 없다.
 *   아래 점수(v)는 화면의 참고 한마디('아주 강해요!' 등)에만 쓴다 (augTier)
 *
 * 한 차례 = 글자 하나 (온라인 문서에도 그대로 저장. 차례가 늘 번갈아 가도록 증강도 한 차례 안에 넣는다)
 *   "123"        123 자리에 착수 (자리 번호는 Board.pt), "0" 패스
 *   "i45;123"    45 의 내 돌에 무적수를 걸고 123 에 착수
 *   "b45;123"    빈 점 45 에 결계를 치고 123 에 착수
 *   "r;123"      되감기 (내 직전 수와 상대 응수를 되돌림) 후 123 에 착수
 *   "d12,34"     슈퍼선수: 12 와 34 에 연달아 착수
 *   "s45;123"    저격: 45 의 상대 돌을 들어내고 123 에 착수
 *   "s45"        (예전 저격, 2026-10-13 전 기보) 45 의 상대 돌을 들어냄 (착수 없음)
 */
'use strict';
// 증강 점수 (2026-10 추정값, 집): 수 하나의 값(포석에서 약 14집)을 기준으로 어림했다. 참고 한마디에만 쓴다.
//  - 패왕: 패가 나면 늘 이긴다. 상대는 패를 피하면 되므로 효과가 제한적
//  - 되감기: 큰 실수 하나를 무를 수 있고, 상대 응수를 본 뒤 다른 수를 고를 수 있다
//  - 저격: 상대 돌 하나를 없애고 내 수도 둔다. 상대가 그 자리에 다시 둬도 내가 한 수를 번 셈이라 슈퍼선수와 비슷하다
//    (예전처럼 수 대신 들어내면 상대가 다시 두는 것으로 그만이라 쓸모가 없었다: AI끼리 4만 판에서 0집 안팎)
//  - 슈퍼선수: 공짜 수 하나(약 14집)를 싸움의 가장 좋은 때에 쓴다. 상대는 늘 두 수 연속을 대비해야 한다
//  - 무적수: 한 무리가 영원히 죽지 않아 침입·싸움에서 크게 유리하다
//  - 결계: 무적수가 하는 일을 다 할 수 있고(붙은 내 돌은 잡히지 않음) 확실한 눈·상대 급소 막기까지 되므로 무적수보다 위
const AUGS={
  kowang:{name:'패왕',passive:true,short:'패를 바로 되따냄',desc:'늘 켜져 있습니다. 패에서 상대 돌을 바로 되따낼 수 있어 패를 늘 이깁니다. 두 사람 모두 패왕이면 서로 지워져 보통 패 규칙입니다.',v:{9:4,13:5,19:6}},
  rewind:{name:'되감기',short:'한 번 무르기',desc:'한 번, 내 직전 수와 상대의 응수를 함께 되돌리고 다시 둡니다. 바로 앞 상대 차례가 되감기였으면 쓸 수 없습니다.',v:{9:6,13:7,19:8}},
  snipe:{name:'저격',short:'상대 돌 하나 빼고 착수',desc:'한 번, 판 위의 상대 돌 한 점을 들어내고, 그 차례에 수도 둡니다 (들어낸 자리에 둬도 됩니다). 무적인 돌은 들어낼 수 없습니다.',v:{9:15,13:18,19:22},v0:{9:10,13:12,19:15}},
  double:{name:'슈퍼선수',short:'두 수 연달아',desc:'한 번, 내 차례에 두 수를 연달아 둡니다 (패스는 안 됨).',v:{9:13,13:16,19:20}},
  invincible:{name:'무적수',short:'잡히지 않는 돌',desc:'한 번, 내 돌 하나를 무적으로 만듭니다. 그 돌과 이어진 돌(나중에 이어 붙인 돌 포함)은 활로가 없어도 잡히지 않고, 계가 때도 늘 산 돌입니다. 쓴 차례에 수도 둡니다.',v:{9:18,13:25,19:35}},
  barrier:{name:'결계',short:'상대가 못 두는 점',desc:'한 번, 빈 점 하나를 상대가 끝까지 둘 수 없는 점으로 만듭니다. 그 점에 붙은 내 돌은 그 점이 활로로 남아 잡히지 않고, 확실한 눈이 됩니다. 쓴 차례에 수도 둡니다.',v:{9:20,13:28,19:40}},
};
const AUG_IDS=Object.keys(AUGS);
const AUG_BASE_KOMI=7.5;
const augValue=(id,n)=>id&&AUGS[id]?AUGS[id].v[n]??AUGS[id].v[19]:0;
// 경매 전(덤표 시절) 기보의 덤을 되살릴 때만: 그때의 점수 (저격 규칙을 바꾸기 전 값)
const augValue0=(id,n)=>id&&AUGS[id]?(AUGS[id].v0||AUGS[id].v)[n]??(AUGS[id].v0||AUGS[id].v)[19]:0;
// 참고 한마디 (정확한 숫자 대신): 같은 판 크기에서 가장 센 증강에 견준 비율로
function augTier(id,n){
  const top=Math.max(...AUG_IDS.map(a=>augValue(a,n))),r=augValue(id,n)/top;
  return r>=0.8?'아주 강해요!':r>=0.55?'좋은 능력이에요':r>=0.4?'무난해요':'조금 약해요';
}
// 경매 상한 (판 크기별 최고로 부를 수 있는 덤)
const AUG_BID_MAX={9:30,13:50,19:80};
// 낙찰 결과로 덤: 흑이 낙찰받으면 백에게 값만큼 더 주고, 백이 낙찰받으면 흑에게 준다
const augKomi=(win,bid)=>AUG_BASE_KOMI+(win===1?bid:win===2?-bid:0);

// 한 차례 글자 ↔ 객체 {pre: {k:'i'|'b'|'s'|'r', q}, kind: 'move'|'double'|'snipe'(예전 저격), p, p2, q}
function augParse(s){
  s=String(s);let m;
  if((m=/^s(\d+)$/.exec(s)))return{kind:'snipe',q:+m[1]};
  if((m=/^d(\d+),(\d+)$/.exec(s)))return{kind:'double',p:+m[1],p2:+m[2]};
  if((m=/^(?:([ibs])(\d+);|(r);)?(\d+)$/.exec(s)))return{kind:'move',p:+m[4],pre:m[1]?{k:m[1],q:+m[2]}:m[3]?{k:'r'}:null};
  return null;
}
function augFormat(t){
  if(t.kind==='snipe')return's'+t.q;
  if(t.kind==='double')return'd'+t.p+','+t.p2;
  return(t.pre?(t.pre.k==='r'?'r;':t.pre.k+t.pre.q+';'):'')+t.p;
}

class AugGame{
  // o = {n, komi(이 대국의 덤: 경매로 정한 값), aug: {1: 흑 증강, 2: 백 증강}}
  constructor(o){
    this.n=o.n;this.base=o.komi??AUG_BASE_KOMI;this.aug={1:o.aug&&o.aug[1]||'',2:o.aug&&o.aug[2]||''};
    this.entries=[];this.turns=[];this.reset();
  }
  reset(){this.b=new Board(this.n);this.inv={1:0,2:0};this.bar={1:0,2:0};this.koBan=null;this.last=-1;this.lastCol=0;this.usedNow={1:false,2:false};}
  get komi(){return this.base;}
  get turn(){return this.entries.length%2===0?BLACK:WHITE;}
  // 이 증강을 이미 썼는가 (판에 적용한 차례까지 기준. 되감기로 되돌린 차례의 증강은 다시 쓸 수 있다)
  used(col){return this.usedNow[col];}
  canUse(col){const a=this.aug[col];return !!a&&!AUGS[a].passive&&!this.used(col);}
  kowang(col){return this.aug[col]==='kowang'&&this.aug[3-col]!=='kowang';}
  chain(p){
    const b=this.b,col=b.c[p],out=[p],seen=new Set([p]);
    for(let i=0;i<out.length;i++)for(const dd of b.d){const r=out[i]+dd;if(b.c[r]===col&&!seen.has(r)){seen.add(r);out.push(r);}}
    return out;
  }
  // p 의 돌이 무적인가 (무적수를 건 돌과 이어져 있으면)
  invincible(p){
    const b=this.b,col=b.c[p];if(col!==BLACK&&col!==WHITE)return false;
    const m=this.inv[col];if(!m||b.c[m]!==col)return false;
    return m===p||this.chain(p).includes(m);
  }
  // col 이 p 에 둘 수 있는가 (빈 점, 상대 결계 아님, 패, 자충)
  canPlay(p,col){
    const b=this.b;if(p===PASS)return true;
    if(b.c[p]!==EMPTY||this.bar[3-col]===p)return false;
    if(this.koBan&&this.koBan.p===p&&this.koBan.col===col&&!this.kowang(col))return false;
    b.c[p]=col;let ok=false;
    for(const dd of b.d){const r=p+dd;if(b.c[r]===3-col&&b.libs(r,1)===0&&!this.invincible(r)){ok=true;break;}}
    if(!ok)ok=b.libs(p,1)>0||this.invincible(p);
    b.c[p]=EMPTY;return ok;
  }
  // 둘 수 없는 이유 (안내용)
  whyNot(p,col){
    const b=this.b;if(b.c[p]!==EMPTY)return'이미 돌이 있습니다';
    if(this.bar[3-col]===p)return'상대의 결계: 이 점에는 둘 수 없습니다';
    if(this.koBan&&this.koBan.p===p&&this.koBan.col===col&&!this.kowang(col))return'패: 바로 되따낼 수 없습니다. 다른 곳에 한 수 두세요';
    return'착수 금지: 스스로 활로가 없어지는 자리입니다';
  }
  put(p,col){
    const b=this.b;this.last=p;this.lastCol=col;
    if(p===PASS){this.koBan=null;return 0;}
    b.c[p]=col;b.delE(p);
    let cap=0,capPos=0;
    for(const dd of b.d){const r=p+dd;if(b.c[r]===3-col&&b.libs(r,1)===0&&!this.invincible(r)){cap+=b.remove(r);capPos=r;}}
    b.caps[col]+=cap;this.koBan=null;
    if(cap===1){let single=true;for(const dd of b.d)if(b.c[p+dd]===col)single=false;if(single&&b.libs(p,2)===1)this.koBan={p:capPos,col:3-col};}
    return cap;
  }
  // 한 차례(객체)를 판에 적용. 규칙에 맞지 않으면 Error. 반환: 따낸 돌 수
  step(t,col){
    const b=this.b,a=this.aug[col],fail=m=>{throw new Error(m);};
    const need=id=>{if(a!==id)fail(AUGS[id].name+' 증강이 없습니다');if(this.used(col))fail('증강은 한 번만 쓸 수 있습니다');this.usedNow[col]=true;};
    if(t.pre&&t.pre.k==='r')this.usedNow[col]=true; // 되감기는 apply 에서 확인하고 되돌린 뒤 여기 온다
    if(t.kind==='snipe'){ // 예전 저격 (수 대신)
      need('snipe');const q=t.q;
      if(b.c[q]!==3-col)fail('상대 돌을 골라야 합니다');if(this.invincible(q))fail('무적인 돌은 들어낼 수 없습니다');
      b.c[q]=EMPTY;b.addE(q);b.caps[col]++;this.koBan=null;this.last=-1;this.lastCol=col;
      return 1;
    }
    if(t.kind==='double'){
      need('double');if(!t.p||!t.p2)fail('패스는 두 수로 쓸 수 없습니다');
      if(!this.canPlay(t.p,col))fail(this.whyNot(t.p,col));
      let cap=this.put(t.p,col);
      if(!this.canPlay(t.p2,col))fail(this.whyNot(t.p2,col));
      return cap+this.put(t.p2,col);
    }
    if(t.pre&&t.pre.k==='i'){need('invincible');if(b.c[t.pre.q]!==col)fail('무적수는 내 돌에 겁니다');this.inv[col]=t.pre.q;}
    if(t.pre&&t.pre.k==='b'){need('barrier');if(b.c[t.pre.q]!==EMPTY)fail('결계는 빈 점에 칩니다');this.bar[col]=t.pre.q;}
    if(t.pre&&t.pre.k==='s'){
      need('snipe');const q=t.pre.q;
      if(b.c[q]!==3-col)fail('상대 돌을 골라야 합니다');if(this.invincible(q))fail('무적인 돌은 들어낼 수 없습니다');
      b.c[q]=EMPTY;b.addE(q);b.caps[col]++;this.koBan=null;
    }
    if(!this.canPlay(t.p,col))fail(this.whyNot(t.p,col));
    return this.put(t.p,col);
  }
  // 되감기를 쓸 수 있는가: 마지막 두 차례가 [내 차례, 상대 차례] 이고 상대 차례가 되감기가 아님
  canRewind(col){
    const n=this.turns.length;if(n<2)return false;
    const a=this.turns[n-1],c=this.turns[n-2];
    return a.col===3-col&&c.col===col&&!(a.t.pre&&a.t.pre.k==='r');
  }
  // 지금 차례들(turns)로 판을 처음부터 다시 만든다
  replayTurns(){this.reset();for(const x of this.turns)this.step(x.t,x.col);}
  // 한 차례(글자)를 둔다. 반환: 따낸 돌 수
  apply(s){
    const col=this.turn,t=augParse(s);if(!t)throw new Error('알 수 없는 수: '+s);
    const snap=this.turns.slice();
    try{
      if(t.pre&&t.pre.k==='r'){
        if(this.aug[col]!=='rewind')throw new Error('되감기 증강이 없습니다');
        if(this.used(col))throw new Error('증강은 한 번만 쓸 수 있습니다');
        if(!this.canRewind(col))throw new Error('지금은 되감을 수 없습니다');
        this.turns=this.turns.slice(0,-2);this.replayTurns();
      }
      const cap=this.step(t,col);
      this.turns.push({col,t,s});
      this.entries.push(s);
      return cap;
    }catch(e){this.turns=snap;this.replayTurns();throw e;}
  }
  // 글자 목록으로 처음부터 (규칙에 맞지 않는 차례에서 멈추고 그 이유를 돌려준다)
  load(entries){
    this.entries=[];this.turns=[];this.reset();
    for(const s of entries){try{this.apply(s);}catch(e){return e.message;}}
    return null;
  }
  // 이어서 두 번 패스했는가 (온라인 규칙과 같게 '0' 두 개. rs: 계가를 멈추고 이어 둔 시점)
  twoPasses(rs=0){const e=this.entries,k=e.length-1;return k>=1&&k-1>=rs&&e[k]==='0'&&e[k-1]==='0';}
  // 계가 (중국식: 산 돌 + 집). dead: 죽은 돌로 표시한 자리 (무적인 돌은 빠진다)
  score(dead){
    const b=this.b,own=new Float32Array(b.size),seen=new Uint8Array(b.size);let bs=0,ws=0;
    const col=p=>dead.has(p)&&!this.invincible(p)?EMPTY:b.c[p];
    for(const p of b.pts){
      const v=col(p);
      if(v===BLACK){bs++;own[p]=1;continue;}
      if(v===WHITE){ws++;own[p]=-1;continue;}
      if(seen[p])continue;
      const reg=[],st=[p];seen[p]=1;let tb=false,tw=false;
      while(st.length){const q=st.pop();reg.push(q);for(const dd of b.d){const r=q+dd;if(b.c[r]===EDGE)continue;const cv=col(r);if(cv===EMPTY){if(!seen[r]){seen[r]=1;st.push(r);}}else if(cv===BLACK)tb=true;else tw=true;}}
      const o=tb&&!tw?1:tw&&!tb?-1:0;for(const q of reg)own[q]=o;if(o>0)bs+=reg.length;else if(o<0)ws+=reg.length;
    }
    const diff=bs-ws-this.komi;
    return{bs,ws,w:diff>0?BLACK:WHITE,d:Math.abs(diff),own};
  }
  // 기보에 남길 실제 수순 (되감은 차례는 빠짐): [{col, p}] 와 증강 설명
  record(){
    const out=[];
    for(const x of this.turns){
      const t=x.t,A=AUGS[this.aug[x.col]];
      if(t.kind==='snipe')out.push({col:x.col,snipe:t.q,note:'저격'});
      else if(t.kind==='double'){out.push({col:x.col,p:t.p,note:'슈퍼선수 (두 수 연달아)'});out.push({col:x.col,p:t.p2});}
      else out.push({col:x.col,p:t.p,note:t.pre?(t.pre.k==='i'?'무적수':t.pre.k==='b'?'결계':t.pre.k==='s'?'저격':'되감기'):'',q:t.pre&&t.pre.q,rm:t.pre&&t.pre.k==='s'?t.pre.q:0});
      void A;
    }
    return out;
  }
}
// 증강 후보: 방 코드 등으로 정해지는 무작위 순서 (같은 씨앗이면 늘 같음 → 다시 뽑기 없음). 경매는 앞의 둘
function augOffers(seed,k=3){
  let h=2166136261>>>0;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  const rnd=()=>{h^=h<<13;h>>>=0;h^=h>>>17;h^=h<<5;h>>>=0;return h/4294967296;};
  const a=AUG_IDS.slice();for(let i=a.length-1;i>0;i--){const j=rnd()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];}
  return a.slice(0,k);
}
// 씨앗으로 정하는 1 또는 2 (경매를 먼저 부를 색)
function augCoin(seed){let h=7;for(const ch of String(seed))h=(h*31+ch.charCodeAt(0))>>>0;return h%2?1:2;}
if(typeof module!=='undefined')module.exports={AUGS,AUG_IDS,AUG_BASE_KOMI,AUG_BID_MAX,augValue,augValue0,augTier,augKomi,augParse,augFormat,AugGame,augOffers,augCoin};
