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
ok('참고 한마디: 9줄 결계 아주 강함, 패왕 조금 약함', augTier('barrier',9)==='아주 강해요!'&&augTier('kowang',9)==='조금 약해요');
ok('경매 후보 둘은 서로 다름', new Set(augOffers('X1',2)).size===2);
ok('먼저 부를 색은 1 또는 2, 같은 씨앗이면 같음', [1,2].includes(ctx.augCoin('ABC'))&&ctx.augCoin('ABC')===ctx.augCoin('ABC'));

console.log(`\n${pass}개 통과, ${fail}개 실패`);process.exit(fail?1:0);
