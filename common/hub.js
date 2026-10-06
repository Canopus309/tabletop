/* 게임 홈 (바둑·오목·체스 공통): 이어 두기 / 새 대국 / 지난 대국 / 학습 / 순위표 / 규칙
 * 페이지는 HUB 설정을 정한 뒤 이 파일을 불러온다:
 *   HUB = {type:'go', name:'바둑', save:'baduk-game', sum:'go', learnSum:'learn', learn:{title, desc}, extra:[{href, title, desc, external}]}
 * 게임 화면은 한 단계 위(../)에 있고, 새 대국은 ../#new 로 연다.
 */
'use strict';
(function(){
  const H=window.HUB,esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const IC={
    play:'<path d="M8 5v14l11-7z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    review:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    learn:'<path d="M10 3h4v2.5a1.5 1.5 0 0 0 3 0V3h4v7h-2.5a1.5 1.5 0 0 0 0 3H21v8h-7v-2.5a1.5 1.5 0 0 0-3 0V21H3v-8h2.5a1.5 1.5 0 0 0 0-3H3V3h7z"/>',
    book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/>',
    trophy:'<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    rules:'<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.4-2.8 4.3"/><path d="M12 17.6h.01"/>',
    link:'<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const svg=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg>`;
  const row=(href,icon,title,desc,cls='',ext=false)=>`<a class="hub-row${cls?' '+cls:''}" href="${href}"${ext?' target="_blank" rel="noopener"':''}><span class="ic">${svg(icon)}</span><span class="t"><b>${esc(title)}</b>${desc?`<small>${esc(desc)}</small>`:''}</span><span class="go">${ext?'↗':'›'}</span></a>`;
  let saved=null;try{saved=JSON.parse(localStorage.getItem(H.save));}catch(e){}
  let sum={};try{sum=JSON.parse(localStorage.getItem('tt-summary'))||{};}catch(e){}

  // 내 기록 요약
  const me=[sum[H.sum],sum[H.learnSum]&&H.learn.title+' '+sum[H.learnSum]].filter(Boolean);
  $('#hubMe').innerHTML=me.length?me.map(esc).join(' · '):'아직 기록이 없습니다';

  // 대국: 두던 대국이 있으면 이어 두기, 끝난 대국이면 복기
  const live=saved&&Array.isArray(saved.moves)&&saved.moves.length&&!saved.over,done=saved&&saved.over&&saved.moves&&saved.moves.length;
  let play='';
  if(live)play+=row('../','play','이어 두기','두던 대국으로 돌아갑니다','primary');
  play+=row('../#new','plus','새 대국',live?'두던 대국은 지난 대국에 남습니다':'AI 또는 한 폰으로 두 사람',live?'':'primary');
  if(done)play+=row('../','review','방금 끝난 대국 복기','승률 그래프 · 실수 찾기 · 변화도');
  play+=row('../../records/#'+H.type,'review','지난 대국','둔 대국을 모두 다시 보고 기보 내려받기');
  $('#hubPlay').innerHTML=play;

  // 두던 대국의 상대·수 (지난 대국 기록에서)
  if(live&&window.REC&&saved.id)REC.get(H.type,saved.id).then(r=>{
    if(!r||!r.meta)return;const s=$('#hubPlay .hub-row small');if(s)s.textContent=`${r.meta.opp} · ${r.meta.len}째`;
  }).catch(()=>{});

  // 학습·그 밖
  let more=row('../learn/','learn',H.learn.title,H.learn.desc);
  for(const x of H.extra||[])more+=row(x.href,x.icon||'link',x.title,x.desc,'',!!x.external);
  more+=row('../../ranks/#'+H.type,'trophy','순위표','온라인 순위와 내 기록');
  more+=row('../../rules/#'+H.type,'rules','규칙',H.rules||'');
  $('#hubMore').innerHTML=more;

  if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('../../sw.js').catch(()=>{});
})();
