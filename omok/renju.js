/* 렌주 오목: 규칙(흑 금수 33·44·장목)과 AI.
 * 페이지에서는 규칙 판정용으로, Web Worker 에서는 AI 계산용으로 같은 파일을 쓴다.
 *
 * 렌주 규칙 요약
 *  - 15×15, 흑 선. 흑은 정확히 5목이어야 이기고, 장목(6목 이상)·44·33 은 둘 수 없다(금수).
 *    단 5목이 되는 수는 금수 모양이 함께 생겨도 5목이 우선이다.
 *  - 백은 5목 이상이면 이기고 금수가 없다.
 *  - 33 의 '3'은 금수가 아닌 수로 열린 4(양쪽이 열린 4)가 될 수 있는 3만 센다(거짓 3 제외).
 */
'use strict';
const RJ = (() => {
  const N = 15, NN = N * N, EMPTY = 0, BLACK = 1, WHITE = 2;
  const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];

  // LINE[(p*4+d)*11 + k+5] = p 에서 방향 d 로 k 칸 떨어진 점 (판 밖이면 -1), k = -5..5
  const LINE = new Int16Array(NN * 4 * 11);
  for (let p = 0; p < NN; p++) {
    const x = p % N, y = (p / N) | 0;
    for (let d = 0; d < 4; d++) for (let k = -5; k <= 5; k++) {
      const X = x + k * DX[d], Y = y + k * DY[d];
      LINE[(p * 4 + d) * 11 + k + 5] = X >= 0 && X < N && Y >= 0 && Y < N ? Y * N + X : -1;
    }
  }
  const at = (b, base, k) => { const r = LINE[base + k + 5]; return r < 0 ? 3 : b[r]; };

  // p 를 지나는 방향 d 의 연속된 c 돌 수 (p 포함, p 에 c 가 있다고 본다)
  function runLen(b, p, d, c) {
    const base = (p * 4 + d) * 11;
    let n = 1;
    for (let k = 1; k <= 5 && at(b, base, k) === c; k++) n++;
    for (let k = -1; k >= -5 && at(b, base, k) === c; k--) n++;
    return n;
  }
  const fiveLen = (c, len) => c === BLACK ? len === 5 : len >= 5;
  function makesFive(b, p, c) { for (let d = 0; d < 4; d++) if (fiveLen(c, runLen(b, p, d, c))) return true; return false; }

  // p 에 c 돌이 있을 때, 방향 d 에서 p 를 포함하는 5목을 만드는 빈칸(완성점)들.
  // 같은 네 돌로 이루어진 4는 하나로 센다 → count: 서로 다른 4의 개수, open: 완성점이 둘인 열린 4가 있는가
  function foursDir(b, p, d, c) {
    const base = (p * 4 + d) * 11, sigs = new Map(), pts = [];
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const q = LINE[base + k + 5];
      if (q < 0 || b[q] !== EMPTY) continue;
      b[q] = c;
      let lo = k, hi = k;
      while (lo > -5 && at(b, base, lo - 1) === c) lo--;
      while (hi < 5 && at(b, base, hi + 1) === c) hi++;
      b[q] = EMPTY;
      if (lo <= 0 && hi >= 0 && fiveLen(c, hi - lo + 1)) {
        let sig = '';
        for (let i = lo; i <= hi; i++) if (i !== k) sig += i + ',';
        sigs.set(sig, (sigs.get(sig) || 0) + 1);
        pts.push(q);
      }
    }
    let open = false;
    for (const v of sigs.values()) if (v >= 2) open = true;
    return { count: sigs.size, open, pts };
  }

  const MAX_FORBID_DEPTH = 3;
  // 흑이 p 에 두면 금수인가 (p 는 빈칸)
  function isForbidden(b, p, depth = 0) {
    if (b[p] !== EMPTY) return false;
    b[p] = BLACK;
    let res = false;
    let five = false, over = false;
    for (let d = 0; d < 4; d++) { const len = runLen(b, p, d, BLACK); if (len === 5) five = true; else if (len > 5) over = true; }
    if (!five) {
      if (over) res = true;
      else {
        let fours = 0;
        const hasFour = [false, false, false, false];
        for (let d = 0; d < 4; d++) { const f = foursDir(b, p, d, BLACK); fours += f.count; hasFour[d] = f.count > 0; }
        if (fours >= 2) res = true;
        else {
          let threes = 0;
          for (let d = 0; d < 4 && threes < 2; d++) if (!hasFour[d] && openThreeDir(b, p, d, depth)) threes++;
          res = threes >= 2;
        }
      }
    }
    b[p] = EMPTY;
    return res;
  }
  // p 에 흑이 있을 때 방향 d 에 '진짜 3'(금수가 아닌 한 수로 열린 4가 되는 3)이 있는가
  function openThreeDir(b, p, d, depth) {
    const base = (p * 4 + d) * 11;
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const q = LINE[base + k + 5];
      if (q < 0 || b[q] !== EMPTY) continue;
      b[q] = BLACK;
      const f = foursDir(b, p, d, BLACK);
      b[q] = EMPTY;
      if (f.open && (depth >= MAX_FORBID_DEPTH || !isForbidden(b, q, depth + 1))) return true;
    }
    return false;
  }

  // ================= 평가용 모양 표 =================
  // 한 방향의 9칸(가운데가 둘 자리)을 보고 그 수가 만드는 모양을 미리 계산해 둔다.
  // 이웃 8칸: 0 빈칸, 1 내 돌, 2 막힘(상대 돌/판 밖)
  const S_NONE = 0, S_ONE = 1, S_TWO = 2, S_TWO_O = 3, S_THREE = 4, S_THREE_O = 5, S_FOUR = 6, S_FOUR_O = 7, S_FIVE = 8;
  function analyze1D(a, black) {
    const fiveL = len => black ? len === 5 : len >= 5;
    const runAt = (arr, i) => { let lo = i, hi = i; while (lo > 0 && arr[lo - 1] === 1) lo--; while (hi < 8 && arr[hi + 1] === 1) hi++; return [lo, hi]; };
    const fourInfo = arr => {
      const sigs = new Map();
      for (let q = 0; q < 9; q++) {
        if (arr[q] !== 0) continue;
        arr[q] = 1; const [lo, hi] = runAt(arr, q); arr[q] = 0;
        if (lo <= 4 && hi >= 4 && fiveL(hi - lo + 1)) { let s = ''; for (let i = lo; i <= hi; i++) if (i !== q) s += i; sigs.set(s, (sigs.get(s) || 0) + 1); }
      }
      let open = false; for (const v of sigs.values()) if (v >= 2) open = true;
      return { count: sigs.size, open };
    };
    const level = (arr, depth) => {
      const [lo, hi] = runAt(arr, 4);
      if (fiveL(hi - lo + 1)) return S_FIVE;
      const f = fourInfo(arr);
      if (f.open || f.count >= 2) return S_FOUR_O;
      if (f.count) return S_FOUR;
      if (depth >= 2) return S_ONE;
      let best = S_ONE;
      for (let q = 0; q < 9; q++) {
        if (arr[q] !== 0) continue;
        arr[q] = 1; const s = level(arr, depth + 1); arr[q] = 0;
        // 한 수 더 두면 열린4 → 지금은 열린3, 그냥4 → 막힌3, 열린3 → 열린2, 막힌3 → 막힌2
        const down = s === S_FOUR_O ? S_THREE_O : s === S_FOUR ? S_THREE : s === S_THREE_O ? S_TWO_O : s === S_THREE ? S_TWO : S_ONE;
        if (down > best) best = down;
      }
      return best;
    };
    return level(a, 0);
  }
  const SHAPE = [null, new Uint8Array(6561), new Uint8Array(6561)];
  {
    const a = new Int8Array(9);
    for (let key = 0; key < 6561; key++) {
      let k = key;
      for (let i = 0; i < 9; i++) { if (i === 4) { a[i] = 1; continue; } const v = k % 3; k = (k / 3) | 0; a[i] = v === 2 ? 2 : v; }
      SHAPE[BLACK][key] = analyze1D(a, true);
      SHAPE[WHITE][key] = analyze1D(a, false);
    }
  }
  const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187];
  function shapeKey(b, p, d, c) {
    const base = (p * 4 + d) * 11;
    let key = 0, i = 0;
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const v = at(b, base, k);
      key += (v === EMPTY ? 0 : v === c ? 1 : 2) * POW3[i++];
    }
    return key;
  }
  const W = [0, 10, 60, 400, 500, 3000, 2500, 100000, 10000000];

  // ================= 탐색용 상태 =================
  class Game {
    constructor() {
      this.b = new Int8Array(NN);
      this.sh = [null, new Uint8Array(NN * 4), new Uint8Array(NN * 4)]; // 점·방향별 모양
      this.ps = [null, new Int32Array(NN), new Int32Array(NN)];       // 점수 (그 색이 두면)
      this.near = new Uint8Array(NN);                                   // 거리 2 안의 돌 수
      this.moves = [];
      this.zh = 0; this.zl = 0;
    }
    static from(moves) { const g = new Game(); for (const m of moves) g.play(m); return g; }
    get turn() { return this.moves.length % 2 === 0 ? BLACK : WHITE; }
    refresh(q) {
      for (const c of [BLACK, WHITE]) {
        if (this.b[q] !== EMPTY) { this.ps[c][q] = 0; continue; }
        let s = 0, fours = 0, threes = 0;
        for (let d = 0; d < 4; d++) {
          const sh = SHAPE[c][shapeKey(this.b, q, d, c)];
          this.sh[c][q * 4 + d] = sh;
          s += W[sh];
          if (sh === S_FOUR || sh === S_FOUR_O) fours++;
          else if (sh === S_THREE_O) threes++;
        }
        if (fours >= 2) s += 100000;
        else if (fours && threes) s += 50000;
        else if (threes >= 2) s += 20000;
        this.ps[c][q] = s;
      }
    }
    touch(p) {
      for (let d = 0; d < 4; d++) {
        const base = (p * 4 + d) * 11;
        for (let k = -4; k <= 4; k++) { const q = LINE[base + k + 5]; if (q >= 0) this.refresh(q); }
      }
    }
    play(p) {
      const c = this.turn;
      this.b[p] = c; this.moves.push(p);
      this.zh ^= ZH[c][p]; this.zl ^= ZL[c][p];
      const x = p % N, y = (p / N) | 0;
      for (let j = Math.max(0, y - 2); j <= Math.min(N - 1, y + 2); j++) for (let i = Math.max(0, x - 2); i <= Math.min(N - 1, x + 2); i++) this.near[j * N + i]++;
      this.touch(p);
    }
    undo() {
      const p = this.moves.pop(), c = this.b[p];
      this.b[p] = EMPTY;
      this.zh ^= ZH[c][p]; this.zl ^= ZL[c][p];
      const x = p % N, y = (p / N) | 0;
      for (let j = Math.max(0, y - 2); j <= Math.min(N - 1, y + 2); j++) for (let i = Math.max(0, x - 2); i <= Math.min(N - 1, x + 2); i++) this.near[j * N + i]--;
      this.touch(p);
    }
    legal(p, c) { return this.b[p] === EMPTY && (c !== BLACK || !this.forbidden(p)); }
    // 금수 판정은 비싸므로, 33·44·장목이 될 가능성이 있을 때만 정밀 판정한다
    forbidden(p) {
      if (this.b[p] !== EMPTY) return false;
      // 한 줄 안의 44(X_XXX_X)는 표에서 열린4로 분류되므로, 열린4 모양이 있으면 정밀 판정한다
      let threats = 0, open4 = false;
      for (let d = 0; d < 4; d++) { const s = this.sh[BLACK][p * 4 + d]; if (s >= S_THREE_O && s !== S_FIVE) threats++; if (s === S_FOUR_O) open4 = true; }
      if (threats < 2 && !open4) {
        let maybeOver = false;
        for (let d = 0; d < 4; d++) if (runLen(this.b, p, d, BLACK) >= 6) maybeOver = true;
        if (!maybeOver) return false;
      }
      return isForbidden(this.b, p);
    }
    // c 가 두면 5목이 되는 점들 (정확 판정)
    fivePoints(c) {
      const out = [];
      for (let q = 0; q < NN; q++) {
        if (this.b[q] !== EMPTY || !this.near[q]) continue;
        let hit = false;
        for (let d = 0; d < 4; d++) if (this.sh[c][q * 4 + d] === S_FIVE) { hit = true; break; }
        if (hit && makesFive(this.b, q, c)) out.push(q);
      }
      return out;
    }
    isWin(p) { return makesFive(this.b, p, this.b[p]); }
  }
  // 조브리스트 해시 (전치표 키)
  const ZH = [null, new Int32Array(NN), new Int32Array(NN)], ZL = [null, new Int32Array(NN), new Int32Array(NN)];
  { let s = 0x9e3779b9 | 0; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; }; for (const c of [1, 2]) for (let p = 0; p < NN; p++) { ZH[c][p] = rnd(); ZL[c][p] = rnd(); } }

  // ================= 수 생성 =================
  function candidates(g, c, limit) {
    const opp = 3 - c;
    // 1) 내가 바로 이기는 수
    const myFive = g.fivePoints(c).filter(q => g.legal(q, c));
    if (myFive.length) return [myFive[0]];
    // 2) 상대가 다음에 이기는 자리 막기 (흑이 막을 자리가 금수면 둘 수 없다)
    const oppFive = g.fivePoints(opp);
    if (oppFive.length) return oppFive.filter(q => g.legal(q, c)).slice(0, 1);
    const list = [];
    let oppOpenThreat = false;
    for (let q = 0; q < NN; q++) {
      if (g.b[q] !== EMPTY || !g.near[q]) continue;
      const a = g.ps[c][q], dfn = g.ps[opp][q];
      if (dfn >= W[S_FOUR_O]) oppOpenThreat = true;
      let myFour = false;
      for (let d = 0; d < 4; d++) { const s = g.sh[c][q * 4 + d]; if (s >= S_FOUR) { myFour = true; break; } }
      list.push([q, a + dfn * 0.85, myFour, dfn]);
    }
    let pool = list;
    // 3) 상대가 열린 4를 만들 수 있으면(열린 3), 막는 수와 내 4만 본다
    if (oppOpenThreat) pool = list.filter(e => e[3] >= W[S_FOUR] || e[2]);
    pool.sort((x, y) => y[1] - x[1]);
    const out = [];
    for (const e of pool) { if (g.legal(e[0], c)) out.push(e[0]); if (out.length >= limit) break; }
    if (!out.length) for (const e of list) if (g.legal(e[0], c)) { out.push(e[0]); break; }
    return out;
  }

  // ================= VCF (연속 4로 이기기) =================
  function vcf(g, c, depth, deadline) {
    if (depth <= 0 || Date.now() > deadline) return 0;
    const opp = 3 - c;
    const oppFive = g.fivePoints(opp);
    for (let q = 0; q < NN; q++) {
      if (g.b[q] !== EMPTY || !g.near[q]) continue;
      let four = false;
      for (let d = 0; d < 4; d++) { const s = g.sh[c][q * 4 + d]; if (s === S_FOUR || s === S_FOUR_O || s === S_FIVE) { four = true; break; } }
      if (!four) continue;
      if (oppFive.length && !oppFive.includes(q)) continue; // 상대 4가 있으면 그걸 막는 수여야 한다
      if (!g.legal(q, c)) continue;
      g.play(q);
      if (g.isWin(q)) { g.undo(); return q + 1; }
      const blocks = g.fivePoints(c);
      let win = 0;
      if (blocks.length >= 2) win = q + 1;                       // 막을 곳이 둘 → 승리
      else if (blocks.length === 1) {
        const bq = blocks[0];
        if (!g.legal(bq, opp)) win = q + 1;                        // 흑이 막을 자리가 금수 → 승리
        else {
          g.play(bq);
          if (!g.isWin(bq) && vcf(g, c, depth - 1, deadline)) win = q + 1;
          g.undo();
        }
      }
      g.undo();
      if (win) return win;
    }
    return 0;
  }

  // ================= 알파베타 =================
  const WIN = 1e9;
  function evaluate(g, c) {
    let a = 0, b = 0;
    const opp = 3 - c;
    for (let q = 0; q < NN; q++) { if (g.b[q] !== EMPTY || !g.near[q]) continue; a += g.ps[c][q]; b += g.ps[opp][q]; }
    return a - b * 1.1;
  }
  function search(g, depth, alpha, beta, ply, ctx) {
    if (Date.now() > ctx.deadline) { ctx.stop = true; return 0; }
    ctx.nodes++;
    const c = g.turn;
    if (depth <= 0) return evaluate(g, c);
    const key = (g.zh >>> 0) + ':' + g.zl;
    const tt = ctx.tt.get(key);
    let first = -1;
    if (tt) { if (tt.depth >= depth) { if (tt.flag === 0) return tt.v; if (tt.flag === 1 && tt.v >= beta) return tt.v; if (tt.flag === -1 && tt.v <= alpha) return tt.v; } first = tt.move; }
    let moves = candidates(g, c, ply === 0 ? ctx.rootWidth : ctx.width);
    if (!moves.length) return -WIN + ply; // 둘 곳이 없거나(막을 자리가 금수) 막을 수 없다
    if (first >= 0) { const i = moves.indexOf(first); if (i > 0) { moves.splice(i, 1); moves.unshift(first); } }
    let best = -Infinity, bestMove = moves[0];
    const a0 = alpha;
    for (const m of moves) {
      g.play(m);
      let v;
      if (g.isWin(m)) v = WIN - ply;
      else v = -search(g, depth - 1, -beta, -alpha, ply + 1, ctx);
      g.undo();
      if (ctx.stop) return 0;
      if (v > best) { best = v; bestMove = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    ctx.tt.set(key, { depth, v: best, flag: best <= a0 ? -1 : best >= beta ? 1 : 0, move: bestMove });
    if (ply === 0) ctx.best = bestMove;
    return best;
  }

  // ================= 착수 고르기 =================
  // 단계: 0 입문 ~ 4 최강
  const LEVELS = [
    { name: '입문', noSearch: true, temp: 1.2, blockFive: 0.8, blockThree: 0.3 },
    { name: '초보', noSearch: true, temp: 0.7, blockFive: 0.9, blockThree: 0.5 },
    { name: '초급', noSearch: true, temp: 0.35, blockFive: 1, blockThree: 0.7 },
    { name: '중급', depth: 2, vcf: 6, time: 600, width: 10 },
    { name: '고급', depth: 4, vcf: 10, time: 1500, width: 10 },
    { name: '최강', depth: 10, vcf: 16, time: 3500, width: 12 },
  ];
  const CENTER = 7 * N + 7;
  function chooseMove(moves, level) {
    const g = Game.from(moves), c = g.turn, opp = 3 - c, L = LEVELS[level];
    if (!moves.length) return { move: CENTER };
    const t0 = Date.now();
    // 1) 바로 이기는 수
    const myFive = g.fivePoints(c).filter(q => g.legal(q, c));
    if (myFive.length) return { move: myFive[0], note: 'win' };
    // 2) 상대 5목 막기
    const oppFive = g.fivePoints(opp);
    if (oppFive.length && (L.blockFive === undefined || Math.random() < L.blockFive)) {
      const b = oppFive.filter(q => g.legal(q, c));
      if (b.length) return { move: b[0], note: 'block' };
    }
    if (L.noSearch) {
      // 약한 단계: 점수 높은 후보 중에서 무작위 (열린 3을 가끔 못 본다)
      let cand = [];
      for (let q = 0; q < NN; q++) {
        if (g.b[q] !== EMPTY || !g.near[q]) continue;
        let dfn = g.ps[opp][q];
        if (dfn >= W[S_FOUR_O] && Math.random() > L.blockThree) dfn *= 0.05;
        cand.push([q, g.ps[c][q] + dfn * 0.85]);
      }
      cand.sort((x, y) => y[1] - x[1]);
      cand = cand.filter(e => g.legal(e[0], c)).slice(0, 8);
      if (!cand.length) return { move: -1 };
      const top = cand[0][1] || 1;
      const ws = cand.map(e => Math.exp((e[1] / top - 1) / (L.temp * 0.25)));
      let r = Math.random() * ws.reduce((s, x) => s + x, 0);
      for (let i = 0; i < cand.length; i++) { r -= ws[i]; if (r <= 0) return { move: cand[i][0] }; }
      return { move: cand[0][0] };
    }
    const deadline = t0 + L.time;
    // 초반 몇 수는 비슷하게 좋은 수 중에서 무작위로 골라 매 판 같은 수순이 되지 않게 한다
    if (moves.length < 4) {
      const cand = candidates(g, c, 6);
      const top = Math.max(1, g.ps[c][cand[0]] + g.ps[opp][cand[0]] * 0.85);
      const pool = cand.filter(q => g.ps[c][q] + g.ps[opp][q] * 0.85 >= top * 0.7).slice(0, 3);
      if (pool.length) return { move: pool[(Math.random() * pool.length) | 0], note: 'opening' };
    }
    // 3) 연속 4로 이길 수 있으면 그대로
    const win = vcf(g, c, L.vcf, t0 + L.time * 0.3);
    if (win) return { move: win - 1, note: 'vcf' };
    // 4) 반복 심화 알파베타
    const ctx = { deadline, stop: false, nodes: 0, tt: new Map(), width: L.width, rootWidth: L.width + 6, best: -1 };
    let best = candidates(g, c, 1)[0], bestV = 0, reached = 0;
    for (let d = 2; d <= L.depth; d += 2) {
      ctx.best = -1;
      const v = search(g, d, -Infinity, Infinity, 0, ctx);
      if (ctx.stop) break;
      if (ctx.best >= 0) { best = ctx.best; bestV = v; reached = d; }
      if (Math.abs(v) > WIN / 2) break;
    }
    return { move: best === undefined ? -1 : best, value: bestV, depth: reached, nodes: ctx.nodes, ms: Date.now() - t0 };
  }

  // 흑 금수 자리 전체 (화면 표시용)
  function forbiddenPoints(moves) {
    const g = Game.from(moves), out = [];
    if (g.turn !== BLACK) return out;
    for (let q = 0; q < NN; q++) if (g.b[q] === EMPTY && g.near[q] && g.forbidden(q)) out.push(q);
    return out;
  }
  // 5목을 이룬 돌들 (승리선 표시용)
  function winLine(b, p) {
    const c = b[p];
    for (let d = 0; d < 4; d++) {
      const len = runLen(b, p, d, c);
      if (!fiveLen(c, len)) continue;
      const base = (p * 4 + d) * 11, line = [p];
      for (let k = 1; k <= 5 && at(b, base, k) === c; k++) line.push(LINE[base + k + 5]);
      for (let k = -1; k >= -5 && at(b, base, k) === c; k--) line.push(LINE[base + k + 5]);
      return line;
    }
    return null;
  }

  return { N, NN, EMPTY, BLACK, WHITE, CENTER, LEVELS, Game, isForbidden, makesFive, foursDir, chooseMove, forbiddenPoints, winLine, vcf };
})();

// Web Worker 로 쓰일 때: {id, moves, level} → {id, move, ...}
if (typeof window === 'undefined' && typeof self !== 'undefined') {
  self.onmessage = e => { const { id, moves, level } = e.data; self.postMessage(Object.assign({ id }, RJ.chooseMove(moves, level))); };
}
if (typeof module !== 'undefined') module.exports = RJ;
