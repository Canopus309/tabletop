/* 증강 바둑 AI 의 장면 (St): 탐색 나무의 한 마디 = 한 '단계'. 앱 AI (go/aug/ai.js) 와 학습 도구 (tools/augnet) 가 같이 쓴다.
 * 한 차례를 단계로 나눈다
 *   decide  착수·패스, 또는 증강 쓰기 (무적수·결계·저격은 대상 칸, 슈퍼선수는 '지금 쓰기')
 *   move    무적수·결계·저격을 쓴 뒤 그 차례의 착수 (패스 가능). 저격은 2026-10-13 부터 '들어내고 착수'
 *   first / second  슈퍼선수의 첫 수 · 둘째 수 (패스 없음)
 *   swap2   맞바꾸기: 내 돌을 고른 뒤 바꿀 상대 돌 고르기 (대상 칸). 바꾸면 차례가 넘어감
 * 벽 · 포로교환 · 패왕은 늘 켜진 증강 (쓰기 행동 없음)
 * 행동 번호: 0..area-1 = 착수(칸 y*n+x), area = 패스, area+1+t = 대상 칸 t, 2*area+1 = 지금 쓰기
 * 되감기는 실제 대국의 뿌리에서만 고려한다 (탐색 나무 안에서는 다루지 않음, selfplay.js)
 * board.js · augboard.js · ../katago.js 다음에 불러온다. 전역 AugState 를 만든다.
 */
