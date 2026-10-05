/* 사활·맥 문제 풀이기: 문제 영역 안의 수만 끝까지 읽어 정답을 정확히 판정한다.
 * board.js 의 Board 를 쓴다.
 *
 * 문제 = { board, attacker, target, region, zone, toPlay, escapeLibs, koFree }
 *  - region: 둘 수 있는 점 (그림의 '.' 과 돌 자리. ',' 는 영역 밖). 지금 빈 점만 실제 후보가 된다
 *  - target: 공격당하는 쪽(수비) 돌 하나의 좌표. 그 돌이 따이면 공격 성공
 *  - 수비 그룹이 무조건 삶(Benson: 계속 패스해도 잡히지 않음)이 되면 수비 성공
 *  - escapeLibs: 수비 그룹 활로가 이만큼 이상이면 탈출로 본다 (맥 문제용, 없으면 무시).
 *    이때는 판 전체에서 읽되 수를 좁힌다: 공격은 목표 활로(활로 2 이하면 그 이웃까지)와 목표에 붙은 약한 내 돌의 활로,
 *    수비는 활로와 목표에 붙은 약한 공격 돌의 활로
 *  - 둘 다 연속으로 패스하면 수비 성공 (공격 쪽이 더 할 수 있는 게 없음 → 빅 포함)
 *  - ladder: 축 판정. 판 전체에서, 공격은 활로에 단수만, 수비는 달아나기·따내기만 읽고 활로 3이면 탈출
 *  - zone: 문제 그림 안의 점들. 국면 기억표의 열쇠로 쓴다 (그림 밖은 바뀌지 않는다)
 *  - koFree: 이 색은 팻감이 끝없이 있다고 보고 패를 바로 되따낼 수 있다.
 *    문제를 푸는 쪽의 상대에게 주면 '패 없이' 해결하는 수만 정답이 된다
 */
