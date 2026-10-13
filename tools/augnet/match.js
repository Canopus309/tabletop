// 두 신경망 대결: 같은 증강·같은 덤으로 흑백을 바꿔 두 판씩 둔다. "학습한 신경망이 처음 KataGo 보다 증강 바둑을 잘 두나" 를 잰다.
// 각 신경망은 자기 서버(server.py --model ... --port ...)를 쓴다. 자기 차례마다 새로 읽는다 (나무를 나누지 않음).
// 사용: node match.js --a 19191 --b 19192 [--pairs 150] [--visits 64] [--workers 3] [--noaug 0.2]  → 결과를 찍고 models/match-log.jsonl 에 남김
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const net = require('net'), fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const O = { n: 9, a: +arg('a', 19191), b: +arg('b', 19192), pairs: +arg('pairs', 150), visits: +arg('visits', 64), workers: +arg('workers', 3), noaug: +arg('noaug', 0.2), cpuct: 1.3, tempTurns: 6, label: arg('label', '') };
if (!isMainThread) Object.assign(O, workerData);

if (isMainThread) {
  const res = [], t0 = Date.now(); let alive = O.workers;
  const per = Math.ceil(O.pairs / O.workers);
  for (let w = 0; w < O.workers; w++) {
    const wk = new Worker(__filename, { workerData: { ...O, pairs: Math.min(per, O.pairs - w * per), seed: w } });
    wk.on('message', m => { res.push(m); if (res.length % 40 === 0) console.log(`${res.length}판 · ${((Date.now() - t0) / 60000).toFixed(1)}분`); });
    wk.on('error', e => console.error('일꾼 오류', e));
    wk.on('exit', () => { if (--alive) return; finish(); });
  }
  function finish() {
    const NAME = { kowang: '패왕', rewind: '되감기', snipe: '저격', double: '슈퍼선수', invincible: '무적수', barrier: '결계', wall: '벽', swap: '맞바꾸기', prisoner: '포로교환', mirror: '거울수', grow: '증식', save: '패스 저축', teleport: '순간이동', para: '공수부대', fork: '양자택일', shadow: '예약수', '': '없음' };
    const sum = rs => { let w = 0, d = 0; for (const r of rs) { w += r.aWin; d += r.aLead; } return { games: rs.length, aWinRate: +(w / Math.max(1, rs.length)).toFixed(3), aLead: +(d / Math.max(1, rs.length)).toFixed(1) }; };
    const aug = sum(res.filter(r => r.aug[0] || r.aug[1])), plain = sum(res.filter(r => !r.aug[0] && !r.aug[1]));
    // 증강을 쓴 쪽이 어느 신경망이었나: 증강별로 A 쪽이 그 증강을 가졌을 때 A 의 평균 집 차이
    const by = {};
    for (const r of res) for (const c of [0, 1]) { const k = r.aug[c]; if (!k) continue; const aHas = (c === 0) === r.aBlack; (by[k] = by[k] || { aHas: [], bHas: [] })[aHas ? 'aHas' : 'bHas'].push(r.aLead); }
    const rec = { t: new Date().toISOString(), label: O.label, visits: O.visits, aug, plain, byAug: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { aHas: +(v.aHas.reduce((s, x) => s + x, 0) / Math.max(1, v.aHas.length)).toFixed(1), bHas: +(v.bHas.reduce((s, x) => s + x, 0) / Math.max(1, v.bHas.length)).toFixed(1), n: v.aHas.length + v.bHas.length }])) };
    fs.appendFileSync(path.join(__dirname, 'models' + (process.env.AUGNET_NET && process.env.AUGNET_NET !== 'b10' ? '-' + process.env.AUGNET_NET : ''), 'match-log.jsonl'), JSON.stringify(rec) + '\n');
    console.log(`${O.label} · 증강 판 ${aug.games}판: A 승률 ${aug.aWinRate} (평균 ${aug.aLead}집) · 증강 없는 판 ${plain.games}판: A 승률 ${plain.aWinRate} (평균 ${plain.aLead}집)`);
    for (const [k, v] of Object.entries(rec.byAug)) console.log(`  ${NAME[k]}: A 가 가졌을 때 A ${v.aHas}집 · B 가 가졌을 때 A ${v.bHas}집 (${v.n})`);
    process.exit(0);
  }
} else {
  const { St, syms, AUG_LIST, NF2, NG2 } = require('./game.js');
  const n = O.n, area = n * n, OUT = 3 * area + 9, IN = area * NF2 + NG2;

  // 온도 조절 신호: THROTTLE (쉬는 비율) · PAUSE (멈춤) — run.js 온도 지킴이가 씀
  const TH = { slow: 0, halt: false, nets: [] };
  setInterval(() => {
    try { TH.slow = Math.max(0, +fs.readFileSync(path.join(__dirname, 'THROTTLE'), 'utf8') || 0); } catch (e) { TH.slow = 0; }
    const h = fs.existsSync(path.join(__dirname, 'PAUSE')); if (TH.halt && !h) { TH.halt = false; TH.nets.forEach(x => x.kick()); } else TH.halt = h;
  }, 1000).unref();
  // 신경망 하나 = 서버 연결 하나 + 묶음 계산
  function Net(port) {
    const sock = net.connect(port, '127.0.0.1'); sock.setNoDelay(true);
    let rbuf = Buffer.alloc(0), want = 0, onData = null, pend = [], busy = false, sched = false, act = 0, mark = Date.now();
    const ready = new Promise(r => sock.on('connect', r));
    sock.on('data', d => { rbuf = Buffer.concat([rbuf, d]); if (onData && rbuf.length >= want) { const b = rbuf.subarray(0, want); rbuf = rbuf.subarray(want); const f = onData; onData = null; f(b); } });
    sock.on('error', e => { console.error('서버 연결 오류', port, e.message); process.exit(1); });
    const ask = (buf, cnt) => new Promise(res => { want = cnt * OUT * 4; onData = b => res(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))); sock.write(buf); });
    function kick() {
      if (busy || !pend.length || TH.halt) return;
      if (!sched) { sched = true; setImmediate(() => { sched = false; if (!busy && pend.length) flush(); }); }
    }
    async function flush() {
      busy = true;
      act += Date.now() - mark; // 온도 조절: run.js 의 THROTTLE (일한 시간 × slow 만큼 쉼)
      if (TH.slow > 0) { const w = Math.min(5000, act * TH.slow); act = 0; if (w >= 2) await new Promise(r => setTimeout(r, w)); } else act = 0;
      const t0 = Date.now(); const batch = pend; pend = [];
      const hdr = Buffer.alloc(8); hdr.writeUInt32LE(batch.length, 0); hdr.writeUInt32LE(n, 4);
      const x = new Float32Array(batch.length * IN), symL = [];
      batch.forEach((b, i) => { const s = (Math.random() * 8) | 0; symL.push(s); b.st.features(s, x, i * IN, x, i * IN + area * NF2); });
      act += Date.now() - t0;
      const out = await ask(Buffer.concat([hdr, Buffer.from(x.buffer)]), batch.length);
      const t2 = Date.now();
      batch.forEach((b, i) => b.res(parse(b.st, symL[i], out.subarray(i * OUT, (i + 1) * OUT))));
      act += Date.now() - t2; mark = Date.now(); busy = false; kick();
    }
    const me = { ready, eval: st => new Promise(res => { pend.push({ st, res }); kick(); }), end: () => sock.end(), kick };
    TH.nets.push(me); return me;
  }
  function parse(st, sym, o) {
    const map = syms(n)[sym], A = st.actions(), lg = new Float64Array(A.length);
    for (let i = 0; i < A.length; i++) { const a = A[i]; lg[i] = a < area ? o[map[a]] : a === area ? o[area] : a === 2 * area + 1 ? o[2 * area + 1] : o[area + 1 + map[a - area - 1]]; }
    let mx = -Infinity; for (const v of lg) if (v > mx) mx = v;
    let s = 0; const P = new Float64Array(A.length); for (let i = 0; i < A.length; i++) { P[i] = Math.exp(lg[i] - mx); s += P[i]; }
    for (let i = 0; i < A.length; i++) P[i] /= s;
    const v0 = o[2 * area + 2], v1 = o[2 * area + 3], v2 = o[2 * area + 4], vm = Math.max(v0, v1, v2);
    const e0 = Math.exp(v0 - vm), e1 = Math.exp(v1 - vm), e2 = Math.exp(v2 - vm), es = e0 + e1 + e2;
    return { A, P, u: (e0 - e1) / es + 0.15 * (2 / Math.PI) * Math.atan(o[2 * area + 7] * 20 / (0.5 * n)) };
  }
  // 수 읽기: selfplay.js 와 같은 PUCT (잡음·탐색 보정 없음)
  class Node { constructor(st) { this.st = st; this.A = null; this.n = 0; this.wb = 0; this.u0 = 0; this.term = st.terminal(); } }
  const termU = st => { const s = st.score(); return Math.sign(s) + 0.15 * (2 / Math.PI) * Math.atan(s / (0.5 * n)); };
  async function expand(nd, nn) { const r = await nn.eval(nd.st); nd.A = r.A; nd.P = r.P; nd.N = new Int32Array(r.A.length); nd.W = new Float64Array(r.A.length); nd.kids = new Array(r.A.length); nd.u0 = nd.st.col === 1 ? r.u : -r.u; return nd.u0; }
  function select(nd) {
    const sg = nd.st.col === 1 ? 1 : -1, pq = nd.n ? sg * nd.wb / nd.n : sg * nd.u0;
    let seen = 0; for (let i = 0; i < nd.A.length; i++) if (nd.N[i]) seen += nd.P[i];
    const fpu = pq - 0.2 * Math.sqrt(seen), sq = Math.sqrt(Math.max(1, nd.n));
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < nd.A.length; i++) { const q = nd.N[i] ? sg * nd.W[i] / nd.N[i] : fpu, v = q + O.cpuct * nd.P[i] * sq / (1 + nd.N[i]); if (v > bv) { bv = v; bi = i; } }
    return bi;
  }
  async function search(root, nn) {
    if (root.term) return;
    if (!root.A) { const u = await expand(root, nn); root.n++; root.wb += u; }
    for (let v = 0; v < O.visits; v++) {
      let nd = root; const pth = [];
      while (nd.A && !nd.term) { const i = select(nd); pth.push([nd, i]); if (!nd.kids[i]) { nd.kids[i] = new Node(nd.st.apply(nd.A[i])); nd = nd.kids[i]; break; } nd = nd.kids[i]; }
      const ub = nd.term ? termU(nd.st) : nd.A ? nd.wb / Math.max(1, nd.n) : await expand(nd, nn);
      nd.n++; nd.wb += ub;
      for (const [p, i] of pth) { p.N[i]++; p.W[i] += ub; p.n++; p.wb += ub; }
    }
  }
  const rootQ = (nd, col) => (col === 1 ? 1 : -1) * nd.wb / Math.max(1, nd.n);

  async function play(aug, komi, nets) {
    let st = new St(n, komi, aug); const turns = []; let micro = 0;
    while (!st.terminal()) {
      const col = st.col, nn = nets[col];
      if (st.step === 'decide') turns.push({ st, col, rew: false });
      const root = new Node(st); await search(root, nn);
      if (st.step === 'decide' && st.aug[col] === 'rewind' && !st.used[col]) {
        const T = turns.length - 1;
        if (T >= 2 && turns[T - 1].col === 3 - col && turns[T - 2].col === col && !turns[T - 1].rew) {
          const back = turns[T - 2].st.clone(); back.used[col] = true; back.step = 'move';
          const broot = new Node(back); await search(broot, nn);
          if (rootQ(broot, col) > rootQ(root, col) + 0.1) { turns.length = T - 2; turns.push({ st: back, col, rew: true }); st = back; micro++; continue; }
        }
      }
      let i = 0; for (let k = 1; k < root.N.length; k++) if (root.N[k] > root.N[i]) i = k;
      // 첫 몇 수는 (증강 쓰기가 최선이 아니면) 읽은 횟수 비율로 골라 판마다 다르게
      if (micro < O.tempTurns && root.A[i] <= area) { let tot = 0; for (let k = 0; k < root.A.length; k++) if (root.A[k] <= area) tot += root.N[k]; let r = Math.random() * tot; for (let k = 0; k < root.A.length; k++) if (root.A[k] <= area) { r -= root.N[k]; if (r <= 0) { i = k; break; } } }
      st = st.apply(root.A[i]); micro++;
      if (micro > 400) break;
    }
    return st.score();
  }
  (async () => {
    const A = Net(O.a), B = Net(O.b); await Promise.all([A.ready, B.ready]);
    const one = async () => {
      // 같은 증강·덤으로 흑백 바꿔 두 판
      const pick = () => AUG_LIST[(Math.random() * AUG_LIST.length) | 0];
      const plain = Math.random() < O.noaug, aug = plain ? { 1: '', 2: '' } : { 1: pick(), 2: pick() };
      const komi = 7.5;
      for (const r of [true, false]) {
        const nets = r ? { 1: A, 2: B } : { 1: B, 2: A };
        const sc = await play(aug, komi, nets);
        const aLead = r ? sc : -sc;
        parentPort.postMessage({ aug: [aug[1], aug[2]], aBlack: r, score: sc, aWin: aLead > 0 ? 1 : 0, aLead });
      }
    };
    let left = O.pairs; const slots = Array.from({ length: Math.min(32, O.pairs) }, async () => { while (left-- > 0) await one(); });
    await Promise.all(slots); A.end(); B.end(); process.exit(0);
  })();
}
