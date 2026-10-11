/* 오목 온라인 대국 설정 (공용 부분은 common/online-core.js)
 * 사람끼리 둔 레이팅 대국 결과는 AI 대국과 같은 '내 급수'(omok-rating, Glicko-2)에 함께 반영한다
 */
'use strict';
const OMOK_ON = (() => {
  // 레이팅 → 급수 (600 = 18급, 80점 = 1급, 0급 이하는 단). 오목 화면의 omokRank 와 같다
  const rank = r => { const k = Math.min(30, Math.round(18 - (r - 600) / 80)); return k >= 1 ? k + '급' : (1 - k) + '단'; };
  const text = R => rank(R.rating) + (R.rd > 110 ? '?' : '');
  const core = onlineCore({
    type: 'omok', name: '오목',
    first: () => 1, // 흑이 먼저
    fields: () => ({ n: 15, komi: 0, handi: 0 }),
    info: () => '렌주',
    sideNote: () => '',
    rating: {
      key: 'omok-rating', col: 'omok', pend: 'omokPending', upl: 'omokUploaded', sumKey: 'omok',
      init: () => ({ rating: 1500, rd: 350, vol: 0.06, games: 0, history: [] }),
      label: '내 급수 (AI 대국과 함께)', big: text,
      small: R => `레이팅 ${Math.round(R.rating)} · ${R.games || 0}판`,
      sum: R => '급수 ' + text(R),
    },
  });
  return { ...core, rank, text };
})();
