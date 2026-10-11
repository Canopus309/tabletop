/* 온라인 대국 (편지 대국) — 오목·체스 대국 화면 공용 진행기 (바둑은 계가가 있어 go/online/play.js 를 따로 쓴다)
 * 주소 #online=방코드 로 연 대국을 서버(Firestore games/방코드)와 맞춘다: 상대 수 받기(실시간 구독 + 확인),
 * 내 수 보내기(오프라인이면 기기에 두었다가 다시), 기권, 시간승, 무승부 제안·동의, 끝난 대국의 레이팅 반영.
 * 화면은 onlinePlay(A) 로 만들고, A 로 자기 판을 다루는 방법을 알려 준다:
 *   core          게임별 onlineCore (OMOK_ON 등)
 *   stop()        AI·분석을 멈추고 지난 대국 보기를 끝낸다 (온라인 대국을 열기 전)
 *   load(d, col)  문서 d 로 새 대국 객체를 만들어 화면의 대국으로 삼고 돌려준다 (col: 내 색 1 흑 / 2 백 / 0 구경)
 *   reload()      game.moves 로 판을 다시 만들고 그린다
 *   play(m, snd)  상대 수 하나를 판에 둔다 (game.moves 에도 넣는다)
 *   turn()        판에서 둘 색 (1 흑 / 2 백)
 *   endOf()       방금 둔 수로 대국이 끝났는지: null 또는 {w: 이긴 색(무승부 0), how}
 *   finish(w, how, change)  대국을 끝낸다 (how: 화면에 보일 말, change: 레이팅 변화 {before, after})
 *   refresh()     화면을 다시 그린다, save() 기록 저장, recView() 지난 대국 보는 중인가
 *   moveName(i)   i번째 수의 이름 (알림용), analyzed(g) 저장된 대국의 분석이 끝났는가
 * 게임 화면에는 #onCard(#onText, #onBtns) 가 있어야 한다.
 */
'use strict';
const ONLINE_HOW={resign:'기권',time:'한 수 기한 지남',five:'5목 완성',full:'판이 가득 찼습니다 (무승부)',mate:'체크메이트',
  stalemate:'스테일메이트 (무승부)',repetition:'같은 국면 3회 반복 (무승부)',material:'체크메이트할 기물 부족 (무승부)',fifty:'50수 규칙 (무승부)',agree:'합의 무승부'};
