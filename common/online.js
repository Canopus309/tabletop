/* 온라인 대국 (편지 대국): Firestore games 컬렉션을 REST로 다룬다. 게임 종류와 상관없는 부분만 여기에 둔다.
 * 대국 문서 하나 = 방 하나 (문서 id = 6자리 방 코드). 누가 어떤 값을 바꿀 수 있는지는 firestore.rules 가 지킨다.
 * leaderboard.js(FIREBASE, LB: 익명 로그인) 다음에 불러온다.
 */
'use strict';
const ONL = (() => {
  const root = () => `projects/${FIREBASE.projectId}/databases/(default)/documents`;
  const api = p => `https://firestore.googleapis.com/v1/${root()}${p}`;
  // 헷갈리는 글자(I·O·0·1)는 뺀다
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => { const a = new Uint32Array(6); crypto.getRandomValues(a); return Array.from(a, x => CODE_CH[x % CODE_CH.length]).join(''); };
  const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

  // Firestore 값 ↔ JS 값
  const enc = v => v === null || v === undefined ? { nullValue: null }
    : typeof v === 'boolean' ? { booleanValue: v }
    : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
    : typeof v === 'string' ? { stringValue: v }
    : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
    : { mapValue: { fields: encFields(v) } };
  function encFields(o) { const f = {}; for (const k in o) if (o[k] !== undefined) f[k] = enc(o[k]); return f; }
  function dec(f) {
    if ('nullValue' in f) return null;
    if ('booleanValue' in f) return f.booleanValue;
    if ('integerValue' in f) return +f.integerValue;
    if ('doubleValue' in f) return f.doubleValue;
    if ('stringValue' in f) return f.stringValue;
    if ('timestampValue' in f) return Date.parse(f.timestampValue);
    if ('arrayValue' in f) return (f.arrayValue.values || []).map(dec);
    if ('mapValue' in f) { const o = {}, m = f.mapValue.fields || {}; for (const k in m) o[k] = dec(m[k]); return o; }
    return undefined;
  }
  // 문서 → 객체 (code: 방 코드, ut: 마지막으로 바뀐 시각. 다음 쓰기의 '그 사이 안 바뀌었을 때만' 조건에 쓴다)
  function fromDoc(d) { const o = {}, f = d.fields || {}; for (const k in f) o[k] = dec(f[k]); o.code = d.name.split('/').pop(); o.ut = d.updateTime; return o; }

  // status 0 = 연결 안 됨 (오프라인 등)
  class NetErr extends Error { constructor(msg, status) { super(msg); this.status = status; } }
  async function call(url, opt = {}) {
    if (!navigator.onLine) throw new NetErr('오프라인', 0);
    let tok;
    try { tok = await LB.auth(); } catch (e) { throw new NetErr('로그인 실패', 0); }
    let r;
    try { r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok.token } }); }
    catch (e) { throw new NetErr('연결 실패', 0); }
    if (!r.ok) { let t = ''; try { t = (await r.json()).error.message; } catch (e) { } throw new NetErr(t || '오류 ' + r.status, r.status); }
    return r.status === 204 ? null : r.json();
  }

  async function get(code) {
    try { return fromDoc(await call(api('/games/' + code))); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  // 내가 들어 있는 대국 모두
  async function mine() {
    const { uid } = await LB.auth();
    const j = await call(api(':runQuery'), { method: 'POST', body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'games' }],
      where: { fieldFilter: { field: { fieldPath: 'players' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } },
      limit: 200 } }) });
    return j.filter(x => x.document).map(x => fromDoc(x.document));
  }
  // fields 의 값으로 고친다. mask 에 있는데 fields 에 없는 키는 지운다.
  // stamp: 서버 시각을 넣을 필드, ut: 그 시각 이후 아무도 안 고쳤을 때만 쓴다 (동시에 고치는 것 막기)
  async function write(code, fields, mask, { stamp = ['mt'], ut = null, create = false } = {}) {
    const w = { update: { name: root() + '/games/' + code, fields: encFields(fields) },
      updateTransforms: stamp.map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })) };
    if (create) w.currentDocument = { exists: false };
    else { w.updateMask = { fieldPaths: mask }; if (ut) w.currentDocument = { updateTime: ut }; }
    const j = await call(api(':commit'), { method: 'POST', body: JSON.stringify({ writes: [w] }) });
    const wr = j.writeResults[0], tr = wr.transformResults && wr.transformResults[0];
    return { ut: wr.updateTime, at: Date.parse(tr && tr.timestampValue || j.commitTime) };
  }
  async function create(fields) {
    for (let i = 0; i < 4; i++) {
      const code = newCode();
      try { const r = await write(code, fields, null, { create: true }); return { code, ...r }; }
      catch (e) { if (e.status !== 409) throw e; } // 같은 코드가 이미 있으면 다시
    }
    throw new NetErr('방 코드를 만들지 못했습니다', 500);
  }
  const remove = code => call(api('/games/' + code), { method: 'DELETE' });

  // 초대 보내기: 공유 시트(카카오톡 등), 안 되면 클립보드
  async function share(text, url) {
    if (navigator.share) {
      try { await navigator.share({ text, url }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancel'; }
    }
    try { await navigator.clipboard.writeText(text + '\n' + url); return 'copied'; } catch (e) { return 'fail'; }
  }
  const uid = () => LB.state().uid || '';
  return { get, mine, write, create, remove, share, uid, normCode, NetErr };
})();
