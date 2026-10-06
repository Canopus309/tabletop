/* 레이팅(Glicko-2)과 레이팅 순위표 — 체스·오목 공용
 * 페이지에는 #btnRank 버튼과 #dlgRank 대화상자(rkBig, rkSub, lbStatus, lbName, lbSave, lbList, rkList, rkReset)가 있어야 한다.
 * ui.js(load, store, $, openDlg, closeDlg, ask, toast)와 leaderboard.js(LB) 다음에 불러온다.
 */
'use strict';

// 한 판(상대 1명)마다 갱신. 상대(AI)는 레이팅이 정해져 있다고 보고 편차를 작게 둔다
function glicko2(me, oppRating, score, oppRd = 60) {
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

/* cfg = {
 *   game: 'chess' | 'omok'       저장 키 접두어이자 순위표 컬렉션 이름
 *   start: 1200                  처음 레이팅
 *   levels: [{name, rating}]     AI 단계와 그 레이팅
 *   fmt: rating => '1350'        화면 표시 (오목은 급수)
 *   prefix: '레이팅 '            홈 화면 요약 앞말
 *   sub: R => '...'              대화상자 부제
 * } */
function ratingBoard(cfg) {
  const KEY = cfg.game + '-rating', PEND = cfg.game + 'Pending', UPL = cfg.game + 'Uploaded', CACHE = cfg.game + 'Cache';
  const get = () => load(KEY, { rating: cfg.start, rd: 350, vol: 0.06, games: 0, history: [] });
  const text = R => cfg.fmt(R.rating) + (R.rd > 110 ? '?' : '');
  function saveSummary() {
    try {
      const s = JSON.parse(localStorage.getItem('tt-summary')) || {}, R = get();
      s[cfg.game] = R.games ? cfg.prefix + text(R) : null;
      localStorage.setItem('tt-summary', JSON.stringify(s));
    } catch (e) { }
  }
  // 대국 결과 반영 (score: 1 승, 0.5 무, 0 패)
  function apply(level, score, id) {
    const R = get(), before = R.rating, nr = glicko2(R, cfg.levels[level].rating, score);
    Object.assign(R, nr);
    R.games = (R.games || 0) + 1;
    R.history = (R.history || []).concat({ id, date: new Date().toISOString().slice(0, 10), level, score, before: Math.round(before), after: Math.round(nr.rating) }).slice(-30);
    store(KEY, R); saveSummary();
    LB.set({ [PEND]: true }); sync();
    return { before, after: nr.rating };
  }
  // 내 레이팅에 가장 가까운 AI 단계 (기록이 없으면 -1)
  function recommend() {
    const R = get(); if (!R.games) return -1;
    let bi = 0; cfg.levels.forEach((l, i) => { if (Math.abs(l.rating - R.rating) < Math.abs(cfg.levels[bi].rating - R.rating)) bi = i; });
    return bi;
  }

  // ---------- 온라인 순위표 (레이팅 순) ----------
  let busy = false;
  async function sync() {
    if (busy || !LB.configured() || !navigator.onLine) return;
    const s = LB.state(); if (!s.name || !s[PEND]) return;
    const R = get(); busy = true;
    try {
      if (R.games >= 3) { await LB.uploadTo(cfg.game, { name: s.name, rating: Math.round(R.rating), rd: Math.round(R.rd), games: R.games }); LB.set({ [PEND]: false, [UPL]: true }); }
      else { if (s[UPL]) await LB.removeFrom(cfg.game); LB.set({ [PEND]: false, [UPL]: false }); }
    } catch (e) { console.warn('[순위표]', e); }
    finally { busy = false; if ($('#dlgRank').open) renderLb(); }
  }
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderLb() {
    const s = LB.state(), rows = s[CACHE] || [], R = get();
    let status = '';
    if (!LB.configured()) status = '순위표 서버 준비 중';
    else if (!s.name) status = '닉네임을 정하면 내 기록이 올라갑니다';
    else if (R.games < 3) status = `3판 이상 두면 올라갑니다 (지금 ${R.games || 0}판)`;
    else if (s[PEND]) status = navigator.onLine ? '올리는 중…' : '오프라인 · 연결되면 자동으로 올립니다';
    else if (s[CACHE + 'At']) status = '갱신 ' + new Date(s[CACHE + 'At']).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('#lbStatus').textContent = status;
    if (document.activeElement !== $('#lbName')) $('#lbName').value = s.name || '';
    $('#lbSave').textContent = s.name ? '변경' : '참가';
    $('#lbList').innerHTML = rows.length
      ? rows.map((r, i) => `<div class="lb-row${r.uid === s.uid ? ' me' : ''}"><span class="no">${i + 1}</span><span>${esc(r.name || '')}</span><span>${esc(cfg.fmt(r.rating))}${r.rd > 110 ? '?' : ''}</span><span class="g">${r.games}판</span></div>`).join('')
      : `<div class="lb-empty">${navigator.onLine ? '아직 순위표에 아무도 없습니다.' : '오프라인입니다. 연결되면 순위표를 받아옵니다.'}</div>`;
  }
  async function refresh() {
    renderLb();
    if (!LB.configured() || !navigator.onLine) return;
    try { await LB.fetchTopFrom(cfg.game, 'rating', 'DESCENDING', CACHE); } catch (e) { console.warn('[순위표]', e); }
    renderLb();
  }
  function show() {
    const R = get(), list = (R.history || []).slice().reverse();
    $('#rkBig').textContent = text(R);
    $('#rkSub').textContent = R.games ? cfg.sub(R) : '아직 기록이 없습니다. 무르기·힌트 없이 끝까지 두면 반영됩니다.';
    $('#rkList').innerHTML = list.map(h => {
      const L = cfg.levels[h.level] || { name: h.label || '', rating: h.opp };
      const res = h.score === 1 ? ['w', '승'] : h.score === 0 ? ['l', '패'] : ['', '무'];
      return `<div class="rank-row"><span class="d">${h.date.slice(5)}</span><span>${L.name} (${cfg.fmt(L.rating)})</span><span class="${res[0]}">${res[1]}</span><span>${cfg.fmt(h.before)} → ${cfg.fmt(h.after)}</span></div>`;
    }).join('');
    openDlg($('#dlgRank')); refresh();
  }
  $('#btnRank').onclick = show;
  $('#lbSave').onclick = async () => {
    const name = $('#lbName').value.trim().slice(0, 12);
    if (!name) { toast('닉네임을 입력하세요'); return; }
    LB.set({ name, [PEND]: true, pending: true });
    renderLb(); toast(navigator.onLine ? '순위표에 참가했습니다' : '저장했습니다. 연결되면 순위표에 올라갑니다');
    await sync(); await refresh();
  };
  $('#rkReset').onclick = async () => {
    closeDlg($('#dlgRank'), 'x');
    if (await ask('기록을 지울까요?', '처음 상태로 돌아가고, 순위표에서도 내려갑니다.', '지우기')) {
      try { localStorage.removeItem(KEY); } catch (e) { }
      LB.set({ [PEND]: true }); sync(); saveSummary(); toast('기록을 지웠습니다');
    }
  };
  window.addEventListener('online', () => { sync(); if ($('#dlgRank').open) refresh(); });
  setTimeout(sync, 3000); saveSummary();
  return { get, text, apply, recommend, sync, show, saveSummary };
}
