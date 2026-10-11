/* 바둑 온라인 대국 설정 (공용 부분은 common/online-core.js)
 * 사람 대국 레이팅: 온라인 대국 결과로만 움직이는 Glicko-2. 1단 = 2100점, 한 급(단)마다 100점 (유럽 바둑 연맹 레이팅과 같은 눈금)
 */
'use strict';
const GO_ON = (() => {
  const kyuOf = r => (2100 - r) / 100, ratingOf = kyu => 2100 - 100 * kyu;
  const rankName = k => { k = Math.round(k); return k > 0 ? k + '급' : (1 - k) + '단'; };
  const rankOf = r => r <= 100 ? '20급 이하' : rankName(kyuOf(r));
  const text = R => Math.round(R.rating) + (R.rd > 110 ? '?' : '');
  const core = onlineCore({
    type: 'go', name: '바둑',
    first: d => d.handi >= 2 ? 2 : 1, // 접바둑은 백이 먼저
    fields: o => ({ n: o.n, komi: o.handi >= 2 ? 0.5 : 7.5, handi: o.handi }),
    info: d => `${d.n}줄${d.handi ? ' · ' + d.handi + '점 접바둑' : ''}`,
    sideNote: (d, col) => d.handi ? (col === 1 ? ' (접바둑 받음)' : ' (접바둑 줌)') : '',
    adv: d => d.handi >= 2 ? 100 * (d.handi - 0.5) : 0, // 한 점 ≈ 한 급, 덤이 0.5 라서 점 수 - 0.5 급
    rating: {
      key: 'go-online-rating', col: 'gor', pend: 'gorPending', upl: 'gorUploaded', sumKey: 'gor',
      // 처음 레이팅: '내 기력'(AI 대국에서 둔 수의 질로 잰 급수)이 있으면 그 급수, 없으면 10급
      init() {
        let k = null; try { k = JSON.parse(localStorage.getItem('tt-summary')).goKyu; } catch (e) { }
        const base = { vol: 0.06, games: 0, history: [] };
        return typeof k === 'number' ? { ...base, rating: Math.max(100, ratingOf(k)), rd: 250 } : { ...base, rating: 1100, rd: 350 };
      },
      label: '사람 대국 레이팅', big: text,
      small: R => `약 ${rankOf(R.rating)} · ${R.games || 0}판${localStorage.getItem('go-online-rating') ? '' : ' · 첫 대국 전 (내 기력 기준)'}`,
      sum: R => text(R) + ' · ' + rankOf(R.rating),
    },
  });
  return { ...core, rankOf, text, kyuOf, ratingOf };
})();
