/* 증강 바둑 AI 의 장면 (St): 탐색 나무의 한 마디 = 한 '단계'. 앱 AI (go/aug/ai.js) 와 학습 도구 (tools/augnet) 가 같이 쓴다.
 * 한 차례를 단계로 나눈다
 *   decide  착수·패스, 또는 증강 쓰기 (대상 칸: 무적수·결계·저격·맞바꾸기·증식·순간이동·양자택일·예약수 / '지금 쓰기': 슈퍼선수·거울수·공수부대·패스 저축)
 *   move    무적수·결계·저격·예약수를 쓴 뒤 그 차례의 착수 (패스 가능)
 *   first / second  슈퍼선수의 첫 수 · 둘째 수 (패스 없음)
 *   swap2   맞바꾸기: 내 돌을 고른 뒤 바꿀 상대 돌 (대상 칸)
 *   tele2   순간이동: 내 돌을 고른 뒤 옮길 빈 점 (대상 칸)
 *   mirror  거울수의 착수 (대칭점에도 놓임, 패스 없음)
 *   para    공수부대의 착수 (자살수 자리도 됨, 패스 없음)
 *   chain   패스 저축을 쓴 연속 착수 (남은 수 chainLeft, 패스 없음)
 *   fork2   양자택일: 첫 예약점을 고른 뒤 둘째 예약점 (대상 칸). 예약하면 차례가 넘어감
 * 벽 · 포로교환 · 패왕은 늘 켜진 증강 (쓰기 행동 없음). 패스 저축은 decide 에서 그냥 패스할 때 1 저축
 * 행동 번호: 0..area-1 = 착수(칸 y*n+x), area = 패스, area+1+t = 대상 칸 t, 2*area+1 = 지금 쓰기
 * 되감기는 실제 대국의 뿌리에서만 고려한다 (탐색 나무 안에서는 다루지 않음, selfplay.js)
 * 한 차례가 끝날 때마다 AugBoard.turnEnd() (공수부대 기한)
 * board.js · augboard.js · ../katago.js 다음에 불러온다. 전역 AugState 를 만든다.
 */
