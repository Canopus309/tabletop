// 증강 바둑 측정용 AI 대국 (Node). 앱의 기본 AI(무작위로 끝까지 두어 보는 탐색, go/index.html 의 engine 스크립트)를
// 증강 규칙 판(go/aug/augboard.js)에서 돌리고, 증강마다 '지금 쓰면 이득인가'를 평가해 쓴다.
// 신경망이 아니라 규칙대로 끝까지 두어 보고 판단하므로 무적수·결계도 계산에 그대로 들어간다 (대신 약하다: 9줄 10~15급쯤)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'go/index.html'), 'utf8');
const engine = html.slice(html.indexOf('<script id="engine">') + 20, html.indexOf('</script>', html.indexOf('<script id="engine">')))
  .replace(/new Board\(/g, 'new AugBoard(');
const src = fs.readFileSync(path.join(ROOT, 'go/board.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'go/aug/augboard.js'), 'utf8') + '\n' + engine
  + '\n;({Board, AugBoard, genmove, estimate, PASS, EMPTY, BLACK, WHITE})';
const E = vm.runInThisContext(src);
const { AugBoard, genmove, estimate, PASS, EMPTY } = E;

function copy(b) { const x = new AugBoard(b.n); x.copyFrom(b); return x; }
// col 쪽에서 본 평균 집 차이 (무작위로 끝까지 sims 판)
function est(b, komi, sims, col) { const s = estimate(b, komi, sims).score; return col === 1 ? s : -s; }
function chains(b, col) {
  const seen = new Set(), out = [];
  for (const p of b.pts) {
    if (b.c[p] !== col || seen.has(p)) continue;
    const st = [p], ch = [p]; seen.add(p);
    while (st.length) { const q = st.pop(); for (const dd of b.d) { const r = q + dd; if (b.c[r] === col && !seen.has(r)) { seen.add(r); st.push(r); ch.push(r); } } }
    out.push(ch);
  }
  return out;
}

// 한 차례의 결정: {kind: 'move'|'double'|'snipe'|'inv'|'bar'|'rewind', m, m2, q, w}
function decide(b, col, me, o, hist) {
  const n = b.n, area = n * n, late = b.moveNum >= Math.floor(area * 0.55);
  const G = (bb, temp = 0) => genmove(bb, o.komi, { playouts: o.P, time: 1e9, temp });
  const r0 = G(b, b.moveNum < 6 ? 0.5 : 0);
  const base = { kind: 'move', m: r0.move, w: r0.winrate };
  if (!me.aug || me.used || me.aug === 'kowang') return base;
  const K = o.K;
  switch (me.aug) {
    case 'double': {
      if (r0.move === PASS) return base;
      const b1 = copy(b); b1.play(r0.move); b1.again();
      const r1 = G(b1);
      if (r1.move !== PASS && (r1.winrate - r0.winrate >= o.thrW || late)) return { kind: 'double', m: r0.move, m2: r1.move, w: r1.winrate };
      return base;
    }
    case 'snipe': {
      const b0 = copy(b); b0.play(r0.move); const s0 = est(b0, o.komi, K, col);
      let best = null;
      for (const p of b.pts) {
        if (b.c[p] !== 3 - col || b.isInv(p)) continue;
        const b2 = copy(b); b2.snipe(p); const s = est(b2, o.komi, K, col);
        if (!best || s > best.s) best = { p, s };
      }
      if (best && (best.s - s0 >= o.thrS || (late && best.s > s0))) return { kind: 'snipe', q: best.p, w: r0.winrate };
      return base;
    }
    case 'invincible': case 'barrier': {
      if (me.aug === 'barrier' && b.moveNum % 2 === 1 && !late) return base; // 결계 후보가 많아 두 차례에 한 번만 따져 본다
      const b0 = copy(b); b0.play(r0.move); const s0 = est(b0, o.komi, K, col);
      let best = null;
      const cands = me.aug === 'invincible' ? chains(b, col).map(ch => ch[0]) : Array.from(b.pts).filter(p => b.c[p] === EMPTY && p !== r0.move);
      for (const q of cands) {
        const b2 = copy(b); if (me.aug === 'invincible') b2.inv[col] = q; else b2.bar[col] = q;
        if (!b2.isLegal(r0.move, col)) continue;
        b2.play(r0.move); const s = est(b2, o.komi, me.aug === 'barrier' ? Math.max(16, K >> 1) : K, col);
        if (!best || s > best.s) best = { q, s };
      }
      if (best && (best.s - s0 >= o.thrS || (late && best.s > s0))) return { kind: me.aug === 'invincible' ? 'inv' : 'bar', q: best.q, m: r0.move, w: r0.winrate };
      return base;
    }
    case 'rewind': {
      // 내 직전 수 뒤 예상보다 승률이 크게 떨어졌으면 (상대의 좋은 응수 · 내 실수) 되감아 다른 수를 둔다
      const T = hist.length - 1;
      if (me.prev === null || T < 2 || hist[T - 1].rewound || r0.winrate > me.prev - o.thrR) return base;
      const back = hist[T - 2], bb = copy(back.b), r1 = G(bb);
      const alt = r1.move !== back.played ? r1 : r1.top.find(t => t.move !== back.played);
      if (alt && alt.winrate > r0.winrate + 0.05) return { kind: 'rewind', m: alt.move, w: alt.winrate };
      return base;
    }
  }
  return base;
}

// 한 판: augB, augW = 증강 이름 또는 ''. 반환: 흑 기준 예상 집 차이(덤 반영), 증강 쓴 때 등
function playGame(o) {
  const n = o.n, b = new AugBoard(n);
  if (o.augB === 'kowang' && o.augW !== 'kowang') b.kw = 1; else if (o.augW === 'kowang' && o.augB !== 'kowang') b.kw = 2;
  const S = { 1: { aug: o.augB, used: false, prev: null, at: -1 }, 2: { aug: o.augW, used: false, prev: null, at: -1 } };
  const hist = [];
  let guard = 0;
  while (b.passes < 2 && guard++ < n * n * 3) {
    const col = b.turn, me = S[col];
    hist.push({ b: copy(b), S: JSON.parse(JSON.stringify(S)), played: null, rewound: false });
    const a = decide(b, col, me, o, hist);
    const h = hist[hist.length - 1];
    if (a.kind === 'rewind') {
      const T = hist.length - 1, back = hist[T - 2];
      b.copyFrom(back.b); S[1] = back.S[1]; S[2] = back.S[2];
      hist.length = T - 2; hist.push({ b: copy(b), S: JSON.parse(JSON.stringify(S)), played: null, rewound: true });
      S[col].used = true; S[col].at = b.moveNum;
      b.play(a.m); hist[hist.length - 1].played = a.m;
    } else if (a.kind === 'double') { b.play(a.m); b.again(); b.play(a.m2); me.used = true; me.at = b.moveNum; h.played = a.m; }
    else if (a.kind === 'snipe') { b.snipe(a.q); me.used = true; me.at = b.moveNum; h.played = -1; }
    else if (a.kind === 'inv' || a.kind === 'bar') { if (a.kind === 'inv') b.inv[col] = a.q; else b.bar[col] = a.q; me.used = true; me.at = b.moveNum; b.play(a.m); h.played = a.m; }
    else { b.play(a.m); h.played = a.m; }
    S[col].prev = a.w;
  }
  const e = estimate(b, o.komi, o.final);
  return { margin: +e.score.toFixed(2), turns: b.moveNum, usedB: S[1].used ? S[1].at : null, usedW: S[2].used ? S[2].at : null };
}
module.exports = { playGame, E };