'use strict';
const AugState = (() => {
  const { encode } = Kata._internal;
  const AUG_LIST = ['kowang', 'rewind', 'snipe', 'double', 'invincible', 'barrier', 'wall', 'swap', 'prisoner'];
  const PASSIVE = { kowang: 1, wall: 1, prisoner: 1 };
  // 입력: KataGo 22면 + 증강 7면 (내/상대 무적 · 내/상대 결계 · 단계 둘 · 맞바꾸기로 고른 내 돌)
  //       KataGo 전역 19 + 증강 22 (내 증강 9 · 남음 · 상대 증강 9 · 남음 · 내/상대 포로교환 따낸 수×0.05)  — model.py 와 같게
  const NF = 22, NG = 19, NF2 = 29, NG2 = 41, K = AUG_LIST.length;

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
      this.swapA = 0;
      if (this.aug[1] === 'kowang' && this.aug[2] !== 'kowang') this.b.kw = 1; else if (this.aug[2] === 'kowang' && this.aug[1] !== 'kowang') this.b.kw = 2;
      this.used = { 1: false, 2: false }; this.step = 'decide';
      this.node = { board: this.b, move: -1, parent: null, lad: null }; // katago.js encode 가 쓰는 수순 정보
      this.len = 0;
    }
    clone() {
      const s = Object.create(St.prototype);
      s.n = this.n; s.area = this.area; s.komi = this.komi; s.aug = this.aug;
      s.b = new AugBoard(this.n); s.b.copyFrom(this.b);
      s.used = { 1: this.used[1], 2: this.used[2] }; s.step = this.step; s.node = this.node; s.len = this.len; s.swapA = this.swapA;
      return s;
    }
    get col() { return this.b.turn; }
    pt(i) { const n = this.n; return (Math.floor(i / n) + 1) * (n + 2) + (i % n) + 1; }
    idx(p) { const W = this.n + 2; return ((p / W | 0) - 1) * this.n + (p % W - 1); }
    terminal() { return this.b.passes >= 2 || this.len >= this.area * 3; }
    // 흑 기준 점수 (모든 돌을 산 것으로 보는 Tromp-Taylor 계가: 끝까지 둔 판)
    score() { // 포로교환: 따낸 상대 돌 수를 더함
      let s = Kata.ttScore(this.b, this.komi);
      if (this.aug[1] === 'prisoner') s += this.b.caps[1];
      if (this.aug[2] === 'prisoner') s -= this.b.caps[2];
      return s;
    }
    canAug(col) { const a = this.aug[col]; return !!a && !PASSIVE[a] && a !== 'rewind' && !this.used[col]; }
    // 맞바꾸기: 내 돌 p 와 바꿀 수 있는 상대 돌이 하나라도 있나
    hasSwap(p) { const b = this.b; for (let i = 0; i < this.area; i++) { const q = this.pt(i); if (b.c[q] === 3 - b.turn && b.canSwap(p, q)) return true; } return false; }
    actions() {
      const b = this.b, col = b.turn, A = [], area = this.area;
      if (this.step === 'swap2') {
        for (let i = 0; i < area; i++) { const q = this.pt(i); if (b.c[q] === 3 - col && b.canSwap(this.swapA, q)) A.push(area + 1 + i); }
        if (!A.length) A.push(area);
        return A;
      }
      const noPass = this.step === 'first' || this.step === 'second';
      for (let i = 0; i < area; i++) { const p = this.pt(i); if (b.isLegal(p, col)) A.push(i); }
      if (!noPass) A.push(area);
      if (this.step === 'decide' && this.canAug(col)) {
        const a = this.aug[col];
        if (a === 'double') A.push(2 * area + 1);
        else for (let i = 0; i < area; i++) {
          const p = this.pt(i), v = b.c[p];
          if ((a === 'invincible' && v === col) || (a === 'barrier' && v === EMPTY) || (a === 'snipe' && v === 3 - col && !b.isInv(p)) || (a === 'swap' && v === col && !b.isInv(p) && this.hasSwap(p))) A.push(area + 1 + i);
        }
      }
      if (noPass && A.length === 0) A.push(area); // 둘 곳이 없으면 패스 (드묾)
      return A;
    }
    // 행동 하나를 둔 새 상태
    apply(a) {
      const s = this.clone(), b = s.b, col = b.turn, area = this.area;
      s.len++;
      const prevNode = this.node;
      const moveNode = m => { s.node = { board: b, move: m, parent: prevNode, lad: null }; };
      const sameNode = () => { s.node = { board: b, move: prevNode.move, parent: prevNode.parent, lad: null }; };
      if (this.step === 'swap2') { // 맞바꾸기 둘째: 상대 돌 (또는 바꿀 것이 없으면 패스)
        if (a === area) { b.play(PASS); s.step = 'decide'; s.swapA = 0; moveNode(PASS); return s; }
        const q = this.pt(a - area - 1); b.swap(this.swapA, q); s.swapA = 0; s.step = 'decide'; moveNode(q); return s;
      }
      if (a < area || a === area) {
        const p = a === area ? PASS : this.pt(a);
        b.play(p);
        if (this.step === 'first') { b.again(); s.step = 'second'; }
        else s.step = 'decide';
        moveNode(p);
      } else if (a === 2 * area + 1) { // 슈퍼선수
        s.used[col] = true; s.step = 'first'; sameNode();
      } else {
        const q = this.pt(a - area - 1), au = this.aug[col];
        s.used[col] = true;
        if (au === 'invincible') { b.inv[col] = q; s.step = 'move'; sameNode(); }
        else if (au === 'barrier') { b.bar[col] = q; s.step = 'move'; sameNode(); }
        else if (au === 'swap') { s.swapA = q; s.step = 'swap2'; sameNode(); }
        else { b.pluck(q); s.step = 'move'; sameNode(); } // 저격: 들어내고 이어서 착수
      }
      return s;
    }
    // 신경망 입력 (대칭 sym). bin: [area*NF2], glob: [NG2]
    features(sym, bin, bo, glob, go) {
      const b = this.b, n = this.n, area = this.area, map = syms(n)[sym], col = b.turn;
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
      const f4 = this.step === 'move' || this.step === 'first', f5 = this.step === 'first' || this.step === 'second';
      if (f4 || f5) for (let i = 0; i < area; i++) { if (f4) bin[bo + i * NF2 + NF + 4] = 1; if (f5) bin[bo + i * NF2 + NF + 5] = 1; }
      if (this.step === 'swap2' && this.swapA) set(this.idx(this.swapA), 6);
      const ga = (c, off) => { const a = this.aug[c]; if (a) { glob[go + NG + off + AUG_LIST.indexOf(a)] = 1; if (PASSIVE[a] || !this.used[c]) glob[go + NG + off + K] = 1; } };
      ga(col, 0); ga(3 - col, K + 1);
      if (this.aug[col] === 'prisoner') glob[go + NG + 2 * K + 2] = b.caps[col] * 0.05;
      if (this.aug[3 - col] === 'prisoner') glob[go + NG + 2 * K + 3] = b.caps[3 - col] * 0.05;
    }
  }

  return { St, syms, AUG_LIST, PASSIVE, NF, NG, NF2, NG2 };
})();
