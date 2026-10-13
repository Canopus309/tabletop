// 실력 재기 (증강 판만): 최신 세대를 ① 원래 KataGo (0세대) ② 지금까지 가장 센 세대(best.txt) 와 붙인다.
// 가장 센 세대를 이기면 (50% 이상) 새 '가장 센 세대'. 크게 지면 (42% 미만) 학습을 가장 센 세대로 되돌린다.
// 결과: models*/eval-log.jsonl. run.js 가 2시간마다 부른다. 사용: node eval.js [--pairs 100] [--visits 64]
'use strict';
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const HERE = __dirname, arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SUF = process.env.AUGNET_NET && process.env.AUGNET_NET !== 'b10' ? '-' + process.env.AUGNET_NET : '', MD = path.join(HERE, 'models' + SUF);
const PY = process.env.AUGNET_PY || path.join(os.homedir(), 'AppData/Local/Programs/Python/Python312/python.exe');
const PAIRS = arg('pairs', '100'), VISITS = arg('visits', '64');
const read = f => { try { return fs.readFileSync(path.join(MD, f), 'utf8').trim(); } catch (e) { return ''; } };
const log = s => console.log(new Date().toLocaleTimeString('ko-KR'), s);

function server(port, model) {
  const out = fs.openSync(path.join(HERE, 'logs', `eval-${port}.log`), 'w');
  const p = spawn(PY, ['server.py', '--port', String(port), '--model', model], { cwd: HERE, stdio: ['ignore', out, out], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  return new Promise((res, rej) => {
    const t0 = Date.now(), iv = setInterval(() => {
      const s = fs.readFileSync(path.join(HERE, 'logs', `eval-${port}.log`), 'utf8');
      if (s.includes('서버 시작')) { clearInterval(iv); res(p); }
      else if (Date.now() - t0 > 120000 || p.exitCode !== null) { clearInterval(iv); rej(new Error('서버가 안 뜸 ' + port)); }
    }, 1000);
  });
}
function match(a, b, label) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, ['match.js', '--a', String(a), '--b', String(b), '--pairs', PAIRS, '--workers', '3', '--visits', VISITS, '--noaug', '0', '--label', label], { cwd: HERE, stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', d => process.stdout.write(d));
    p.on('exit', code => {
      if (code) return rej(new Error('대결 실패 ' + code));
      const L = read('match-log.jsonl').split('\n'); res(JSON.parse(L[L.length - 1]));
    });
  });
}

(async () => {
  const cand = read('latest.txt'), best = read('best.txt') || 'gen_0000.pt';
  if (!cand || cand === 'gen_0000.pt') { log('아직 학습한 세대가 없음'); return; }
  log(`실력 재기: ${cand} (가장 센 세대 ${best})`);
  const procs = [];
  try {
    procs.push(await server(19191, cand), await server(19193, 'gen_0000.pt'));
    if (best !== 'gen_0000.pt' && best !== cand) procs.push(await server(19192, best));
    const vsRaw = await match(19191, 19193, `${cand} 대 원래 KataGo`);
    const vsBest = best === 'gen_0000.pt' ? vsRaw : best === cand ? null : await match(19191, 19192, `${cand} 대 ${best}`);
    const rec = { t: new Date().toISOString(), cand, best, vsRaw: vsRaw.aug, vsBest: vsBest ? vsBest.aug : null, byAug: vsRaw.byAug };
    if (vsBest && vsBest.aug.aWinRate >= 0.5) { fs.writeFileSync(path.join(MD, 'best.txt'), cand); rec.decision = 'new-best'; log(`${cand} 가 새 가장 센 세대`); }
    else if (vsBest && vsBest.aug.aWinRate < 0.42) {
      // 되돌리기: 가장 센 세대를 새 번호로 복사해 latest 로 두고, 학습을 다시 띄우게 한다 (run.js 가 train.py 를 다시 띄움)
      const last = fs.readdirSync(MD).filter(f => /^gen_\d{4}\.pt$/.test(f)).map(f => +f.slice(4, 8)).sort((x, y) => x - y).pop();
      const name = `gen_${String(last + 1).padStart(4, '0')}.pt`;
      fs.copyFileSync(path.join(MD, best), path.join(MD, name));
      fs.writeFileSync(path.join(MD, 'latest.txt.tmp'), name); fs.renameSync(path.join(MD, 'latest.txt.tmp'), path.join(MD, 'latest.txt'));
      fs.writeFileSync(path.join(HERE, 'RESTART_TRAIN'), name);
      rec.decision = 'revert'; rec.revertTo = name; log(`${cand} 가 약해짐 → ${best} 로 되돌림 (${name})`);
    } else rec.decision = 'keep';
    fs.appendFileSync(path.join(MD, 'eval-log.jsonl'), JSON.stringify(rec) + '\n');
  } catch (e) { log('실력 재기 실패: ' + e.message); }
  finally { for (const p of procs) try { p.kill(); } catch (e) { } }
})();
