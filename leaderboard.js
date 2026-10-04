/* 온라인 순위표: Firebase 익명 로그인 + Firestore.
 * SDK 없이 REST로 직접 호출해 앱을 가볍게 유지한다. 대국은 오프라인으로 두고,
 * 결과는 폰에 쌓아 두었다가 온라인이 되면 올린다 (index.html의 lbSync).
 * 쓰기 권한은 firestore.rules 가 지킨다: 각자 자기 문서(players/{uid})만 고칠 수 있다.
 */
'use strict';
// Firebase 콘솔 → 프로젝트 설정 → 웹 앱의 값. 웹 앱용 apiKey는 공개되어도 되는 값이다.
const FIREBASE = { apiKey: 'AIzaSyAX8wY-LOrJNCA3U-K3aRnHLyDmFp_FNmg', projectId: 'table-top-51538' };

const LB = (() => {
  const KEY = 'baduk-lb';
  const state = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const set = o => { try { localStorage.setItem(KEY, JSON.stringify({ ...state(), ...o })); } catch (e) { } };
  const configured = () => !!(FIREBASE.apiKey && FIREBASE.projectId);
  const docsUrl = () => `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
  let idToken = null, idExp = 0;

  // 익명 로그인 (처음 한 번 계정을 만들고, 그 뒤로는 갱신 토큰으로 이어 간다)
  async function auth() {
    const s = state();
    if (idToken && s.uid && Date.now() < idExp - 60000) return { token: idToken, uid: s.uid };
    if (s.refresh) {
      const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refresh),
      });
      if (r.ok) {
        const j = await r.json();
        idToken = j.id_token; idExp = Date.now() + (+j.expires_in) * 1000;
        set({ refresh: j.refresh_token, uid: j.user_id });
        return { token: idToken, uid: j.user_id };
      }
    }
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!r.ok) throw new Error('익명 로그인 실패 (' + r.status + ')');
    const j = await r.json();
    idToken = j.idToken; idExp = Date.now() + (+j.expiresIn) * 1000;
    set({ refresh: j.refreshToken, uid: j.localId });
    return { token: idToken, uid: j.localId };
  }

  const toField = v => typeof v === 'string' ? { stringValue: v }
    : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  const fromField = f => !f ? undefined : f.stringValue !== undefined ? f.stringValue
    : f.integerValue !== undefined ? +f.integerValue : f.doubleValue !== undefined ? f.doubleValue : f.timestampValue;

  // 내 기록을 올린다. updated 는 서버 시각으로 채운다 (규칙에서 확인)
  async function upload(entry) {
    const { token, uid } = await auth();
    const fields = {};
    for (const k in entry) fields[k] = toField(entry[k]);
    const name = `projects/${FIREBASE.projectId}/databases/(default)/documents/players/${uid}`;
    const r = await fetch(`${docsUrl()}:commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ writes: [{ update: { name, fields }, updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }] }] }),
    });
    if (!r.ok) throw new Error('기록 올리기 실패 (' + r.status + ') ' + (await r.text()).slice(0, 200));
  }
  async function remove() {
    const { token, uid } = await auth();
    const r = await fetch(`${docsUrl()}/players/${uid}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok && r.status !== 404) throw new Error('기록 지우기 실패 (' + r.status + ')');
  }
  // 기력 높은 순(급수 숫자가 작은 순) 100명. 받은 목록은 오프라인에서 보이도록 저장해 둔다
  async function fetchTop() {
    const r = await fetch(`${docsUrl()}:runQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'players' }], orderBy: [{ field: { fieldPath: 'kyu' }, direction: 'ASCENDING' }], limit: 100 } }),
    });
    if (!r.ok) throw new Error('순위표 받기 실패 (' + r.status + ')');
    const rows = (await r.json()).filter(x => x.document).map(x => {
      const f = x.document.fields || {};
      return { uid: x.document.name.split('/').pop(), name: fromField(f.name), kyu: fromField(f.kyu), weak: fromField(f.weak), strong: fromField(f.strong), games: fromField(f.games), updated: fromField(f.updated) };
    });
    set({ cache: rows, cacheAt: Date.now() });
    return rows;
  }
  return { configured, upload, remove, fetchTop, state, set };
})();