'use strict';
const Tsumego = (() => {
  // ---------- Benson: color 의 무조건 산 돌들 ----------
  function passAlive(b, color) {
    const c = b.c, d = b.d, size = b.size;
    const chainOf = new Int32Array(size).fill(-1), chains = [];
    for (const p of b.pts) {
      if (c[p] !== color || chainOf[p] >= 0) continue;
      const id = chains.length, st = [p], stones = [], libs = new Set();
      chainOf[p] = id;
      while (st.length) {
        const q = st.pop(); stones.push(q);
        for (let i = 0; i < 4; i++) { const r = q + d[i]; if (c[r] === color && chainOf[r] < 0) { chainOf[r] = id; st.push(r); } else if (c[r] === EMPTY) libs.add(r); }
      }
      chains.push({ stones, libs });
    }
    // 색이 아닌 점(빈칸·상대 돌)으로 이어진 영역
    const regOf = new Int32Array(size).fill(-1), regions = [];
    for (const p of b.pts) {
      if (c[p] === color || regOf[p] >= 0) continue;
      const id = regions.length, st = [p], empties = [], adj = new Set();
      regOf[p] = id;
      while (st.length) {
        const q = st.pop(); if (c[q] === EMPTY) empties.push(q);
        for (let i = 0; i < 4; i++) { const r = q + d[i], v = c[r]; if (v === EDGE) continue; if (v === color) adj.add(chainOf[r]); else if (regOf[r] < 0) { regOf[r] = id; st.push(r); } }
      }
      regions.push({ empties, adj });
    }
    const aliveC = new Set(chains.map((_, i) => i)), aliveR = new Set(regions.map((_, i) => i));
    for (let changed = true; changed;) {
      changed = false;
      for (const ci of [...aliveC]) {
        let vital = 0;
        for (const ri of aliveR) {
          const R = regions[ri];
          if (!R.adj.has(ci)) continue;
          if (R.empties.every(e => chains[ci].libs.has(e))) vital++;
        }
        if (vital < 2) { aliveC.delete(ci); changed = true; }
      }
      for (const ri of [...aliveR]) for (const ci of regions[ri].adj) if (!aliveC.has(ci)) { aliveR.delete(ri); changed = true; break; }
    }
    const mark = new Uint8Array(size);
    for (const ci of aliveC) for (const s of chains[ci].stones) mark[s] = 1;
    return mark;
  }

  // ---------- 탐색 ----------
  function key(pr, b, passed) { let s = ''; for (const p of pr.zone) s += b.c[p]; return s + '|' + b.ko + '|' + b.turn + '|' + (passed ? 1 : 0); }
  // 수를 둔 새 판 (koFree 쪽은 패 금지를 무시한다)
  function after(pr, b, m) { const nb = new Board(b.n); nb.copyFrom(b); if (b.turn === pr.koFree) nb.ko = 0; nb.play(m); return nb; }
  // 이미 결판났으면 공격 쪽 승패(true/false), 아니면 null
  function terminal(pr, b) {
    const tgt = pr.target, def = 3 - pr.attacker;
    if (b.c[tgt] !== def) return true;                                  // 따임
    if (pr.escapeLibs && b.libs(tgt, pr.escapeLibs) >= pr.escapeLibs) return false; // 탈출
    if (!pr.escapeLibs && passAlive(b, def)[tgt]) return false;         // 무조건 삶 (따내기 문제는 활로로만 본다)
    return null;
  }

  // 이 국면(두는 쪽 = b.turn)에서 공격 쪽이 이기는가
  // 같은 국면이 수순 안에서 되풀이되면(패 싸움이 끝나지 않으면) 팻감이 끝없는 쪽(koFree)이 이긴 것으로 보고,
  // koFree 가 없으면 수비 승으로 본다. 되풀이에 기댄 결과는 수순에 따라 달라지므로 기억표에 넣지 않는다
  function attackerWins(pr, b, depth, passed, tt, stat) {
    const t = terminal(pr, b);
    if (t !== null) return t;
    if (depth <= 0) return false;
    if (++stat.nodes > stat.limit) { stat.aborted = true; return false; }
    const k = key(pr, b, passed);
    if (tt.has(k)) return tt.get(k);
    const pk = k.slice(0, pr.zone.length) + b.turn;
    if (stat.path.has(pk)) { stat.dirty++; return pr.koFree ? pr.koFree === pr.attacker : false; }
    stat.path.add(pk);
    const dirty0 = stat.dirty;
    const side = b.turn, attackerToMove = side === pr.attacker;
    const moves = orderedMoves(pr, b, side);
    let result = !attackerToMove; // 공격: 하나라도 이기면 승 / 수비: 모두 지면 공격 승
    for (const m of moves) {
      const w = attackerWins(pr, after(pr, b, m), depth - 1, false, tt, stat);
      if (attackerToMove && w) { result = true; break; }
      if (!attackerToMove && !w) { result = false; break; }
    }
    // 패스: 둘 다 연속 패스면 수비 승 (따내기 문제에서 공격 쪽 패스는 쓸모가 없어 읽지 않는다)
    if ((attackerToMove ? !result : result) && !(pr.escapeLibs && attackerToMove)) {
      if (passed) result = false;
      else {
        const w = attackerWins(pr, after(pr, b, PASS), depth - 1, true, tt, stat);
        if (attackerToMove && w) result = true;
        if (!attackerToMove && !w) result = false;
      }
    }
    stat.path.delete(pk);
    if (!stat.aborted && stat.dirty === dirty0) tt.set(k, result);
    return result;
  }
  // 그룹의 돌과 활로
  function group(b, p) {
    const col = b.c[p], st = [p], stones = new Set(st), libs = new Set();
    while (st.length) { const q = st.pop(); for (const dd of b.d) { const r = q + dd; if (b.c[r] === col && !stones.has(r)) { stones.add(r); st.push(r); } else if (b.c[r] === EMPTY) libs.add(r); } }
    return { stones, libs };
  }
  // 영역 안 합법 수. 수비 그룹 활로·이웃 칸을 먼저 본다
  function orderedMoves(pr, b, side) {
    const near = new Set();
    let tgtLibs = new Set(), only = null;
    if (b.c[pr.target] !== EMPTY) {
      const g = group(b, pr.target);
      tgtLibs = g.libs;
      for (const l of tgtLibs) for (const dd of b.d) near.add(l + dd);
      if (pr.escapeLibs) {
        only = new Set(tgtLibs);
        if (side === pr.attacker && pr.ladder) { /* 축 판정: 공격은 활로에 단수만 친다 */ }
        else if (side === pr.attacker) {
          if (tgtLibs.size <= 2) for (const p of near) only.add(p); // 활로 3 이상이면 활로를 메우는 수만
          // 목표에 붙은 내 돌이 약하면(활로 2 이하) 살리는 수도 본다
          const seen = new Set();
          for (const s of g.stones) for (const dd of b.d) { const r = s + dd; if (b.c[r] === side && !seen.has(r)) { const h = group(b, r); h.stones.forEach(v => seen.add(v)); if (h.libs.size <= 2) h.libs.forEach(v => only.add(v)); } }
        }
        else { // 수비: 목표에 붙은 공격 돌 중 활로 2 이하의 활로 (따내기·단수)
          const seen = new Set();
          for (const s of g.stones) for (const dd of b.d) { const r = s + dd; if (b.c[r] === pr.attacker && !seen.has(r)) { const h = group(b, r); h.stones.forEach(v => seen.add(v)); if (h.libs.size <= 2) h.libs.forEach(v => only.add(v)); } }
        }
      }
    }
    const list = [];
    const ko = b.ko; if (side === pr.koFree) b.ko = 0;
    for (const p of pr.region) if (b.c[p] === EMPTY && (!only || only.has(p)) && b.isLegal(p, side)) list.push([p, tgtLibs.has(p) ? 2 : near.has(p) ? 1 : 0]);
    b.ko = ko;
    list.sort((a, c) => c[1] - a[1]);
    return list.map(e => e[0]);
  }
  const withOpts = (pr, opts) => 'koFree' in opts ? { ...pr, koFree: opts.koFree } : pr;
  const ctx = (pr, opts) => ({ tt: new Map(), stat: { nodes: 0, limit: opts.limit || 400000, aborted: false, dirty: 0, path: new Set() }, depth: opts.depth || pr.depth || pr.region.length * 2 + 6 });

  // 지금 두는 쪽 기준: 이기는 첫 수들 (빈 배열이면 어떻게 둬도 진다)
  function winningMoves(pr0, b, opts = {}) {
    const pr = withOpts(pr0, opts), { tt, stat, depth } = ctx(pr, opts), attackerToMove = b.turn === pr.attacker;
    const out = [];
    for (const m of orderedMoves(pr, b, b.turn)) {
      const w = attackerWins(pr, after(pr, b, m), depth - 1, false, tt, stat);
      if (w === attackerToMove) out.push(m);
    }
    return { moves: out, nodes: stat.nodes, aborted: stat.aborted };
  }
  // 두는 쪽이 이기는 수 하나 (손 빼기는 PASS, 없으면 null)
  function bestReply(pr0, b, opts = {}) {
    const pr = withOpts(pr0, opts), { tt, stat, depth } = ctx(pr, opts), attackerToMove = b.turn === pr.attacker;
    for (const m of orderedMoves(pr, b, b.turn)) if (attackerWins(pr, after(pr, b, m), depth - 1, false, tt, stat) === attackerToMove) return m;
    // 두지 않고 손을 빼는 것이 이기는 수일 수도 있다 (예: 둘 다 메울 수 없는 모양에서 수비 쪽)
    if (!(pr.escapeLibs && attackerToMove) && attackerWins(pr, after(pr, b, PASS), depth - 1, true, tt, stat) === attackerToMove) return PASS;
    return null;
  }
  // 두는 쪽 기준 승패: 'win' | 'lose'
  function status(pr0, b, opts = {}) {
    const pr = withOpts(pr0, opts), { tt, stat, depth } = ctx(pr, opts);
    const aw = attackerWins(pr, b, depth, false, tt, stat);
    return (aw === (b.turn === pr.attacker)) ? 'win' : 'lose';
  }
  // 방금 둔 쪽이 이번 차례를 한 번 쉬어도(상대가 두 번 둬도) 이기면 결판난 것으로 본다
  function settled(pr0, b, opts = {}) {
    const pr = withOpts(pr0, opts), opp = b.turn, mover = 3 - opp, moverAttacks = mover === pr.attacker;
    const t = terminal(pr, b);
    if (t !== null) return t === moverAttacks;
    for (const m of [...orderedMoves(pr, b, opp), PASS]) {
      const nb = after(pr, b, m), t1 = terminal(pr, nb);
      if (t1 !== null) { if (t1 !== moverAttacks) return false; continue; }
      if (status(pr, after(pr, nb, PASS), opts) === 'win') return false;
    }
    return true;
  }
  // 지고 있는 쪽의 응수: 상대가 맞힐 수 있는 수가 가장 적게 남는 수 (가장 까다롭게 버틴다)
  function toughestReply(pr0, b, opts = {}) {
    const pr = withOpts(pr0, opts);
    let best = null, bestScore = Infinity;
    for (const m of orderedMoves(pr, b, b.turn)) {
      const nb = after(pr, b, m);
      if (terminal(pr, nb) !== null) continue;
      const w = winningMoves(pr, nb, opts).moves.length;
      const score = w === 0 ? -1 : w + (settled(pr, nb, opts) ? 0.5 : 0);
      if (score < bestScore) { bestScore = score; best = m; }
    }
    // 손 빼기도 후보로 본다 (어차피 지는 장면이면 두는 수를 고른다)
    if (!(pr.escapeLibs && b.turn === pr.attacker)) {
      const nb = after(pr, b, PASS);
      if (terminal(pr, nb) === null && !winningMoves(pr, nb, opts).moves.length) { best = PASS; } // 손 빼기는 그것으로 버틸 수 있을 때만
    }
    return best === null ? PASS : best;
  }

  // ---------- 그림 문자로 문제 만들기 ----------
  // rows: 위에서부터 한 줄씩. X 흑, O 백, . 영역 안 빈칸, , 영역 밖 빈칸, x·o 는 목표 돌(공격당하는 쪽)
  // at: 그림의 왼쪽 위가 놓일 판 좌표 [x, y] (기본 0,0 = 왼쪽 위 귀)
  function fromDiagram(def) {
    const n = def.size || 19, b = new Board(n), region = [], zone = [], at = def.at || [0, 0];
    let target = -1;
    def.rows.forEach((row, y) => [...row.replace(/ /g, '')].forEach((ch, x) => {
      const p = b.pt(at[0] + x, at[1] + y);
      zone.push(p);
      if (ch === 'X' || ch === 'x') { b.place(p, BLACK); if (ch === 'x') target = p; }
      else if (ch === 'O' || ch === 'o') { b.place(p, WHITE); if (ch === 'o') target = p; }
      // 돌 자리도 영역에 넣는다: 따인 뒤 빈칸이 되면 그 자리에 다시 둘 수 있어야 한다 (예: 네모로 먹여 따이게 한 뒤 안쪽에 두기)
      if (ch !== ',') region.push(p);
    }));
    if (target < 0) throw new Error('목표 돌(x/o)이 없습니다: ' + def.id);
    // 따내기(맥) 문제는 그림 밖까지 판 전체에서 읽는다: 그림 끝에서 수순이 잘리면 반격(예: 막은 돌을 축으로 잡기)을 놓친다
    if (def.escapeLibs || def.ladder) { region.length = 0; zone.length = 0; for (const p of b.pts) { region.push(p); zone.push(p); } }
    const defender = b.c[target], attacker = 3 - defender;
    b.turn = def.toPlay === 'W' ? WHITE : BLACK;
    return { id: def.id, board: b, attacker, target, region, zone, ladder: !!def.ladder, escapeLibs: def.ladder ? 3 : def.escapeLibs || 0, depth: def.depth || 0, toPlay: b.turn, koFree: 0 };
  }

  return { passAlive, terminal, winningMoves, bestReply, status, settled, toughestReply, orderedMoves, fromDiagram };
})();
if (typeof module !== 'undefined') module.exports = Tsumego;
