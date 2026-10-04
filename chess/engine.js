/* 체스 AI(Stockfish) 연결과 레이팅 계산.
 * - Stockfish 19 Lite WASM (GPL-3.0, github.com/nmrugg/stockfish.js) 을 Web Worker 로 띄워 UCI 로 대화한다
 * - AI 단계: 1320 이상은 Stockfish 의 UCI_Elo(레이팅 보정 기능), 그보다 약한 단계는
 *   여러 후보 수(MultiPV)를 얕게 읽고 일부러 덜 좋은 수도 고르게 해서 만든다 (레이팅은 1320 단계와 대국해 추정)
 * - 내 레이팅: Glicko-2 (한 판마다 갱신)
 */

// 단계: elo 는 화면에 보이는 레이팅 (Stockfish UCI_Elo 척도).
// 입문·초급은 1400 단계와 대국해 잰 값: 초급은 1400 상대 20판 2.5점(약 1060), 입문은 중간 설정을 거쳐 약 575
export const LEVELS = [
  { name: '입문', elo: 600, weak: { depth: 1, multipv: 8, temp: 180 }, desc: '체스를 처음 배우는 분께. 말을 자주 거저 줍니다.' },
  { name: '초급', elo: 1050, weak: { depth: 3, multipv: 8, temp: 120 }, desc: '규칙을 알고 몇 판 둬 본 분께.' },
  { name: '중급', elo: 1400, uciElo: 1400, movetime: 700, desc: '기본 전술을 아는 분께.' },
  { name: '고급', elo: 1800, uciElo: 1800, movetime: 900, desc: '클럽에서 두는 수준.' },
  { name: '상급', elo: 2200, uciElo: 2200, movetime: 1100, desc: '대회에 나가는 수준.' },
  { name: '최강', elo: 2800, full: true, movetime: 2000, desc: 'Stockfish 전력. 한 수에 2초 동안 읽습니다. (레이팅은 추정치)' },
];

// 평가(센티폰)를 이길 확률로 (리체스와 같은 식)
export const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);

export class Engine {
  constructor(url) {
    this.w = new Worker(url);
    this.listeners = new Set();
    this.w.onmessage = e => { const line = String(e.data); for (const f of [...this.listeners]) f(line); };
    this.queue = Promise.resolve();
    this.ready = this.run(async () => { this.send('uci'); await this.waitFor(/^uciok/); this.send('setoption name Hash value 16'); await this.sync(); });
  }
  send(cmd) { this.w.postMessage(cmd); }
  waitFor(re, collect) {
    return new Promise(res => {
      const f = line => { if (collect) collect(line); if (re.test(line)) { this.listeners.delete(f); res(line); } };
      this.listeners.add(f);
    });
  }
  async sync() { this.send('isready'); await this.waitFor(/^readyok/); }
  // 계산은 한 번에 하나씩
  run(fn) { const p = this.queue.then(fn); this.queue = p.then(() => { }, () => { }); return p; }
  stop() { this.send('stop'); }
  newGame() { return this.run(async () => { this.send('ucinewgame'); await this.sync(); }); }

  // 한 번 계산: 마지막 깊이의 MultiPV 결과들 [{move, cp}] (cp 는 두는 쪽 기준, 메이트는 ±(100000-수))
  async analyse(moves, { depth, movetime, multipv = 1, elo = 0 }) {
    return this.run(async () => {
      this.send('setoption name MultiPV value ' + multipv);
      this.send('setoption name UCI_LimitStrength value ' + (elo ? 'true' : 'false'));
      if (elo) this.send('setoption name UCI_Elo value ' + elo);
      this.send('position startpos' + (moves.length ? ' moves ' + moves.join(' ') : ''));
      const lines = new Map();
      let best = '';
      const collect = line => {
        if (line.startsWith('info') && line.includes(' pv ') && line.includes(' score ')) {
          const mpv = +(line.match(/ multipv (\d+)/) || [0, 1])[1];
          const m = line.match(/ score (cp|mate) (-?\d+)/), pv = line.split(' pv ')[1].split(' ');
          const v = +m[2], cp = m[1] === 'cp' ? v : (v > 0 ? 100000 - v : -100000 - v);
          lines.set(mpv, { move: pv[0], cp, pv });
        }
        if (line.startsWith('bestmove')) best = line.split(' ')[1];
      };
      this.send(depth ? 'go depth ' + depth : 'go movetime ' + movetime);
      await this.waitFor(/^bestmove/, collect);
      const list = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
      return { best, list };
    });
  }

  // 단계에 맞는 AI 착수 (uci 문자열)
  async move(moves, level) {
    const L = LEVELS[level];
    if (L.weak) {
      const { best, list } = await this.analyse(moves, { depth: L.weak.depth, multipv: L.weak.multipv });
      if (!list.length) return best;
      // 최선과의 차이에 따라 확률을 주어 고른다 (메이트 위기는 거의 놓치지 않게 온도를 낮춘다)
      const top = list[0].cp, T = Math.abs(top) > 50000 ? 30 : L.weak.temp;
      const ws = list.map(e => Math.exp((Math.max(e.cp, top - 3000) - top) / T));
      let r = Math.random() * ws.reduce((s, x) => s + x, 0);
      for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i].move; }
      return list[0].move;
    }
    const { best } = await this.analyse(moves, { movetime: L.movetime, elo: L.full ? 0 : L.uciElo });
    return best;
  }
  // 힌트·분석용 (전력)
  async best(moves, depth = 14) { return this.analyse(moves, { depth }); }
}

// ---------- Glicko-2 ----------
// 한 판(상대 1명)마다 갱신. 상대(AI)는 레이팅이 정해져 있다고 보고 편차를 작게 둔다
export function glicko2(me, oppRating, score, oppRd = 60) {
  const S = 173.7178, tau = 0.5;
  const mu = (me.rating - 1500) / S, phi = me.rd / S, sigma = me.vol;
  const muj = (oppRating - 1500) / S, phij = oppRd / S;
  const g = 1 / Math.sqrt(1 + 3 * phij * phij / (Math.PI * Math.PI));
  const E = 1 / (1 + Math.exp(-g * (mu - muj)));
  const v = 1 / (g * g * E * (1 - E));
  const delta = v * g * (score - E);
  // 변동성 갱신 (Illinois 방법)
  const a = Math.log(sigma * sigma);
  const f = x => { const ex = Math.exp(x); return ex * (delta * delta - phi * phi - v - ex) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (tau * tau); };
  let A = a, B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * tau) < 0) k++; B = a - k * tau; }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 60 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + (A - B) * fA / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigma2 = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigma2 * sigma2);
  const phi2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const mu2 = mu + phi2 * phi2 * g * (score - E);
  return { rating: S * mu2 + 1500, rd: Math.max(30, S * phi2), vol: sigma2 };
}
export const NEW_RATING = { rating: 1200, rd: 350, vol: 0.06, games: 0 };
