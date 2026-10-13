// 증강 바둑 규칙 엔진 검사: node tools/aug/aug-test.js
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const ctx={console};vm.createContext(ctx);
const src=['go/board.js','go/aug/aug.js'].map(f=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8')).join('\n');
vm.runInContext(src+'\n;this.Board=Board;this.AugGame=AugGame;this.AUGS=AUGS;this.augOffers=augOffers;this.augTier=augTier;this.augKomi=augKomi;this.augCoin=augCoin;',ctx);
const {AugGame,augOffers,augTier,augKomi}=ctx;
let pass=0,fail=0;
const ok=(name,cond)=>{console.log((cond?'OK  ':'FAIL')+' '+name);cond?pass++:fail++;};
const throws=(name,f)=>{let t=false;try{f();}catch(e){t=true;}ok(name,t);};
const P=(x,y)=>(y+1)*11+x+1; // 9줄 자리 번호
const G=(a1,a2)=>new AugGame({n:9,aug:{1:a1,2:a2}});

// 덤
ok('덤: 대국 덤 그대로 (증강 점수는 덤에 안 들어감)', G('double','kowang').komi===7.5);

// 보통 패 (흑: c3? 모양) — 백 돌을 따낸 뒤 바로 되따내기 금지
function koSetup(g){
  // 흑 B(1,0) B(0,1) B(2,1) B(1,2)를 두고, 백 W(2,0) W(3,1) W(2,2) 를 두어 (2,1) 흑/(1,1) 패 모양을 만든다
  const seq=[P(1,0),P(2,0),P(0,1),P(3,1),P(1,2),P(2,2),P(8,8),P(1,1),P(2,1)]; // 마지막: 흑이 (2,1)에 두어 백 (1,1) 을 따냄
  for(const p of seq)g.apply(String(p));
}
{const g=G('','');koSetup(g);
 ok('패: 흑이 백 한 점을 따냄', g.b.c[P(1,1)]===0);
 throws('패: 백이 바로 되따내기 금지', ()=>g.apply(String(P(1,1))));}
{const g=G('','kowang');koSetup(g);
 g.apply(String(P(1,1)));ok('패왕: 백이 바로 되따냄', g.b.c[P(1,1)]===2&&g.b.c[P(2,1)]===0);
 throws('패왕: 흑은 바로 되따낼 수 없음', ()=>g.apply(String(P(2,1))));}
{const g=G('kowang','kowang');koSetup(g);
 throws('패왕 둘: 서로 지워져 되따내기 금지', ()=>g.apply(String(P(1,1))));}

// 무적수: 흑 한 점을 무적으로, 백이 활로를 다 막아도 남는다
{const g=G('invincible','');
 throws('무적수: 판 밖·빈 자리에는 못 검', ()=>g.apply('i'+0+';'+P(4,4)));
}
{const g=G('invincible','');
 throws('무적수: 빈 점에는 못 검', ()=>g.apply('i'+P(4,4)+';'+P(4,4)));
}
{const g=G('invincible','snipe');
 g.apply(String(P(4,4)));g.apply(String(P(4,3)));
 g.apply('i'+P(4,4)+';'+P(0,0));g.apply(String(P(3,4)));
 g.apply(String(P(8,0)));g.apply(String(P(5,4)));
 g.apply(String(P(8,1)));g.apply(String(P(4,5))); // 활로를 모두 막음
 ok('무적수: 활로 없어도 남음', g.b.c[P(4,4)]===1&&g.invincible(P(4,4)));
 throws('무적수: 두 번 못 씀', ()=>g.apply('i'+P(0,0)+';'+P(8,2)));
 throws('저격: 무적인 돌은 못 들어냄', ()=>{g.apply(String(P(8,2)));g.apply('s'+P(4,4));});
}
{const g=G('invincible','');
 g.apply(String(P(4,4)));g.apply(String(P(0,8)));
 g.apply('i'+P(4,4)+';'+P(5,4));g.apply(String(P(1,8)));
 ok('무적수: 이어 붙인 돌도 무적', g.invincible(P(5,4)));
 // 흑이 자기 활로를 스스로 다 메우는 수(보통은 자충)도 무적 무리라 둘 수 있다
 ok('무적수: 무적 무리는 자충으로 안 막힘', g.canPlay(P(4,5),1));
}

// 결계: 상대는 그 점에 못 둔다, 붙은 내 돌은 잡히지 않는다
{const g=G('barrier','');
 g.apply(String(P(0,0)));g.apply(String(P(1,0)));
 g.apply('b'+P(0,1)+';'+P(8,8));
 throws('결계: 상대가 결계 점에 못 둠', ()=>g.apply(String(P(0,1))));
 g.apply(String(P(7,7)));
 ok('결계: 흑 (0,0) 은 결계 점이 활로로 남음', g.b.c[P(0,0)]===1&&g.b.libs(P(0,0),2)===1);
 ok('결계: 흑은 결계 점에 둘 수 있음', g.canPlay(P(0,1),1));
}

// 슈퍼선수: 두 수 연달아, 차례는 그대로 번갈아
{const g=G('double','');
 g.apply('d'+P(2,2)+','+P(6,6));
 ok('슈퍼선수: 흑 두 점', g.b.c[P(2,2)]===1&&g.b.c[P(6,6)]===1&&g.turn===2);
 g.apply(String(P(4,4)));
 throws('슈퍼선수: 두 번 못 씀', ()=>g.apply('d'+P(0,0)+','+P(0,1)));
 throws('슈퍼선수: 패스 섞기 금지', ()=>{const h=G('double','');h.apply('d0,'+P(1,1));});
}
// 슈퍼선수로 단수 → 따내기
{const g=G('double','');
 g.apply(String(P(8,8)));g.apply(String(P(4,4)));
 g.apply(String(P(4,3)));g.apply(String(P(8,7)));
 g.apply(String(P(3,4)));g.apply(String(P(8,6)));
 g.apply('d'+P(5,4)+','+P(4,5));
 ok('슈퍼선수: 두 수로 백 한 점 따냄', g.b.c[P(4,4)]===0);
}

// 저격
{const g=G('snipe','');
 g.apply(String(P(0,0)));g.apply(String(P(4,4)));
 throws('저격: 내 돌은 못 들어냄', ()=>g.apply('s'+P(0,0)+';'+P(1,1)));
 g.apply('s'+P(4,4)+';'+P(4,4)); // 들어내고 그 자리에 둠
 ok('저격: 백 돌이 없어지고 그 자리에 흑, 백 차례', g.b.c[P(4,4)]===1&&g.turn===2&&g.used(1));
 throws('저격: 한 번만', ()=>{g.apply(String(P(8,8)));g.apply('s'+P(8,8)+';'+P(7,7));});
}
{const g=G('snipe','');
 g.apply(String(P(0,0)));g.apply(String(P(4,4)));
 g.apply('s'+P(4,4)+';0'); // 들어내고 패스도 됨
 ok('저격 뒤 패스', g.b.c[P(4,4)]===0&&g.turn===2&&g.entries[2]==='s'+P(4,4)+';0');
}
{const g=G('snipe','');
 g.load([String(P(0,0)),String(P(4,4)),'s'+P(4,4)]); // 예전 기보 (수 대신 들어냄)
 ok('예전 저격 기보도 읽힘', g.b.c[P(4,4)]===0&&g.turn===2&&g.turns.length===3);
}

// 되감기
{const g=G('rewind','double');
 g.apply(String(P(2,2)));g.apply('d'+P(4,4)+','+P(5,5)); // 백이 슈퍼선수로 응수
 ok('되감기 전: 백 증강 사용함', g.used(2));
 g.apply('r;'+P(6,6)); // 흑 (2,2) 와 백 응수를 되돌리고 (6,6)
 ok('되감기: 흑 (2,2) 없어지고 (6,6)', g.b.c[P(2,2)]===0&&g.b.c[P(6,6)]===1&&g.b.c[P(4,4)]===0);
 ok('되감기: 되돌린 백의 슈퍼선수는 다시 쓸 수 있음', !g.used(2)&&g.used(1));
 ok('되감기: 차례는 백', g.turn===2);
 g.apply(String(P(3,3)));
 throws('되감기: 두 번 못 씀', ()=>g.apply('r;'+P(1,1)));
}
{const g=G('rewind','rewind');
 g.apply(String(P(2,2)));g.apply(String(P(3,3)));g.apply('r;'+P(6,6));
 throws('되감기: 상대가 막 되감았으면 못 씀', ()=>g.apply('r;'+P(1,1)));
}
{const g=G('rewind','');throws('되감기: 처음에는 못 씀', ()=>g.apply('r;'+P(1,1)));}

// 기보 다시 불러오기 = 같은 판
{const g=G('invincible','barrier');
 const seq=[String(P(4,4)),'b'+P(0,0)+';'+P(4,3),'i'+P(4,4)+';'+P(5,5),String(P(3,4)),String(P(1,1)),String(P(5,4)),'0','0'];
 for(const s of seq)g.apply(s);
 const h=G('invincible','barrier');const err=h.load(seq);
 ok('다시 불러오기: 오류 없음', err===null);
 ok('다시 불러오기: 같은 판', Buffer.from(g.b.c).equals(Buffer.from(h.b.c))&&h.bar[2]===P(0,0)&&h.inv[1]===P(4,4));
 ok('두 번 패스', h.twoPasses());
 const s=h.score(new Set([P(4,4)]));
 ok('계가: 무적인 돌은 죽은 돌로 표시해도 산 돌', s.own[P(4,4)]===1);
}
// 증강 후보 3개, 같은 씨앗이면 같음
{const a=augOffers('ABC234:1'),b=augOffers('ABC234:1'),c=augOffers('ABC234:2');
 ok('후보 3개, 서로 다름', a.length===3&&new Set(a).size===3);
 ok('같은 씨앗이면 같은 후보', a.join()===b.join());
 void c;}

// 경매
ok('경매 덤: 흑 낙찰 5집 → 12.5, 백 낙찰 5집 → 2.5', augKomi(1,5)===12.5&&augKomi(2,5)===2.5);
ok('참고 한마디: 9줄 결계 아주 강함, 패왕 조금 약함, 벽 압도적', augTier('barrier',9)==='아주 강해요!'&&augTier('kowang',9)==='조금 약해요'&&augTier('wall',9)==='압도적이에요!!');
ok('경매 후보 둘은 서로 다름', new Set(augOffers('X1',2)).size===2);
ok('먼저 부를 색은 1 또는 2, 같은 씨앗이면 같음', [1,2].includes(ctx.augCoin('ABC'))&&ctx.augCoin('ABC')===ctx.augCoin('ABC'));

// 벽 (흑 아래 · 백 위 1선)
{const g=G('wall','wall');
 ok('벽: 흑 아래 1선 9점 · 백 위 1선 9점으로 시작', [0,1,2,3,4,5,6,7,8].every(x=>g.b.c[P(x,8)]===1&&g.b.c[P(x,0)]===2));
 ok('벽: 흑부터 둠', g.turn===1);
 g.apply(String(P(4,4)));g.load(g.entries);
 ok('벽: 기보를 다시 읽어도 벽이 있음', g.b.c[P(0,8)]===1&&g.b.c[P(4,4)]===1);
 const s=g.score(new Set());ok('벽: 계가에 벽 돌도 셈', s.bs>=10&&s.ws>=9);
}
// 맞바꾸기
{const g=G('swap','');
 g.apply(String(P(0,0)));g.apply(String(P(4,4)));
 g.apply('x'+P(0,0)+','+P(4,4));
 ok('맞바꾸기: 흑 돌과 백 돌 자리가 바뀜, 백 차례', g.b.c[P(0,0)]===2&&g.b.c[P(4,4)]===1&&g.turn===2&&g.used(1));
}
{const g=G('swap','');
 // 백 A9(0,0) 은 백 B9 · A8 과 이어져 있음 → 흑 돌을 A9 로 보내면 흑은 활로가 없음
 for(const p of [P(4,4),P(1,0),P(8,8),P(0,1),P(7,7),P(0,0)])g.apply(String(p));
 throws('맞바꾸기: 내 돌이 활로 없이 남으면 못 함', ()=>g.apply('x'+P(4,4)+','+P(0,0)));
 ok('맞바꾸기: 못 한 뒤에도 판·증강 그대로', g.b.c[P(4,4)]===1&&g.b.c[P(0,0)]===2&&!g.used(1));
}
{const g=G('swap','');
 // 백 (5,5) 를 흑 (0,0) 과 바꾸면 백이 A9 로 감: A9 백은 흑 B9·A8 에 둘러싸여 활로 0 → 잡힘
 g.apply(String(P(1,0)));g.apply(String(P(5,5)));g.apply(String(P(0,1)));g.apply(String(P(6,6)));g.apply(String(P(0,0)));g.apply(String(P(7,7)));
 g.apply('x'+P(0,0)+','+P(5,5));
 ok('맞바꾸기: 보낸 상대 돌이 활로 없으면 잡힘', g.b.c[P(0,0)]===0&&g.b.c[P(5,5)]===1&&g.b.caps[1]===1);
 throws('맞바꾸기: 한 번만', ()=>{g.apply(String(P(8,8)));g.apply('x'+P(1,0)+','+P(6,6));});
}
{const g=G('swap','invincible');
 for(const p of [P(0,0),P(4,4),P(8,8)])g.apply(String(p));
 g.apply('i'+P(4,4)+';'+P(3,3));
 throws('맞바꾸기: 무적인 돌은 못 바꿈', ()=>g.apply('x'+P(0,0)+','+P(4,4)));
}
// 포로교환
{const g=G('prisoner','');
 // 흑이 백 한 점을 따냄: 백 (0,0), 흑 (1,0) · (0,1)
 g.apply(String(P(1,0)));g.apply(String(P(0,0)));g.apply(String(P(0,1)));
 const s0=G('',''),gg=G('','');for(const e of g.entries)gg.apply(e);
 const a=g.score(new Set()),b=gg.score(new Set());
 ok('포로교환: 따낸 1점만큼 흑 집이 1 많음', a.bs===b.bs+1&&a.pb===1);
 g.apply(String(P(4,4)));g.apply(String(P(8,8)));
 const d=g.score(new Set([P(4,4)]));ok('포로교환: 죽은 돌로 표시한 백 돌도 셈', d.pb===2);
 void s0;
}

// 거울수 · 증식 · 패스 저축 · 순간이동 · 공수부대 · 양자택일 · 예약수
{const g=G('mirror','');g.apply('m'+P(2,2));ok('거울수: 대칭점에도 놓임', g.b.c[P(2,2)]===1&&g.b.c[P(6,6)]===1&&g.turn===2);
 const h=G('mirror','');h.apply('m'+P(4,4));ok('거울수: 가운데는 한 점', h.b.pts.filter(p=>h.b.c[p]===1).length===1);}
{const g=G('grow','');g.apply(String(P(4,4)));g.apply(String(P(0,0)));g.apply('g'+P(4,4));
 ok('증식: 둘레 빈 점 4곳이 내 돌', [P(3,4),P(5,4),P(4,3),P(4,5)].every(p=>g.b.c[p]===1)&&g.turn===2);}
{const g=G('save','');g.apply('0');g.apply(String(P(0,0)));g.apply('0');g.apply(String(P(8,8)));
 ok('패스 저축: 패스 두 번이면 2 저축', g.saves[1]===2);
 throws('패스 저축: 수가 모자라면 거부', ()=>g.apply('e'+P(4,4)+','+P(4,5)));
 g.apply('e'+P(4,4)+','+P(4,5)+','+P(4,6));ok('패스 저축: 3수 연달아, 백 차례', [P(4,4),P(4,5),P(4,6)].every(p=>g.b.c[p]===1)&&g.turn===2&&g.saves[1]===0);}
{const g=G('teleport','');g.apply(String(P(0,0)));g.apply(String(P(8,8)));g.apply('t'+P(0,0)+','+P(4,4));
 ok('순간이동: 돌이 옮겨짐', g.b.c[P(0,0)]===0&&g.b.c[P(4,4)]===1&&g.turn===2);}
{const g=G('para','');
 for(const p of [P(6,6),P(1,0),P(6,7),P(0,1)])g.apply(String(p));
 g.apply('p'+P(0,0));ok('공수부대: 자살수 자리에 둠', g.b.c[P(0,0)]===1);
 g.apply(String(P(5,5)));ok('공수부대: 상대 차례에는 안 잡힘', g.b.c[P(0,0)]===1);
 g.apply(String(P(7,7)));ok('공수부대: 내 다음 차례 뒤 활로 없으면 잡힘', g.b.c[P(0,0)]===0&&g.b.caps[2]===1);}
{const g=G('fork','');g.apply('f'+P(2,2)+','+P(6,6));ok('양자택일: 예약만, 백 차례', g.b.c[P(2,2)]===0&&g.turn===2);
 g.apply(String(P(6,6)));ok('양자택일: 막지 않은 예약점에 흑 돌', g.b.c[P(2,2)]===1&&g.b.c[P(6,6)]===2&&g.turn===1);
 throws('양자택일: 같은 점 둘은 안 됨', ()=>{const h=G('fork','');h.apply('f'+P(2,2)+','+P(2,2));});}
{const g=G('shadow','');g.apply('h'+P(4,4)+';'+P(2,2));ok('예약수: 예약하고 착수', g.b.c[P(2,2)]===1&&g.b.c[P(4,4)]===0&&g.turn===2);
 g.apply(String(P(0,0)));ok('예약수: 상대 차례 뒤 내 돌', g.b.c[P(4,4)]===1&&g.turn===1);
 const h=G('shadow','');h.apply('h'+P(4,4)+';'+P(2,2));h.apply(String(P(4,4)));ok('예약수: 상대가 먼저 두면 사라짐', h.b.c[P(4,4)]===2&&!h.resv);}

// 네크로맨서 · 추크추방 · 중립지대 · 큰돌 · 명당
{const g=G('necro','');throws('네크로맨서: 따낸 돌이 없으면 못 씀', ()=>g.apply('n'+P(4,4)));
 for(const p of [P(1,0),P(0,0),P(0,1),P(8,8)])g.apply(String(p));
 throws('네크로맨서: 상대 자살수 자리는 안 됨', ()=>g.apply('n'+P(0,0)));
 g.apply('n'+P(4,4));ok('네크로맨서: 따낸 돌로 상대 돌을 놓음, 내 수 없음', g.b.c[P(4,4)]===2&&g.turn===2&&g.necroLeft(1)===0);}
{const g=G('zugzwang','');g.apply('z;'+P(4,4));
 throws('추크추방: 상대는 1-1 말고 못 둠', ()=>g.apply(String(P(3,3))));
 g.apply(String(P(0,0)));g.apply(String(P(5,5)));g.apply(String(P(3,3)));ok('추크추방: 1-1 뒤에는 자유', g.b.c[P(0,0)]===2&&g.b.c[P(3,3)]===2);}
{const g=G('neutral','');g.apply('u'+P(4,4)+';'+P(4,3));const s=g.score(new Set());
 ok('중립지대: 판 끝처럼 (활로도 집도 아님, 누구도 못 둠)', g.b.c[P(4,4)]===3&&s.bs+s.ws===80&&!g.canPlay(P(4,4),2));
 const h=G('neutral','');for(const p of [P(1,0),P(0,0)])h.apply(String(p));h.apply('u'+P(0,1)+';'+P(5,5));
 ok('중립지대: 활로가 없어진 상대 돌은 잡힘', h.b.c[P(0,0)]===0&&h.b.caps[1]===1);}
{const g=G('bigstone','');g.apply('o'+P(3,3)+';'+P(0,0));
 ok('큰돌: 2×2 와 착수', [P(3,3),P(4,3),P(3,4),P(4,4),P(0,0)].every(p=>g.b.c[p]===1)&&g.turn===2);
 throws('큰돌: 판 밖으로 넘으면 안 됨', ()=>{const h=G('bigstone','');h.apply('o'+P(8,8)+';'+P(0,0));});}
{const g=G('myeongdang','');g.apply(String(P(2,2)));const s=g.score(new Set());
 ok('명당: 내 집인 화점 5곳 +10', s.mb===10);}

console.log(`\n${pass}개 통과, ${fail}개 실패`);process.exit(fail?1:0);