function onlinePlay(A){
  const ON=A.core,QK=ON.type+'-online-q',NAME={1:'흑',2:'백'};
  const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let poll=0,pulling=false,again=false,lastPull=0,live=null;
  const G=()=>A.get();
  const active=()=>{const g=G();return !!(g&&g.online&&!A.recView());};
  const me=()=>ONL.uid();
  const canMove=()=>active()&&G().online.st==='play'&&!G().online.sending&&A.turn()===G().online.col;
  function queue(code,moves){
    let q={};try{q=JSON.parse(localStorage.getItem(QK))||{};}catch(e){}
    if(moves===undefined)return q[code]||null;
    if(moves)q[code]=moves;else delete q[code];
    try{localStorage.setItem(QK,JSON.stringify(q));}catch(e){}
  }
  function stop(){clearInterval(poll);poll=0;if(live){live.stop();live=null;}}

  async function open(code){
    A.stop();stop();
    let d=null,err=null;
    try{d=await ONL.get(code);}catch(e){err=e;}
    if(!d&&err)d=ON.cachedOne(code); // 오프라인: 마지막으로 받은 상태
    if(!d||d.g!==ON.type){toast(err?'대국을 불러오지 못했습니다 (인터넷 연결을 확인하세요)':'없는 대국입니다');history.replaceState(null,'',location.pathname);A.leave();return;}
    if(d.st==='open'&&d.host!==me()){location.replace('online/#join='+code);return;}
    // 끝난 대국을 이미 이 기기에서 분석해 두었으면 지난 대국 기록으로 연다
    if(d.st==='done'&&ON.colorOf(d)){
      ON.settle(d);let r=null;try{r=await REC.get(ON.type,d.created);}catch(e){}
      if(r&&r.game&&r.game.over&&A.analyzed(r.game)){location.replace('#rec='+d.created);return;}
    }
    const col=ON.colorOf(d),g=A.load(d,col);
    g.online={code,col,opp:ON.opp(d),rated:d.rated,days:d.days,st:d.st,mt:d.mt,res:d.res||null,offer:d.offer||'',ut:d.ut,host:d.host};
    A.reload();
    if(!col)toast('이 대국의 참가자가 아니라서 보기만 합니다');
    apply(d,true);
    if(err)toast('오프라인 · 마지막으로 받은 상태입니다');
    if(G().over)return;
    live=ONL.listen(code,()=>{if(active()&&G().online.code===code)pull();});
    // 실시간 구독이 되면 1분마다, 안 되면 15초마다 확인 (구독이 끊겼을 때를 대비)
    poll=setInterval(()=>{
      if(!active()||G().over||document.visibilityState!=='visible')return;
      if(live&&live.ok()&&Date.now()-lastPull<60000)return;
      pull();
    },15000);
  }
  async function pull(){
    if(!active())return;
    if(pulling){again=true;return;} // 받는 중에 또 바뀌었으면 끝나고 한 번 더
    const code=G().online.code;pulling=true;lastPull=Date.now();
    try{const d=await ONL.get(code);if(d&&active()&&G().online.code===code)apply(d,false);}
    catch(e){}
    finally{pulling=false;if(again){again=false;pull();}}
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&active()&&!G().over)pull();});
  window.addEventListener('online',()=>{if(active()&&!G().over)pull();});

  // 서버 상태를 화면에 반영
  function apply(d,first){
    const g=G(),o=g.online,sm=d.moves,lm=g.moves.slice(),q=queue(o.code),before=o.offer;
    const prefix=(a,b)=>a.length<=b.length&&a.every((m,i)=>m===b[i]);
    Object.assign(o,{st:d.st,mt:d.mt,res:d.res||null,offer:d.offer||'',ut:d.ut,rated:d.rated,days:d.days,opp:ON.opp(d)});
    if(o.col)ON.remember(d);
    let resend=false;
    if(sm.length>lm.length&&prefix(lm,sm)){
      for(let i=lm.length;i<sm.length;i++)A.play(sm[i],!first);
      if(!first&&d.st==='play')toast(`${o.opp.name}: ${A.moveName(sm.length-1)}`);
      queue(o.code,null);
    }else if(!(sm.length===lm.length&&prefix(sm,lm))){
      // 아직 못 보낸 내 수 하나는 남겨 두고 다시 보낸다. 그 밖에는 서버 기준으로
      if(q&&q.length===sm.length+1&&prefix(sm,q)&&d.st==='play'&&ON.turnColor(d)===o.col){g.moves=q.slice();resend=true;}
      else{g.moves=sm.slice();queue(o.code,null);}
      A.reload();
    }else if(q&&!o.sending)queue(o.code,null);
    if(!first&&o.offer&&o.offer!==me()&&o.offer!==before&&d.st==='play')toast(`${o.opp.name}님이 무승부를 제안했습니다`);
    if(d.st==='done'){if(!g.over)end(d);return;}
    A.save();A.refresh();
    if(resend)send();
  }

  // ---------- 내 수 보내기 ----------
  function moved(){queue(G().online.code,G().moves.slice());send();}
  async function send(){
    const g=G(),o=g.online;if(o.sending)return;
    const mv=g.moves.slice(),code=o.code,fin=A.endOf();
    const f={moves:mv,st:fin?'done':'play'},mask=['moves','st'];
    if(fin){f.res={w:fin.w,how:fin.how,d:0,by:me()};mask.push('res');}
    const declined=o.offer&&o.offer!==me();if(declined)mask.push('offer'); // 상대의 무승부 제안은 수를 두면 거절한 것으로
    o.sending=true;A.refresh();
    try{
      const r=await ONL.write(code,f,mask,{ut:o.ut});
      if(!active()||G().online.code!==code)return;
      Object.assign(o,{ut:r.ut,mt:r.at,sending:false});queue(code,null);
      if(declined)o.offer='';
      if(fin){await pull();return;} // 끝난 상태를 받아 마무리
      ON.remember(docLike());
    }catch(e){
      o.sending=false;
      if(e.status===0)toast('오프라인 · 연결되면 이 수를 보냅니다');
      else{console.warn('[온라인]',e);toast('수를 보내지 못했습니다 · 대국 상태를 다시 받습니다');queue(code,null);await pull();}
    }
    A.refresh();
  }
  // 목록 캐시에 넣을 문서 모양 (마지막으로 받은 문서에 지금 상태를 덮어쓴 것)
  function docLike(){
    const g=G(),o=g.online,old=ON.cachedOne(o.code)||{};
    return{...old,code:o.code,moves:g.moves.slice(),st:o.st,mt:o.mt,ut:o.ut,offer:o.offer||undefined};
  }
  // 상태 바꾸기 (기권·시간승·무승부). 성공하면 서버 상태를 다시 받는다
  async function write(fields,mask,okMsg,stamp){
    const o=G().online;if(o.sending)return false;
    o.sending=true;A.refresh();
    try{await ONL.write(o.code,fields,mask,{ut:o.ut,...(stamp?{}:{stamp:[]})});o.sending=false;if(okMsg)toast(okMsg);await pull();return true;}
    catch(e){
      o.sending=false;console.warn('[온라인]',e);
      toast(e.status===0?'인터넷에 연결되어야 합니다':'처리하지 못했습니다 · 상대가 먼저 무언가를 했을 수 있어 다시 받습니다');
      if(e.status!==0)await pull();
      A.refresh();return false;
    }
  }
  async function resign(){
    const o=G().online;if(!o.col)return;
    if(!(await ask('기권할까요?',`${o.opp.name}님의 승리로 대국을 끝냅니다.`,'기권')))return;
    write({st:'done',res:{w:3-o.col,how:'resign',d:0,by:me()}},['st','res'],'',true);
  }
  async function claimTime(){
    const o=G().online;
    if(!(await ask('시간승으로 끝낼까요?',`${o.opp.name}님의 한 수 기한이 지났습니다. 내 승리로 대국을 끝냅니다.`,'시간승')))return;
    write({st:'done',res:{w:o.col,how:'time',d:0,by:me()}},['st','res'],'',true);
  }
  async function offerDraw(){
    if(!(await ask('무승부를 제안할까요?',`${G().online.opp.name}님이 동의하면 무승부로 끝납니다. 상대가 그냥 다음 수를 두면 거절한 것입니다.`,'제안')))return;
    write({offer:me()},['offer'],'무승부를 제안했습니다');
  }
  const cancelOffer=()=>write({},['offer'],'제안을 거두었습니다');
  const declineDraw=()=>write({},['offer'],'무승부 제안을 거절했습니다');
  async function acceptDraw(){
    if(!(await ask('무승부에 동의할까요?','이 대국을 무승부로 끝냅니다.','동의')))return;
    write({st:'done',res:{w:0,how:'agree',d:0,by:me()}},['st','res','offer'],'',true);
  }

  // ---------- 끝 ----------
  function end(d){
    const g=G(),o=g.online,r=d.res;
    stop();queue(o.code,null);
    if(o.col)ON.settle(d);
    o.rchg=ON.change(d.code);
    A.finish(r.w,ONLINE_HOW[r.how]||r.how,o.rchg);
  }

  // ---------- 화면 ----------
  function ui(){
    const card=$('#onCard'),g=G(),on=active()&&!g.over;
    card.classList.toggle('hidden',!on);
    $('.home-btn').href=g&&g.online&&!A.recView()?'online/':'home/';
    if(!on)return;
    const o=g.online,dl=o.mt+o.days*864e5,late=dl<Date.now(),mine=A.turn()===o.col;
    const dlText=`기한 ${ON.when(dl)} (${ON.left(dl)})`;
    let t='',btns=[];
    const B=(id,label,cls='ghost')=>btns.push(`<button type="button" class="${cls}" id="${id}">${label}</button>`);
    if(o.sending)t='보내는 중…';
    else if(o.st==='open'){t=`상대를 기다리는 중 · 방 코드 <b>${o.code}</b>`;B('onInvite','초대 보내기','primary');}
    else if(!o.col)t=`보기만 하는 중 · ${NAME[A.turn()]} 차례`;
    else{
      if(o.offer&&o.offer!==me()){t=`<b>${esc(o.opp.name)}님이 무승부를 제안했습니다</b><br>그냥 두면 거절한 것이 됩니다 · ${dlText}`;B('onDecline','거절');B('onDraw','동의','primary');}
      else if(mine)t=`<b>내 차례</b> · ${dlText}${o.offer?'<br>무승부 제안 중 (상대 답 기다림)':''}`;
      else t=`${esc(o.opp.name)}님 차례 · ${dlText}${o.offer?'<br>무승부 제안 중 (상대 답 기다림)':''}`;
      if(!(o.offer&&o.offer!==me())){
        if(!mine){B('onRefresh','새로고침');if(late)B('onTime','시간승으로 끝내기','primary');}
        if(o.offer===me())B('onCancelOffer','제안 거두기');else B('onOffer','무승부 제안');
      }
    }
    $('#onText').innerHTML=t;$('#onBtns').innerHTML=btns.join('');
    const bind=(id,f)=>{const el=document.getElementById(id);if(el)el.onclick=f;};
    bind('onRefresh',()=>{pull();toast('새로 받는 중…');});bind('onTime',claimTime);bind('onOffer',offerDraw);bind('onCancelOffer',cancelOffer);
    bind('onDecline',declineDraw);bind('onDraw',acceptDraw);
    bind('onInvite',async()=>{const d=ON.cachedOne(o.code);if(!d)return;const r=await ONL.share(ON.inviteText(d),ON.link(o.code));if(r==='copied')toast('초대 글과 링크를 복사했습니다');});
  }
  // 차례 줄 (위쪽 상태 글)
  function status(){
    const o=G().online,t=A.turn();
    if(o.st==='open')return '<b>상대 기다리는 중</b>';
    return `<b>${NAME[t]}</b> 차례${o.col?(t===o.col?' · 내 차례':' · 상대 차례'):''}`;
  }
  return{open,stop,active,canMove,moved,resign,ui,status,pull};
}
