/* 증강 바둑 규칙: 대국 시작 때 고른 증강(능력) 하나씩을 가지고 두는 바둑. go/board.js 의 Board 위에서 동작한다.
 *
 * 증강 (한 사람에 하나, '한 번' 표시는 대국 중 한 번만)
 *   패왕     늘 켜짐. 패에서 상대 돌을 바로 되따낼 수 있다 (두 사람 모두 패왕이면 서로 지워져 보통 패 규칙)
 *   되감기   한 번. 내 직전 수와 상대의 응수를 함께 되돌리고 다시 둔다 (바로 앞 상대 차례가 되감기였으면 못 씀)
 *   저격     한 번. 판 위 상대 돌 한 점을 들어내고, 그 차례에 수도 둔다 (무적인 돌은 안 됨). 2026-10-13 전에는 수 대신이었다
 *   슈퍼선수 한 번. 내 차례에 두 수를 연달아 둔다 (패스는 안 됨)
 *   무적수   한 번. 내 돌 하나를 무적으로: 그 돌과 이어진 돌(나중에 이은 돌 포함)은 활로가 없어도 잡히지 않는다. 쓴 차례에 수도 둔다
 *   결계     한 번. 빈 점 하나를 상대가 끝까지 둘 수 없는 점으로. 그 점에 붙은 내 돌은 그 점이 활로로 남아 잡히지 않는다. 쓴 차례에 수도 둔다
 *   벽       늘. 내 쪽 변(흑 아래 · 백 위)의 1선에 내 돌이 다 놓인 채로 시작한다 (2026-10-13 추가: 벽·맞바꾸기·포로교환)
 *   맞바꾸기 한 번. 수 대신 내 돌 하나와 상대 돌 하나의 자리를 바꾼다. 활로가 없어진 상대 무리는 잡히고, 내 무리가 활로 없이 남는 맞바꾸기는 못 한다
 *   포로교환 늘. 대국 중 따내거나 들어낸 상대 돌 수 + 계가 때 죽은 돌로 표시한 상대 돌 수만큼 내 집에 더한다
 *   거울수   한 번. 이번 수의 판 중심 대칭점(180도)에도 내 돌이 놓인다 (비어 있고 둘 수 있으면)  — 2026-10-13 추가: 거울수·증식·패스 저축·순간이동·공수부대
 *   증식     한 번. 수 대신 내 돌 하나 둘레의 빈 점을 모두 내 돌로 (상대 결계 점 빼고. 내 무리가 활로 없이 남으면 못 씀)
 *   패스저축 내가 패스할 때마다 1 저축. 한 번, 저축을 쓰면 그 차례에 (1 + 저축)수를 연달아 둔다
 *   순간이동 한 번. 수 대신 내 돌 하나를 빈 점으로 옮긴다 (옮긴 돌에 활로가 없으면 못 옮김. 무적수를 건 돌이면 무적도 따라감)
 *   공수부대 한 번. 이번 수는 자살수 자리에도 둘 수 있고, 그 돌의 무리는 상대의 다음 차례 동안 잡히지 않는다.
 *            내 다음 차례가 끝났을 때도 활로가 없으면 그때 잡힌다
 *   양자택일 한 번. 수 대신 빈 점 두 곳을 예약. 상대 차례가 끝나면 아직 비어 있고 둘 수 있는 예약점마다 내 돌이 놓인다
 *   예약수   한 번. 빈 점 한 곳을 예약하고 그 차례 수도 둔다 (지금 둘 수 없는 자리도 예약 가능). 상대 차례가 끝나면 비어 있고 둘 수 있으면 내 돌
 *   (2026-10-13 밤 추가. 따로 말이 없으면 능력을 쓰고 그 차례 수도 둔다)
 *   네크로맨서 내 수 대신, 내가 따낸 돌 하나를 써서 상대 돌을 놓는다 (상대가 둔 것과 똑같이). 따낸 돌이 남아 있으면 계속
 *   추크추방 한 번. 이번 수를 두면 상대는 다음 차례에 둘 수 있는 1-1점 중 하나에만 둔다 (없으면 효과 없음)
 *   중립지대 한 번. 빈 점 하나를 누구도 못 두는 점으로 (판 가장자리처럼: 활로도 집도 아님). 그 차례 수도 둔다
 *   큰돌     한 번. 2×2 칸의 빈 점을 모두 내 돌로 채우고 그 차례 수도 둔다
 *   명당     늘. 계가 때 내 돌이나 내 집인 화점 한 곳마다 +2 (1점이 3점)
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
 *   "x12,34"      맞바꾸기: 12 의 내 돌과 34 의 상대 돌 자리를 바꿈
 *   "m12"        거울수: 12 에 두고 대칭점에도
 *   "g12"        증식: 12 의 내 돌 둘레 빈 점을 모두 내 돌로
 *   "e12,34,56"  패스 저축 쓰기: (1 + 저축)수를 차례로
 *   "t12,34"      순간이동: 12 의 내 돌을 34 로
 *   "p12"        공수부대: 12 에 (자살수 자리도 됨)
 *   "f12,34"      양자택일: 12 와 34 를 예약
 *   "h12;123"    예약수: 12 를 예약하고 123 에 착수
 *   "n12"        네크로맨서: 12 에 상대 돌
 *   "z;123"      추크추방 + 착수 · "u12;123" 중립지대 · "o12;123" 큰돌 (12 = 2×2 의 왼쪽 위)
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
  wall:{name:'벽',passive:true,short:'1선을 내 돌로 시작',desc:'늘 켜져 있습니다. 내 쪽 변(흑은 아래, 백은 위)의 1선에 내 돌이 다 놓인 채로 대국을 시작합니다.',v:{9:35,13:38,19:40}},
  swap:{name:'맞바꾸기',short:'내 돌과 상대 돌 자리 바꾸기',desc:'한 번, 내 차례에 수를 두는 대신 내 돌 하나와 상대 돌 하나의 자리를 바꿉니다. 활로가 없어진 상대 무리는 잡히고, 내 무리가 활로 없이 남게 되면 바꿀 수 없습니다. 무적인 돌은 바꿀 수 없습니다.',v:{9:8,13:9,19:10}},
  mirror:{name:'거울수',short:'대칭점에도 한 점',desc:'한 번, 이번 수를 두면 판 가운데를 중심으로 180도 돌린 자리에도 내 돌이 놓입니다 (그 자리가 비어 있고 둘 수 있을 때. 가운데 점에 두면 한 점만).',v:{9:12,13:13,19:14}},
  grow:{name:'증식',short:'둘레 빈 점을 모두 내 돌로',desc:'한 번, 내 차례에 수를 두는 대신 내 돌 하나를 고르면 그 둘레(위아래 양옆)의 빈 점이 모두 내 돌이 됩니다. 상대 결계 점은 빠지고, 내 무리가 활로 없이 남게 되면 쓸 수 없습니다.',v:{9:22,13:22,19:22}},
  save:{name:'패스 저축',short:'패스를 모아 연속 착수',desc:'내가 패스할 때마다 1씩 저축합니다. 한 번, 저축을 쓰면 그 차례에 (1 + 저축)수를 연달아 둡니다 (패스는 안 됨). 두 사람이 이어서 패스하면 대국이 끝나는 규칙은 그대로입니다.',v:{9:6,13:7,19:8}},
  teleport:{name:'순간이동',short:'내 돌 하나 옮기기',desc:'한 번, 내 차례에 수를 두는 대신 내 돌 하나를 빈 점으로 옮깁니다. 옮긴 돌에 활로가 없으면 옮길 수 없고, 옮긴 돌로 상대 돌을 따낼 수는 있습니다.',v:{9:5,13:6,19:7}},
  para:{name:'공수부대',short:'자살수 자리에도 착수 · 한 턴 무적',desc:'한 번, 이번 수는 자살수 자리(활로가 없는 곳)에도 둘 수 있고, 그 돌의 무리는 상대의 다음 차례 동안 잡히지 않습니다. 내 다음 차례가 끝났을 때도 활로가 없으면 그때 잡힙니다.',v:{9:8,13:9,19:10}},
  fork:{name:'양자택일',short:'빈 점 두 곳 예약',desc:'한 번, 내 차례에 수를 두는 대신 빈 점 두 곳을 예약합니다. 상대 차례가 끝나면, 아직 비어 있고 둘 수 있는 예약점마다 내 돌이 놓입니다. 상대는 한 수로 한 곳만 막을 수 있습니다.',v:{9:8,13:9,19:10}},
  shadow:{name:'예약수',short:'빈 점 한 곳 예약 + 착수',desc:'한 번, 빈 점 한 곳을 예약하고 그 차례 수도 둡니다 (지금 둘 수 없는 자리도 예약할 수 있습니다). 상대 차례가 끝나면, 그 점이 비어 있고 둘 수 있으면 내 돌이 놓입니다.',v:{9:10,13:11,19:12}},
  necro:{name:'네크로맨서',short:'따낸 돌로 상대 돌 놓기',desc:'내 차례에 내 수를 두는 대신, 내가 따낸 상대 돌 하나를 써서 상대 돌을 놓습니다 (상대가 그 자리에 둔 것과 똑같이 처리: 상대 눈 메우기 등). 따낸 돌이 남아 있으면 몇 번이든 쓸 수 있습니다.',v:{9:3,13:4,19:5}},
  zugzwang:{name:'추크추방',short:'상대 다음 수를 1-1로',desc:'한 번, 이번 수를 두면 상대는 다음 차례에 둘 수 있는 1-1점(네 귀의 맨 끝) 중 하나에만 둘 수 있습니다. 둘 수 있는 1-1점이 없으면 효과가 없습니다.',v:{9:10,13:11,19:12}},
  neutral:{name:'중립지대',short:'누구도 못 두는 점',desc:'한 번, 빈 점 하나를 누구도 둘 수 없는 점으로 만듭니다 (판 가장자리처럼: 활로도 집도 아님). 그 때문에 활로가 없어진 상대 무리는 잡히고, 내 무리가 활로 없이 남게 되는 점은 고를 수 없습니다. 쓴 차례에 수도 둡니다.',v:{9:6,13:6,19:7}},
  bigstone:{name:'큰돌',short:'2×2를 내 돌로',desc:'한 번, 2×2 칸의 빈 점을 모두 내 돌로 채우고 그 차례 수도 둡니다 (상대 결계 점은 빠짐). 내 무리가 활로 없이 남게 되면 쓸 수 없습니다.',v:{9:30,13:30,19:30}},
  myeongdang:{name:'명당',passive:true,short:'화점이 3배',desc:'늘 켜져 있습니다. 계가 때 내 돌이나 내 집인 화점(천원 포함) 한 곳마다 2집을 더합니다 (1점이 3점).',v:{9:5,13:8,19:8}},
  prisoner:{name:'포로교환',passive:true,short:'따낸 돌만큼 집',desc:'늘 켜져 있습니다. 대국 중 따내거나 들어낸 상대 돌 수와, 계가 때 죽은 돌로 표시한 상대 돌 수만큼 내 집에 더합니다 (중국식 계가에 일본식 사석 계산을 더하는 셈).',v:{9:5,13:7,19:10}},
};
const AUG_IDS=Object.keys(AUGS);
const AUG_BASE_KOMI=7.5;
const augValue=(id,n)=>id&&AUGS[id]?AUGS[id].v[n]??AUGS[id].v[19]:0;
// 경매 전(덤표 시절) 기보의 덤을 되살릴 때만: 그때의 점수 (저격 규칙을 바꾸기 전 값)
const augValue0=(id,n)=>id&&AUGS[id]?(AUGS[id].v0||AUGS[id].v)[n]??(AUGS[id].v0||AUGS[id].v)[19]:0;
// 화점 (명당): 판 크기별 [x, y]
const AUG_STARS={9:[[2,2],[6,6],[6,2],[2,6],[4,4]],13:[[3,3],[9,9],[9,3],[3,9],[6,6],[3,6],[9,6],[6,3],[6,9]],19:[[3,3],[15,15],[15,3],[3,15],[9,9],[3,9],[15,9],[9,3],[9,15]]};
// 벽: 흑은 아래 변, 백은 위 변의 1선 (Board 자리 번호)
function augWallPts(n,col){const y=col===1?n-1:0,out=[];for(let x=0;x<n;x++)out.push((y+1)*(n+2)+x+1);return out;}
// 참고 한마디 (정확한 숫자 대신): 같은 판 크기에서 가장 센 증강에 견준 비율로
// 기준은 슈퍼선수 (벽처럼 훨씬 센 증강이 있어도 나머지가 다 약해 보이지 않게)
function augTier(id,n){
  const r=augValue(id,n)/augValue('double',n);
  return r>=1.8?'압도적이에요!!':r>=1?'아주 강해요!':r>=0.7?'좋은 능력이에요':r>=0.45?'무난해요':'조금 약해요';
}
// 경매 상한: 판의 칸 수 (그보다 많이 부르면 부른 쪽이 반드시 지므로 사실상 상한 없음. 2026-10-13 사용자 결정)
const AUG_BID_MAX={9:81,13:169,19:361};
// 낙찰 결과로 덤: 흑이 낙찰받으면 백에게 값만큼 더 주고, 백이 낙찰받으면 흑에게 준다
const augKomi=(win,bid)=>AUG_BASE_KOMI+(win===1?bid:win===2?-bid:0);

// 한 차례 글자 ↔ 객체 {pre: {k:'i'|'b'|'s'|'r', q}, kind: 'move'|'double'|'snipe'(예전 저격), p, p2, q}
function augParse(s){
  s=String(s);let m;
  if((m=/^s(\d+)$/.exec(s)))return{kind:'snipe',q:+m[1]};
  if((m=/^d(\d+),(\d+)$/.exec(s)))return{kind:'double',p:+m[1],p2:+m[2]};
  if((m=/^x(\d+),(\d+)$/.exec(s)))return{kind:'swap',a:+m[1],b:+m[2]};
  if((m=/^m(\d+)$/.exec(s)))return{kind:'mirror',p:+m[1]};
  if((m=/^g(\d+)$/.exec(s)))return{kind:'grow',p:+m[1]};
  if((m=/^e(\d+(?:,\d+)*)$/.exec(s)))return{kind:'spend',ps:m[1].split(',').map(Number)};
  if((m=/^t(\d+),(\d+)$/.exec(s)))return{kind:'teleport',a:+m[1],b:+m[2]};
  if((m=/^p(\d+)$/.exec(s)))return{kind:'para',p:+m[1]};
  if((m=/^f(\d+),(\d+)$/.exec(s)))return{kind:'fork',a:+m[1],b:+m[2]};
  if((m=/^n(\d+)$/.exec(s)))return{kind:'necro',p:+m[1]};
  if((m=/^(?:([ibsuoh])(\d+);|([rz]);)?(\d+)$/.exec(s)))return{kind:'move',p:+m[4],pre:m[1]?{k:m[1],q:+m[2]}:m[3]?{k:m[3]}:null};
  return null;
}
function augFormat(t){
  if(t.kind==='snipe')return's'+t.q;
  if(t.kind==='double')return'd'+t.p+','+t.p2;
  if(t.kind==='swap')return'x'+t.a+','+t.b;
  if(t.kind==='mirror')return'm'+t.p;
  if(t.kind==='grow')return'g'+t.p;
  if(t.kind==='spend')return'e'+t.ps.join(',');
  if(t.kind==='teleport')return't'+t.a+','+t.b;
  if(t.kind==='para')return'p'+t.p;
  if(t.kind==='fork')return'f'+t.a+','+t.b;
  if(t.kind==='necro')return'n'+t.p;
  return(t.pre?(t.pre.k==='r'||t.pre.k==='z'?t.pre.k+';':t.pre.k+t.pre.q+';'):'')+t.p;
}

class AugGame{
  // o = {n, komi(이 대국의 덤: 경매로 정한 값), aug: {1: 흑 증강, 2: 백 증강}}
  constructor(o){
    this.n=o.n;this.base=o.komi??AUG_BASE_KOMI;this.aug={1:o.aug&&o.aug[1]||'',2:o.aug&&o.aug[2]||''};
    this.entries=[];this.turns=[];this.reset();
  }
  reset(){
    this.b=new Board(this.n);this.inv={1:0,2:0};this.bar={1:0,2:0};this.koBan=null;this.last=-1;this.lastCol=0;this.usedNow={1:false,2:false};
    this.ply=0;this.saves={1:0,2:0};this.para=null;this.resv=null;this.necroUsed={1:0,2:0};this.forced=null;this.neutral=[]; // necroUsed: 네크로맨서로 쓴 따낸 돌 · forced: 추크추방 {col, at} // resv: 양자택일 · 예약수 {col, pts, at: 이 차례 수가 되면 놓음} // ply: 판에 적용한 차례 수 · saves: 패스 저축 · para: 공수부대 {col, p, prot(이 차례까지 보호), check(이 차례 끝에 확인)}
    for(const col of [1,2])if(this.aug[col]==='wall')for(const p of augWallPts(this.n,col))this.b.place(p,col);
  }
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
    if(this.para&&this.para.col===col&&this.ply<=this.para.prot&&b.c[this.para.p]===col&&(p===this.para.p||this.chain(p).includes(this.para.p)))return true;
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
  // 맞바꾸기 뒤 정리: pts 둘레에서 활로가 없는 상대 무리를 따내고, 내 무리가 활로 없이 남으면 -1 (그 차례는 무효)
  settle(col,pts){
    const b=this.b,opp=3-col,near=new Set();
    for(const p of pts){near.add(p);for(const dd of b.d)near.add(p+dd);}
    let cap=0;
    for(const r of near)if(b.c[r]===opp&&b.libs(r,1)===0&&!this.invincible(r))cap+=b.remove(r);
    b.caps[col]+=cap;
    for(const r of near)if(b.c[r]===col&&b.libs(r,1)===0&&!this.invincible(r))return -1;
    this.koBan=null;return cap;
  }
  // 둘 곳이 하나도 없는가 (연속 착수 증강이 판이 꽉 차 멈출 때)
  noMove(col){return !this.b.pts.some(p=>this.canPlay(p,col));}
  // 판 중심 대칭점 (거울수)
  mirrorPt(p){const [x,y]=this.b.xy(p);return this.b.pt(this.n-1-x,this.n-1-y);}
  // 한 차례(객체)를 판에 적용. 규칙에 맞지 않으면 Error. 반환: 따낸 돌 수
  step(t,col){
    const cap=this.stepCore(t,col),k=this.ply++;
    if(this.forced&&k===this.forced.at)this.forced=null; // 추크추방에 묶였던 차례가 지남
    if(t.pre&&t.pre.k==='z')this.forced={col:3-col,at:k+1};
    // 패스 저축: 아직 쓰지 않은 패스 저축을 가진 사람이 그냥 패스하면 1 저축
    if(t.kind==='move'&&!t.p&&!t.pre&&this.aug[col]==='save'&&!this.used(col))this.saves[col]++;
    // 공수부대: 내 다음 차례가 끝났을 때 활로가 없으면 잡힘
    if(this.para&&k===this.para.check){
      const P=this.para,b=this.b;this.para=null;
      if(b.c[P.p]===P.col&&b.libs(P.p,1)===0&&!this.invincible(P.p))b.caps[3-P.col]+=b.remove(P.p);
    }
    // 양자택일 · 예약수: 상대 차례가 끝나면 예약점에 내 돌 (비어 있고 둘 수 있으면, 하나씩)
    if(this.resv&&this.ply===this.resv.at){const R=this.resv;this.resv=null;let c2=0;for(const p of R.pts)if(this.canPlay(p,R.col))c2+=this.put(p,R.col);this.koBan=null;this.last=-1;void c2;}
    return cap;
  }
  // 네크로맨서로 쓸 수 있는 따낸 돌 수
  necroLeft(col){return this.b.caps[col]-this.necroUsed[col];}
  corners(){const n=this.n,b=this.b;return [b.pt(0,0),b.pt(n-1,0),b.pt(0,n-1),b.pt(n-1,n-1)];}
  // 추크추방에 묶인 차례인가 (둘 수 있는 1-1점이 있을 때만)
  forcedNow(col){const F=this.forced;return !!(F&&F.col===col&&F.at===this.ply&&this.corners().some(p=>this.canPlay(p,col)));}
  stepCore(t,col){
    const b=this.b,a=this.aug[col],fail=m=>{throw new Error(m);};
    if(this.forcedNow(col)&&!(t.kind==='move'&&!t.pre&&this.corners().includes(t.p)))fail('추크추방: 이번 차례는 1-1점(네 귀 끝) 중 하나에 둬야 합니다');
    const need=id=>{if(a!==id)fail(AUGS[id].name+' 증강이 없습니다');if(this.used(col))fail('증강은 한 번만 쓸 수 있습니다');this.usedNow[col]=true;};
    if(t.pre&&t.pre.k==='r')this.usedNow[col]=true; // 되감기는 apply 에서 확인하고 되돌린 뒤 여기 온다
    if(t.kind==='snipe'){ // 예전 저격 (수 대신)
      need('snipe');const q=t.q;
      if(b.c[q]!==3-col)fail('상대 돌을 골라야 합니다');if(this.invincible(q))fail('무적인 돌은 들어낼 수 없습니다');
      b.c[q]=EMPTY;b.addE(q);b.caps[col]++;this.koBan=null;this.last=-1;this.lastCol=col;
      return 1;
    }
    if(t.kind==='swap'){
      need('swap');const p=t.a,q=t.b;
      if(b.c[p]!==col)fail('먼저 내 돌을 골라야 합니다');if(b.c[q]!==3-col)fail('바꿀 상대 돌을 골라야 합니다');
      if(this.invincible(p)||this.invincible(q))fail('무적인 돌은 바꿀 수 없습니다');
      b.c[p]=3-col;b.c[q]=col;
      const cap=this.settle(col,[p,q]);if(cap<0)fail('바꾸면 내 돌이 활로 없이 남습니다');
      this.last=q;this.lastCol=col;return cap;
    }
    if(t.kind==='mirror'){
      need('mirror');if(!t.p){if(!this.noMove(col))fail('거울수는 패스로 쓸 수 없습니다');return 0;}
      if(!this.canPlay(t.p,col))fail(this.whyNot(t.p,col));
      let cap=this.put(t.p,col);const q=this.mirrorPt(t.p);
      if(q!==t.p&&this.canPlay(q,col))cap+=this.put(q,col);
      this.last=t.p;return cap;
    }
    if(t.kind==='grow'){
      need('grow');const p=t.p;if(b.c[p]!==col)fail('내 돌을 골라야 합니다');
      const pts=[];for(const dd of b.d){const r=p+dd;if(b.c[r]===EMPTY&&this.bar[3-col]!==r)pts.push(r);}
      if(!pts.length)fail('둘레에 빈 점이 없습니다');
      for(const r of pts)b.place(r,col);
      const cap=this.settle(col,pts);if(cap<0)fail('늘리면 내 돌이 활로 없이 남습니다');
      this.last=-1;this.lastCol=col;return cap;
    }
    if(t.kind==='spend'){
      need('save');const k=this.saves[col];if(k<1)fail('저축한 패스가 없습니다');
      if(t.ps.length!==k+1)fail(`저축 ${k}: ${k+1}수를 둬야 합니다`);
      let cap=0;for(const p of t.ps){if(!p){if(!this.noMove(col))fail('패스는 쓸 수 없습니다');continue;}if(!this.canPlay(p,col))fail(this.whyNot(p,col));cap+=this.put(p,col);}
      this.saves[col]=0;return cap;
    }
    if(t.kind==='teleport'){
      need('teleport');const a0=t.a,q=t.b;
      if(b.c[a0]!==col)fail('옮길 내 돌을 골라야 합니다');if(b.c[q]!==EMPTY||this.bar[3-col]===q)fail('빈 점으로만 옮길 수 있습니다');
      b.c[a0]=EMPTY;b.addE(a0);b.place(q,col);if(this.inv[col]===a0)this.inv[col]=q;
      const cap=this.settle(col,[q]);if(cap<0)fail('옮긴 돌에 활로가 없습니다');
      this.last=q;this.lastCol=col;return cap;
    }
    if(t.kind==='para'){
      need('para');const q=t.p;if(!q){if(this.b.pts.some(p=>this.b.c[p]===EMPTY&&this.bar[3-col]!==p))fail('공수부대는 패스로 쓸 수 없습니다');return 0;}
      if(b.c[q]!==EMPTY||this.bar[3-col]===q)fail(this.whyNot(q,col));
      this.para={col,p:q,prot:this.ply+1,check:this.ply+2};
      return this.put(q,col);
    }
    if(t.kind==='necro'){
      if(a!=='necro')fail('네크로맨서 증강이 없습니다');if(this.necroLeft(col)<1)fail('쓸 수 있는 따낸 돌이 없습니다');
      const q=t.p,opp=3-col;if(!this.canPlay(q,opp))fail('상대가 둘 수 없는 자리입니다 ('+this.whyNot(q,opp)+')');
      this.necroUsed[col]++;const cap=this.put(q,opp);this.lastCol=opp;return cap;
    }
    if(t.kind==='fork'){
      need('fork');const pts=[t.a,t.b];
      if(t.a===t.b)fail('서로 다른 두 점을 골라야 합니다');
      for(const p of pts)if(b.c[p]!==EMPTY||this.bar[3-col]===p)fail('빈 점만 예약할 수 있습니다');
      this.resv={col,pts,at:this.ply+2};this.koBan=null;this.last=-1;this.lastCol=col;return 0;
    }
    if(t.kind==='double'){
      need('double');let cap=0;
      for(const p of [t.p,t.p2]){if(!p){if(!this.noMove(col))fail('패스는 두 수로 쓸 수 없습니다');continue;}if(!this.canPlay(p,col))fail(this.whyNot(p,col));cap+=this.put(p,col);}
      return cap;
    }
    if(t.pre&&t.pre.k==='i'){need('invincible');if(b.c[t.pre.q]!==col)fail('무적수는 내 돌에 겁니다');this.inv[col]=t.pre.q;}
    if(t.pre&&t.pre.k==='b'){need('barrier');if(b.c[t.pre.q]!==EMPTY)fail('결계는 빈 점에 칩니다');this.bar[col]=t.pre.q;}
    if(t.pre&&t.pre.k==='z')need('zugzwang');
    if(t.pre&&t.pre.k==='u'){
      need('neutral');const q=t.pre.q;if(b.c[q]!==EMPTY)fail('빈 점만 고를 수 있습니다');
      b.c[q]=EDGE;b.delE(q);if(this.bar[1]===q)this.bar[1]=0;if(this.bar[2]===q)this.bar[2]=0;
      if(this.settle(col,[q])<0)fail('내 돌이 활로 없이 남는 점입니다');this.neutral=(this.neutral||[]).concat(q);
    }
    if(t.pre&&t.pre.k==='h'){ // 예약수: 예약하고 이어서 착수
      need('shadow');const q=t.pre.q;if(b.c[q]!==EMPTY||this.bar[3-col]===q)fail('빈 점만 예약할 수 있습니다');
      this.resv={col,pts:[q],at:this.ply+2};
    }
    if(t.pre&&t.pre.k==='o'){
      need('bigstone');const q=t.pre.q,[x,y]=b.xy(q);if(x>this.n-2||y>this.n-2)fail('2×2 칸이 판 안에 있어야 합니다');
      const pts=[q,q+1,q+b.W,q+b.W+1].filter(p=>b.c[p]===EMPTY&&this.bar[3-col]!==p);if(!pts.length)fail('채울 빈 점이 없습니다');
      for(const p of pts)b.place(p,col);if(this.settle(col,pts)<0)fail('내 돌이 활로 없이 남습니다');
    }
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
      const v=col(p);if(v===EDGE)continue; // 중립지대
      if(v===BLACK){bs++;own[p]=1;continue;}
      if(v===WHITE){ws++;own[p]=-1;continue;}
      if(seen[p])continue;
      const reg=[],st=[p];seen[p]=1;let tb=false,tw=false;
      while(st.length){const q=st.pop();reg.push(q);for(const dd of b.d){const r=q+dd;if(b.c[r]===EDGE)continue;const cv=col(r);if(cv===EMPTY){if(!seen[r]){seen[r]=1;st.push(r);}}else if(cv===BLACK)tb=true;else tw=true;}}
      const o=tb&&!tw?1:tw&&!tb?-1:0;for(const q of reg)own[q]=o;if(o>0)bs+=reg.length;else if(o<0)ws+=reg.length;
    }
    // 포로교환: 따내거나 들어낸 상대 돌 + 죽은 돌로 표시한 상대 돌만큼 더함
    let pb=0,pw=0;
    if(this.aug[1]==='prisoner'){pb=b.caps[1];for(const p of dead)if(b.c[p]===WHITE&&!this.invincible(p))pb++;}
    if(this.aug[2]==='prisoner'){pw=b.caps[2];for(const p of dead)if(b.c[p]===BLACK&&!this.invincible(p))pw++;}
    // 명당: 내 돌이나 내 집인 화점 한 곳마다 +2
    let mb=0,mw=0;
    for(const [x,y] of AUG_STARS[this.n]||[]){const p=b.pt(x,y);if(this.aug[1]==='myeongdang'&&own[p]>0)mb+=2;if(this.aug[2]==='myeongdang'&&own[p]<0)mw+=2;}
    pb+=mb;pw+=mw;
    bs+=pb;ws+=pw;
    const diff=bs-ws-this.komi;
    return{bs,ws,pb:pb-mb,pw:pw-mw,mb,mw,w:diff>0?BLACK:WHITE,d:Math.abs(diff),own};
  }
  // 기보에 남길 실제 수순 (되감은 차례는 빠짐): [{col, p}] 와 증강 설명
  record(){
    const out=[];
    for(const x of this.turns){
      if(x.t.kind==='swap'){out.push({col:x.col,swap:[x.t.a,x.t.b],note:'맞바꾸기'});continue;}
      if(x.t.kind==='teleport'){out.push({col:x.col,tele:[x.t.a,x.t.b],note:'순간이동'});continue;}
      if(x.t.kind==='spend'){x.t.ps.forEach((p,i)=>out.push({col:x.col,p,note:i?'':'패스 저축 ('+x.t.ps.length+'수 연달아)'}));continue;}
      if(x.t.kind==='mirror'){out.push({col:x.col,p:x.t.p,note:'거울수',extra:'mirror'});continue;}
      if(x.t.kind==='grow'){out.push({col:x.col,grow:x.t.p,note:'증식'});continue;}
      if(x.t.kind==='para'){out.push({col:x.col,p:x.t.p,note:'공수부대'});continue;}
      if(x.t.kind==='fork'){out.push({col:x.col,p:0,note:'양자택일'});continue;}
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
// pool: 고를 증강 목록 (AI 대국은 AI 가 배운 증강만)
function augOffers(seed,k=3,pool=AUG_IDS){
  let h=2166136261>>>0;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  const rnd=()=>{h^=h<<13;h>>>=0;h^=h>>>17;h^=h<<5;h>>>=0;return h/4294967296;};
  const a=pool.slice();for(let i=a.length-1;i>0;i--){const j=rnd()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];}
  return a.slice(0,k);
}
// 씨앗으로 정하는 1 또는 2 (경매를 먼저 부를 색)
function augCoin(seed){let h=7;for(const ch of String(seed))h=(h*31+ch.charCodeAt(0))>>>0;return h%2?1:2;}
if(typeof module!=='undefined')module.exports={AUGS,AUG_IDS,AUG_BASE_KOMI,AUG_BID_MAX,AUG_STARS,augWallPts,augValue,augValue0,augTier,augKomi,augParse,augFormat,AugGame,augOffers,augCoin};
