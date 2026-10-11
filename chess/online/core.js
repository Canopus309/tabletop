/* 체스 온라인 대국 설정 (공용 부분은 common/online-core.js)
 * 사람끼리 둔 레이팅 대국 결과는 AI 대국과 같은 '내 레이팅'(chess-rating, Glicko-2, 리체스 래피드 기준)에 함께 반영한다
 * 색은 문서에서 숫자다: 1 = 흑, 2 = 백 (백이 먼저)
 */
'use strict';
const CHESS_ON = (() => {
  const text = R => Math.round(R.rating) + (R.rd > 110 ? '?' : '');
  const core = onlineCore({
    type: 'chess', name: '체스',
    first: () => 2, // 백이 먼저
    fields: () => ({ n: 8, komi: 0, handi: 0 }),
    info: () => '',
    sideNote: () => '',
    rating: {
      key: 'chess-rating', col: 'chess', pend: 'chessPending', upl: 'chessUploaded', sumKey: 'chess',
      init: () => ({ rating: 1500, rd: 350, vol: 0.06, games: 0, history: [] }),
      label: '내 레이팅 (AI 대국과 함께)', big: text,
      small: R => `레이팅 대국 ${R.games || 0}판`,
      sum: R => '레이팅 ' + text(R),
    },
  });
  return { ...core, text };
})();
