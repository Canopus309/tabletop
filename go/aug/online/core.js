/* 증강 바둑 온라인 대국 설정 (공용 부분은 common/online-core.js)
 * 참가하면 두 사람이 증강을 고르는 단계(st 'pick')를 거쳐 대국이 시작된다. 덤으로 밸런스를 잡으므로 레이팅에는 넣지 않는다 (늘 친선)
 */
'use strict';
const GA_ON = onlineCore({
  type: 'goaug', name: '증강 바둑', path: 'go/aug', joinState: 'pick', unrated: true,
  first: () => 1,
  fields: o => ({ n: o.n, komi: AUG_BASE_KOMI, handi: 0, ab: '', aw: '' }),
  info: d => `${d.n}줄 · 증강${d.ab && d.aw ? ` ${AUGS[d.ab].name} 대 ${AUGS[d.aw].name}` : ''}`,
  sideNote: () => '',
  rating: {
    key: 'goaug-rating', col: 'goaugr', pend: 'goaugPending', upl: 'goaugUploaded', sumKey: 'goaug',
    init: () => ({ rating: 1500, rd: 350, vol: 0.06, games: 0, history: [] }),
    label: '증강 바둑', big: () => '친선 대국', small: () => '레이팅 대신 덤으로 밸런스를 맞춥니다',
    sum: () => null,
  },
});
