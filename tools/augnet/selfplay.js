// 증강 바둑 자기 대국: 신경망 서버(server.py)에 장면을 보내 계산받으며 수 읽기(MCTS, PUCT)로 둔다.
// 깊게 읽은 장면(full)만 학습 기록으로 data/*.bin 에 쌓고, 대국 결과는 data/games.jsonl 에 남긴다.
// 사용: node selfplay.js [--workers 6] [--games 32] [--port 19190]   (tools/augnet/STOP 파일이 생기면 두던 판을 끝내고 멈춤)
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const net = require('net'), fs = require('fs'), path = require('path');
const HERE = __dirname, DATA = path.join(HERE, 'data' + (process.env.AUGNET_NET && process.env.AUGNET_NET !== 'b10' ? '-' + process.env.AUGNET_NET : '')); // AUGNET_NET=b15 이면 data-b15/
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const O = { n: 9, port: +arg('port', 19190), workers: +arg('workers', 6), games: +arg('games', 32), full: +arg('full', 200), fast: +arg('fast', 48), pFull: 0.25, cpuct: 1.3, tempTurns: 10, chunk: 1500 };
if (!isMainThread) Object.assign(O, workerData); // 일꾼은 부모가 넘긴 설정을 쓴다

if (isMainThread) {
  fs.mkdirSync(DATA, { recursive: true });
  let alive = O.workers, games = 0, samples = 0;
  const t0 = Date.now();
  for (let w = 0; w < O.workers; w++) {
    const wk = new Worker(__filename, { workerData: { ...O, id: `${Date.now().toString(36)}-${w}` } });
    wk.on('message', m => {
      if (m.game) {
        games++; samples += m.game.samples;
        fs.appendFileSync(path.join(DATA, 'games.jsonl'), JSON.stringify(m.game) + '\n');
        if (games % 50 === 0) console.log(new Date().toLocaleTimeString('ko-KR'), `${games}판 · 학습 장면 ${samples} · ${(games / ((Date.now() - t0) / 3600000)).toFixed(0)}판/시간`);
      }
    });
    wk.on('error', e => console.error('일꾼 오류', e));
    wk.on('exit', () => { if (--alive === 0) { console.log('자기 대국 끝', games, '판'); process.exit(0); } });
  }
} else {
  const G = require('./game.js');
  const { St, syms, AUG_LIST, NF2, NG2, PASS } = G;
  const n = O.n, area = n * n, OUT = 3 * area + 9, IN = area * NF2 + NG2, SAMPLE = IN + (2 * area + 2) + 2 + area;
  const ME = workerData.id;

  // ---------- 서버 연결 (요청 하나씩) ----------
  const sock = net.connect(O.port, '127.0.0.1');
  sock.setNoDelay(true);
  let rbuf = Buffer.alloc(0), want = 0, onData = null;
  sock.on('data', d => { rbuf = Buffer.concat([rbuf, d]); if (onData && rbuf.length >= want) { const b = rbuf.subarray(0, want); rbuf = rbuf.subarray(want); const f = onData; onData = null; f(b); } });
  sock.on('error', e => { console.error('서버 연결 오류', e.message); try { dump(true); } catch (x) { } process.exit(1); });
  const ask = (buf, cnt) => new Promise(res => { want = cnt * OUT * 4; onData = b => res(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))); sock.write(buf); });

  // ---------- 계산 묶기: 진행 중인 판들이 모두 기다리면 한 번에 보낸다 ----------
  let pend = [], busy = false, active = 0, sched = false;
  const evalSt = st => new Promise(res => { pend.push({ st, res }); kick(); });
  let halt = false; // 온도가 높아 쉬는 중: 계산 요청을 보내지 않아 모든 판이 그 자리에서 멈춘다 (식으면 이어서 둠)
  let slow = 0, act = 0, mark = Date.now(); // slow: 온도 조절용 쉬는 비율 (CPU 로 일한 시간 act × slow 만큼 쉬고 계산을 보낸다, run.js 가 THROTTLE 파일로 정함)
  function kick() {
    if (busy || !pend.length || halt) return;
    if (pend.length >= active) { flush(); return; }
    if (!sched) { sched = true; setImmediate(() => { sched = false; if (!busy && pend.length) flush(); }); }
  }
  async function flush() {
    busy = true;
    act += Date.now() - mark; // 지난 결과 뒤로 수 읽기에 쓴 시간
    if (slow > 0) { const w = Math.min(5000, act * slow); act = 0; if (w >= 2) await new Promise(r => setTimeout(r, w)); } else act = 0;
    const t0 = Date.now();
    const batch = pend; pend = [];
    const hdr = Buffer.alloc(8); hdr.writeUInt32LE(batch.length, 0); hdr.writeUInt32LE(n, 4);
    const x = new Float32Array(batch.length * IN), symL = [];
    batch.forEach((b, i) => { const s = (Math.random() * 8) | 0; symL.push(s); b.st.features(s, x, i * IN, x, i * IN + area * NF2); });
    act += Date.now() - t0; // 장면 특징 만들기
    const out = await ask(Buffer.concat([hdr, Buffer.from(x.buffer)]), batch.length);
    const t2 = Date.now();
    batch.forEach((b, i) => b.res(parse(b.st, symL[i], out.subarray(i * OUT, (i + 1) * OUT))));
    act += Date.now() - t2; mark = Date.now(); busy = false; kick();
  }
  // 신경망 출력 → 둘 수 있는 행동의 사전 확률과 두는 쪽 기준 가치
  function parse(st, sym, o) {
    const map = syms(n)[sym], A = st.actions(), lg = new Float64Array(A.length);
    for (let i = 0; i < A.length; i++) { const a = A[i]; lg[i] = a < area ? o[map[a]] : a === area ? o[area] : a === 2 * area + 1 ? o[2 * area + 1] : o[area + 1 + map[a - area - 1]]; }
    let mx = -Infinity; for (const v of lg) if (v > mx) mx = v;
    let s = 0; const P = new Float64Array(A.length); for (let i = 0; i < A.length; i++) { P[i] = Math.exp(lg[i] - mx); s += P[i]; }
    for (let i = 0; i < A.length; i++) P[i] /= s;
    const v0 = o[2 * area + 2], v1 = o[2 * area + 3], v2 = o[2 * area + 4], vm = Math.max(v0, v1, v2);
    const e0 = Math.exp(v0 - vm), e1 = Math.exp(v1 - vm), e2 = Math.exp(v2 - vm), es = e0 + e1 + e2;
    const lead = o[2 * area + 7] * 20;
    return { A, P, u: (e0 - e1) / es + 0.15 * (2 / Math.PI) * Math.atan(lead / (0.5 * n)) };
  }

  // ---------- 수 읽기 (PUCT) ----------
  class Node { constructor(st) { this.st = st; this.A = null; this.P = null; this.N = null; this.W = null; this.kids = null; this.n = 0; this.wb = 0; this.u0 = 0; this.term = st.terminal(); } }
  const termU = st => { const s = st.score(); return Math.sign(s) + 0.15 * (2 / Math.PI) * Math.atan(s / (0.5 * n)); };
  async function expand(nd) {
    const r = await evalSt(nd.st);
    nd.A = r.A; nd.P = r.P; nd.N = new Int32Array(r.A.length); nd.W = new Float64Array(r.A.length); nd.kids = new Array(r.A.length);
    nd.u0 = nd.st.col === 1 ? r.u : -r.u; // 흑 기준
    return nd.u0;
  }
  function select(nd) {
    const sg = nd.st.col === 1 ? 1 : -1, pq = nd.n ? sg * nd.wb / nd.n : sg * nd.u0;
    let seen = 0; for (let i = 0; i < nd.A.length; i++) if (nd.N[i]) seen += nd.P[i];
    const fpu = pq - 0.2 * Math.sqrt(seen), sq = Math.sqrt(Math.max(1, nd.n));
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < nd.A.length; i++) {
      const q = nd.N[i] ? sg * nd.W[i] / nd.N[i] : fpu, v = q + O.cpuct * nd.P[i] * sq / (1 + nd.N[i]);
      if (v > bv) { bv = v; bi = i; }
    }
    return bi;
  }
  function gamma(a) { // Marsaglia-Tsang
    if (a < 1) return gamma(a + 1) * Math.pow(Math.random(), 1 / a);
    const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) { let x, v; do { x = gauss(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = Math.random(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
  }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // explore: 증강 행동에 사전 확률 10% 를 나눠 준다 (써 봐야 효과를 배운다). only: 증강 행동만 고려 (억지로 쓰기)
  const isAug = a => a > area;
  async function search(root, visits, noise, explore = true, only = false) {
    if (root.term) return;
    if (!root.A) { const u = await expand(root); root.n++; root.wb += u; }
    if (!root.P0) root.P0 = Float64Array.from(root.P); // 탐색 보정·잡음 전의 신경망 사전 확률 (정책 목표 가지치기에 씀)
    const k = root.A.filter(isAug).length;
    if (k && only) { for (let i = 0; i < root.P.length; i++) root.P[i] = isAug(root.A[i]) ? 1 / k : 0; }
    else if (k && explore) { for (let i = 0; i < root.P.length; i++) root.P[i] = 0.9 * root.P[i] + (isAug(root.A[i]) ? 0.1 / k : 0); }
    if (noise) {
      const al = Math.min(1, Math.max(0.03, 10 / root.A.length)), g = root.A.map(() => gamma(al)), gs = g.reduce((a, b) => a + b, 0);
      for (let i = 0; i < root.P.length; i++) root.P[i] = 0.75 * root.P[i] + 0.25 * g[i] / gs;
    }
    for (let v = 0; v < visits; v++) {
      let nd = root; const path = [];
      while (nd.A && !nd.term) {
        const i = select(nd); path.push([nd, i]);
        if (!nd.kids[i]) { nd.kids[i] = new Node(nd.st.apply(nd.A[i])); nd = nd.kids[i]; break; }
        nd = nd.kids[i];
      }
      const ub = nd.term ? termU(nd.st) : nd.A ? nd.wb / Math.max(1, nd.n) : await expand(nd);
      nd.n++; nd.wb += ub;
      for (const [p, i] of path) { p.N[i]++; p.W[i] += ub; p.n++; p.wb += ub; }
    }
  }
  // 정책 목표 가지치기 (KataGo 식): 최선이 아닌 수는, 원래 사전 확률로도 PUCT 가 최선 수를 넘어 뽑혔을 만큼만 남긴다.
  // 탐색 보정(증강 10%)·잡음으로 억지로 늘어난 방문을 학습 목표에서 빼서, 신경망이 증강을 점점 더 쓰게 부풀지 않게 한다.
  function prunedN(root) {
    const N = Array.from(root.N), P = root.P0 || root.P, sg = root.st.col === 1 ? 1 : -1;
    let b = 0; for (let i = 1; i < N.length; i++) if (N[i] > N[b]) b = i;
    if (!N[b]) return N;
    const sq = Math.sqrt(Math.max(1, root.n)), vb = sg * root.W[b] / N[b] + O.cpuct * P[b] * sq / (1 + N[b]);
    for (let i = 0; i < N.length; i++) {
      if (i === b || !N[i]) continue;
      const q = sg * root.W[i] / N[i];
      if (q < vb) N[i] = Math.min(N[i], Math.floor(O.cpuct * P[i] * sq / (vb - q)));
    }
    return N;
  }
  const rootQ = (nd, col) => (col === 1 ? 1 : -1) * nd.wb / Math.max(1, nd.n);

  // ---------- 학습 기록 ----------
  let buf = [], fileSeq = 0;
  function dump(force) {
    if (!buf.length || (!force && buf.length < O.chunk)) return;
    const arr = new Float32Array(buf.length * SAMPLE); buf.forEach((s, i) => arr.set(s, i * SAMPLE));
    const f = path.join(DATA, `sp-${ME}-${String(fileSeq++).padStart(4, '0')}`);
    fs.writeFileSync(f + '.tmp', Buffer.from(arr.buffer)); fs.renameSync(f + '.tmp', f + '.bin');
    buf = [];
  }
  function sample(root, st, oneHot) {
    const sym = (Math.random() * 8) | 0, map = syms(n)[sym], s = new Float32Array(SAMPLE);
    st.features(sym, s, 0, s, area * NF2);
    const pi = s.subarray(IN, IN + 2 * area + 2);
    const idx = a => a < area ? map[a] : a === area ? area : a === 2 * area + 1 ? 2 * area + 1 : area + 1 + map[a - area - 1];
    if (oneHot !== undefined) pi[idx(oneHot)] = 1;
    else { const N = prunedN(root); let tot = 0; for (let i = 0; i < root.A.length; i++) tot += N[i]; for (let i = 0; i < root.A.length; i++) if (N[i]) pi[idx(root.A[i])] += N[i] / tot; }
    return { s, col: st.col, map };
  }
  function areaOwn(b) { // 흑 1 · 백 -1 · 공배 0 (모든 돌을 산 것으로)
    const o = new Float32Array(area), seen = new Uint8Array(b.size);
    for (let i = 0; i < area; i++) {
      const p = (Math.floor(i / n) + 1) * (n + 2) + (i % n) + 1, v = b.c[p];
      if (v === 1 || v === 2) { o[i] = v === 1 ? 1 : -1; continue; }
      if (seen[p]) continue;
      const reg = [], st = [p]; seen[p] = 1; let tb = false, tw = false;
      while (st.length) { const q = st.pop(); reg.push(q); for (const dd of b.d) { const r = q + dd, c = b.c[r]; if (c === 0) { if (!seen[r]) { seen[r] = 1; st.push(r); } } else if (c === 1) tb = true; else if (c === 2) tw = true; } }
      const val = tb && !tw ? 1 : tw && !tb ? -1 : 0;
      for (const q of reg) { const W = n + 2; o[((q / W | 0) - 1) * n + (q % W - 1)] = val; }
    }
    return o;
  }

  // ---------- 한 판 ----------
  async function playGame() {
    const komi = Math.max(-30.5, Math.min(40.5, 7.5 + Math.round(gauss() * 10)));
    const pick = () => Math.random() < 0.25 ? '' : AUG_LIST[(Math.random() * AUG_LIST.length) | 0];
    const aug = { 1: pick(), 2: pick() };
    let st = new St(n, komi, aug), root = new Node(st);
    const recs = [], turns = [], used = { 1: null, 2: null };
    // 증강을 가진 쪽의 1/4 은 무작위 시점에 억지로 한 번 쓰게 한다 (그 선택은 학습 기록에서 뺀다)
    const forceAt = {};
    for (const c of [1, 2]) if (['invincible', 'barrier', 'snipe', 'double'].includes(aug[c]) && Math.random() < 0.25) forceAt[c] = Math.floor(Math.random() * 50);
    let micro = 0;
    while (!st.terminal()) {
      const col = st.col;
      if (st.step === 'decide') turns.push({ st, col, rew: false });
      const forced = st.step === 'decide' && forceAt[col] !== undefined && micro >= forceAt[col] && st.canAug(col);
      if (forced) {
        await search(root, O.fast, false, false, true);
        let bi = -1; for (let i = 0; i < root.A.length; i++) if (isAug(root.A[i]) && (bi < 0 || root.N[i] > root.N[bi])) bi = i;
        if (bi >= 0) {
          delete forceAt[col];
          const a = root.A[bi]; used[col] = { kind: st.aug[col], at: micro, forced: true };
          const next = root.kids[bi] || new Node(st.apply(a)); st = next.st; root = next; micro++;
          continue;
        }
      }
      const full = Math.random() < O.pFull;
      await search(root, full ? O.full : O.fast, full);
      // 되감기: 뿌리에서만, 되감은 장면을 따로 읽어 확실히 나을 때
      if (st.step === 'decide' && st.aug[col] === 'rewind' && !st.used[col]) {
        const T = turns.length - 1;
        if (T >= 2 && turns[T - 1].col === 3 - col && turns[T - 2].col === col && !turns[T - 1].rew) {
          const back = turns[T - 2].st.clone(); back.used[col] = true; back.step = 'move';
          const broot = new Node(back); await search(broot, O.fast, false);
          if (rootQ(broot, col) > rootQ(root, col) + 0.1) {
            if (full) recs.push(sample(root, st, 2 * area + 1));
            used[col] = { kind: 'rewind', at: micro };
            turns.length = T - 2; turns.push({ st: back, col, rew: true });
            st = back; root = broot; micro++;
            continue;
          }
        }
      }
      if (full) recs.push(sample(root, st));
      let i = 0;
      if (micro < O.tempTurns) { const N = prunedN(root); let tot = 0; for (const c of N) tot += c; let r = Math.random() * tot; for (i = 0; i < N.length - 1; i++) { r -= N[i]; if (r <= 0) break; } }
      else { for (let j = 1; j < root.N.length; j++) if (root.N[j] > root.N[i]) i = j; }
      const a = root.A[i];
      if (a > area && !used[col]) used[col] = { kind: st.aug[col], at: micro };
      const next = root.kids[i] || new Node(st.apply(a));
      st = next.st; root = next; micro++;
    }
    const sc = st.score(), ownB = areaOwn(st.b);
    for (const r of recs) {
      const sg = r.col === 1 ? 1 : -1, o = r.s;
      o[IN + 2 * area + 2] = Math.sign(sc) * sg;      // 이겼나 (두는 쪽 기준)
      o[IN + 2 * area + 3] = sc * sg;                 // 집 차이 (두는 쪽 기준)
      for (let k = 0; k < area; k++) o[IN + 2 * area + 4 + r.map[k]] = sg * ownB[k];
      buf.push(o);
    }
    dump(false);
    parentPort.postMessage({ game: { aug: [aug[1], aug[2]], komi, score: sc, len: micro, samples: recs.length, used, t: Date.now() } });
  }
  const stopFile = path.join(HERE, 'STOP'), pauseFile = path.join(HERE, 'PAUSE'); // PAUSE: 온도가 높아 쉼 (run.js 가 식으면 지우고 다시 띄움)
  const throttleFile = path.join(HERE, 'THROTTLE');
  setInterval(() => { try { slow = Math.max(0, +fs.readFileSync(throttleFile, 'utf8') || 0); } catch (e) { slow = 0; } }, 1000);
  setInterval(() => { const h = fs.existsSync(pauseFile); if (halt && !h) { halt = false; kick(); } else halt = h; }, 1000);
  async function slot() { active++; while (!fs.existsSync(stopFile)) await playGame(); active--; kick(); }
  sock.on('connect', async () => { await Promise.all(Array.from({ length: O.games }, slot)); dump(true); sock.end(); process.exit(0); });
}
