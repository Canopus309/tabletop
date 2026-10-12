// 측정 결과 요약: 증강 점수 = (흑만 그 증강일 때 평균 집 차이 - 백만 그 증강일 때) / 2 (흑을 먼저 두는 이점은 서로 지워짐)
// 사용: node tools/aug/fit.js tools/aug/results/mc-13.jsonl [더 많은 파일…]
'use strict';
const fs = require('fs');
const NAME = { kowang: '패왕', rewind: '되감기', snipe: '저격', double: '슈퍼선수', invincible: '무적수', barrier: '결계' };
const rows = process.argv.slice(2).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
const by = {};
for (const r of rows) (by[`${r.n}|${r.augB}|${r.augW}`] ||= []).push(r);
const stat = a => { const n = a.length, m = a.reduce((s, x) => s + x, 0) / n, v = a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1); return { n, m, sd: Math.sqrt(v), se: Math.sqrt(v / n) }; };
const sizes = [...new Set(rows.map(r => r.n))].sort((a, b) => a - b);
for (const n of sizes) {
  const g = (b, w) => by[`${n}|${b}|${w}`] || [];
  const base = g('', '');
  if (base.length) { const s = stat(base.map(r => r.margin)); console.log(`\n${n}줄 · 둘 다 증강 없음 ${s.n}판: 흑 평균 ${s.m.toFixed(1)}집 (덤 7.5 뒤, 표준편차 ${s.sd.toFixed(0)}), 흑 승률 ${(base.filter(r => r.margin > 0).length / base.length * 100).toFixed(0)}%`); }
  console.log('증강      점수(집)   ±오차   흑만 가짐(판·흑평균)   백만 가짐(판·흑평균)   쓴 비율·평균 수');
  const out = [];
  for (const a of Object.keys(NAME)) {
    const B = g(a, ''), W = g('', a);
    if (!B.length || !W.length) continue;
    const sb = stat(B.map(r => r.margin)), sw = stat(W.map(r => r.margin));
    const v = (sb.m - sw.m) / 2, se = Math.sqrt(sb.se ** 2 + sw.se ** 2) / 2;
    const used = B.map(r => r.usedB).concat(W.map(r => r.usedW)), u = used.filter(x => x !== null);
    out.push({ a, v, se });
    console.log(`${NAME[a].padEnd(5)} ${v.toFixed(1).padStart(8)} ${('±' + se.toFixed(1)).padStart(7)}   ${String(sb.n).padStart(5)}판 ${sb.m.toFixed(1).padStart(7)}       ${String(sw.n).padStart(5)}판 ${sw.m.toFixed(1).padStart(7)}       ${(u.length / used.length * 100).toFixed(0)}% · ${u.length ? (u.reduce((s, x) => s + x, 0) / u.length).toFixed(0) + '수째' : '-'}`);
  }
  console.log('순서: ' + out.sort((x, y) => y.v - x.v).map(x => `${NAME[x.a]} ${x.v.toFixed(0)}`).join(' > '));
}
