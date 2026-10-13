// 실제 자기 대국 결과로 증강 값 재기: 흑 집 차이(덤 빼기 전) = 기본 + 값[흑 증강] - 값[백 증강] 를 최소제곱으로 푼다.
// 억지로 쓰게 한 판(forced)은 증강 값을 낮춰 보이게 하므로 뺀다. 값의 ± 는 표준 오차.
// 사용: node analyze.js [--last 4000]   (run.js 보고서에서도 fit() 을 부른다)
'use strict';
const fs = require('fs'), path = require('path');
const { AUG_LIST: AUGS } = require('./game.js');

function solve(A, b) {   // 작은 대칭 행렬: 가우스 소거, 역행렬도 함께
  const k = b.length, M = A.map((r, i) => r.concat(Array.from({ length: k }, (_, j) => +(i === j)), [b[i]]));
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; if (Math.abs(d) < 1e-9) return null;
    for (let j = 0; j <= 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j <= 2 * k; j++) M[r][j] -= f * M[c][j]; }
  }
  return { x: M.map(r => r[2 * k]), inv: M.map(r => r.slice(k, 2 * k)) };
}

function fit(games) {
  const rows = games.filter(g => !(g.used && ((g.used[1] && g.used[1].forced) || (g.used[2] && g.used[2].forced))));
  const k = AUGS.length + 1, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0), X = [];
  for (const g of rows) {
    const x = new Array(k).fill(0); x[0] = 1;
    const ib = AUGS.indexOf(g.aug[0]), iw = AUGS.indexOf(g.aug[1]);
    if (ib >= 0) x[ib + 1] += 1; if (iw >= 0) x[iw + 1] -= 1;
    const y = g.score + g.komi; X.push([x, y]);
    for (let i = 0; i < k; i++) { b[i] += x[i] * y; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; }
  }
  const s = rows.length > k ? solve(A, b) : null; if (!s) return null;
  let rss = 0; for (const [x, y] of X) { let p = 0; for (let i = 0; i < k; i++) p += x[i] * s.x[i]; rss += (y - p) ** 2; }
  const s2 = rss / (X.length - k), se = i => Math.sqrt(Math.max(0, s2 * s.inv[i][i]));
  const out = { games: X.length, base: +s.x[0].toFixed(1), baseSe: +se(0).toFixed(1), value: {}, se: {} };
  AUGS.forEach((a, i) => { out.value[a] = +s.x[i + 1].toFixed(1); out.se[a] = +se(i + 1).toFixed(1); });
  return out;
}

if (require.main === module) {
  const i = process.argv.indexOf('--last'), last = i > 0 ? +process.argv[i + 1] : 4000;
  const games = fs.readFileSync(path.join(__dirname, 'data' + (process.env.AUGNET_NET && process.env.AUGNET_NET !== 'b10' ? '-' + process.env.AUGNET_NET : ''), 'games.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const NAME = { kowang: '패왕', rewind: '되감기', snipe: '저격', double: '슈퍼선수', invincible: '무적수', barrier: '결계', wall: '벽', swap: '맞바꾸기', prisoner: '포로교환' };
  for (const [lo, hi] of [[0, last], [Math.max(0, games.length - last), games.length]]) {
    const r = fit(games.slice(lo, hi)); if (!r) continue;
    console.log(`${lo}~${hi}판 (억지 사용 판 뺀 ${r.games}판) · 흑 기본 우세 ${r.base}±${r.baseSe}`);
    console.log(AUGS.map(a => `${NAME[a]} ${r.value[a]}±${r.se[a]}`).join(' · '));
  }
}
module.exports = { fit, AUGS };
