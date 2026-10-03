/* KataGo 신경망 엔진 (오프라인)
 * - 신경망: KataGo g170 b6c96 (MIT 라이선스, https://github.com/lightvector/KataGo)
 * - 추론: TensorFlow.js (WebGPU → WebGL → CPU 순으로 시도)
 * - 모델 파일 형식, 입력 특징(V7), 축(ladder) 판독은 KataGo의 desc.cpp / nninputs.cpp / board.cpp를 따름
 *   (브라우저 구현은 web-katrain(MIT)을 참고)
 * index.html의 Board / PASS / BLACK / WHITE / EMPTY 를 사용한다.
 */
'use strict';
const Kata = (() => {
  const NF = 22, NG = 19, BATCH = 8;
  let net = null, desc = null, backend = '', loading = null;

  // ================= 모델 파서 (KataGo .bin, 모델 버전 8~11) =================
  class Reader {
    constructor(u8) { this.d = u8; this.i = 0; this.td = new TextDecoder(); }
    ws() { const d = this.d; while (this.i < d.length) { const b = d[this.i]; if (b === 32 || b === 10 || b === 13 || b === 9) this.i++; else break; } }
    tok() {
      this.ws(); const d = this.d, s = this.i;
      while (this.i < d.length) { const b = d[this.i]; if (b === 32 || b === 10 || b === 13 || b === 9) break; this.i++; }
      if (this.i === s) throw new Error('모델 파일이 잘렸습니다');
      return this.td.decode(d.subarray(s, this.i));
    }
    int() { const t = this.tok(), v = parseInt(t, 10); if (!Number.isFinite(v)) throw new Error('잘못된 정수: ' + t); return v; }
    num() { const t = this.tok(), v = parseFloat(t); if (!Number.isFinite(v)) throw new Error('잘못된 실수: ' + t); return v; }
    floats(n) {
      this.ws(); const d = this.d, i = this.i;
      if (d[i] !== 64 || d[i + 1] !== 66 || d[i + 2] !== 73 || d[i + 3] !== 78 || d[i + 4] !== 64) throw new Error('@BIN@ 표식이 없습니다');
      const off = d.byteOffset + i + 5;
      const out = new Float32Array(d.buffer.slice(off, off + n * 4));
      this.i = i + 5 + n * 4; return out;
    }
  }
  function parseModel(u8) {
    const r = new Reader(u8);
    const m = { name: r.tok(), version: r.int(), nIn: r.int(), nGlob: r.int() };
    const v = m.version;
    if (v < 8 || v > 11) throw new Error('지원하지 않는 모델 버전: ' + v);
    if (m.nIn !== NF || m.nGlob !== NG) throw new Error('입력 채널 수가 다릅니다');
    const conv = () => { const name = r.tok(), ky = r.int(), kx = r.int(), ic = r.int(), oc = r.int(), dy = r.int(), dx = r.int(); return { name, ky, kx, ic, oc, dy, dx, w: r.floats(ky * kx * ic * oc) }; };
    const bn = () => {
      r.tok(); const c = r.int(), eps = r.num(), hasScale = r.int() !== 0, hasBias = r.int() !== 0;
      const mean = r.floats(c), vari = r.floats(c), sc = hasScale ? r.floats(c) : null, bi = hasBias ? r.floats(c) : null;
      const mul = new Float32Array(c), add = new Float32Array(c);
      for (let i = 0; i < c; i++) { const s = (sc ? sc[i] : 1) / Math.sqrt(vari[i] + eps); mul[i] = s; add[i] = (bi ? bi[i] : 0) - s * mean[i]; }
      return { c, mul, add };
    };
    const act = () => { r.tok(); if (v >= 11) { const k = r.tok(); return k === 'ACTIVATION_MISH' ? 'mish' : k === 'ACTIVATION_IDENTITY' ? 'id' : 'relu'; } return 'relu'; };
    const matmul = () => { r.tok(); const ic = r.int(), oc = r.int(); return { ic, oc, w: r.floats(ic * oc) }; };
    const bias = () => { r.tok(); const c = r.int(); return { c, w: r.floats(c) }; };
    // trunk
    r.tok(); const numBlocks = r.int(); m.C = r.int(); r.int(); r.int(); r.int(); r.int();
    m.conv1 = conv(); m.mat1 = matmul(); m.blocks = [];
    for (let i = 0; i < numBlocks; i++) {
      const kind = r.tok(); r.tok();
      if (kind === 'ordinary_block') m.blocks.push({ kind, preBN: bn(), preAct: act(), c1: conv(), midBN: bn(), midAct: act(), c2: conv() });
      else if (kind === 'gpool_block') m.blocks.push({ kind, preBN: bn(), preAct: act(), c1: conv(), gc: conv(), gBN: bn(), gAct: act(), gMul: matmul(), midBN: bn(), midAct: act(), c2: conv() });
      else throw new Error('지원하지 않는 블록: ' + kind);
    }
    m.tipBN = bn(); m.tipAct = act();
    // policy head
    r.tok(); m.p1 = conv(); m.g1 = conv(); m.g1BN = bn(); m.g1Act = act(); m.gToBias = matmul(); m.p1BN = bn(); m.p1Act = act(); m.p2 = conv(); m.gToPass = matmul();
    // value head
    r.tok(); m.v1 = conv(); m.v1BN = bn(); m.v1Act = act(); m.v2 = matmul(); m.v2b = bias(); m.v2Act = act();
    m.v3 = matmul(); m.v3b = bias(); m.sv3 = matmul(); m.sv3b = bias(); m.own = conv();
    return m;
  }

  // ================= TF.js 신경망 =================
  function buildNet(m) {
    const T = [];
    const keep = t => (T.push(t), t);
    // BN을 앞의 합성곱/행렬곱 출력 채널에 접어 넣는다: (x*w)*mul + add
    const scaleOut = (w, oc, mul) => { const o = new Float32Array(w.length); for (let i = 0; i < w.length; i++) o[i] = w[i] * mul[i % oc]; return o; };
    const t4 = (c, w) => keep(tf.tensor4d(w || c.w, [c.ky, c.kx, c.ic, c.oc]));
    const cw = c => ({ w: t4(c), dil: [c.dy, c.dx] });
    const bw = b => ({ mul: keep(tf.tensor1d(b.mul)), add: keep(tf.tensor1d(b.add)) });
    const mw = x => keep(tf.tensor2d(x.w, [x.ic, x.oc]));
    const cbn = (c, b, act) => ({ w: t4(c, scaleOut(c.w, c.oc, b.mul)), bias: keep(tf.tensor1d(b.add)), act, dil: [c.dy, c.dx] });
    const cgbn = (c, mm, b, act) => ({ w: t4(c, scaleOut(c.w, c.oc, b.mul)), mm: keep(tf.tensor2d(scaleOut(mm.w, mm.oc, b.mul), [mm.ic, mm.oc])), add: keep(tf.tensor1d(b.add)), act, dil: [c.dy, c.dx] });
    const W = {
      conv1: cw(m.conv1), mat1: mw(m.mat1),
      blocks: m.blocks.map(b => b.kind === 'ordinary_block'
        ? { g: false, preBN: bw(b.preBN), preAct: b.preAct, c1: cbn(b.c1, b.midBN, b.midAct), c2: cw(b.c2) }
        : { g: true, preBN: bw(b.preBN), preAct: b.preAct, gc: cbn(b.gc, b.gBN, b.gAct), c1: cgbn(b.c1, b.gMul, b.midBN, b.midAct), c2: cw(b.c2) }),
      tipBN: bw(m.tipBN), tipAct: m.tipAct,
      g1: cbn(m.g1, m.g1BN, m.g1Act), p1: cgbn(m.p1, m.gToBias, m.p1BN, m.p1Act), p2: cw(m.p2), gToPass: mw(m.gToPass),
      v1: cbn(m.v1, m.v1BN, m.v1Act), v2: mw(m.v2), v2b: keep(tf.tensor1d(m.v2b.w)), v2Act: m.v2Act,
      v3: mw(m.v3), v3b: keep(tf.tensor1d(m.v3b.w)), sv3: mw(m.sv3), sv3b: keep(tf.tensor1d(m.sv3b.w)), own: cw(m.own),
    };
    const actF = (x, a) => a === 'relu' ? tf.relu(x) : a === 'mish' ? tf.mul(x, tf.tanh(tf.softplus(x))) : x;
    const conv = (x, c) => tf.conv2d(x, c.w, 1, 'same', 'NHWC', c.dil);
    // 합성곱 + 편향 + ReLU 를 한 번에
    const fconv = (x, f) => {
      const y = tf.fused.conv2d({ x, filter: f.w, strides: 1, pad: 'same', dataFormat: 'NHWC', dilations: f.dil, bias: f.bias, activation: f.act === 'relu' ? 'relu' : 'linear' });
      return f.act === 'mish' ? actF(y, 'mish') : y;
    };
    const bnA = (x, b, a) => actF(tf.add(tf.mul(x, b.mul), b.add), a);
    function forward(bin, glob, n) {
      return tf.tidy(() => {
        const N = bin.shape[0], area = n * n, sq = Math.sqrt(area);
        const toBias = (v) => tf.reshape(v, [N, 1, 1, -1]);
        const gpool = x => { const mean = tf.mean(x, [1, 2]); return tf.concat([mean, tf.mul(mean, (sq - 14) * 0.1), tf.max(x, [1, 2])], 1); };
        const vpool = x => { const mean = tf.mean(x, [1, 2]); return tf.concat([mean, tf.mul(mean, (sq - 14) * 0.1), tf.mul(mean, (sq - 14) * (sq - 14) * 0.01 - 0.1)], 1); };
        // 합성곱 + (전역 풀링으로 만든 채널별 편향) + BN + 활성화
        const gconv = (x, f, gp) => actF(tf.add(conv(x, f), toBias(tf.add(tf.matMul(gp, f.mm), f.add))), f.act);
        let x = tf.add(conv(bin, W.conv1), toBias(tf.matMul(glob, W.mat1)));
        for (const b of W.blocks) {
          const a = bnA(x, b.preBN, b.preAct);
          const r = b.g ? gconv(a, b.c1, gpool(fconv(a, b.gc))) : fconv(a, b.c1);
          x = tf.add(x, conv(r, b.c2));
        }
        const trunk = bnA(x, W.tipBN, W.tipAct);
        // policy
        const gp = gpool(fconv(trunk, W.g1));
        const p2 = conv(gconv(trunk, W.p1, gp), W.p2); // [N,n,n,pc]
        const pol = tf.reshape(tf.slice(p2, [0, 0, 0, 0], [N, n, n, 1]), [N, area]);
        const pass = tf.slice(tf.matMul(gp, W.gToPass), [0, 0], [N, 1]);
        const policy = tf.concat([pol, pass], 1);
        // value
        const v1 = fconv(trunk, W.v1);
        const v2 = actF(tf.add(tf.matMul(vpool(v1), W.v2), W.v2b), W.v2Act);
        const value = tf.add(tf.matMul(v2, W.v3), W.v3b);
        const misc = tf.add(tf.matMul(v2, W.sv3), W.sv3b);
        const own = tf.tanh(tf.reshape(conv(v1, W.own), [N, area]));
        return [policy, value, misc, own];
      });
    }
    return { forward, dispose: () => T.forEach(t => t.dispose()) };
  }

  // ================= 대칭 (8가지) =================
  const SYMS = {};
  function syms(n) {
    if (SYMS[n]) return SYMS[n];
    const out = [];
    for (let s = 0; s < 8; s++) {
      const m = new Int16Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let a = x, b = y;
        if (s & 1) a = n - 1 - a;
        if (s & 2) b = n - 1 - b;
        if (s & 4) { const t = a; a = b; b = t; }
        m[y * n + x] = b * n + a;
      }
      out.push(m);
    }
    return (SYMS[n] = out);
  }
  const idxOf = (b, p) => ((p / b.W | 0) - 1) * b.n + (p % b.W - 1);

  // ================= 보드 분석 도우미 =================
  // 각 돌의 활로 수 (최대 4로 자름)
  function libCounts(b) {
    const c = b.c, d = b.d, out = new Uint8Array(b.size), seen = new Uint8Array(b.size), lm = new Int32Array(b.size);
    let stamp = 0; const st = [], grp = [];
    for (const p of b.pts) {
      const col = c[p]; if (col === EMPTY || seen[p]) continue;
      stamp++; st.length = 0; grp.length = 0; st.push(p); seen[p] = 1; let libs = 0;
      while (st.length) {
        const q = st.pop(); grp.push(q);
        for (let i = 0; i < 4; i++) {
          const r = q + d[i], v = c[r];
          if (v === EMPTY) { if (lm[r] !== stamp) { lm[r] = stamp; libs++; } }
          else if (v === col && !seen[r]) { seen[r] = 1; st.push(r); }
        }
      }
      const L = Math.min(libs, 4); for (const q of grp) out[q] = L;
    }
    return out;
  }
  // 트롬프-테일러 영역: 돌 + 한 색에만 닿은 빈 영역
  function ttArea(b) {
    const c = b.c, d = b.d, out = new Uint8Array(b.size), seen = new Uint8Array(b.size), reg = [];
    for (const p of b.pts) {
      const v = c[p];
      if (v !== EMPTY) { out[p] = v; continue; }
      if (seen[p]) continue;
      reg.length = 0; const st = [p]; seen[p] = 1; let nb = 0, nw = 0;
      while (st.length) {
        const q = st.pop(); reg.push(q);
        for (let i = 0; i < 4; i++) {
          const r = q + d[i], u = c[r];
          if (u === EMPTY) { if (!seen[r]) { seen[r] = 1; st.push(r); } }
          else if (u === BLACK) nb = 1; else if (u === WHITE) nw = 1;
        }
      }
      const own = nb && !nw ? BLACK : nw && !nb ? WHITE : 0;
      if (own) for (const q of reg) out[q] = own;
    }
    return out;
  }
  function ttScore(b, komi) { const a = ttArea(b); let s = 0; for (const p of b.pts) s += a[p] === BLACK ? 1 : a[p] === WHITE ? -1 : 0; return s - komi; }

  // ---------- 축(ladder) 판독: KataGo board.cpp의 searchIsLadderCaptured를 단순화 ----------
  const LADDER_BUDGET = 3000, POOLS = {};
  function chainLibs(b, p, max) { // 그룹의 활로 목록 (최대 max개)
    const c = b.c, d = b.d, col = c[p], seen = new Set([p]), st = [p], libs = [];
    while (st.length) {
      const q = st.pop();
      for (let i = 0; i < 4; i++) {
        const r = q + d[i], v = c[r];
        if (v === EMPTY) { if (!libs.includes(r)) { libs.push(r); if (libs.length >= max) return libs; } }
        else if (v === col && !seen.has(r)) { seen.add(r); st.push(r); }
      }
    }
    return libs;
  }
  function libGainingCaptures(b, p) { // 수비 그룹에 붙은 공격측 단수 돌을 따내는 자리
    const c = b.c, d = b.d, col = c[p], opp = 3 - col, seen = new Set([p]), st = [p], out = [];
    while (st.length) {
      const q = st.pop();
      for (let i = 0; i < 4; i++) {
        const r = q + d[i], v = c[r];
        if (v === col && !seen.has(r)) { seen.add(r); st.push(r); }
        else if (v === opp) { const l = chainLibs(b, r, 2); if (l.length === 1 && !out.includes(l[0])) out.push(l[0]); }
      }
    }
    return out;
  }
  function emptyNbrs(b, p) { let k = 0; for (let i = 0; i < 4; i++) if (b.c[p + b.d[i]] === EMPTY) k++; return k; }
  function ladderCaptured(b0, p) { // 수비측이 먼저 두는 1활로 그룹이 축으로 잡히는가
    const def = b0.c[p], att = 3 - def, pool = POOLS[b0.n] || (POOLS[b0.n] = []);
    let nodes = 0, aborted = false;
    const maxDepth = b0.n * b0.n * 3 / 2 + 1;
    const next = (b, depth) => { const nb = pool[depth] || (pool[depth] = new Board(b.n)); nb.copyFrom(b); return nb; };
    const root = next(b0, 0); root.ko = 0; // 루트에서는 패를 수비측에 유리하게 본다
    function rec(b, isDef, depth) {
      if (aborted) return false;
      if (++nodes > LADDER_BUDGET) { aborted = true; return false; }
      if (depth >= maxDepth) return true;
      const libs = chainLibs(b, p, 3), L = libs.length;
      if (!isDef && L <= 1) return true;
      if (!isDef && L >= 3) return false;
      if (isDef && L >= 2) return false;
      if (isDef && b.ko !== 0) return false;
      if (isDef) {
        const moves = libGainingCaptures(b, p); if (!moves.includes(libs[0])) moves.push(libs[0]);
        for (const m of moves) {
          if (!b.isLegal(m, def)) continue;
          const nb = next(b, depth + 1); nb.turn = def; nb.play(m);
          if (!rec(nb, false, depth + 1)) return false;
        }
        return true;
      }
      let [m0, m1] = libs;
      const l0 = emptyNbrs(b, m0), l1 = emptyNbrs(b, m1);
      let moves = [m0, m1];
      const adj = b.d.some(dd => m0 + dd === m1);
      if (!adj) { if (l0 >= 3 && l1 >= 3) return false; else if (l0 >= 3) moves = [m0]; else if (l1 >= 3) moves = [m1]; }
      else if (l1 > l0) moves = [m1, m0];
      for (const m of moves) {
        if (!b.isLegal(m, att)) continue;
        const nb = next(b, depth + 1); nb.turn = att; nb.play(m);
        if (rec(nb, true, depth + 1)) return true;
      }
      return false;
    }
    const res = rec(root, true, 0);
    return aborted ? false : res;
  }
  // 축에 걸린 돌과, (상대 2활로 그룹을) 축으로 잡는 수 목록
  function ladders(b) {
    const stones = [], work = [], lib = libCounts(b), done = new Map(), c = b.c, pla = b.turn;
    const head = new Int32Array(b.size); // 그룹 대표점
    for (const p of b.pts) {
      if (c[p] === EMPTY || head[p]) continue;
      const st = [p]; head[p] = p;
      while (st.length) { const q = st.pop(); for (let i = 0; i < 4; i++) { const r = q + b.d[i]; if (c[r] === c[p] && !head[r]) { head[r] = p; st.push(r); } } }
    }
    for (const p of b.pts) {
      const col = c[p]; if (col === EMPTY) continue;
      const L = lib[p]; if (L !== 1 && L !== 2) continue;
      const h = head[p];
      if (!done.has(h)) {
        let lad = false;
        if (L === 1) lad = ladderCaptured(b, p);
        else {
          const libs = chainLibs(b, p, 2), att = 3 - col, wm = [];
          for (const m of libs) {
            if (!b.isLegal(m, att)) continue;
            const nb = new Board(b.n); nb.copyFrom(b); nb.turn = att; nb.play(m);
            if (ladderCaptured(nb, p)) wm.push(m);
          }
          lad = wm.length > 0;
          if (lad && col === 3 - pla) work.push(...wm);
        }
        done.set(h, lad);
      }
      if (done.get(h)) stones.push(p);
    }
    return { stones, work };
  }

  // ================= 탐색 노드 =================
  class KNode {
    constructor(parent, move, board) {
      this.parent = parent; this.move = move; this.board = board; this.pla = board.turn;
      this.n = 0; this.vl = 0; this.u = 0; this.wl = 0; this.lead = 0;
      this.expanded = false; this.pending = false; this.terminal = board.passes >= 2;
      this.moves = null; this.priors = null; this.kids = null; this.lad = null;
    }
  }
  const ladderOf = nd => nd.lad || (nd.lad = ladders(nd.board));

  // 게임 상태 → 루트 노드 (조상 노드에 최근 수순을 담는다)
  function rootFromState(st) {
    const b = new Board(st.n);
    for (const p of st.setup) b.place(p, BLACK);
    if (st.setup.length) b.turn = WHITE;
    const keepFrom = Math.max(0, st.moves.length - 6);
    let node = null;
    for (let i = 0; i <= st.moves.length; i++) {
      if (i > 0) b.play(st.moves[i - 1]);
      if (i >= keepFrom) { const cb = new Board(st.n); cb.copyFrom(b); node = new KNode(node, i > 0 ? st.moves[i - 1] : -1, cb); }
    }
    node.isRoot = true;
    return node;
  }

  // ================= 입력 특징 (KataGo V7) =================
  function encode(node, komi, sym, bin, bo, glob, go) {
    const b = node.board, n = b.n, area = n * n, map = syms(n)[sym], pla = b.turn, opp = 3 - pla, c = b.c;
    const set = (p, f) => { bin[bo + map[idxOf(b, p)] * NF + f] = 1; };
    for (let i = 0; i < area; i++) bin[bo + i * NF] = 1;
    const lib = libCounts(b);
    for (const p of b.pts) {
      const v = c[p]; if (v === EMPTY) continue;
      set(p, v === pla ? 1 : 2);
      const L = lib[p]; if (L >= 1 && L <= 3) set(p, 2 + L);
    }
    if (b.ko) set(b.ko, 6);
    // 이전 5수
    let nd = node, k = 0;
    while (k < 5 && nd && nd.move !== -1 && nd.move !== undefined) {
      if (nd.move === PASS) glob[go + k] = 1; else set(nd.move, 9 + k);
      k++; nd = nd.parent;
    }
    // 축
    const L0 = ladderOf(node);
    for (const p of L0.stones) set(p, 14);
    for (const p of L0.work) set(p, 17);
    const n1 = k >= 1 ? node.parent : node, n2 = k >= 2 ? n1.parent : n1;
    for (const p of ladderOf(n1).stones) set(p, 15);
    for (const p of ladderOf(n2).stones) set(p, 16);
    // 영역 (덤 없는 집 계산)
    const ar = ttArea(b);
    for (const p of b.pts) { if (ar[p] === pla) set(p, 18); else if (ar[p] === opp) set(p, 19); }
    // 전역 특징: 덤, 규칙(단순 패 · 자살 금지 · 계가(area) · 세금 없음), 패스 시 종국 여부, 덤 패리티
    let selfKomi = pla === WHITE ? komi : -komi;
    selfKomi = Math.max(-area - 20, Math.min(area + 20, selfKomi));
    glob[go + 5] = selfKomi / 20;
    glob[go + 14] = b.last === PASS ? 1 : 0;
    const even = area % 2 === 0;
    const floor = even ? Math.floor(selfKomi / 2) * 2 : Math.floor((selfKomi - 1) / 2) * 2 + 1;
    const delta = Math.max(0, Math.min(2, selfKomi - floor));
    glob[go + 18] = delta < 0.5 ? delta : delta < 1.5 ? 1 - delta : delta - 2;
  }

  // ================= 신경망 평가 (배치) =================
  const SCORE_W = 0.15;
  const utilOf = (wl, lead, n) => wl + SCORE_W * (2 / Math.PI) * Math.atan(lead / (0.5 * n));
  async function evalNodes(nodes, komi, opt = {}) {
    const n = nodes[0].board.n, area = n * n;
    // GPU는 배치 크기를 고정해 셰이더 재컴파일을 막고, CPU는 실제 국면 수만 계산한다
    const B = backend === 'cpu' || backend === 'wasm' ? nodes.length : Math.max(opt.batch || BATCH, nodes.length);
    const bin = new Float32Array(B * area * NF), glob = new Float32Array(B * NG);
    const symList = nodes.map((_, i) => opt.syms ? opt.syms[i] : (Math.random() * 8) | 0);
    nodes.forEach((nd, i) => encode(nd, komi, symList[i], bin, i * area * NF, glob, i * NG));
    const tb = tf.tensor4d(bin, [B, n, n, NF]), tg = tf.tensor2d(glob, [B, NG]);
    const outs = net.forward(tb, tg, n);
    tb.dispose(); tg.dispose();
    const [pol, val, misc, own] = await Promise.all(outs.map(t => t.data()));
    outs.forEach(t => t.dispose());
    const sc = misc.length / B;
    return nodes.map((nd, i) => {
      const map = syms(n)[symList[i]], b = nd.board;
      const v0 = val[i * 3], v1 = val[i * 3 + 1], v2 = val[i * 3 + 2], mx = Math.max(v0, v1, v2);
      const e0 = Math.exp(v0 - mx), e1 = Math.exp(v1 - mx), e2 = Math.exp(v2 - mx), es = e0 + e1 + e2;
      const win = e0 / es, loss = e1 / es;
      const r = { win, loss, wl: win - loss, lead: misc[i * sc + 2] * 20, score: misc[i * sc] * 20, pol: null, own: null };
      // 정책: 합법 수에 대해서만 소프트맥스
      const P = pol.subarray(i * (area + 1), (i + 1) * (area + 1)), mv = [], lg = [];
      for (const p of b.pts) if (b.isLegal(p, b.turn)) { mv.push(p); lg.push(P[map[idxOf(b, p)]]); }
      mv.push(PASS); lg.push(P[area]);
      let m2 = -Infinity; for (const x of lg) if (x > m2) m2 = x;
      let s = 0; const pr = new Float32Array(lg.length);
      for (let j = 0; j < lg.length; j++) { pr[j] = Math.exp(lg[j] - m2); s += pr[j]; }
      for (let j = 0; j < pr.length; j++) pr[j] /= s;
      r.moves = mv; r.priors = pr;
      if (opt.own) {
        const O = own.subarray(i * area, (i + 1) * area), o = new Float32Array(b.size), sign = b.turn === BLACK ? 1 : -1;
        for (const p of b.pts) o[p] = sign * O[map[idxOf(b, p)]];
        r.own = o;
      }
      return r;
    });
  }
  function applyEval(nd, r) {
    nd.moves = r.moves; nd.priors = r.priors; nd.kids = new Array(r.moves.length);
    nd.nnWl = r.wl; nd.nnLead = r.lead; nd.nnU = utilOf(r.wl, r.lead, nd.board.n); nd.expanded = true;
  }

  // ================= MCTS (PUCT) =================
  const CPUCT = 1.1, FPU_RED = 0.2;
  function selectChild(nd) {
    const N = nd.n + nd.vl, sq = Math.sqrt(Math.max(1, N));
    let visitedP = 0;
    for (let i = 0; i < nd.kids.length; i++) { const k = nd.kids[i]; if (k && k.n + k.vl > 0) visitedP += nd.priors[i]; }
    const parentQ = nd.isRoot || nd.n === 0 ? nd.nnU : -nd.u / nd.n;
    const fpu = parentQ - FPU_RED * Math.sqrt(visitedP);
    let best = 0, bv = -Infinity;
    for (let i = 0; i < nd.kids.length; i++) {
      const k = nd.kids[i], kn = k ? k.n + k.vl : 0;
      const q = kn > 0 ? (k.u - k.vl) / kn : fpu;
      const v = q + CPUCT * nd.priors[i] * sq / (1 + kn);
      if (v > bv) { bv = v; best = i; }
    }
    return best;
  }
  function child(nd, i) {
    let k = nd.kids[i];
    if (!k) { const b = new Board(nd.board.n); b.copyFrom(nd.board); b.play(nd.moves[i]); k = nd.kids[i] = new KNode(nd, nd.moves[i], b); }
    return k;
  }
  // leaf 관점의 효용(u)/승패(wl)/집(lead)을 경로를 따라 반영
  function backup(path, leafPla, u, wl, lead) {
    for (let j = path.length - 1; j >= 0; j--) {
      const nd = path[j], s = nd.pla === leafPla ? -1 : 1; // 노드 값은 '그 노드로 둔 사람' 관점
      nd.n++; nd.u += s * u; nd.wl += s * wl; nd.lead += s * lead;
    }
  }
  async function search(root, komi, o) {
    const t0 = performance.now();
    if (!root.expanded) { const [r] = await evalNodes([root], komi); applyEval(root, r); backup([root], root.pla, root.nnU, root.nnWl, root.nnLead); }
    const BS = o.batch || BATCH;
    while (root.n < o.visits && performance.now() - t0 < o.time) {
      if (o.abort && o.abort()) break;
      const leaves = [], paths = [], collided = [];
      // 같은 미평가 노드에 부딪히면 가상 패배를 남겨 둔 채 다시 골라 배치를 채운다
      for (let tries = 0; leaves.length < BS && root.n + leaves.length < o.visits && tries < BS * 4; tries++) {
        const path = [root]; let nd = root;
        while (nd.expanded && !nd.terminal) { nd = child(nd, selectChild(nd)); nd.vl++; path.push(nd); }
        if (nd.terminal) {
          for (let j = 1; j < path.length; j++) path[j].vl--;
          const s = ttScore(nd.board, komi), sp = nd.pla === BLACK ? s : -s, wl = sp > 0 ? 1 : -1;
          backup(path, nd.pla, utilOf(wl, sp, nd.board.n), wl, sp);
          continue;
        }
        if (nd.pending) { collided.push(path); continue; }
        nd.pending = true; leaves.push(nd); paths.push(path);
      }
      const undoVL = path => { for (let j = 1; j < path.length; j++) path[j].vl--; };
      if (!leaves.length) { collided.forEach(undoVL); continue; }
      const res = await evalNodes(leaves, komi, { batch: BS });
      collided.forEach(undoVL);
      leaves.forEach((nd, i) => {
        const path = paths[i]; for (let j = 1; j < path.length; j++) path[j].vl--;
        applyEval(nd, res[i]); nd.pending = false;
        backup(path, nd.pla, nd.nnU, nd.nnWl, nd.nnLead);
      });
    }
    return root;
  }
  // 루트 자식 통계 (두는 사람 관점)
  function rootStats(root) {
    const out = [];
    root.kids.forEach((k, i) => { if (k && k.n > 0) out.push({ move: k.move, visits: k.n, prior: root.priors[i], winrate: (k.wl / k.n + 1) / 2, lead: k.lead / k.n }); });
    out.sort((a, b) => b.visits - a.visits || b.prior - a.prior);
    return out;
  }

  // ================= 대국 중 트리 재사용 + 상대 차례에 미리 읽기 =================
  // 탐색은 한 번에 하나만 돌도록 줄을 세운다. gen이 바뀌면 진행 중인 미리 읽기는 다음 배치에서 멈춘다.
  const sess = { root: null, base: null, moves: null };
  let chain = Promise.resolve(), gen = 0;
  const queue = fn => { const p = chain.then(fn); chain = p.then(() => {}, () => {}); return p; };
  const baseKey = st => st.n + '|' + st.komi + '|' + st.setup.join(',');
  // 새 루트의 형제 가지는 버려 메모리를 돌려받고, 수순 특징에 필요한 조상 6개만 남긴다
  function promote(nd) {
    nd.isRoot = true;
    let a = nd.parent, d = 0;
    while (a) { a.kids = null; a.isRoot = false; if (++d >= 6) { a.parent = null; break; } a = a.parent; }
  }
  function sessionRoot(st) {
    const base = baseKey(st);
    if (sess.root && sess.base === base && st.moves.length >= sess.moves.length && sess.moves.every((m, i) => st.moves[i] === m)) {
      let nd = sess.root;
      for (let i = sess.moves.length; i < st.moves.length && nd; i++) {
        const j = nd.expanded && nd.kids ? nd.moves.indexOf(st.moves[i]) : -1;
        nd = j >= 0 ? child(nd, j) : null;
      }
      if (nd) { if (nd !== sess.root) promote(nd); sess.root = nd; sess.moves = st.moves.slice(); return nd; }
    }
    sess.root = rootFromState(st); sess.base = base; sess.moves = st.moves.slice();
    return sess.root;
  }
  // 세션 트리에서 visits까지 읽는다 (이미 읽어 둔 만큼은 바로 쓴다)
  function think(st, o) {
    gen++;
    return queue(async () => {
      const root = sessionRoot(st);
      await search(root, st.komi, o);
      return { root, stats: rootStats(root), rootWinrate: (-root.wl / root.n + 1) / 2, rootLead: -root.lead / root.n };
    });
  }
  function ponder(st, o) {
    const my = ++gen;
    queue(async () => {
      if (gen !== my) return;
      await search(sessionRoot(st), st.komi, { ...o, abort: () => gen !== my });
    }).catch(e => console.warn('[KataGo] 미리 읽기 실패', e));
  }
  const stopPonder = () => { gen++; };
  const resetSession = () => { gen++; queue(() => { sess.root = null; sess.moves = null; }); };

  // ================= 공개 API =================
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' 를 불러오지 못했습니다')); document.head.appendChild(s); });
  }
  const gunzip = async stream => new Uint8Array(await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  async function decodeModel() {
    const b64 = window.KATAGO_MODEL_B64; window.KATAGO_MODEL_B64 = null;
    const bin = atob(b64), gz = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    return gunzip(new Blob([gz]).stream());
  }
  // 신경망 목록. g170 신경망은 CC0, b6는 KataGo 저장소의 시험용 신경망(MIT)
  const MODELS = {
    b6: { label: 'b6', file: null },
    b10: { label: 'b10', file: 'models/g170e-b10c128.bin.gz' },
    b15: { label: 'b15', file: 'models/g170e-b15c192.bin.gz' },
  };
  let modelKey = '';
  // 원하는 신경망의 바이트. 파일을 직접 연 경우(file://)처럼 받을 수 없으면 내장된 b6로 대신한다
  async function modelBytes(key, onStatus) {
    const m = MODELS[key];
    if (m && m.file && location.protocol !== 'file:') {
      try {
        const res = await fetch(m.file);
        if (res.ok) {
          const total = +res.headers.get('content-length') || 0;
          let got = 0;
          const counted = res.body.pipeThrough(new TransformStream({ transform(ch, c) { got += ch.length; if (total) onStatus(`신경망 받는 중… ${Math.round(got / total * 100)}%`); c.enqueue(ch); } }));
          return { key, raw: await gunzip(counted) };
        }
      } catch (e) { console.warn('[KataGo] ' + m.file + ' 를 받지 못해 b6로 대신합니다', e); }
    }
    if (!window.KATAGO_MODEL_B64) await loadScript('models/katago-b6.js');
    return { key: 'b6', raw: await decodeModel() };
  }
  // 9줄 시험 국면으로 백엔드 출력이 CPU 계산과 같은지 확인
  async function probe(n) {
    const st = { n, setup: [], moves: [] };
    const tmp = new Board(n); [[2, 2], [6, 6], [6, 2], [3, 6], [4, 4]].forEach(([x, y]) => st.moves.push(tmp.pt(x, y)));
    const root = rootFromState(st);
    const [r] = await evalNodes([root], 7, { syms: [0] });
    return { wl: r.wl, lead: r.lead, pri: Array.from(r.priors.slice(0, 20)) };
  }
  // 9줄 국면 8개를 한 번 계산하는 시간(ms)
  async function timeEval(n) {
    const nodes = Array(8).fill(0).map(() => rootFromState({ n, setup: [], moves: [] }));
    await evalNodes(nodes, 7); await evalNodes(nodes, 7);
    const t = performance.now(); await evalNodes(nodes, 7); await evalNodes(nodes, 7);
    return (performance.now() - t) / 2;
  }
  const close = (a, b) => Math.abs(a.wl - b.wl) < 0.02 && Math.abs(a.lead - b.lead) < 0.5 && a.pri.every((x, i) => Math.abs(x - b.pri[i]) < 0.01);

  function load(onStatus = () => {}, wantModel = 'b10') {
    if (loading) return loading;
    loading = (async () => {
      onStatus('AI 엔진 불러오는 중…');
      if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않습니다');
      await loadScript('vendor/tf.min.js');
      if (navigator.gpu) { try { await loadScript('vendor/tf-backend-webgpu.min.js'); } catch (e) { } }
      const mb = await modelBytes(wantModel, onStatus);
      desc = parseModel(mb.raw); modelKey = mb.key;
      onStatus('AI 엔진 준비 중…');
      // 기준값: CPU
      await tf.setBackend('cpu'); await tf.ready();
      net = buildNet(desc);
      const ref = await probe(9);
      const cpuNet = net;
      // WASM(그래픽 가속이 없는 폰용)은 .wasm 파일을 받아야 해서 file:// 에서는 쓰지 않는다
      if (location.protocol !== 'file:') {
        try { await loadScript('vendor/tf-backend-wasm.min.js'); tf.wasm.setWasmPaths(new URL('vendor/', location.href).href); } catch (e) { }
      }
      // 결과가 CPU 계산과 같은 백엔드 중에서 가장 빠른 것을 고른다 (기기마다 다르므로 직접 재 본다)
      let best = { be: 'cpu', ms: Infinity, net: cpuNet };
      for (const be of ['webgpu', 'webgl', 'wasm']) {
        if (!tf.findBackendFactory(be)) continue;
        try {
          if (!(await tf.setBackend(be))) continue;
          await tf.ready();
          backend = be; const cand = net = buildNet(desc);
          const got = await probe(9);
          if (!close(got, ref)) { console.warn('[KataGo] ' + be + ' 출력이 CPU와 달라 사용하지 않습니다', got, ref); cand.dispose(); continue; }
          const ms = await timeEval(9);
          if (ms < best.ms) { if (best.net !== cpuNet) best.net.dispose(); best = { be, ms, net: cand }; } else cand.dispose();
          if (be === 'webgpu' && ms < 40) break; // 충분히 빠르면 더 재지 않는다
        } catch (e) { console.warn('[KataGo] ' + be + ' 사용 불가', e); }
      }
      await tf.setBackend(best.be);
      net = best.net; backend = best.be;
      if (best.net !== cpuNet) cpuNet.dispose();
      return { backend, model: modelKey, name: desc.name, ms: best.ms };
    })();
    return loading;
  }
  // 실행 중에 신경망 바꾸기 (진행 중인 탐색이 끝난 뒤 교체)
  function setModel(key, onStatus = () => {}) {
    gen++;
    return queue(async () => {
      if (key === modelKey) return modelKey;
      const mb = await modelBytes(key, onStatus);
      onStatus('AI 엔진 준비 중…');
      const d = parseModel(mb.raw), old = net;
      net = buildNet(d); desc = d; modelKey = mb.key;
      if (old) old.dispose();
      sess.root = null; sess.moves = null;
      return modelKey;
    });
  }
  // 여러 국면의 흑 승률·흑 기준 집 차이. 대칭 2개를 평균해 흔들림을 줄인다 (CPU 계열은 1개)
  async function evalPositions(states, onProgress = () => {}) {
    const sy = backend === 'cpu' || backend === 'wasm' ? [0] : [0, 5], per = BATCH / sy.length, out = [];
    for (let i = 0; i < states.length; i += per) {
      const roots = states.slice(i, i + per).map(rootFromState);
      const nodes = [], syms = [];
      roots.forEach(r => sy.forEach(s => { nodes.push(r); syms.push(s); }));
      const rs = await evalNodes(nodes, states[0].komi, { syms });
      roots.forEach((r, j) => {
        let wl = 0, lead = 0;
        for (let k = 0; k < sy.length; k++) { wl += rs[j * sy.length + k].wl / sy.length; lead += rs[j * sy.length + k].lead / sy.length; }
        const sign = r.board.turn === BLACK ? 1 : -1;
        out.push({ wr: (sign * wl + 1) / 2, lead: sign * lead });
      });
      onProgress(out.length / states.length);
    }
    return out;
  }
  // 미리 셰이더 컴파일 (판 크기별 첫 계산이 느리므로)
  async function warmup(n) { const root = rootFromState({ n, setup: [], moves: [] }); await evalNodes([root], 7); }

  async function analyze(state, o) {
    const root = rootFromState(state);
    await search(root, state.komi, o);
    return { root, stats: rootStats(root), rootWinrate: (-root.wl / root.n + 1) / 2, rootLead: -root.lead / root.n };
  }
  // 대칭 8개 평균으로 소유권(흑 관점, 보드 좌표 p 기준)과 집 차이(흑 관점)
  async function ownership(state) {
    const root = rootFromState(state), b = root.board;
    const sy = backend === 'cpu' ? [0, 7] : backend === 'wasm' ? [0, 3, 5, 6] : [0, 1, 2, 3, 4, 5, 6, 7], k = sy.length;
    const rs = await evalNodes(Array(k).fill(root), state.komi, { own: true, syms: sy });
    const own = new Float32Array(b.size); let lead = 0, wl = 0;
    for (const r of rs) { for (const p of b.pts) own[p] += r.own[p] / k; lead += r.lead / k; wl += r.wl / k; }
    const sign = b.turn === BLACK ? 1 : -1;
    return { own: Array.from(own), lead: sign * lead, blackWinrate: (sign * wl + 1) / 2 };
  }
  // 정책만 보고 두기 (약한 단계용). 반환: {move, winrate(두는 사람), policy}
  async function policyEval(state) {
    const root = rootFromState(state);
    const [r] = await evalNodes([root], state.komi);
    return { moves: r.moves, priors: r.priors, winrate: (r.wl + 1) / 2, lead: r.lead, board: root.board };
  }

  return { load, setModel, evalPositions, get model() { return modelKey; }, warmup, analyze, think, ponder, stopPonder, resetSession, ownership, policyEval, ttScore, get backend() { return backend; }, get ready() { return !!net; }, _internal: { parseModel, buildNet, rootFromState, encode, ladders, evalNodes, search, rootStats, setNet: (n) => { net = n; }, getNet: () => net, getDesc: () => desc,
    async useModelBytes(raw) { const d = parseModel(raw); const old = net; net = buildNet(d); desc = d; if (old) old.dispose(); sess.root = null; return d.name; } } };
})();
