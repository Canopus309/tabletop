/* 오목 퍼즐용 연속 4(VCF) 풀이기. 렌주 규칙 판정은 renju.js 의 makesFive · isForbidden 을 쓴다.
 *  - 판: 길이 225 배열 (0 빈칸, 1 흑, 2 백), 색을 직접 지정해 읽는다 (차례와 상관없이 '이쪽이 두면'을 물을 수 있다)
 *  - 연속 4: 공격 쪽이 매 수 4(다음에 5목이 되는 수)를 두고, 수비는 막을 수밖에 없는 수순으로 5목까지 가는 것
 *  - 흑이 막을 자리가 금수면 막을 수 없다. 흑은 정확히 5목, 백은 5목 이상이면 이긴다
 *  - depth: 공격 쪽이 둘 수 있는 수 (마지막 5목 포함)
 */
'use strict';
const VCF = (() => {
  const R = typeof RJ !== 'undefined' ? RJ : require('../renju.js');
  const N = 15, NN = N * N, BLACK = 1, WHITE = 2;
  const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];
  // 조브리스트 해시 (기억표 열쇠)
  const ZA = [null, new Int32Array(NN), new Int32Array(NN)], ZB = [null, new Int32Array(NN), new Int32Array(NN)];
  { let s = 0x2545f491 | 0; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; }; for (const c of [1, 2]) for (let p = 0; p < NN; p++) { ZA[c][p] = rnd(); ZB[c][p] = rnd(); } }

  class Solver {
    constructor(board) { this.b = Int8Array.from(board); this.ha = 0; this.hb = 0; for (let p = 0; p < NN; p++) if (this.b[p]) { this.ha ^= ZA[this.b[p]][p]; this.hb ^= ZB[this.b[p]][p]; } this.tt = new Map(); this.nodes = 0; this.limit = 2e6; this.aborted = false; }
    put(p, c) { this.b[p] = c; this.ha ^= ZA[c][p]; this.hb ^= ZB[c][p]; }
    take(p) { const c = this.b[p]; this.b[p] = 0; this.ha ^= ZA[c][p]; this.hb ^= ZB[c][p]; }
    legal(p, c) { return this.b[p] === 0 && (c !== BLACK || !R.isForbidden(this.b, p)); }
    // 돌에서 두 칸 안의 빈칸 (4·5목·막기 자리는 모두 여기에 있다)
    near() {
      const b = this.b, mark = new Uint8Array(NN), out = [];
      for (let p = 0; p < NN; p++) {
        if (!b[p]) continue;
        const x = p % N, y = (p / N) | 0;
        for (let j = Math.max(0, y - 2); j <= Math.min(N - 1, y + 2); j++) for (let i = Math.max(0, x - 2); i <= Math.min(N - 1, x + 2); i++) { const q = j * N + i; if (!b[q] && !mark[q]) { mark[q] = 1; out.push(q); } }
      }
      return out;
    }
    // c 가 두면 5목이 되는 자리 (흑은 정확히 5목이라 금수와 상관없이 둘 수 있다)
    fives(c, pts) { const out = []; for (const q of pts || this.near()) if (this.b[q] === 0 && R.makesFive(this.b, q, c)) out.push(q); return out; }
    // p 를 지나는 네 줄 위에서 c 의 5목 자리
    fivesThrough(p, c) {
      const out = [], x = p % N, y = (p / N) | 0;
      for (let d = 0; d < 4; d++) for (let k = -4; k <= 4; k++) {
        if (!k) continue;
        const X = x + k * DX[d], Y = y + k * DY[d];
        if (X < 0 || X >= N || Y < 0 || Y >= N) continue;
        const q = Y * N + X;
        if (this.b[q] === 0 && !out.includes(q) && R.makesFive(this.b, q, c)) out.push(q);
      }
      return out;
    }
    // c 가 q 에 둔 뒤의 강제 응수: 'win' (막을 수 없음) | 막는 자리 | null (4가 아님)
    replyTo(q, c) {
      const opp = 3 - c, my = this.fivesThrough(q, c);
      if (!my.length) return null;
      const blocks = my.filter(r => this.legal(r, opp));
      if (my.length >= 2 || !blocks.length) return { win: true, my };
      return { win: false, block: blocks[0], my };
    }
    // c 차례: depth 수 안에 연속 4로 이기는가
    win(c, depth) {
      if (this.aborted) return false;
      const opp = 3 - c, pts = this.near();
      if (this.fives(c, pts).length) return true;
      if (depth <= 1) return false;
      if (++this.nodes > this.limit) { this.aborted = true; return false; }
      const key = this.ha + ':' + this.hb + ':' + c + ':' + depth;
      const hit = this.tt.get(key); if (hit !== undefined) return hit;
      const oppF = this.fives(opp, pts);
      let res = false;
      if (oppF.length < 2) {
        for (const q of oppF.length ? oppF : pts) {
          if (!this.legal(q, c)) continue;
          this.put(q, c);
          const r = this.replyTo(q, c);
          let ok = false;
          if (r) {
            if (r.win) ok = true;
            else { this.put(r.block, opp); ok = !R.makesFive(this.b, r.block, opp) && this.win(c, depth - 1); this.take(r.block); }
          }
          this.take(q);
          if (ok) { res = true; break; }
        }
      }
      if (!this.aborted) this.tt.set(key, res);
      return res;
    }
    // 이기는 데 필요한 가장 적은 수 (없으면 0)
    minDepth(c, max = 12) { for (let d = 1; d <= max; d++) { if (this.win(c, d)) return d; if (this.aborted) return 0; } return 0; }
    // depth 수 안에 이기는 첫 수들 (5목 자리 포함)
    winningMoves(c, depth) {
      const opp = 3 - c, pts = this.near(), out = [];
      const myF = this.fives(c, pts);
      if (myF.length) return myF;
      if (depth <= 1) return out;
      const oppF = this.fives(opp, pts);
      if (oppF.length >= 2) return out;
      for (const q of oppF.length ? oppF : pts) {
        if (!this.legal(q, c)) continue;
        this.put(q, c);
        const r = this.replyTo(q, c);
        let ok = false;
        if (r) {
          if (r.win) ok = true;
          else { this.put(r.block, opp); ok = !R.makesFive(this.b, r.block, opp) && this.win(c, depth - 1); this.take(r.block); }
        }
        this.take(q);
        if (ok) out.push(q);
      }
      return out;
    }
    // 가장 짧은 승리 수순: [수, 응수(막기 자리, 금수로 못 막으면 -1), 수, …, 5목]
    line(c, max = 12) {
      const d = this.minDepth(c, max), out = [];
      if (!d) return out;
      const opp = 3 - c;
      for (let left = d; left >= 1; left--) {
        const pts = this.near(), myF = this.fives(c, pts);
        if (myF.length) { out.push(myF[0]); break; }
        const q = this.winningMoves(c, left)[0];
        if (q === undefined) break;
        this.put(q, c); out.push(q);
        const r = this.replyTo(q, c);
        if (r.win) {
          // 막을 곳이 둘이면 하나를 막고, 금수라 못 막으면 그대로
          const b = r.my.find(x => this.legal(x, opp));
          if (b !== undefined && r.my.length >= 2) { this.put(b, opp); out.push(b); } else out.push(-1);
        } else { this.put(r.block, opp); out.push(r.block); }
      }
      // 판을 원래대로
      for (let i = out.length - 1; i >= 0; i--) if (out[i] >= 0 && this.b[out[i]]) this.take(out[i]);
      return out;
    }
  }
  return { Solver };
})();
if (typeof module !== 'undefined') module.exports = VCF;
