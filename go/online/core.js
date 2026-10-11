/* 바둑 온라인 대국 공용 (목록 화면 go/online/ 과 대국 화면 go/ 이 함께 쓴다)
 * - 사람 대국 레이팅: 온라인 대국 결과로만 움직이는 Glicko-2 (common/rating.js 의 glicko2)
 * - 대국 목록 캐시 (오프라인에서도 마지막 목록이 보이게), 홈 화면의 '내 차례' 수
 * ui.js, leaderboard.js, rating.js, online.js 다음에 불러온다.
 */
'use strict';
const GO_ON = (() => {
  // 레이팅 ↔ 급수: 1단 = 2100점, 한 급(단)마다 100점 (유럽 바둑 연맹 레이팅과 같은 눈금)
  const kyuOf = r => (2100 - r) / 100;
  const ratingOf = kyu => 2100 - 100 * kyu;
  const rankName = k => { k = Math.round(k); return k > 0 ? k + '급' : (1 - k) + '단'; };
  const rankOf = r => r <= 100 ? '20급 이하' : rankName(kyuOf(r));
  const KEY = 'go-online-rating', LIST = 'go-online-list', SUM = 'go-online-sum';
  // 처음 레이팅: '내 기력'(AI 대국에서 둔 수의 질로 잰 급수)이 있으면 그 급수, 없으면 10급. 첫 온라인 대국 때 정해진다
  function seed() {
    let k = null; try { k = JSON.parse(localStorage.getItem('tt-summary')).goKyu; } catch (e) { }
    const base = { vol: 0.06, games: 0, history: [], done: [] };
    return typeof k === 'number' ? { ...base, rating: Math.max(100, ratingOf(k)), rd: 250 } : { ...base, rating: 1100, rd: 350 };
  }
  const get = () => load(KEY, null) || seed();
  const fix = () => { try { if (!localStorage.getItem(KEY)) store(KEY, seed()); } catch (e) { } };
  const text = R => Math.round(R.rating) + (R.rd > 110 ? '?' : '');
  // 접바둑: 흑이 받는 이점을 레이팅으로 (한 점 ≈ 한 급, 덤이 0.5 라서 점 수 - 0.5 급)
  const handiAdv = d => d.handi >= 2 ? 100 * (d.handi - 0.5) : 0;

  // ---------- 대국 문서 읽기 ----------
  const me = () => ONL.uid();
  const colorOf = d => d.bu && d.bu === me() ? 1 : d.wu && d.wu === me() ? 2 : 0;
  const turnColor = d => ((d.moves.length % 2 === 0) === (d.handi < 2)) ? 1 : 2;
  const deadline = d => d.mt + d.days * 864e5;
  const opp = d => colorOf(d) === 1 ? { name: d.wn, r: d.wR, rd: d.wD } : { name: d.bn, r: d.bR, rd: d.bD };
  // 내 할 일: mine(내 차례) / theirs(상대 차례) / open(초대 중) / done
  function stage(d) {
    if (d.st === 'open') return 'open';
    if (d.st === 'done') return 'done';
    if (d.st === 'score') return !d.prop || d.prop.by !== me() ? 'mine' : 'theirs';
    return turnColor(d) === colorOf(d) ? 'mine' : 'theirs';
  }
  const when = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`; };
  function left(ms) {
    const t = ms - Date.now(); if (t <= 0) return '기한 지남';
    const h = Math.floor(t / 36e5); return h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간 남음` : h >= 1 ? `${h}시간 남음` : `${Math.max(1, Math.round(t / 6e4))}분 남음`;
  }

  // ---------- 레이팅 ----------
  // 끝난 대국을 내 레이팅에 한 번만 반영한다. 반환: {before, after} (반영 안 하면 null)
  function settle(d) {
    const col = colorOf(d);
    if (d.st !== 'done' || !d.res || !col) return null;
    const R = get();
    if (R.done.includes(d.code)) return null;
    R.done = R.done.concat(d.code).slice(-300);
    // 친선 대국, 첫 수도 없이 시간이 지난 대국은 반영하지 않는다
    if (!d.rated || (d.res.how === 'time' && d.moves.length < 2)) { store(KEY, R); return null; }
    const o = opp(d), adv = handiAdv(d), oppEff = o.r + (col === 1 ? -adv : adv);
    const score = d.res.w === col ? 1 : 0, before = R.rating;
    Object.assign(R, glicko2(R, oppEff, score, Math.max(30, Math.min(350, o.rd || 350))));
    R.games = (R.games || 0) + 1;
    R.history = (R.history || []).concat({ code: d.code, date: new Date(d.mt || Date.now()).toISOString().slice(0, 10), opp: o.name, oppR: Math.round(o.r), n: d.n, handi: d.handi, score, before: Math.round(before), after: Math.round(R.rating) }).slice(-30);
    store(KEY, R); LB.set({ gorPending: true }); sync(); saveSum();
    return { before, after: R.rating };
  }
  // 순위표 화면의 '내 레이팅' 요약
  function saveSum() {
    try { const s = JSON.parse(localStorage.getItem('tt-summary')) || {}, R = load(KEY, null); s.gor = R && R.games ? text(R) + ' · ' + rankOf(R.rating) : null; localStorage.setItem('tt-summary', JSON.stringify(s)); } catch (e) { }
  }
  const change = code => (get().history || []).find(h => h.code === code) || null;
  // 순위표(gor 컬렉션)에 올리기: 닉네임이 있고 3판 이상
  let busy = false;
  async function sync() {
    if (busy || !LB.configured() || !navigator.onLine) return;
    const s = LB.state(); if (!s.name || !s.gorPending) return;
    const R = get(); busy = true;
    try {
      if (R.games >= 3) { await LB.uploadTo('gor', { name: s.name, rating: Math.max(100, Math.round(R.rating)), rd: Math.round(Math.min(400, R.rd)), games: R.games }); LB.set({ gorPending: false, gorUploaded: true }); }
      else LB.set({ gorPending: false });
    } catch (e) { console.warn('[순위표]', e); }
    finally { busy = false; }
  }

  // ---------- 목록 ----------
  const cached = () => { try { return JSON.parse(localStorage.getItem(LIST)) || []; } catch (e) { return []; } };
  const cachedOne = code => cached().find(d => d.code === code) || null;
  function remember(d) { // 대국 화면에서 받은 최신 상태도 목록 캐시에 넣는다
    const l = cached().filter(x => x.code !== d.code); l.push(d); saveList(l);
  }
  function saveList(l) {
    try { localStorage.setItem(LIST, JSON.stringify(l.filter(d => d.g === 'go').sort((a, b) => b.mt - a.mt).slice(0, 60))); } catch (e) { }
    summary(l);
  }
  // 홈 화면에 보일 요약과 앱 아이콘 배지 (내 차례인 대국 수)
  function summary(l = cached()) {
    const act = l.filter(d => d.st === 'play' || d.st === 'score'), mine = act.filter(d => stage(d) === 'mine').length;
    try { localStorage.setItem(SUM, JSON.stringify({ mine, active: act.length, open: l.filter(d => d.st === 'open').length, at: Date.now() })); } catch (e) { }
    try { if (navigator.setAppBadge) mine ? navigator.setAppBadge(mine) : navigator.clearAppBadge(); } catch (e) { }
  }
  async function refresh() {
    const l = (await ONL.mine()).filter(d => d.g === 'go');
    for (const d of l) settle(d);
    saveList(l);
    return cached();
  }

  // ---------- 만들기 · 참가 ----------
  async function create(o) { // o = {n, color: 1|2|0(무작위), handi, days, rated}
    const s = LB.state(), { uid } = await LB.auth(); fix();
    const R = get(), col = o.color || (Math.random() < 0.5 ? 1 : 2), r = Math.max(0, Math.round(R.rating)), rd = Math.round(R.rd);
    const f = { g: 'go', n: o.n, komi: o.handi >= 2 ? 0.5 : 7.5, handi: o.handi, days: o.days, rated: !!o.rated, host: uid, players: [uid],
      bu: col === 1 ? uid : '', wu: col === 2 ? uid : '', bn: col === 1 ? s.name : '', wn: col === 2 ? s.name : '',
      bR: col === 1 ? r : 0, bD: col === 1 ? rd : 0, wR: col === 2 ? r : 0, wD: col === 2 ? rd : 0,
      st: 'open', moves: [], rs: 0, created: Date.now() };
    const { code, at, ut } = await ONL.create(f);
    remember({ ...f, code, mt: at, ut });
    return code;
  }
  async function join(d) {
    const s = LB.state(), { uid } = await LB.auth(); fix();
    const R = get(), x = d.bu === '' ? 'b' : 'w';
    const f = { players: d.players.concat(uid), [x + 'u']: uid, [x + 'n']: s.name, [x + 'R']: Math.max(0, Math.round(R.rating)), [x + 'D']: Math.round(R.rd), st: 'play' };
    await ONL.write(d.code, f, Object.keys(f), { ut: d.ut });
  }
  const link = code => location.href.replace(/\/go\/.*$/, '/go/online/#join=' + code);
  const inviteText = d => `${d.bn || d.wn}님이 바둑 한 판 청합니다 · ${d.n}줄${d.handi ? ' ' + d.handi + '점 접바둑' : ''} · 한 수 ${d.days}일 · 방 코드 ${d.code}`;

  window.addEventListener('online', sync);
  setTimeout(sync, 4000); saveSum();
  return { kyuOf, ratingOf, rankOf, get, text, colorOf, turnColor, deadline, opp, stage, when, left, settle, change, sync, cached, cachedOne, remember, summary, refresh, create, join, link, inviteText };
})();
