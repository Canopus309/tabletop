/* 체스 AI(Stockfish) 연결.
 * - Stockfish 19 Lite WASM (GPL-3.0, github.com/nmrugg/stockfish.js) 을 Web Worker 로 띄워 UCI 로 대화한다
 * - AI 단계: 여러 후보 수(MultiPV)를 정해진 깊이로 읽고, 최선과의 차이에 따라 일부러 덜 좋은 수도 고르게 해서 세기를 맞춘다. 최강만 전력
 * - 내 레이팅(Glicko-2)은 common/rating.js
 */

// 단계: elo 는 화면에 보이는 레이팅으로, 리체스(래피드) 기준 추정치 (2026-10 측정).
// 리체스 사람 기보로 배운 엔진 Maia(maia-1100·1500·1900, 1노드)와 단계마다 60판씩 둬서 쟀다.
// 기준은 이 Maia 들이 리체스에서 사람과 둬서 얻은 래피드 레이팅: maia1 1477, maia5 1691, maia9 1749.
// 최강은 Maia 를 모두 압도해서 2300 이상이라는 것만 확인했다.
export const LEVELS = [
  { name: '입문', elo: 1100, weak: { depth: 1, multipv: 8, temp: 180 }, desc: '체스를 처음 배우는 분께. 말을 자주 거저 줍니다.' },
  { name: '초보', elo: 1200, weak: { depth: 1, multipv: 8, temp: 140 }, desc: '규칙을 막 익힌 분께. 말을 가끔 거저 줍니다.' },
  { name: '초급', elo: 1400, weak: { depth: 1, multipv: 8, temp: 100 }, desc: '규칙을 알고 몇 판 둬 본 분께.' },
  { name: '중급', elo: 1550, weak: { depth: 3, multipv: 8, temp: 80 }, desc: '기본 전술을 아는 분께.' },
  { name: '고급', elo: 1700, weak: { depth: 4, multipv: 8, temp: 80 }, desc: '전술을 곧잘 찾는 수준.' },
  { name: '상급', elo: 1900, weak: { depth: 4, multipv: 6, temp: 60 }, desc: '클럽에서 꾸준히 두는 수준.' },
  { name: '최강', elo: 2400, full: true, movetime: 2000, desc: 'Stockfish 전력. 한 수에 2초 동안 읽습니다. (2300 이상만 확인한 추정치)' },
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
