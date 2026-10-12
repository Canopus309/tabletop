// 온라인 대국 Firestore 규칙 검사 (배포된 규칙에 실제로 요청을 보내 허용·거부를 확인한다)
// 사용: node tools/online/rules-test.js
// 익명 계정 3개를 만들고, 시험용 대국 문서 몇 개를 남긴다 (참가자 말고는 목록에 안 보이고, 코드는 TS 로 시작)
'use strict';
const KEY = 'AIzaSyAX8wY-LOrJNCA3U-K3aRnHLyDmFp_FNmg', PID = 'table-top-51538';
const ROOT = `projects/${PID}/databases/(default)/documents`, API = `https://firestore.googleapis.com/v1/${ROOT}`;

async function anon() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' });
  const j = await r.json(); return { token: j.idToken, uid: j.localId };
}
const enc = v => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
// stamp: 서버 시각을 mt 에 넣는다 (무승부 제안·거절은 기한을 바꾸지 않으므로 false)
async function write(u, code, fields, mask, create = false, stamp = true) {
  const w = { update: { name: `${ROOT}/games/${code}`, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) },
    updateTransforms: stamp ? [{ fieldPath: 'mt', setToServerValue: 'REQUEST_TIME' }] : [] };
  if (create) w.currentDocument = { exists: false }; else w.updateMask = { fieldPaths: mask };
  const r = await fetch(`${API}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + u.token }, body: JSON.stringify({ writes: [w] }) });
  return r.status;
}
async function req(u, path, opt = {}) {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: 'Bearer ' + u.token } : {}) } });
  return r.status;
}
let pass = 0, fail = 0;
function expect(name, status, ok) {
  const good = ok ? status === 200 : status === 403;
  console.log(`${good ? 'OK  ' : 'FAIL'} ${ok ? '허용' : '거부'} 기대 · ${status} · ${name}`);
  good ? pass++ : fail++;
}
const code = () => 'TS' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(4, 'X');

(async () => {
  const A = await anon(), B = await anon(), C = await anon();
  const newGame = (o = {}) => ({ g: 'go', n: 9, komi: 7.5, handi: 0, days: 3, rated: true, host: A.uid, players: [A.uid], bu: A.uid, wu: '', bn: 'A', wn: '', bR: 1100, bD: 350, wR: 0, wD: 0, st: 'open', moves: [], rs: 0, created: Date.now(), ...o });
  const join = { players: null, wu: B.uid, wn: 'B', wR: 1200, wD: 300, st: 'play' }, JM = ['players', 'wu', 'wn', 'wR', 'wD', 'st'];

  // 만들기
  const g1 = code();
  expect('잘못된 상태로 만들기', await write(A, g1, newGame({ st: 'play' }), null, true), false);
  expect('남의 uid 로 만들기', await write(A, g1, newGame({ host: B.uid }), null, true), false);
  expect('대국 만들기', await write(A, g1, newGame(), null, true), true);
  // 참가
  expect('호스트가 자기 대국 참가', await write(A, g1, { ...join, players: [A.uid, A.uid], wu: A.uid }, JM), false);
  expect('흑 자리 빼앗기', await write(B, g1, { players: [A.uid, B.uid], bu: B.uid, st: 'play' }, ['players', 'bu', 'st']), false);
  expect('참가', await write(B, g1, { ...join, players: [A.uid, B.uid] }, JM), true);
  expect('세 번째 사람 참가', await write(C, g1, { ...join, players: [A.uid, B.uid, C.uid], wu: C.uid }, JM), false);
  // 수
  expect('백이 흑 차례에 두기', await write(B, g1, { moves: [11], st: 'play' }, ['moves', 'st']), false);
  expect('흑 첫 수', await write(A, g1, { moves: [11], st: 'play' }, ['moves', 'st']), true);
  expect('흑이 연달아 두기', await write(A, g1, { moves: [11, 12], st: 'play' }, ['moves', 'st']), false);
  expect('앞 수를 바꾸며 두기', await write(B, g1, { moves: [13, 12], st: 'play' }, ['moves', 'st']), false);
  expect('두 수 한꺼번에', await write(B, g1, { moves: [11, 12, 13], st: 'play' }, ['moves', 'st']), false);
  expect('백 수', await write(B, g1, { moves: [11, 12], st: 'play' }, ['moves', 'st']), true);
  expect('제3자가 두기', await write(C, g1, { moves: [11, 12, 13], st: 'play' }, ['moves', 'st']), false);
  expect('흑 패스', await write(A, g1, { moves: [11, 12, 0], st: 'play' }, ['moves', 'st']), true);
  expect('두 번째 패스인데 계가로 안 넘기기', await write(B, g1, { moves: [11, 12, 0, 0], st: 'play' }, ['moves', 'st']), false);
  expect('두 번째 패스 → 계가', await write(B, g1, { moves: [11, 12, 0, 0], st: 'score' }, ['moves', 'st']), true);
  expect('계가 중에 두기', await write(A, g1, { moves: [11, 12, 0, 0, 14], st: 'play' }, ['moves', 'st']), false);
  // 계가
  const prop = { by: A.uid, dead: [12], bs: 81, ws: 0, w: 1, d: 73.5 };
  expect('남의 이름으로 제안', await write(A, g1, { prop: { ...prop, by: B.uid } }, ['prop']), false);
  expect('계가 제안', await write(A, g1, { prop }, ['prop']), true);
  expect('제안자가 바로 끝내기', await write(A, g1, { st: 'done', res: { w: 1, how: 'score', d: 73.5, by: A.uid } }, ['st', 'res']), false);
  expect('결과를 바꿔 동의', await write(B, g1, { st: 'done', res: { w: 2, how: 'score', d: 73.5, by: B.uid } }, ['st', 'res']), false);
  expect('이어 두기 (rs 틀림)', await write(B, g1, { st: 'play', rs: 0 }, ['st', 'prop', 'rs']), false);
  expect('이어 두기', await write(B, g1, { st: 'play', rs: 4 }, ['st', 'prop', 'rs']), true);
  expect('이어 둔 뒤 패스 한 번으로 계가', await write(A, g1, { moves: [11, 12, 0, 0, 0], st: 'score' }, ['moves', 'st']), false);
  expect('이어 둔 뒤 패스', await write(A, g1, { moves: [11, 12, 0, 0, 0], st: 'play' }, ['moves', 'st']), true);
  expect('이어 둔 뒤 두 번째 패스 → 계가', await write(B, g1, { moves: [11, 12, 0, 0, 0, 0], st: 'score' }, ['moves', 'st']), true);
  expect('계가 다시 제안', await write(A, g1, { prop }, ['prop']), true);
  expect('동의', await write(B, g1, { st: 'done', res: { w: 1, how: 'score', d: 73.5, by: B.uid } }, ['st', 'res']), true);
  expect('끝난 대국 기권', await write(B, g1, { st: 'done', res: { w: 1, how: 'resign', d: 0, by: B.uid } }, ['st', 'res']), false);

  // 기권 · 시간승
  const g2 = code();
  await write(A, g2, newGame(), null, true); await write(B, g2, { ...join, players: [A.uid, B.uid] }, JM);
  expect('시간승 (기한 전)', await write(B, g2, { st: 'done', res: { w: 2, how: 'time', d: 0, by: B.uid } }, ['st', 'res']), false);
  expect('상대 승으로 기권 처리 안 하고 자기 승으로', await write(A, g2, { st: 'done', res: { w: 1, how: 'resign', d: 0, by: A.uid } }, ['st', 'res']), false);
  expect('기권', await write(A, g2, { st: 'done', res: { w: 2, how: 'resign', d: 0, by: A.uid } }, ['st', 'res']), true);

  // 오목: 흑 먼저, 칸 번호 0~224, 5목은 둔 사람 승으로 끝, 무승부 제안·동의
  const omok = o => newGame({ g: 'omok', n: 15, komi: 0, handi: 0, ...o });
  expect('오목: 판 크기 틀림', await write(A, code(), omok({ n: 19 }), null, true), false);
  const o1 = code();
  expect('오목 만들기', await write(A, o1, omok(), null, true), true);
  await write(B, o1, { ...join, players: [A.uid, B.uid] }, JM);
  expect('오목: 판 밖 칸', await write(A, o1, { moves: [300], st: 'play' }, ['moves', 'st']), false);
  expect('오목: 흑 첫 수', await write(A, o1, { moves: [112], st: 'play' }, ['moves', 'st']), true);
  expect('오목: 무승부 제안', await write(A, o1, { offer: A.uid }, ['offer'], false, false), true);
  expect('오목: 또 제안', await write(B, o1, { offer: B.uid }, ['offer'], false, false), false);
  expect('오목: 자기 제안에 동의', await write(A, o1, { st: 'done', res: { w: 0, how: 'agree', d: 0, by: A.uid } }, ['st', 'res', 'offer']), false);
  expect('오목: 수를 두며 제안 거절', await write(B, o1, { moves: [112, 113], st: 'play' }, ['moves', 'st', 'offer']), true);
  expect('오목: 상대 승으로 5목 주장', await write(A, o1, { moves: [112, 113, 114], st: 'done', res: { w: 2, how: 'five', d: 0, by: A.uid } }, ['moves', 'st', 'res']), false);
  expect('오목: 5목으로 끝', await write(A, o1, { moves: [112, 113, 114], st: 'done', res: { w: 1, how: 'five', d: 0, by: A.uid } }, ['moves', 'st', 'res']), true);
  const o2 = code();
  await write(A, o2, omok(), null, true); await write(B, o2, { ...join, players: [A.uid, B.uid] }, JM);
  await write(B, o2, { offer: B.uid }, ['offer'], false, false);
  expect('오목: 상대 제안에 동의', await write(A, o2, { st: 'done', res: { w: 0, how: 'agree', d: 0, by: A.uid } }, ['st', 'res', 'offer']), true);
  // 체스: 백 먼저(흑 A, 백 B), 수는 'e2e4' 같은 글자, 체크메이트·무승부로 끝
  const chess = o => newGame({ g: 'chess', n: 8, komi: 0, handi: 0, ...o });
  const c1 = code();
  expect('체스 만들기', await write(A, c1, chess(), null, true), true);
  await write(B, c1, { ...join, players: [A.uid, B.uid] }, JM);
  expect('체스: 흑이 먼저 두기', await write(A, c1, { moves: ['e7e5'], st: 'play' }, ['moves', 'st']), false);
  expect('체스: 숫자 수', await write(B, c1, { moves: [12], st: 'play' }, ['moves', 'st']), false);
  expect('체스: 백 첫 수', await write(B, c1, { moves: ['f2f3'], st: 'play' }, ['moves', 'st']), true);
  await write(A, c1, { moves: ['f2f3', 'e7e5'], st: 'play' }, ['moves', 'st']);
  await write(B, c1, { moves: ['f2f3', 'e7e5', 'g2g4'], st: 'play' }, ['moves', 'st']);
  expect('체스: 체크메이트 (흑 승)', await write(A, c1, { moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'], st: 'done', res: { w: 1, how: 'mate', d: 0, by: A.uid } }, ['moves', 'st', 'res']), true);
  const c2 = code();
  await write(A, c2, chess(), null, true); await write(B, c2, { ...join, players: [A.uid, B.uid] }, JM);
  expect('체스: 스테일메이트를 승으로', await write(B, c2, { moves: ['e2e4'], st: 'done', res: { w: 2, how: 'stalemate', d: 0, by: B.uid } }, ['moves', 'st', 'res']), false);
  expect('체스: 무승부로 끝', await write(B, c2, { moves: ['e2e4'], st: 'done', res: { w: 0, how: 'stalemate', d: 0, by: B.uid } }, ['moves', 'st', 'res']), true);
  // 증강 바둑: 참가 → 증강 경매(st 'pick': 번갈아 부르기 → 그만 → 낙찰자가 고르기, 덤 = 7.5 ± 값) → 대국, 수는 글자 ('0' 패스)
  // A = 흑(만든 사람), B = 백. 먼저 부를 색 bt = 1 (흑)
  const aug = o => newGame({ g: 'goaug', n: 13, komi: 7.5, handi: 0, rated: false, ab: '', aw: '', of: ['barrier', 'snipe'], bv: -1, bw: 0, bt: 1, ...o });
  expect('증강: 레이팅 대국으로 만들기', await write(A, code(), aug({ rated: true }), null, true), false);
  expect('증강: 같은 후보 둘', await write(A, code(), aug({ of: ['snipe', 'snipe'] }), null, true), false);
  const a1 = code();
  expect('증강 만들기', await write(A, a1, aug(), null, true), true);
  expect('증강: 바로 play 로 참가', await write(B, a1, { ...join, players: [A.uid, B.uid] }, JM), false);
  expect('증강: 참가 (pick)', await write(B, a1, { ...join, players: [A.uid, B.uid], st: 'pick' }, JM), true);
  expect('증강: 수 두기 (경매 중)', await write(A, a1, { moves: ['20'], st: 'play' }, ['moves', 'st']), false);
  expect('경매: 차례 아닌 백이 부르기', await write(B, a1, { bv: 3, bw: 2, bt: 1 }, ['bv', 'bw', 'bt']), false);
  expect('경매: 처음에 그만', await write(A, a1, { bt: 0 }, ['bt']), false);
  expect('경매: 흑 0집', await write(A, a1, { bv: 0, bw: 1, bt: 2 }, ['bv', 'bw', 'bt']), true);
  expect('경매: 백이 같은 값', await write(B, a1, { bv: 0, bw: 2, bt: 1 }, ['bv', 'bw', 'bt']), false);
  expect('경매: 백 상한 넘게', await write(B, a1, { bv: 51, bw: 2, bt: 1 }, ['bv', 'bw', 'bt']), false);
  expect('경매: 백 6집', await write(B, a1, { bv: 6, bw: 2, bt: 1 }, ['bv', 'bw', 'bt']), true);
  expect('경매: 낙찰 전에 고르기', await write(B, a1, { ab: 'snipe', aw: 'barrier', komi: 1.5, st: 'play' }, ['ab', 'aw', 'komi', 'st']), false);
  expect('경매: 흑 그만 (백 낙찰)', await write(A, a1, { bt: 0 }, ['bt']), true);
  expect('경매: 진 쪽이 고르기', await write(A, a1, { ab: 'barrier', aw: 'snipe', komi: 1.5, st: 'play' }, ['ab', 'aw', 'komi', 'st']), false);
  expect('경매: 덤 틀리게', await write(B, a1, { ab: 'snipe', aw: 'barrier', komi: 13.5, st: 'play' }, ['ab', 'aw', 'komi', 'st']), false);
  expect('경매: 후보 밖 증강', await write(B, a1, { ab: 'snipe', aw: 'double', komi: 1.5, st: 'play' }, ['ab', 'aw', 'komi', 'st']), false);
  expect('경매: 백이 결계를 고름 (덤 7.5-6)', await write(B, a1, { ab: 'snipe', aw: 'barrier', komi: 1.5, st: 'play' }, ['ab', 'aw', 'komi', 'st']), true);
  expect('증강: 숫자 수', await write(A, a1, { moves: [20], st: 'play' }, ['moves', 'st']), false);
  expect('증강: 흑 첫 수', await write(A, a1, { moves: ['20'], st: 'play' }, ['moves', 'st']), true);
  expect('증강: 백 패스', await write(B, a1, { moves: ['20', '0'], st: 'play' }, ['moves', 'st']), true);
  expect('증강: 두 번째 패스 → 계가', await write(A, a1, { moves: ['20', '0', '0'], st: 'score' }, ['moves', 'st']), true);
  expect('증강: 무승부 제안 없음', await write(A, a1, { offer: A.uid }, ['offer'], false, false), false);
  const st1 = { n: 13, ab: 'double', aw: 'kowang', komi: 1.5, w: 1, how: 'score', len: 120, local: false, of: ['double', 'kowang'], bid: 6, bwin: 2 };
  expect('증강 결과 모음: 쓰기', await req(A, ':commit', { method: 'POST', body: JSON.stringify({ writes: [{ update: { name: `${ROOT}/augstats/T${a1}`, fields: Object.fromEntries(Object.entries(st1).map(([k, v]) => [k, enc(v)])) }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] }] }) }), true);
  expect('증강 결과 모음: 덮어쓰기', await req(A, ':commit', { method: 'POST', body: JSON.stringify({ writes: [{ update: { name: `${ROOT}/augstats/T${a1}`, fields: Object.fromEntries(Object.entries({ ...st1, w: 2 }).map(([k, v]) => [k, enc(v)])) }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] }] }) }), false);

  // 바둑에는 무승부 제안이 없다
  const g4 = code();
  await write(A, g4, newGame(), null, true); await write(B, g4, { ...join, players: [A.uid, B.uid] }, JM);
  expect('바둑: 무승부 제안', await write(A, g4, { offer: A.uid }, ['offer'], false, false), false);

  // 읽기 · 목록 · 지우기
  expect('코드로 읽기 (로그인 없이)', await req(null, '/games/' + g1), true);
  const q = (u, uid) => req(u, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'games' }], ...(uid ? { where: { fieldFilter: { field: { fieldPath: 'players' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } } } : {}), limit: 5 } }) });
  expect('내 대국 목록', await q(A, A.uid), true);
  // 목록 화면이 쓰는 두 질의 (색인 firestore.indexes.json 필요)
  const has = { fieldFilter: { field: { fieldPath: 'players' }, op: 'ARRAY_CONTAINS', value: { stringValue: A.uid } } };
  const live = { fieldFilter: { field: { fieldPath: 'st' }, op: 'IN', value: { arrayValue: { values: ['open', 'play', 'score'].map(s => ({ stringValue: s })) } } } };
  const run = (u, sq) => req(u, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'games' }], ...sq } }) });
  expect('진행 중인 내 대국 (색인)', await run(A, { where: { compositeFilter: { op: 'AND', filters: [has, live] } }, limit: 5 }), true);
  expect('최근 내 대국 (색인)', await run(A, { where: has, orderBy: [{ field: { fieldPath: 'mt' }, direction: 'DESCENDING' }], limit: 5 }), true);
  expect('남의 진행 중 대국', await run(C, { where: { compositeFilter: { op: 'AND', filters: [has, live] } }, limit: 5 }), false);
  expect('남의 대국 목록', await q(C, A.uid), false);
  expect('전체 목록', await q(C, null), false);
  const g3 = code();
  await write(A, g3, newGame(), null, true);
  expect('남의 초대 지우기', await req(B, '/games/' + g3, { method: 'DELETE' }), false);
  expect('내 초대 지우기', await req(A, '/games/' + g3, { method: 'DELETE' }), true);
  expect('시작한 대국 지우기', await req(A, '/games/' + g2, { method: 'DELETE' }), false);

  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
