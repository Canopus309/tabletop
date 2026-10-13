// 측정용 판(AugBoard)과 앱 규칙(AugGame)이 같은 결과를 내는지: 증강을 섞은 무작위 대국 여러 판을 둘 다에 두어 비교한다
// 사용: node tools/aug/sim-test.js [판 수=300]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '../..');
const src = ['go/board.js', 'go/aug/augboard.js', 'go/aug/aug.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + '\n;({AugBoard, AugGame, AUG_IDS, PASS, EMPTY})';
const { AugBoard, AugGame, AUG_IDS, PASS, EMPTY } = vm.runInThisContext(src);
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const pick = a => a[Math.floor(rnd() * a.length)];
const N = +process.argv[2] || 300;
let games = 0, moves = 0, augUses = 0, bad = 0, swaps = 0; const kinds = {};
for (let gi = 0; gi < N; gi++) {
  const n = pick([9, 9, 13]), augB = pick(AUG_IDS), augW = pick(AUG_IDS);
  const G = new AugGame({ n, aug: { 1: augB, 2: augW } }), b = new AugBoard(n);
  if (augB === 'kowang' && augW !== 'kowang') b.kw = 1; else if (augW === 'kowang' && augB !== 'kowang') b.kw = 2;
  for (const c of [1, 2]) if (G.aug[c] === 'wall') b.wall(c);
  if (!b.pts.every(p => b.c[p] === G.b.c[p])) { console.log('벽 시작 다름', gi); bad++; }
  const snaps = [], savesB = { 1: 0, 2: 0 };
  for (let t = 0; t < n * n * 2; t++) {
    const col = G.turn; if (b.turn !== col) { console.log('차례 다름', gi, t); bad++; break; }
    const legal = Array.from(b.pts).filter(p => b.isLegal(p, col));
    // 두 규칙의 둘 수 있는 자리가 같은지
    const legalG = Array.from(b.pts).filter(p => G.canPlay(p, col));
    if (legal.join() !== legalG.join()) { console.log('둘 수 있는 자리 다름', gi, t, augB, augW); bad++; break; }
    if (!legal.length) break;
    const a = G.aug[col], use = G.canUse(col) && rnd() < 0.15;
    let s;
    snaps.push(b.c.slice());
    if (use && a === 'double') { const p1 = pick(legal); const g2 = new AugGame({ n, aug: G.aug }); g2.load(G.entries); g2.put(p1, col); const l2 = Array.from(b.pts).filter(p => g2.canPlay(p, col)); if (!l2.length) { s = String(p1); } else { const p2 = pick(l2); s = 'd' + p1 + ',' + p2; } }
    else if (use && a === 'snipe') { const opp = Array.from(b.pts).filter(p => b.c[p] === 3 - col && !b.isInv(p)); if (opp.length) { const q = pick(opp), b2 = new AugBoard(n); b2.copyFrom(b); b2.pluck(q); s = 's' + q + ';' + pick(Array.from(b2.pts).filter(p => b2.isLegal(p, col))); } else s = String(pick(legal)); }
    else if (use && a === 'invincible') { const mine = Array.from(b.pts).filter(p => b.c[p] === col); s = mine.length ? 'i' + pick(mine) + ';' + pick(legal) : String(pick(legal)); }
    else if (use && a === 'barrier') { const q = pick(Array.from(b.pts).filter(p => b.c[p] === EMPTY)); const lg = legal.filter(p => p !== q || true); s = 'b' + q + ';' + pick(lg); }
    else if (use && a === 'swap') {
      // 아무 두 돌이나 골라, 두 규칙이 '바꿀 수 있나'를 똑같이 판단하는지 본다
      const mine = Array.from(b.pts).filter(p => b.c[p] === col), opp = Array.from(b.pts).filter(p => b.c[p] === 3 - col);
      if (mine.length && opp.length) { const x = pick(mine), y = pick(opp), okB = b.canSwap(x, y), g2 = new AugGame({ n, aug: G.aug }); g2.load(G.entries); let okG = true; try { g2.apply('x' + x + ',' + y); } catch (e) { okG = false; } if (okB !== okG) { console.log('맞바꾸기 판단 다름', gi, t, x, y, okB, okG); bad++; break; } s = okB ? 'x' + x + ',' + y : String(pick(legal)); swaps++; }
      else s = String(pick(legal));
    }
    else if (use && (a === 'fork' || a === 'shadow')) { const emp = Array.from(b.pts).filter(p => b.c[p] === EMPTY && b.bar[3 - col] !== p); if (emp.length >= 2) { const x = pick(emp), y = pick(emp.filter(p => p !== x)); s = a === 'fork' ? 'f' + x + ',' + y : 'h' + x; } else s = String(pick(legal)); }
    else if (use && a === 'mirror') s = 'm' + pick(legal);
    else if (use && a === 'grow') {
      const mine = Array.from(b.pts).filter(p => b.c[p] === col); if (mine.length) { const x = pick(mine), okB = b.canGrow(x), g2 = new AugGame({ n, aug: G.aug }); g2.load(G.entries); let okG = true; try { g2.apply('g' + x); } catch (e) { okG = false; } if (okB !== okG) { console.log('증식 판단 다름', gi, t, x, okB, okG); bad++; break; } s = okB ? 'g' + x : String(pick(legal)); } else s = String(pick(legal));
    }
    else if (use && a === 'teleport') {
      const mine = Array.from(b.pts).filter(p => b.c[p] === col), emp = Array.from(b.pts).filter(p => b.c[p] === EMPTY);
      if (mine.length && emp.length) { const x = pick(mine), y = pick(emp), okB = b.canTeleport(x, y), g2 = new AugGame({ n, aug: G.aug }); g2.load(G.entries); let okG = true; try { g2.apply('t' + x + ',' + y); } catch (e) { okG = false; } if (okB !== okG) { console.log('순간이동 판단 다름', gi, t, x, y, okB, okG); bad++; break; } s = okB ? 't' + x + ',' + y : String(pick(legal)); } else s = String(pick(legal));
    }
    else if (use && a === 'para') { const emp = Array.from(b.pts).filter(p => b.c[p] === EMPTY && b.bar[3 - col] !== p); s = 'p' + pick(emp); }
    else if (use && a === 'save' && savesB[col] > 0) {
      // 저축 수 + 1 수를 차례로 (앱 규칙으로 하나씩 둘 수 있는 자리 고르기)
      const g2 = new AugGame({ n, aug: G.aug }); g2.load(G.entries); const ps = [];
      for (let k = 0; k <= savesB[col]; k++) { const lg = Array.from(b.pts).filter(p => g2.canPlay(p, col)); if (!lg.length) break; const p = pick(lg); ps.push(p); g2.put(p, col); }
      s = ps.length === savesB[col] + 1 ? 'e' + ps.join(',') : String(pick(legal));
    }
    else s = rnd() < (a === 'save' ? 0.12 : 0.03) ? '0' : String(pick(legal));
    if (s.startsWith('d') && s.split(',').length === 1) s = s.slice(1);
    try { G.apply(s); } catch (e) { continue; } // 앱 규칙이 거부하면 (예: 결계 점이 이번 수 자리) 건너뜀
    // 같은 행동을 AugBoard 에
    if (s[0] === 'd') { const [p1, p2] = s.slice(1).split(',').map(Number); b.play(p1); b.again(); b.play(p2); augUses++; }
    else if (s[0] === 's') { const [q, p] = s.slice(1).split(';').map(Number); b.pluck(q); b.play(p); augUses++; }
    else if (s[0] === 'f') { b.reserve(s.slice(1).split(',').map(Number)); augUses++; }
    else if (s[0] === 'h') { b.reserve([+s.slice(1)]); augUses++; }
    else if (s[0] === 'm') { b.mirror(+s.slice(1)); augUses++; }
    else if (s[0] === 'g') { b.grow(+s.slice(1)); augUses++; }
    else if (s[0] === 't') { const [x, y] = s.slice(1).split(',').map(Number); b.teleport(x, y); augUses++; }
    else if (s[0] === 'p') { b.paraPlay(+s.slice(1)); augUses++; }
    else if (s[0] === 'e') { const ps = s.slice(1).split(',').map(Number); ps.forEach((p, i) => { b.play(p); if (i < ps.length - 1) b.again(); }); savesB[col] = 0; augUses++; }
    else if (s[0] === 'x') { const [x, y] = s.slice(1).split(',').map(Number); b.swap(x, y); augUses++; }
    else if (s[0] === 'i' || s[0] === 'b') { const [q, p] = s.slice(1).split(';').map(Number); if (s[0] === 'i') b.inv[col] = q; else b.bar[col] = q; b.play(p); augUses++; }
    else b.play(+s);
    if (/^[mgtpexdsibfh]/.test(s)) kinds[s[0]] = (kinds[s[0]] || 0) + 1;
    if (s === '0' && G.aug[col] === 'save' && !G.used(col)) savesB[col]++;
    b.turnEnd();
    moves++;
    const same = b.pts.every(p => b.c[p] === G.b.c[p]);
    if (!same) { console.log('판 다름', gi, t, s, augB, augW); bad++; break; }
    if (b.caps[1] !== G.b.caps[1] || b.caps[2] !== G.b.caps[2]) { console.log('따낸 수 다름', gi, t, s); bad++; break; }
    if (b.passes >= 2) break;
  }
  games++;
}
console.log(`${games}판 ${moves}수 (증강 ${augUses}번 ${JSON.stringify(kinds)}) 비교 · 어긋남 ${bad}`);
process.exit(bad ? 1 : 0);
