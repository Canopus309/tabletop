// 증강 점수 측정 (몬테카를로 AI 자가대국, tools/aug/sim.js). 결과는 한 판씩 JSONL 에 쌓아 언제 멈춰도 이어서 돌린다.
// 사용: node tools/aug/measure.js --n 13 --P 3000 --K 48 --workers 8 --until 2026-10-13T07:30 --out tools/aug/results/mc-13.jsonl
// 대국 구성: 둘 다 증강 없음 + 증강마다 (흑만 그 증강) · (백만 그 증강). 판 수가 가장 적은 구성부터 채운다
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path'), os = require('os');
const AUGS = ['kowang', 'rewind', 'snipe', 'double', 'invincible', 'barrier'];
const CFGS = [['', '']].concat(AUGS.flatMap(a => [[a, ''], ['', a]]));

if (isMainThread) {
  const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
  const o = { n: +(arg('n') || 13), komi: 7.5, P: +(arg('P') || 3000), K: +(arg('K') || 48), thrW: 0.15, thrS: 4, thrR: 0.2, final: +(arg('final') || 400) };
  const W = +(arg('workers') || 4), until = arg('until') ? Date.parse(arg('until')) : Infinity;
  const out = arg('out') || `tools/aug/results/mc-${o.n}.jsonl`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try { os.setPriority(0, 19); } catch (e) { } // 낮은 우선순위 (다른 작업이 느려지지 않게)
  const count = CFGS.map(() => 0);
  if (fs.existsSync(out)) for (const l of fs.readFileSync(out, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); const i = CFGS.findIndex(c => c[0] === r.augB && c[1] === r.augW); if (i >= 0 && r.P === o.P) count[i]++; } catch (e) { } }
  const inflight = CFGS.map(() => 0);
  const next = () => { let bi = 0; for (let i = 1; i < CFGS.length; i++) if (count[i] + inflight[i] < count[bi] + inflight[bi]) bi = i; return bi; };
  let done = 0, alive = W;
  const t0 = Date.now();
  console.log(`시작 ${new Date().toLocaleString('ko-KR')} · ${o.n}줄 P=${o.P} K=${o.K} 일꾼 ${W} · 지금까지 ${count.reduce((a, b) => a + b, 0)}판 · 끝 ${isFinite(until) ? new Date(until).toLocaleString('ko-KR') : '없음'}`);
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: o });
    const give = () => {
      if (Date.now() > until || fs.existsSync(out + '.stop')) { wk.postMessage(null); return; }
      const i = next(); inflight[i]++; wk.postMessage({ i, augB: CFGS[i][0], augW: CFGS[i][1] });
    };
    wk.on('message', m => {
      if (m.ready) { give(); return; }
      inflight[m.i]--; count[m.i]++; done++;
      fs.appendFileSync(out, JSON.stringify({ augB: m.augB, augW: m.augW, n: o.n, P: o.P, K: o.K, ...m.r, at: Date.now() }) + '\n');
      if (done % 20 === 0) console.log(`${new Date().toLocaleTimeString('ko-KR')} ${done}판 (${((Date.now() - t0) / done / 1000 * W).toFixed(0)}초/판) 구성별 최소 ${Math.min(...count)}판`);
      give();
    });
    wk.on('exit', () => { if (--alive === 0) console.log(`끝 ${new Date().toLocaleString('ko-KR')} · 이번에 ${done}판`); });
    wk.on('error', e => console.error('일꾼 오류', e));
  }
} else {
  const { playGame } = require('./sim.js');
  parentPort.on('message', job => {
    if (!job) { process.exit(0); }
    const r = playGame({ ...workerData, augB: job.augB, augW: job.augW });
    parentPort.postMessage({ i: job.i, augB: job.augB, augW: job.augW, r });
  });
  parentPort.postMessage({ ready: true });
}
