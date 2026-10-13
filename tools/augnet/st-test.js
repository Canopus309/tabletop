// AI 장면(St, go/aug/augstate.js)과 앱 규칙(AugGame)이 같은 판을 만드는지: 무작위 행동으로 둔 대국을 차례마다 맞댄다
// St 의 한 차례(단계 여럿)를 앱의 한 차례 글자로 바꿔 AugGame 에 두고, 차례가 끝날 때마다 판 · 따낸 수 · 패스 저축을 비교
// 사용: node tools/augnet/st-test.js [판 수=300]
'use strict';
const { St, AUG_LIST } = require('./game.js');
const { AugGame } = require('./jsenv.js');
const N = +process.argv[2] || 300;
let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const pick = a => a[Math.floor(rnd() * a.length)];
let games = 0, turns = 0, bad = 0; const kinds = {};
for (let gi = 0; gi < N && !bad; gi++) {
  const aug = { 1: pick(AUG_LIST), 2: pick(AUG_LIST) }, komi = 7.5;
  let s = new St(9, komi, aug); const G = new AugGame({ n: 9, komi, aug });
  if (!s.b.pts.every(p => s.b.c[p] === G.b.c[p])) { console.log('시작 판 다름', aug); bad++; break; }
  let cur = []; // 이번 차례의 행동들
  const area = 81, pt = i => s.pt(i);
  for (let k = 0; k < 400 && !s.terminal(); k++) {
    const A = s.actions(), aug1 = A.filter(a => a > area);
    let a = aug1.length && rnd() < 0.2 ? pick(aug1) : pick(A);
    if (a === area && A.length > 1 && s.step === 'decide' && rnd() < (s.aug[s.col] === 'save' ? 0.85 : 0.97)) a = pick(A.filter(x => x !== area));
    const st0 = s.step, col = s.col, au = s.aug[col];
    cur.push({ a, st: st0 });
    s = s.apply(a);
    if (a === 2 * area + 1) cur[cur.length - 1].need = au === 'double' ? 2 : au === 'save' ? s.chainLeft : 1;
    if (s.step !== 'decide') continue;
    // 차례 끝: 글자로
    const P = x => x === area ? 0 : pt(x), T = x => pt(x - area - 1);
    const f = cur[0], last = cur[cur.length - 1];
    let str;
    if (cur.length === 1) str = f.a > area ? 'g' + T(f.a) : String(P(f.a));
    else if (f.a === 2 * area + 1) {
      const ms = cur.slice(1).map(c => P(c.a)); while (ms.length < f.need) ms.push(0); // 둘 곳이 없어 일찍 끝난 차례
      str = au === 'double' ? 'd' + ms.join(',') : au === 'mirror' ? 'm' + ms[0] : au === 'para' ? 'p' + ms[0] : 'e' + ms.join(',');
    } else if (au === 'swap' || au === 'teleport' || au === 'fork') str = ({ swap: 'x', teleport: 't', fork: 'f' })[au] + T(f.a) + ',' + (last.a === area ? 0 : T(last.a));
    else str = ({ invincible: 'i', barrier: 'b', snipe: 's', shadow: 'h' })[au] + T(f.a) + ';' + P(last.a);
    kinds[str[0]] = (kinds[str[0]] || 0) + 1;
    try { G.apply(str); } catch (e) { console.log('앱이 거부', gi, k, str, aug, e.message); bad++; break; }
    turns++; cur = [];
    const same = s.b.pts.every(p => s.b.c[p] === G.b.c[p]);
    if (!same || G.turn !== s.col || s.b.caps[1] !== G.b.caps[1] || s.b.caps[2] !== G.b.caps[2] || s.saves[1] !== G.saves[1] || s.saves[2] !== G.saves[2]) {
      console.log('다름', gi, k, str, aug, { same, turnG: G.turn, turnS: s.col, caps: [s.b.caps, G.b.caps], saves: [s.saves, G.saves] }); bad++; break;
    }
  }
  games++;
}
console.log(`${games}판 ${turns}차례 ${JSON.stringify(kinds)} · 어긋남 ${bad}`);
process.exit(bad ? 1 : 0);
