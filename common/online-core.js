/* 온라인 대국 공용 (바둑·오목·체스): 대국 문서 읽기, 레이팅 반영, 대국 목록 캐시, 만들기·참가
 * 게임마다 onlineCore(설정) 로 하나씩 만든다 (go/online/core.js 등). 목록 화면과 대국 화면이 함께 쓴다.
 * ui.js, leaderboard.js, rating.js(glicko2), online.js 다음에 불러온다.
 *
 * 설정 C = {
 *   type: 'go'|'omok'|'chess', name: '바둑',
 *   first(d): 수가 없을 때 둘 색 (1 흑, 2 백)
 *   fields(o): 새 대국 문서의 게임별 값 {n, komi, handi}
 *   info(d): '19줄 · 3점 접바둑' 같은 설명, sideNote(d, col): '(접바둑 받음)' 같은 덧말
 *   adv(d): 흑이 받는 이점(레이팅 점수, 접바둑)
 *   rating: {key, col, pend, upl, init(), label, big(R), small(R), sumKey, sum(R)}
 *   path: 주소의 게임 폴더 (기본 type, 증강 바둑은 'go/aug'), joinState: 참가 뒤 상태 (기본 'play', 증강 바둑은 증강 고르기 'pick')
 *   unrated: 늘 친선 대국
 *     key: 기기에 저장된 레이팅, col: 순위표 컬렉션, pend/upl: 올릴 것 있음/올렸음 표시 (LB 상태)
 * }
 * 색은 문서와 여기서 늘 숫자다: 1 = 흑, 2 = 백 (체스 화면은 'b'/'w' 로 바꿔 쓴다)
 */