'use strict';
const AugState = (() => {
  const { encode } = Kata._internal;
  // 증강 자리 (신경망 입력의 순서. 뒤에만 덧붙인다)
  const AUG_LIST = ['kowang', 'rewind', 'snipe', 'double', 'invincible', 'barrier', 'wall', 'swap', 'prisoner', 'mirror', 'grow', 'save', 'teleport', 'para', 'fork', 'shadow'];
  const PASSIVE = { kowang: 1, wall: 1, prisoner: 1 };
  // 입력 (2026-10-13 3판): 증강을 더 넣어도 신경망 크기가 그대로이도록 자리를 넉넉히
  //   칸 13면: 0 내 무적 · 1 상대 무적 · 2 내 결계 · 3 상대 결계 · 4 증강 착수 단계 · 5 이어지는 착수 (슈퍼선수 둘째 · 저축)
  //            6 고른 점 (맞바꾸기 · 순간이동의 내 돌, 양자택일 첫 예약점) · 7 내 공수부대 보호 · 8 상대 공수부대 보호
  //            9 내 예약점 · 10 상대 예약점 · 11~12 빈자리
  //   전역 52개: 0~19 내 증강 · 20 남음 · 21~40 상대 증강 · 41 남음 · 42/43 내/상대 포로교환 따낸 수×0.05
  //              44/45 내/상대 패스 저축×0.2 · 46 남은 연속 착수×0.2 · 47~51 빈자리     — model.py 와 같게
  const KMAX = 20, AUG_NF = 13, AUG_NG = 52;
  const NF = 22, NG = 19, NF2 = NF + AUG_NF, NG2 = NG + AUG_NG;
  const ACT = { double: 'first', mirror: 'mirror', para: 'para', save: 'chain' }; // '지금 쓰기' 다음 단계

  const SYMS = {};
  function syms(n) { // katago.js 와 같은 8 대칭
    if (SYMS[n]) return SYMS[n];
    const out = [];
    for (let s = 0; s < 8; s++) {
      const m = new Int16Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let a = x, b = y; if (s & 1) a = n - 1 - a; if (s & 2) b = n - 1 - b; if (s & 4) { const t = a; a = b; b = t; } m[y * n + x] = b * n + a; }
      out.push(m);
    }
    return (SYMS[n] = out);
  }

  class St {
    constructor(n, komi, aug) {
      this.n = n; this.area = n * n; this.komi = komi; this.aug = { 1: aug[1] || '', 2: aug[2] || '' };
      this.b = new AugBoard(n);
      for (const c of [1, 2]) if (this.aug[c] === 'wall') this.b.wall(c);
      if (this.aug[1] === 'kowang' && this.aug[2] !== 'kowang') this.b.kw = 1; else if (this.aug[2] === 'kowang' && this.aug[1] !== 'kowang') this.b.kw = 2;
      this.used = { 1: false, 2: false }; this.saves = { 1: 0, 2: 0 }; this.step = 'decide'; this.pickA = 0; this.chainLeft = 0;
      this.node = { board: this.b, move: -1, parent: null, lad: null }; // katago.js encode 가 쓰는 수순 정보
      this.len = 0;
    }
    clone() {
      const s = Object.create(St.prototype);
      s.n = this.n; s.area = this.area; s.komi = this.komi; s.aug = this.aug;
      s.b = new AugBoard(this.n); s.b.copyFrom(this.b);
      s.used = { 1: this.used[1], 2: this.used[2] }; s.saves = { 1: this.saves[1], 2: this.saves[2] };
      s.step = this.step; s.node = this.node; s.len = this.len; s.pickA = this.pickA; s.chainLeft = this.chainLeft;
      return s;
    }
    get col() { return this.b.turn; }
    pt(i) { const n = this.n; return (Math.floor(i / n) + 1) * (n + 2) + (i % n) + 1; }
    idx(p) { const W = this.n + 2; return ((p / W | 0) - 1) * this.n + (p % W - 1); }
    terminal() { return this.b.passes >= 2 || this.len >= this.area * 3; }
    // 흑 기준 점수 (모든 돌을 산 것으로 보는 Tromp-Taylor 계가: 끝까지 둔 판). 포로교환은 따낸 상대 돌 수를 더함
    score() {
      let s = Kata.ttScore(this.b, this.komi);
      if (this.aug[1] === 'prisoner') s += this.b.caps[1];
      if (this.aug[2] === 'prisoner') s -= this.b.caps[2];
      return s;
    }
    canAug(col) { const a = this.aug[col]; return !!a && !PASSIVE[a] && a !== 'rewind' && !this.used[col] && (a !== 'save' || this.saves[col] > 0); }
    // 맞바꾸기 · 순간이동: 내 돌 p 로 할 수 있는 것이 하나라도 있나
    hasSwap(p) { const b = this.b; for (let i = 0; i < this.area; i++) { const q = this.pt(i); if (b.c[q] === 3 - b.turn && b.canSwap(p, q)) return true; } return false; }
    hasTele(p) { const b = this.b; for (let i = 0; i < this.area; i++) { const q = this.pt(i); if (b.c[q] === EMPTY && b.canTeleport(p, q)) return true; } return false; }
    actions() {
      const b = this.b, col = b.turn, A = [], area = this.area, st = this.step;
      if (st === 'swap2' || st === 'tele2' || st === 'fork2') {
        for (let i = 0; i < area; i++) { const q = this.pt(i); if (st === 'swap2' ? b.c[q] === 3 - col && b.canSwap(this.pickA, q) : st === 'tele2' ? b.c[q] === EMPTY && b.canTeleport(this.pickA, q) : b.c[q] === EMPTY && q !== this.pickA && b.bar[3 - col] !== q) A.push(area + 1 + i); }
        if (!A.length) A.push(area);
        return A;
      }
      if (st === 'para') { // 자살수 자리도 됨
        for (let i = 0; i < area; i++) { const p = this.pt(i); if (b.c[p] === EMPTY && b.bar[3 - col] !== p) A.push(i); }
        if (!A.length) A.push(area);
        return A;
      }
      const noPass = st === 'first' || st === 'second' || st === 'mirror' || st === 'chain';
      for (let i = 0; i < area; i++) { const p = this.pt(i); if (b.isLegal(p, col)) A.push(i); }
      if (!noPass) A.push(area);
      if (st === 'decide' && this.canAug(col)) {
        const a = this.aug[col];
        if (ACT[a]) A.push(2 * area + 1);
        else for (let i = 0; i < area; i++) {
          const p = this.pt(i), v = b.c[p];
          if ((a === 'invincible' && v === col) || (a === 'barrier' && v === EMPTY) || (a === 'snipe' && v === 3 - col && !b.isInv(p))
            || (a === 'swap' && v === col && !b.isInv(p) && this.hasSwap(p)) || (a === 'grow' && v === col && b.canGrow(p))
            || (a === 'teleport' && v === col && this.hasTele(p)) || ((a === 'fork' || a === 'shadow') && v === EMPTY && b.bar[3 - col] !== p)) A.push(area + 1 + i);
        }
      }
      if (noPass && A.length === 0) A.push(area); // 둘 곳이 없으면 패스 (드묾)
      return A;
    }
    // 행동 하나를 둔 새 상태
    apply(a) {
      const s = this.clone(), b = s.b, col = b.turn, area = this.area, st = this.step;
      s.len++;
      const prevNode = this.node;
      const moveNode = m => { s.node = { board: b, move: m, parent: prevNode, lad: null }; };
      const sameNode = () => { s.node = { board: b, move: prevNode.move, parent: prevNode.parent, lad: null }; };
      const done = () => { s.step = 'decide'; s.pickA = 0; s.chainLeft = 0; b.turnEnd(); }; // 차례 끝
      if (st === 'swap2' || st === 'tele2' || st === 'fork2') { // 둘째 고르기 (고를 것이 없으면 패스)
        if (a === area) { b.play(PASS); done(); moveNode(PASS); return s; }
        const q = this.pt(a - area - 1);
        if (st === 'swap2') b.swap(this.pickA, q); else if (st === 'tele2') b.teleport(this.pickA, q); else b.reserve([this.pickA, q]);
        done(); moveNode(q); return s;
      }
      if (a === area && (st === 'first' || st === 'second' || st === 'chain' || st === 'mirror' || st === 'para')) { b.endTurn(); done(); moveNode(PASS); return s; } // 둘 곳이 없음 (드묾): 차례만 끝남
      if (a < area || a === area) {
        const p = a === area ? PASS : this.pt(a);
        if (st === 'mirror' && p) { b.mirror(p); done(); }
        else if (st === 'para' && p) { b.paraPlay(p); done(); }
        else if (st === 'first') { b.play(p); b.again(); s.step = 'second'; }
        else if (st === 'chain' && this.chainLeft > 1) { b.play(p); b.again(); s.chainLeft = this.chainLeft - 1; }
        else {
          if (st === 'decide' && !p && this.aug[col] === 'save' && !this.used[col]) s.saves[col]++; // 그냥 패스: 1 저축
          b.play(p); done();
        }
        moveNode(p);
      } else if (a === 2 * area + 1) { // 지금 쓰기
        const au = this.aug[col]; s.used[col] = true; s.step = ACT[au];
        if (au === 'save') { s.chainLeft = this.saves[col] + 1; s.saves[col] = 0; }
        sameNode();
      } else {
        const q = this.pt(a - area - 1), au = this.aug[col];
        s.used[col] = true;
        if (au === 'invincible') { b.inv[col] = q; s.step = 'move'; sameNode(); }
        else if (au === 'barrier') { b.bar[col] = q; s.step = 'move'; sameNode(); }
        else if (au === 'swap') { s.pickA = q; s.step = 'swap2'; sameNode(); }
        else if (au === 'teleport') { s.pickA = q; s.step = 'tele2'; sameNode(); }
        else if (au === 'grow') { b.grow(q); done(); moveNode(q); }
        else if (au === 'fork') { s.pickA = q; s.step = 'fork2'; sameNode(); }
        else if (au === 'shadow') { b.reserveOnly(q); s.step = 'move'; sameNode(); } // 예약수: 예약하고 이어서 착수
        else { b.pluck(q); s.step = 'move'; sameNode(); } // 저격: 들어내고 이어서 착수
      }
      return s;
    }
    // 신경망 입력 (대칭 sym). bin: [area*NF2], glob: [NG2]
    features(sym, bin, bo, glob, go) {
      const b = this.b, n = this.n, area = this.area, map = syms(n)[sym], col = b.turn, st = this.step;
      const tmp = new Float32Array(area * NF), tg = new Float32Array(NG);
      encode(this.node, this.komi, sym, tmp, 0, tg, 0);
      if (b.kw === col && b.ko) tmp[map[this.idx(b.ko)] * NF + 6] = 0; // 패왕: 패 금지가 없다
      for (let i = 0; i < area; i++) { bin.set(tmp.subarray(i * NF, i * NF + NF), bo + i * NF2); }
      glob.set(tg, go);
      const set = (i, f) => { bin[bo + map[i] * NF2 + NF + f] = 1; };
      for (const c of [col, 3 - col]) {
        const k = c === col ? 0 : 1, m = b.inv[c];
        if (m && b.c[m] === c) for (let i = 0; i < area; i++) { const p = this.pt(i); if (b.c[p] === c && b.isInv(p)) set(i, k); }
        if (b.bar[c]) set(this.idx(b.bar[c]), 2 + k);
      }
      const P = b.para; // 공수부대 보호 중인 무리
      if (P && b.turnNo <= P.prot && b.c[P.p] === P.col) for (let i = 0; i < area; i++) { const p = this.pt(i); if (b.c[p] === P.col && b.sameChain(p, P.p)) set(i, P.col === col ? 7 : 8); }
      const f4 = st === 'move' || st === 'first' || st === 'mirror' || st === 'para' || st === 'chain', f5 = st === 'first' || st === 'second' || st === 'chain';
      if (f4 || f5) for (let i = 0; i < area; i++) { if (f4) bin[bo + i * NF2 + NF + 4] = 1; if (f5) bin[bo + i * NF2 + NF + 5] = 1; }
      if ((st === 'swap2' || st === 'tele2' || st === 'fork2') && this.pickA) set(this.idx(this.pickA), 6);
      const R = b.resv; if (R) for (const p of R.pts) set(this.idx(p), R.col === col ? 9 : 10);
      const ga = (c, off) => { const a = this.aug[c]; if (a) { glob[go + NG + off + AUG_LIST.indexOf(a)] = 1; if (PASSIVE[a] || !this.used[c]) glob[go + NG + off + KMAX] = 1; } };
      ga(col, 0); ga(3 - col, KMAX + 1);
      const G0 = go + NG + 2 * KMAX + 2;
      if (this.aug[col] === 'prisoner') glob[G0] = b.caps[col] * 0.05;
      if (this.aug[3 - col] === 'prisoner') glob[G0 + 1] = b.caps[3 - col] * 0.05;
      glob[G0 + 2] = this.saves[col] * 0.2; glob[G0 + 3] = this.saves[3 - col] * 0.2;
      glob[G0 + 4] = this.chainLeft * 0.2;
    }
  }

  return { St, syms, AUG_LIST, PASSIVE, NF, NG, NF2, NG2, KMAX, AUG_NF, AUG_NG };
})();
