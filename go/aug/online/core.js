/* 증강 바둑 온라인 대국 설정 (공용 부분은 common/online-core.js)
 * 참가하면 증강 경매(st 'pick')를 거쳐 대국이 시작된다: of = 증강 둘, bv = 지금 최고 값(-1 없음), bw = 최고 부른 색, bt = 부를 색(0 = 끝, 낙찰자가 고를 차례).
 * 방을 만들 때 증강 둘과 먼저 부를 색을 무작위로 정한다. 레이팅에는 넣지 않는다 (늘 친선)
 */
'use strict';
const GA_ON = onlineCore({
  type: 'goaug', name: '증강 바둑', path: 'go/aug', joinState: 'pick', unrated: true,
  first: () => 1,
  fields: o => { const seed = Date.now() + ':' + Math.random(); return { n: o.n, komi: AUG_BASE_KOMI, handi: 0, ab: '', aw: '', of: augOffers(seed, 2), bv: -1, bw: 0, bt: augCoin(seed + 'c') }; },
  info: d => `${d.n}줄 · 증강${d.ab && d.aw ? ` ${AUGS[d.ab].name} 대 ${AUGS[d.aw].name}` : d.of ? ` 경매 ${d.of.map(a => AUGS[a].name).join('·')}` : ''}`,
  sideNote: () => '',
  rating: {
    key: 'goaug-rating', col: 'goaugr', pend: 'goaugPending', upl: 'goaugUploaded', sumKey: 'goaug',
    init: () => ({ rating: 1500, rd: 350, vol: 0.06, games: 0, history: [] }),
    label: '증강 바둑', big: () => '친선 대국', small: () => '증강과 덤은 경매로 정합니다',
    sum: () => null,
  },
});
