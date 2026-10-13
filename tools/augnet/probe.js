// 신경망에게 묻는 공정한 덤: 빈 9줄 판, 흑·백 증강 조합마다 덤을 바꿔 가며 흑 승률(이김-짐)이 0 이 되는 덤을 찾는다.
// 증강 점수 = (흑만 그 증강일 때 공정한 덤 - 둘 다 없음) 과 (둘 다 없음 - 백만 그 증강일 때) 의 평균
// 사용: node probe.js [--port 19190]  → models/probe-log.jsonl 에 한 줄 더하고 표를 찍는다
'use strict';
const net = require('net'), fs = require('fs'), path = require('path');
const { St, AUG_LIST, NF2, NG2 } = require('./game.js');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('port', 19190), n = 9, area = n * n, IN = area * NF2 + NG2, OUT = 3 * area + 9;
const NAME = { kowang: '패왕', rewind: '되감기', snipe: '저격', double: '슈퍼선수', invincible: '무적수', barrier: '결계', wall: '벽', swap: '맞바꾸기', prisoner: '포로교환', '': '없음' };
const AUGS = [''].concat(AUG_LIST), KOMI = []; for (let k = -30.5; k <= 40.5; k += 1) KOMI.push(k);

const sock = net.connect(PORT, '127.0.0.1'); let rbuf = Buffer.alloc(0), want = 0, cb = null;
sock.on('data', d => { rbuf = Buffer.concat([rbuf, d]); if (cb && rbuf.length >= want) { const b = rbuf.subarray(0, want); rbuf = rbuf.subarray(want); const f = cb; cb = null; f(b); } });
const ask = (x, cnt) => new Promise(res => { want = cnt * OUT * 4; cb = b => res(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))); const h = Buffer.alloc(8); h.writeUInt32LE(cnt, 0); h.writeUInt32LE(n, 4); sock.write(Buffer.concat([h, Buffer.from(x.buffer)])); });

sock.on('connect', async () => {
  const jobs = [];
  for (const ab of AUGS) for (const aw of AUGS) for (const k of KOMI) jobs.push({ ab, aw, k });
  const wl = new Float32Array(jobs.length), lead = new Float32Array(jobs.length);
  for (let s = 0; s < jobs.length; s += 512) {
    const part = jobs.slice(s, s + 512), x = new Float32Array(part.length * IN);
    part.forEach((j, i) => new St(n, j.k, { 1: j.ab, 2: j.aw }).features(0, x, i * IN, x, i * IN + area * NF2));
    const o = await ask(x, part.length);
    part.forEach((j, i) => { const b = i * OUT + 2 * area + 2, v0 = o[b], v1 = o[b + 1], v2 = o[b + 2], m = Math.max(v0, v1, v2), e0 = Math.exp(v0 - m), e1 = Math.exp(v1 - m), e2 = Math.exp(v2 - m); wl[s + i] = (e0 - e1) / (e0 + e1 + e2); lead[s + i] = o[b + 3] * 20; });
  }
  const fair = {};
  for (const ab of AUGS) for (const aw of AUGS) {
    const base = jobs.findIndex(j => j.ab === ab && j.aw === aw); let f = null;
    for (let i = 0; i + 1 < KOMI.length; i++) { const a = wl[base + i], b = wl[base + i + 1]; if (a >= 0 && b < 0) { f = KOMI[i] + a / (a - b); break; } }
    fair[ab + '|' + aw] = f === null ? (wl[base] < 0 ? KOMI[0] : KOMI[KOMI.length - 1]) : +f.toFixed(1);
  }
  // 집 차이 출력으로 본 공정한 덤: 덤 7.5 일 때 흑(두는 쪽)의 예상 집 차이 + 7.5
  const fairS = {}, k75 = KOMI.indexOf(7.5);
  for (const ab of AUGS) for (const aw of AUGS) { const base = jobs.findIndex(j => j.ab === ab && j.aw === aw); fairS[ab + '|' + aw] = +(7.5 + lead[base + k75]).toFixed(1); }
  const f0 = fair['|'], val = {}, s0 = fairS['|'], valS = {};
  for (const a of AUG_LIST) { val[a] = +(((fair[a + '|'] - f0) + (f0 - fair['|' + a])) / 2).toFixed(1); valS[a] = +(((fairS[a + '|'] - s0) + (s0 - fairS['|' + a])) / 2).toFixed(1); }
  let gen = '?'; try { gen = fs.readFileSync(path.join(__dirname, 'models' + (process.env.AUGNET_NET && process.env.AUGNET_NET !== 'b10' ? '-' + process.env.AUGNET_NET : ''), 'latest.txt'), 'utf8').trim(); } catch (e) { }
  const rec = { gen, t: new Date().toISOString(), fairNone: f0, value: val, fair, fairNoneS: s0, valueS: valS, fairS };
  fs.appendFileSync(path.join(__dirname, 'models' + (process.env.AUGNET_NET && process.env.AUGNET_NET !== 'b10' ? '-' + process.env.AUGNET_NET : ''), 'probe-log.jsonl'), JSON.stringify(rec) + '\n');
  console.log(`${gen} · 증강 없을 때 공정한 덤 ${f0}`);
  console.log(AUG_LIST.map(a => `${NAME[a]} ${val[a]}`).join(' · '));
  console.log(`집 차이 출력으로: 없음 ${s0} · ` + AUG_LIST.map(a => `${NAME[a]} ${valS[a]}`).join(' · '));
  sock.end();
});
sock.on('error', e => { console.error('서버 연결 실패', e.message); process.exit(1); });