'use strict';
function onlineCore(C) {
  const T = C.type, RK = C.rating.key, LIST = T + '-online-list', SUM = T + '-online-sum', DONE = T + '-online-done';
  const get = () => load(RK, null) || C.rating.init();
  // 처음 레이팅을 정해 둔다 (바둑은 '내 기력'에서 정해지므로 첫 온라인 대국 때 고정)
  const fix = () => { try { if (!localStorage.getItem(RK)) store(RK, C.rating.init()); } catch (e) { } };

  // ---------- 대국 문서 읽기 ----------
  const me = () => ONL.uid();
  const colorOf = d => d.bu && d.bu === me() ? 1 : d.wu && d.wu === me() ? 2 : 0;
  const turnColor = d => d.moves.length % 2 === 0 ? C.first(d) : 3 - C.first(d);
  const deadline = d => d.mt + d.days * 864e5;
  const opp = d => colorOf(d) === 1 ? { name: d.wn, r: d.wR, rd: d.wD } : { name: d.bn, r: d.bR, rd: d.bD };
  // 내 할 일: mine(내 차례) / theirs(상대 차례) / open(초대 중) / done
  function stage(d) {
    if (d.st === 'open') return 'open';
    if (d.st === 'done') return 'done';
    if (d.st === 'pick') return (d.bt ? d.bt === colorOf(d) : d.bw === colorOf(d)) ? 'mine' : 'theirs'; // 증강 경매: 부를 차례 / 낙찰자가 고를 차례
    if (d.st === 'score') return !d.prop || d.prop.by !== me() ? 'mine' : 'theirs';
    if (d.offer && d.offer !== me()) return 'mine'; // 상대의 무승부 제안에 답할 차례
    return turnColor(d) === colorOf(d) ? 'mine' : 'theirs';
  }
  const when = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`; };
  function left(ms) {
    const t = ms - Date.now(); if (t <= 0) return '기한 지남';
    const h = Math.floor(t / 36e5); return h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간 남음` : h >= 1 ? `${h}시간 남음` : `${Math.max(1, Math.round(t / 6e4))}분 남음`;
  }
  const info = d => [C.info(d), `한 수 ${d.days}일`, d.rated ? '' : '친선'].filter(Boolean).join(' · ');

  // ---------- 레이팅 ----------
  const doneList = () => { try { return JSON.parse(localStorage.getItem(DONE)) || []; } catch (e) { return []; } };
  const isDone = code => doneList().includes(code) || (get().done || []).includes(code); // done: 예전 바둑 기록 안에 두던 목록
  const markDone = code => { try { localStorage.setItem(DONE, JSON.stringify(doneList().concat(code).slice(-300))); } catch (e) { } };
  // 끝난 대국을 내 레이팅에 한 번만 반영한다. 반환: {before, after} (반영 안 하면 null)
  function settle(d) {
    const col = colorOf(d);
    if (d.st !== 'done' || !d.res || !col || isDone(d.code)) return null;
    markDone(d.code);
    // 친선 대국, 첫 수도 없이 시간이 지난 대국은 반영하지 않는다
    if (!d.rated || (d.res.how === 'time' && d.moves.length < 2)) return null;
    const R = get(), o = opp(d), adv = C.adv ? C.adv(d) : 0, oppEff = o.r + (col === 1 ? -adv : adv);
    const score = d.res.w === 0 ? 0.5 : d.res.w === col ? 1 : 0, before = R.rating;
    Object.assign(R, glicko2(R, oppEff, score, Math.max(30, Math.min(350, o.rd || 350))));
    R.games = (R.games || 0) + 1;
    R.history = (R.history || []).concat({ id: d.created, code: d.code, date: new Date(d.mt || Date.now()).toISOString().slice(0, 10), level: -1, label: '온라인 · ' + o.name, opp: Math.round(o.r), score, before: Math.round(before), after: Math.round(R.rating) }).slice(-30);
    store(RK, R); LB.set({ [C.rating.pend]: true }); sync(); saveSum();
    return { before, after: R.rating };
  }
  const change = code => (get().history || []).find(h => h.code === code) || null;
  // 순위표에 올리기: 닉네임이 있고 3판 이상 (기록을 지웠으면 내린다)
  let busy = false;
  async function sync() {
    if (busy || !LB.configured() || !navigator.onLine) return;
    const s = LB.state(), P = C.rating.pend, U = C.rating.upl; if (!s.name || !s[P]) return;
    const R = get(); busy = true;
    try {
      if (R.games >= 3) { await LB.uploadTo(C.rating.col, { name: s.name, rating: Math.max(100, Math.min(3500, Math.round(R.rating))), rd: Math.round(Math.min(400, R.rd)), games: R.games }); LB.set({ [P]: false, [U]: true }); }
      else { if (s[U]) await LB.removeFrom(C.rating.col); LB.set({ [P]: false, [U]: false }); }
    } catch (e) { console.warn('[순위표]', e); }
    finally { busy = false; }
  }
  // 홈·순위표 화면의 '내 레이팅' 요약
  function saveSum() {
    try { const s = JSON.parse(localStorage.getItem('tt-summary')) || {}, R = load(RK, null); s[C.rating.sumKey] = R && R.games ? C.rating.sum(R) : null; localStorage.setItem('tt-summary', JSON.stringify(s)); } catch (e) { }
  }

  // ---------- 목록 ----------
  const cached = () => { try { return JSON.parse(localStorage.getItem(LIST)) || []; } catch (e) { return []; } };
  const cachedOne = code => cached().find(d => d.code === code) || null;
  function remember(d) { // 대국 화면에서 받은 최신 상태도 목록 캐시에 넣는다
    const l = cached().filter(x => x.code !== d.code); l.push(d); saveList(l);
  }
  function saveList(l) {
    // 진행 중인 대국은 모두, 끝난 대국은 최근 40판만 기기에 둔다
    const mine = l.filter(d => d.g === T).sort((a, b) => b.mt - a.mt);
    const keep = mine.filter(d => d.st !== 'done').concat(mine.filter(d => d.st === 'done').slice(0, 40));
    try { localStorage.setItem(LIST, JSON.stringify(keep)); } catch (e) { }
    summary(keep);
  }
  // 게임 홈에 보일 요약과 앱 아이콘 배지 (세 게임의 '내 차례' 수를 합침)
  function summary(l = cached()) {
    const act = l.filter(d => d.st === 'play' || d.st === 'score' || d.st === 'pick'), mine = act.filter(d => stage(d) === 'mine').length;
    try { localStorage.setItem(SUM, JSON.stringify({ mine, active: act.length, open: l.filter(d => d.st === 'open').length, at: Date.now() })); } catch (e) { }
    let all = 0;
    for (const t of ['go', 'omok', 'chess']) { try { all += (JSON.parse(localStorage.getItem(t + '-online-sum')) || {}).mine || 0; } catch (e) { } }
    try { if (navigator.setAppBadge) all ? navigator.setAppBadge(all) : navigator.clearAppBadge(); } catch (e) { }
  }
  async function refresh() {
    const l = (await ONL.mine()).filter(d => d.g === T);
    for (const d of l) settle(d);
    saveList(l);
    return cached();
  }

  // ---------- 만들기 · 참가 ----------
  async function create(o) { // o = {color: 1|2|0(무작위), days, rated, n?, handi?}
    const s = LB.state(), { uid } = await LB.auth(); fix();
    const R = get(), col = o.color || (Math.random() < 0.5 ? 1 : 2), r = Math.max(0, Math.round(R.rating)), rd = Math.round(R.rd);
    const f = { g: T, ...C.fields(o), days: o.days, rated: !C.unrated && !!o.rated, host: uid, players: [uid],
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
    const f = { players: d.players.concat(uid), [x + 'u']: uid, [x + 'n']: s.name, [x + 'R']: Math.max(0, Math.round(R.rating)), [x + 'D']: Math.round(R.rd), st: C.joinState || 'play' };
    await ONL.write(d.code, f, Object.keys(f), { ut: d.ut });
  }
  const PATH = C.path || T, link = code => location.href.replace(new RegExp('/' + PATH + '/.*$'), '/' + PATH + '/online/#join=' + code);
  const inviteText = d => `${d.bn || d.wn}님이 ${C.name} 한 판 청합니다 · ${info(d)} · 방 코드 ${d.code}`;

  window.addEventListener('online', sync);
  setTimeout(sync, 4000); saveSum();
  return { type: T, name: C.name, C, get, colorOf, turnColor, deadline, opp, stage, when, left, info, settle, change, sync, cached, cachedOne, remember, summary, refresh, create, join, link, inviteText };
}
