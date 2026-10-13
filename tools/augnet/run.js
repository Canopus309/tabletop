// 증강 바둑 신경망 학습 전체 실행: 신경망 서버 · 자기 대국 · 학습을 함께 돌리고, 30분마다 공정한 덤을 재고, PROGRESS.md 를 고친다.
// 사용: node run.js   (tools/augnet/STOP 파일을 만들면 모두 멈춤. 죽은 것은 다시 띄운다)
'use strict';
const { spawn, execFile } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const HERE = __dirname, LOGS = path.join(HERE, 'logs'), PY = process.env.AUGNET_PY || path.join(os.homedir(), 'AppData/Local/Programs/Python/Python312/python.exe');
fs.mkdirSync(LOGS, { recursive: true }); 
// --net b15 → 자식 프로세스 모두 AUGNET_NET=b15 (data-b15/ · models-b15/)
if (process.argv.indexOf('--net') > 0) process.env.AUGNET_NET = process.argv[process.argv.indexOf('--net') + 1];
const SUF = process.env.AUGNET_NET && process.env.AUGNET_NET !== 'b10' ? '-' + process.env.AUGNET_NET : '', MD = 'models' + SUF, DD = 'data' + SUF;
const stop = () => fs.existsSync(path.join(HERE, 'STOP'));
fs.mkdirSync(path.join(HERE, MD), { recursive: true }); fs.mkdirSync(path.join(HERE, DD), { recursive: true });
const PAUSE = path.join(HERE, 'PAUSE'), paused = () => fs.existsSync(PAUSE);
const procs = {};
const { fit } = require('./analyze.js');
function start(name, cmd, args, delay = 0) {
  setTimeout(() => {
    if (stop()) return;
    if (name === 'selfplay' && paused()) { start(name, cmd, args, 30000); return; }
    const out = fs.openSync(path.join(LOGS, name + '.log'), 'a');
    const p = spawn(cmd, args, { cwd: HERE, stdio: ['ignore', out, out], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    procs[name] = p;
    try { os.setPriority(p.pid, name === 'selfplay' ? 10 : 0); } catch (e) { }
    p.on('exit', code => { procs[name] = null; if (!stop()) { fs.appendFileSync(path.join(LOGS, 'run.log'), `${new Date().toISOString()} ${name} 끝남(${code}) → 다시 띄움\n`); start(name, cmd, args, 10000); } });
  }, delay);
}
start('server', PY, ['server.py']);
start('train', PY, ['train.py']);
const WORKERS = (process.argv.indexOf('--workers') > 0 ? process.argv[process.argv.indexOf('--workers') + 1] : '6');
const RA = (k, d) => (process.argv.indexOf('--' + k) > 0 ? process.argv[process.argv.indexOf('--' + k) + 1] : d);
start('selfplay', process.execPath, ['selfplay.js', '--workers', WORKERS, '--games', '32', '--full', RA('full', '200'), '--fast', RA('fast', '48')], 15000);

// 실력 재기 (b15 부터): 2시간마다 eval.js. 크게 약해져 되돌리면 (RESTART_TRAIN) 학습을 다시 띄워 되돌린 가중치에서 잇는다
const RT = path.join(HERE, 'RESTART_TRAIN');
let evaling = false;
function evaluate() {
  if (evaling || stop()) return; evaling = true;
  const out = fs.openSync(path.join(LOGS, 'eval.log'), 'a');
  const p = spawn(process.execPath, ['eval.js'], { cwd: HERE, stdio: ['ignore', out, out] });
  p.on('exit', () => { evaling = false; if (fs.existsSync(RT)) { fs.unlinkSync(RT); if (procs.train) procs.train.kill(); } report(); });
}
if (SUF) setInterval(evaluate, +RA('eval-hours', '2') * 3600000);

// 온도 지킴이: 5초마다 CPU 온도를 읽어 logs/temp.log 에 남긴다. hot 도를 넘으면 자기 대국을 그 자리에 얼리고(PAUSE),
// cool 도까지 식으면 이어서 둔다 (사용자 요청 2026-10-13). 그 아래에서는 hot-10 ~ hot-5 도에 머물도록 잘게 쉰다. 이 노트북 CPU 는 일을 시작하면 30초 안에 90도까지 올라서 자주 오간다.
// 기준은 thermo.json {hot, cool} 에서 읽는다 (고치면 다시 띄우지 않아도 바로 적용). 2026-10-13: 처음 70/50 → 사용자가 80/60 으로 올림
const TH = path.join(HERE, 'thermo.json');
const th = () => { try { const j = JSON.parse(fs.readFileSync(TH, 'utf8')); return { hot: +j.hot || 80, cool: +j.cool || 60 }; } catch (e) { return { hot: 80, cool: 60 }; } };
let iPaused = paused(), lastTemp = '', pausedMs = 0, sinceMs = Date.now(), pauseAt = iPaused ? Date.now() : 0;
const tlog = s => fs.appendFileSync(path.join(LOGS, 'temp.log'), s + '\n');
const THROTTLE = path.join(HERE, 'THROTTLE');
let slow = (() => { try { return +fs.readFileSync(THROTTLE, 'utf8') || 3; } catch (e) { return 3; } })(); // 처음엔 일 1 : 쉼 3
function thermo() {
  const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'temp.ps1'), '-Every', '5'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let rest = '';
  p.stdout.on('data', d => {
    const lines = (rest + d).split(/\r?\n/); rest = lines.pop();
    for (const l of lines) {
      const m = /cpu=([\d.]+)/.exec(l); if (!m) continue;
      lastTemp = l.trim(); tlog(`${lastTemp} slow=${slow.toFixed(2)}`);
      const c = +m[1], { hot: HOT, cool: COOL } = th();
      // 잘게 쉬기: 70도에 닿기 전에 60~65도에 머물도록 자기 대국의 쉬는 비율(THROTTLE)을 조금씩 바꾼다
      if (c > HOT - 5) slow = Math.min(30, slow * 1.3 + 0.2); else if (c < HOT - 10) slow = Math.max(0, slow / 1.15 - 0.05);
      if (c > HOT) slow = Math.min(30, Math.max(slow * 2, 2));
      fs.writeFileSync(THROTTLE, slow.toFixed(2));
      if (c > HOT && !paused()) { fs.writeFileSync(PAUSE, lastTemp); iPaused = true; pauseAt = Date.now(); tlog(`  ${c}도 → 자기 대국 얼림`); }
      if (iPaused && c <= COOL && paused()) { fs.unlinkSync(PAUSE); iPaused = false; pausedMs += Date.now() - pauseAt; tlog(`  ${c}도로 식음 → 자기 대국 이어서`); }
    }
  });
  p.on('exit', () => { if (!stop()) setTimeout(thermo, 5000); });
  procs.thermo = p; p.on('exit', () => { procs.thermo = null; });
}
thermo();
// 쉰 시간 비율 (보고서용)
const restRatio = () => { const tot = Date.now() - sinceMs, ps = pausedMs + (iPaused ? Date.now() - pauseAt : 0); return tot ? Math.round(ps / tot * 100) : 0; };
// 멈출 때 온도 읽기도 끝낸다
setInterval(() => { if (stop() && procs.thermo) procs.thermo.kill(); }, 5000);

// 진행 보고서
function report() {
  const rd = f => { try { return fs.readFileSync(path.join(HERE, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; } };
  const games = rd(DD + '/games.jsonl'), tl = rd(MD + '/train-log.jsonl'), pl = rd(MD + '/probe-log.jsonl');
  const NAME = { kowang: '패왕', rewind: '되감기', snipe: '저격', double: '슈퍼선수', invincible: '무적수', barrier: '결계' };
  const recent = games.slice(-2000);
  const useRate = Object.keys(NAME).filter(a => a !== 'kowang').map(a => {
    let have = 0, used = 0, at = 0;
    for (const g of recent) for (const c of [1, 2]) if (g.aug[c - 1] === a) { have++; if (g.used && g.used[c]) { used++; at += g.used[c].at; } }
    return `${NAME[a]} ${have ? Math.round(used / have * 100) : '-'}%${used ? ` (평균 ${Math.round(at / used)}단계째)` : ''}`;
  }).join(' · ');
  let md = `# 증강 바둑 신경망 학습 진행 (9줄 · ${process.env.AUGNET_NET || "b10"})\n\n갱신 ${new Date().toLocaleString('ko-KR')}\n\n`;
  md += `- 자기 대국 ${games.length}판, 학습 세대 ${tl.length ? tl[tl.length - 1].gen : 0}\n`;
  if (tl.length) { const t = tl[tl.length - 1]; md += `- 최근 학습 손실: 정책 ${t.pol} · 승패 ${t.val} · 집 ${t.score} · 소유 ${t.own} (학습 창 ${t.window}장면)\n`; }
  md += `- 최근 2000판 증강을 쓴 비율: ${useRate}\n`;
  if (lastTemp) md += `- 온도: ${lastTemp}${paused() ? ' · 식히는 중 (자기 대국 얼림)' : ''} · 이번 실행에서 식히느라 멈춘 시간 ${restRatio()}% · 지금 일:쉼 = 1:${slow.toFixed(1)}\n`;
  if (pl.length) {
    md += `\n## 신경망이 보는 증강 점수 (집, 빈 판에서 공정한 덤 차이)\n\n집 차이 출력 기준 (괄호는 승패 출력 기준)\n\n| 세대 | 증강 없을 때 공정한 덤 | ${Object.values(NAME).join(' | ')} |\n|---|---|${Object.keys(NAME).map(() => '---').join('|')}|\n`;
    for (const p of pl.slice(-12)) md += `| ${p.gen.replace('.pt', '')} | ${p.fairNoneS ?? '-'} (${p.fairNone}) | ${Object.keys(NAME).map(a => `${p.valueS ? p.valueS[a] : '-'} (${p.value[a]})`).join(' | ')} |\n`;
  }
  const fl = rd(MD + '/fit-log.jsonl');
  if (fl.length) {
    md += `\n## 실제 자기 대국 결과로 본 증강 값 (집, 최근 3000판 회귀 · 억지 사용 판 제외 · ±는 표준 오차)\n\n| 세대 | 대국 수 | 흑 기본 우세 | ${Object.values(NAME).join(' | ')} |\n|---|---|---|${Object.keys(NAME).map(() => '---').join('|')}|\n`;
    for (const r of fl.slice(-12)) md += `| ${r.gen.replace('.pt', '')} | ${r.total} | ${r.base}±${r.baseSe} | ${Object.keys(NAME).map(a => `${r.value[a]}±${r.se[a]}`).join(' | ')} |\n`;
  }
  const el = rd(MD + '/eval-log.jsonl');
  if (el.length) {
    md += `\n## 실력 (증강 판만, 흑백 바꿔 가며)\n\n| 시각 | 세대 | 원래 KataGo 상대 승률 | 가장 센 세대 상대 승률 | 판정 |\n|---|---|---|---|---|\n`;
    const D = { 'new-best': '새 최강', keep: '유지', revert: '되돌림' };
    for (const e of el.slice(-12)) md += `| ${new Date(e.t).toLocaleTimeString('ko-KR')} | ${e.cand.replace('.pt', '')} | ${Math.round(e.vsRaw.aWinRate * 100)}% (${e.vsRaw.games}판) | ${e.vsBest ? Math.round(e.vsBest.aWinRate * 100) + '% (' + e.best.replace('.pt', '') + ')' : '-'} | ${D[e.decision] || e.decision} |\n`;
  }
  if (tl.length) { md += `\n## 학습 기록 (최근)\n\n| 세대 | 시각 | 본 장면 | 정책 | 승패 | 집 | 소유 |\n|---|---|---|---|---|---|---|\n`; for (const t of tl.slice(-15)) md += `| ${t.gen} | ${t.t} | ${t.seen} | ${t.pol} | ${t.val} | ${t.score} | ${t.own} |\n`; }
  fs.writeFileSync(path.join(HERE, 'PROGRESS.md'), md);
}
let probing = false;
function probe() {
  if (probing || stop()) return; probing = true;
  const p = spawn(process.execPath, ['probe.js'], { cwd: HERE, stdio: 'ignore' });
  p.on('exit', () => {
    probing = false;
    try {   // 실제 대국 결과 회귀도 한 줄 남긴다
      const games = fs.readFileSync(path.join(HERE, DD, 'games.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const r = fit(games.slice(-3000)); let gen = '?'; try { gen = fs.readFileSync(path.join(HERE, MD, 'latest.txt'), 'utf8').trim(); } catch (e) { }
      if (r) fs.appendFileSync(path.join(HERE, MD, 'fit-log.jsonl'), JSON.stringify({ gen, total: games.length, t: new Date().toISOString(), ...r }) + '\n');
    } catch (e) { }
    report();
  });
}
setTimeout(probe, 90000);
setInterval(probe, 30 * 60000);
setInterval(report, 5 * 60000);
setInterval(() => { if (stop() && !Object.values(procs).some(Boolean)) { report(); process.exit(0); } }, 15000);
