/* 증강 바둑 AI (시험판, 9줄): 증강을 배운 신경망 + 수 읽기(PUCT)
 * - 신경망: KataGo g170e-b10c128 (CC0) 에 증강 입력·출력을 붙여 AI끼리 대국으로 학습한 것 (tools/augnet).
 *   파일 models/augnet9.bin 은 tools/augnet/export.py 가 만든다 (float16 가중치)
 * - 장면 · 행동 · 입력 특징은 augstate.js (학습 도구와 같은 파일)
 * - 규칙 판은 augboard.js 의 AugBoard. 한 차례를 단계로 나눠 읽는다:
 *     decide (착수 · 패스 · 증강 쓰기) → move (무적수·결계·저격 뒤 착수) / first · second (슈퍼선수 두 수)
 * board.js, augboard.js, ../katago.js, augstate.js 다음에 불러온다. 전역 AugAI 를 만든다.
 */
'use strict';
const AugAI = (() => {
  const { AUG_LIST, NF2, NG2 } = AugState;
  // 신경망이 본 증강 값 (9줄, 집 · 2026-10-13 AI끼리 4만 판). 경매에서 AI 가 덤을 부를 때 쓴다
  // 저격은 2026-10-13 에 '들어내고 착수'로 바뀌어 아직 재지 못했다: 슈퍼선수와 비슷하게 어림
  const VALUE = { wall: 35, swap: 15, double: 14, snipe: 13, prisoner: 11, invincible: 9, barrier: 9, kowang: 8, rewind: 4 }; // b15 학습 초반 값, 배포 때 다시 잼
  let net = null, head = null, backend = '', loading = null;
  // 이 파일(go/aug/ai.js) 이 있는 곳 기준으로 TF.js · 신경망 파일을 찾는다
  const HERE = typeof document !== 'undefined' && document.currentScript ? new URL('.', document.currentScript.src).href : './';

  // ---------------- 증강 바둑 장면: 학습 도구와 같은 augstate.js ----------------
  const { St, syms } = AugState;

  // 앱 대국(AugGame) 의 차례들 → St. 되감기로 되돌린 차례는 turns 에 없다
  function fromTurns(n, komi, aug, turns) {
    let s = new St(n, komi, aug);
    const ix = p => p ? s.idx(p) : s.area;
    for (const x of turns) {
      const t = x.t;
      if (t.kind === 'swap') s = s.apply(s.area + 1 + s.idx(t.a)).apply(s.area + 1 + s.idx(t.b));
      else if (t.kind === 'snipe') { // 예전 저격 (수 대신 들어냄, 2026-10-13 전 기보)
        const prev = s.node; s = s.clone(); s.len++; s.used[x.col] = true; s.b.snipe(t.q); s.step = 'decide'; s.node = { board: s.b, move: PASS, parent: prev, lad: null };
      }
      else if (t.kind === 'double') s = s.apply(2 * s.area + 1).apply(ix(t.p)).apply(ix(t.p2));
      else {
        if (t.pre && t.pre.k === 'r') s.used[x.col] = true;
        else if (t.pre) s = s.apply(s.area + 1 + s.idx(t.pre.q));
        s = s.apply(ix(t.p));
      }
    }
    return s;
  }

  // ---------------- 신경망 파일 (float16) ----------------
  const H2F = (() => { // float16 → float32 표
    const t = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) {
      const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
      t[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
    }
    return t;
  })();
  function parseFile(buf) {
    const u8 = new Uint8Array(buf), magic = new TextDecoder().decode(u8.subarray(0, 8));
    if (magic !== 'AUGNET1\n') throw new Error('증강 신경망 파일이 아닙니다');
    const hl = new DataView(buf).getUint32(8, true), h = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hl)));
    if (h.nf !== NF2 || h.ng !== NG2) throw new Error('앱과 맞지 않는 AI 신경망 파일입니다 (입력 ' + h.nf + '·' + h.ng + ')');
    const half = new Uint16Array(buf, 12 + hl), W = {};
    for (const [k, [off, shape]] of Object.entries(h.tensors)) {
      const len = shape.reduce((a, b) => a * b, 1), f = new Float32Array(len);
      for (let i = 0; i < len; i++) f[i] = H2F[half[off + i]];
      W[k] = { f, shape };
    }
    return { h, W };
  }
  function buildNet({ h, W }) {
    const T = [], keep = t => (T.push(t), t);
    const t = k => keep(tf.tensor(W[k].f, W[k].shape));
    const P = {}; for (const k of Object.keys(W)) P[k] = t(k);
    const actF = (x, a) => a === 'relu' ? tf.relu(x) : a === 'mish' ? tf.mul(x, tf.tanh(tf.softplus(x))) : x;
    const conv = (x, w) => tf.conv2d(x, w, 1, 'same', 'NHWC');
    function forward(bin, glob, n) {
      return tf.tidy(() => {
        const N = bin.shape[0], area = n * n, sq = Math.sqrt(area);
        const tb = v => tf.reshape(v, [N, 1, 1, -1]);
        const gpool = x => { const m = tf.mean(x, [1, 2]); return tf.concat([m, tf.mul(m, (sq - 14) * 0.1), tf.max(x, [1, 2])], 1); };
        const vpool = x => { const m = tf.mean(x, [1, 2]); return tf.concat([m, tf.mul(m, (sq - 14) * 0.1), tf.mul(m, (sq - 14) * (sq - 14) * 0.01 - 0.1)], 1); };
        let x = tf.add(conv(bin, P.conv1), tb(tf.matMul(glob, P.mat1)));
        h.blocks.forEach((b, i) => {
          const p = 'b' + i + '.';
          const a = actF(tf.add(tf.mul(x, P[p + 'pre_mul']), P[p + 'pre_add']), b.pre);
          let r;
          if (b.g) {
            const gp = gpool(actF(tf.add(conv(a, P[p + 'gc_w']), P[p + 'gc_b']), b.gc));
            r = actF(tf.add(conv(a, P[p + 'c1_w']), tb(tf.add(tf.matMul(gp, P[p + 'mm']), P[p + 'mm_add']))), b.c1);
          } else r = actF(tf.add(conv(a, P[p + 'c1_w']), P[p + 'c1_b']), b.c1);
          x = tf.add(x, conv(r, P[p + 'c2_w']));
        });
        const trunk = actF(tf.add(tf.mul(x, P.tip_mul), P.tip_add), h.act.tip);
        const gp = gpool(actF(tf.add(conv(trunk, P.g1_w), P.g1_b), h.act.g1));
        const p1 = actF(tf.add(conv(trunk, P.p1_w), tb(tf.add(tf.matMul(gp, P.p1_mm), P.p1_add))), h.act.p1);
        const pol = tf.reshape(tf.slice(conv(p1, P.p2_w), [0, 0, 0, 0], [N, n, n, 1]), [N, area]);
        const pass = tf.slice(tf.matMul(gp, P.to_pass), [0, 0], [N, 1]);
        const tgt = tf.reshape(tf.add(conv(p1, P.t2_w), P.t2_b), [N, area]);
        const act = tf.add(tf.matMul(gp, P.act_w), P.act_b);
        const v1 = actF(tf.add(conv(trunk, P.v1_w), P.v1_b), h.act.v1);
        const v2 = actF(tf.add(tf.matMul(vpool(v1), P.v2), P.v2b), h.act.v2);
        const value = tf.add(tf.matMul(v2, P.v3), P.v3b);
        const misc = tf.slice(tf.add(tf.matMul(v2, P.sv3), P.sv3b), [0, 0], [N, 4]);
        const own = tf.tanh(tf.reshape(conv(v1, P.own_w), [N, area]));
        // 서버(server.py)와 같은 순서: 정책(area+1) · 대상(area) · 쓰기(1) · 가치(3) · misc(4) · 소유(area)
        return tf.concat([pol, pass, tgt, act, value, misc, own], 1);
      });
    }
    return { forward, dispose: () => T.forEach(x => x.dispose()) };
  }
  // 장면들을 한 번에 계산 → 장면마다 출력 (Float32Array, 길이 3*area+9) 와 쓴 대칭
  async function run(states, fixedSym) {
    const n = states[0].n, area = n * n, IN = area * NF2, N = states.length;
    const bin = new Float32Array(N * IN), glob = new Float32Array(N * NG2), sy = [];
    states.forEach((s, i) => { const k = fixedSym ?? ((Math.random() * 8) | 0); sy.push(k); s.features(k, bin, i * IN, glob, i * NG2); });
    const tb = tf.tensor4d(bin, [N, n, n, NF2]), tg = tf.tensor2d(glob, [N, NG2]);
    const out = net.forward(tb, tg, n); tb.dispose(); tg.dispose();
    const d = await out.data(); out.dispose();
    const OUT = 3 * area + 9;
    return states.map((s, i) => ({ o: d.subarray(i * OUT, (i + 1) * OUT), sym: sy[i] }));
  }

  // ---------------- 불러오기 ----------------
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' 를 불러오지 못했습니다')); document.head.appendChild(s); });
  }
  async function probeOut() {
    const s = fromTurns(9, 7.5, { 1: 'double', 2: 'invincible' }, []);
    const [r] = await run([s]); return Array.from(r.o.slice(0, 12)).concat(Array.from(r.o.slice(2 * 81 + 2, 2 * 81 + 9)));
  }
  function load(onStatus = () => {}) {
    if (loading) return loading;
    loading = (async () => {
      onStatus('AI 불러오는 중…');
      if (typeof tf === 'undefined') {
        await loadScript(HERE + '../vendor/tf.min.js');
        if (navigator.gpu) { try { await loadScript(HERE + '../vendor/tf-backend-webgpu.min.js'); } catch (e) { } }
      }
      const res = await fetch(HERE + 'models/augnet9.bin');
      if (!res.ok) throw new Error('AI 신경망 파일을 받지 못했습니다');
      const total = +res.headers.get('content-length') || 0; let got = 0; const parts = [];
      const rd = res.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total) onStatus(`AI 신경망 받는 중… ${Math.round(got / total * 100)}%`); }
      const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
      const file = parseFile(buf.buffer); head = file.h;
      onStatus('AI 준비 중…');
      await tf.setBackend('cpu'); await tf.ready();
      net = buildNet(file); const ref = await probeOut(), cpuNet = net;
      let best = { be: 'cpu', ms: Infinity, net: cpuNet };
      for (const be of ['webgpu', 'webgl']) {
        if (!tf.findBackendFactory(be)) continue;
        try {
          if (!(await tf.setBackend(be))) continue;
          await tf.ready(); backend = be; const cand = net = buildNet(file);
          const got2 = await probeOut();
          if (!got2.every((v, i) => Math.abs(v - ref[i]) < 0.05)) { console.warn('[증강 AI] ' + be + ' 출력이 CPU와 달라 쓰지 않습니다', got2, ref); cand.dispose(); continue; }
          const st = Array(8).fill(0).map(() => fromTurns(9, 7.5, {}, []));
          await run(st); const t0 = performance.now(); await run(st); await run(st); const ms = (performance.now() - t0) / 2;
          if (ms < best.ms) { if (best.net !== cpuNet) best.net.dispose(); best = { be, ms, net: cand }; } else cand.dispose();
        } catch (e) { console.warn('[증강 AI] ' + be + ' 사용 불가', e); }
      }
      await tf.setBackend(best.be); net = best.net; backend = best.be;
      BATCH = best.ms > 60 ? 32 : best.ms > 25 ? 16 : 8;
      if (best.net !== cpuNet) cpuNet.dispose();
      return { backend, name: head.name };
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  // ---------------- 수 읽기 (PUCT, 가상 손실로 여러 장면을 한 번에) ----------------
  const CPUCT = 1.3;
  let BATCH = 8; // 한 번에 계산할 장면 수: 계산 한 번의 고정 시간이 크면 (b15 · 느린 그래픽) 더 많이 묶는다
  function parse(st, r) {
    const n = st.n, area = n * n, o = r.o, map = syms(n)[r.sym], A = st.actions(), lg = new Float64Array(A.length);
    for (let i = 0; i < A.length; i++) { const a = A[i]; lg[i] = a < area ? o[map[a]] : a === area ? o[area] : a === 2 * area + 1 ? o[2 * area + 1] : o[area + 1 + map[a - area - 1]]; }
    let mx = -Infinity; for (const v of lg) if (v > mx) mx = v;
    let s = 0; const P = new Float64Array(A.length); for (let i = 0; i < A.length; i++) { P[i] = Math.exp(lg[i] - mx); s += P[i]; }
    for (let i = 0; i < A.length; i++) P[i] /= s;
    const v0 = o[2 * area + 2], v1 = o[2 * area + 3], v2 = o[2 * area + 4], vm = Math.max(v0, v1, v2);
    const e0 = Math.exp(v0 - vm), e1 = Math.exp(v1 - vm), e2 = Math.exp(v2 - vm), es = e0 + e1 + e2;
    const lead = o[2 * area + 7] * 20;
    return { A, P, wl: (e0 - e1) / es, lead, u: (e0 - e1) / es + 0.15 * (2 / Math.PI) * Math.atan(lead / (0.5 * n)) };
  }
  class Node { constructor(st) { this.st = st; this.A = null; this.n = 0; this.wb = 0; this.u0 = 0; this.term = st.terminal(); } }
  const sgOf = nd => nd.st.col === 1 ? 1 : -1;
  const termU = st => { const s = st.score(); return Math.sign(s) + 0.15 * (2 / Math.PI) * Math.atan(s / (0.5 * st.n)); };
  function expand(nd, r) {
    const e = parse(nd.st, r);
    nd.A = e.A; nd.P = e.P; nd.N = new Int32Array(e.A.length); nd.W = new Float64Array(e.A.length); nd.kids = new Array(e.A.length);
    nd.u0 = nd.st.col === 1 ? e.u : -e.u; nd.wl = nd.st.col === 1 ? e.wl : -e.wl; nd.lead = nd.st.col === 1 ? e.lead : -e.lead;
  }
  function select(nd) {
    const sg = sgOf(nd), pq = nd.n ? sg * nd.wb / nd.n : sg * nd.u0;
    let seen = 0; for (let i = 0; i < nd.A.length; i++) if (nd.N[i]) seen += nd.P[i];
    const fpu = pq - 0.2 * Math.sqrt(seen), sq = Math.sqrt(Math.max(1, nd.n));
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < nd.A.length; i++) { const q = nd.N[i] ? sg * nd.W[i] / nd.N[i] : fpu, v = q + CPUCT * nd.P[i] * sq / (1 + nd.N[i]); if (v > bv) { bv = v; bi = i; } }
    return bi;
  }
  // 가상 손실: 고른 길을 잠시 '진 것'으로 쳐서 같은 묶음의 다른 읽기가 다른 길을 고르게 한다
  const vl = (path, k) => { for (const [p, i] of path) { const sg = sgOf(p); p.N[i] += k; p.W[i] -= k * sg; p.n += k; p.wb -= k * sg; } };
  const backup = (path, u) => { for (const [p, i] of path) { p.N[i]++; p.W[i] += u; p.n++; p.wb += u; } };
  async function search(root, visits, abort) {
    if (root.term) return root;
    if (!root.A) { const [r] = await run([root.st]); expand(root, r); root.n++; root.wb += root.u0; }
    let done = 0;
    while (done < visits) {
      if (abort && abort()) throw new Error('abort');
      const leaves = [], pend = new Set(), B = Math.min(BATCH, visits - done);
      for (let k = 0; k < B; k++) {
        let nd = root; const path = [];
        while (nd.A && !nd.term) {
          const i = select(nd); path.push([nd, i]);
          if (!nd.kids[i]) nd.kids[i] = new Node(nd.st.apply(nd.A[i]));
          nd = nd.kids[i]; if (!nd.A) break;
        }
        if (nd.term) { const u = termU(nd.st); nd.n++; nd.wb += u; backup(path, u); done++; continue; }
        if (pend.has(nd)) break;
        pend.add(nd); vl(path, 1); leaves.push({ nd, path });
      }
      if (!leaves.length) continue;
      const res = await run(leaves.map(l => l.nd.st));
      leaves.forEach((l, j) => { vl(l.path, -1); expand(l.nd, res[j]); const u = l.nd.u0; l.nd.n++; l.nd.wb += u; backup(l.path, u); done++; });
    }
    return root;
  }
  const best = nd => { let b = 0; for (let i = 1; i < nd.A.length; i++) if (nd.N[i] > nd.N[b]) b = i; return b; };
  const rootQ = (nd, col) => (col === 1 ? 1 : -1) * nd.wb / Math.max(1, nd.n);
  const visitsFor = () => backend === 'cpu' ? 64 : 256;

  // 앱 대국 G 에서 AI(col) 의 한 차례를 정한다 → 한 차례 글자 ("123", "i45;123", "d12,34", "s45", "r;123", "0")
  async function move(G, col, o = {}) {
    await load(o.onStatus);
    const V = o.visits || visitsFor(), ab = o.abort;
    const st = fromTurns(G.n, G.komi, G.aug, G.turns);
    if (st.col !== col) throw new Error('AI 차례가 아닙니다');
    const area = st.area, pt = i => i === area ? 0 : st.pt(i);
    const root = await search(new Node(st), V, ab);
    // 되감기: 내 직전 수와 상대 응수를 되돌린 장면을 따로 읽어 확실히 나으면 쓴다
    if (G.aug[col] === 'rewind' && !G.used(col) && G.canRewind(col)) {
      const back = fromTurns(G.n, G.komi, G.aug, G.turns.slice(0, -2)); back.used[col] = true; back.step = 'move';
      const br = await search(new Node(back), V, ab);
      if (rootQ(br, col) > rootQ(root, col) + 0.1) return 'r;' + pt(br.A[best(br)]);
    }
    const a = root.A[best(root)];
    if (a <= area) return String(pt(a));
    if (a === 2 * area + 1) { // 슈퍼선수: 첫 수 · 둘째 수
      const i = root.A.indexOf(a), n1 = await search(root.kids[i] || new Node(st.apply(a)), V, ab), p1 = n1.A[best(n1)];
      const i2 = best(n1), n2 = await search(n1.kids[i2] || new Node(n1.st.apply(p1)), V, ab), p2 = n2.A[best(n2)];
      return 'd' + pt(p1) + ',' + pt(p2);
    }
    const q = st.pt(a - area - 1), au = G.aug[col];
    const i = root.A.indexOf(a), n1 = await search(root.kids[i] || new Node(st.apply(a)), V, ab);
    if (au === 'swap') { // 바꿀 상대 돌 (없으면 맞바꾸기를 접고 가장 좋은 보통 수)
      const b2 = n1.A[best(n1)]; if (b2 > area) return 'x' + q + ',' + st.pt(b2 - area - 1);
      let m = -1; for (let k = 0; k < root.A.length; k++) if (root.A[k] <= area && (m < 0 || root.N[k] > root.N[m])) m = k;
      return String(pt(root.A[m]));
    }
    return (au === 'invincible' ? 'i' : au === 'barrier' ? 'b' : 's') + q + ';' + pt(n1.A[best(n1)]);
  }
  // 흑 기준 소유 (계가 때 죽은 돌 표시용): Board 자리 번호 → -1..1, 그리고 흑 기준 승률 · 집
  async function judge(G) {
    await load();
    const st = fromTurns(G.n, G.komi, G.aug, G.turns), area = st.area, sg = st.col === 1 ? 1 : -1;
    const out = new Float32Array((G.n + 2) * (G.n + 2));
    const rs = await run(Array(4).fill(st)); // 대칭 넷 평균
    for (const r of rs) { const map = syms(G.n)[r.sym]; for (let i = 0; i < area; i++) out[st.pt(i)] += sg * r.o[2 * area + 9 + map[i]] / rs.length; }
    const e = parse(st, rs[0]);
    return { own: out, wl: sg * e.wl, lead: sg * e.lead };
  }
  // 경매: 증강 둘(of) 을 두고 AI 가 낙찰받고 싶은 최고 값 (먼저 고르면 좋은 것을 갖고, 진 쪽은 남은 것)
  const maxBid = of => Math.max(0, Math.round(Math.abs((VALUE[of[0]] || 0) - (VALUE[of[1]] || 0))));
  const prefer = of => (VALUE[of[0]] || 0) >= (VALUE[of[1]] || 0) ? of[0] : of[1];
  // 이 AI 가 배운 증강 (AI 대국의 경매 후보)
  const KNOWN = AUG_LIST.slice();
  return { load, move, judge, maxBid, prefer, VALUE, KNOWN, get ready() { return !!net; }, get backend() { return backend; }, get name() { return head ? head.name : ''; }, _internal: { St, fromTurns, run, parseFile, buildNet, search, Node } };
})();
