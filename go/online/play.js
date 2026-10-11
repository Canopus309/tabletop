/* 바둑 온라인 대국 (편지 대국) — 대국 화면(go/index.html) 쪽
 * 주소 #online=방코드 로 연다. 서버(Firestore games/방코드)의 수순으로 판을 만들고, 내 차례에 둔 수를 보낸다.
 * 화면을 보고 있는 동안 15초마다 상대 수를 확인한다. 보내지 못한 수(오프라인)는 기기에 두었다가 다시 보낸다.
 * 두 사람이 이어서 패스하면 계가: 한 사람이 죽은 돌을 표시해 제안하고, 다른 사람이 동의하면 끝난다.
 * 동의하지 않으면 이어서 둬서 정리한다 (중국식 계가라 더 둬도 집이 줄지 않는다).
 * go/index.html 의 본 스크립트 다음에 불러온다 (game, board, playMove, endGame … 을 함께 쓴다).
 */
'use strict';
const ONQ='go-online-q'; // 보내지 못한 수순 {방코드: moves}
let onPoll=0,onPulling=false,onPullAgain=false,onLastPull=0,scoreEdit=false;
// ---------- 실시간 구독 (common/online.js 의 ONL.listen). 안 되면 15초마다 확인 ----------
let onLive=null;
const onLiveOkNow=()=>!!(onLive&&onLive.ok());
function onListen(code){onUnlisten();onLive=ONL.listen(code,()=>{if(isOnline()&&game.online.code===code)onPull();});}
function onUnlisten(){if(onLive)onLive.stop();onLive=null;}
const isOnline=()=>!!(game&&game.online&&!recView);
const onCanMove=()=>isOnline()&&game.online.st==='play'&&!game.online.sending&&board.turn===game.human;
function onQueue(code,moves){
  let q={};try{q=JSON.parse(localStorage.getItem(ONQ))||{};}catch(e){}
  if(moves===undefined)return q[code]||null;
  if(moves)q[code]=moves;else delete q[code];
  try{localStorage.setItem(ONQ,JSON.stringify(q));}catch(e){}
}
function onGameFrom(d){
  const col=GO_ON.colorOf(d),tmp=new Board(d.n),setup=handicapPts(d.n,d.handi).map(([x,y])=>tmp.pt(x,y));
  return{id:d.created,n:d.n,komi:d.komi,handicap:d.handi,human:col,level:0,setup,moves:d.moves.slice(),over:false,result:null,wr:0.5,
    online:{code:d.code,col,opp:GO_ON.opp(d),rated:d.rated,days:d.days,st:d.st,mt:d.mt,rs:d.rs||0,prop:d.prop||null,res:d.res||null,ut:d.ut,host:d.host}};
}

async function openOnline(code){
  cancelEngine();stopPonder();epoch++;thinking=false;recView=null;scoreEdit=false;clearInterval(onPoll);onUnlisten();
  closeDlg($('#dlgNew'),'cancel');
  let d=null,err=null;
  try{d=await ONL.get(code);}catch(e){err=e;}
  if(!d&&err)d=GO_ON.cachedOne(code); // 오프라인: 마지막으로 받은 상태
  if(!d){toast(err?'대국을 불러오지 못했습니다 (인터넷 연결을 확인하세요)':'없는 대국입니다');history.replaceState(null,'',location.pathname);route();return;}
  if(d.st==='open'&&d.host!==ONL.uid()){location.replace('online/#join='+code);return;}
  // 끝난 대국을 이미 이 기기에서 분석해 두었으면 지난 대국 기록으로 연다
  if(d.st==='done'&&GO_ON.colorOf(d)){
    GO_ON.settle(d);let r=null;try{r=await REC.get('go',d.created);}catch(e){}
    if(r&&r.game&&r.game.over&&r.game.evals&&r.game.evals.length){location.replace('#rec='+d.created);return;}
  }
  game=onGameFrom(d);resetView();rebuild();
  if(!game.human)toast('이 대국의 참가자가 아니라서 보기만 합니다');
  onApply(d,true);
  if(err)toast('오프라인 · 마지막으로 받은 상태입니다');
  if(game.over)return;
  onListen(code);
  // 실시간 구독이 되면 1분마다, 안 되면 15초마다 확인 (구독이 끊겼을 때를 대비)
  onPoll=setInterval(()=>{
    if(!isOnline()||game.over||document.visibilityState!=='visible')return;
    if(onLiveOkNow()&&Date.now()-onLastPull<60000)return;
    onPull();
  },15000);
}
async function onPull(){
  if(!isOnline())return;
  if(onPulling){onPullAgain=true;return;} // 받는 중에 또 바뀌었으면 끝나고 한 번 더
  const code=game.online.code;onPulling=true;onLastPull=Date.now();
  try{const d=await ONL.get(code);if(d&&isOnline()&&game.online.code===code)onApply(d,false);}
  catch(e){}
  finally{onPulling=false;if(onPullAgain){onPullAgain=false;onPull();}}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&isOnline()&&!game.over)onPull();});
window.addEventListener('online',()=>{if(isOnline()&&!game.over)onPull();});

// 서버 상태를 화면에 반영
function onApply(d,first){
  const o=game.online,sm=d.moves,lm=game.moves,q=onQueue(o.code);
  const prefix=(a,b)=>a.length<=b.length&&a.every((m,i)=>m===b[i]);
  Object.assign(o,{st:d.st,mt:d.mt,rs:d.rs||0,prop:d.prop||null,res:d.res||null,ut:d.ut,rated:d.rated,days:d.days,opp:GO_ON.opp(d)});
  if(game.human)GO_ON.remember(d);
  let resend=false;
  if(sm.length>lm.length&&prefix(lm,sm)){
    // 상대가 둔 수
    for(let i=lm.length;i<sm.length;i++){const cap=board.play(sm[i]);game.moves.push(sm[i]);if(!first)sound(sm[i]===PASS?'pass':cap?'cap':'stone',cap);}
    hints=null;pending=0;
    if(!first&&d.st==='play'){const m=sm[sm.length-1];toast(m===PASS?`${o.opp.name}님이 패스했습니다`:`${o.opp.name}: ${moveName(m)}`);}
    onQueue(o.code,null);
  }else if(!(sm.length===lm.length&&prefix(sm,lm))){
    // 아직 못 보낸 내 수 하나는 남겨 두고 다시 보낸다. 그 밖에는 서버 기준으로
    if(q&&q.length===sm.length+1&&prefix(sm,q)&&d.st==='play'&&GO_ON.turnColor(d)===game.human){game.moves=q.slice();resend=true;}
    else{game.moves=sm.slice();onQueue(o.code,null);}
    resetView();board=Board.fromState(stateOf());
  }else if(q&&!o.sending)onQueue(o.code,null);
  if(d.st==='done'){if(!game.over)onEnd(d);return;}
  if(d.st==='score')onScore();
  else{scoreEdit=false;if(deadSet||ownMap){deadSet=null;ownMap=null;}}
  save();draw();ui();
  if(resend)onSend();
}

// ---------- 내 수 보내기 ----------
function onMoved(){onQueue(game.online.code,game.moves.slice());onSend();}
async function onSend(){
  const o=game.online;if(o.sending)return;
  o.sending=true;ui();
  // 이어서 두 번 패스하면 계가 (계가를 멈추고 이어 둔 뒤에 나온 패스만 센다)
  const mv=game.moves.slice(),k=mv.length-1,two=k>=1&&k-1>=(o.rs||0)&&mv[k]===PASS&&mv[k-1]===PASS,code=o.code;
  try{
    const r=await ONL.write(code,{moves:mv,st:two?'score':'play'},['moves','st'],{ut:o.ut});
    if(!isOnline()||game.online.code!==code)return;
    Object.assign(o,{ut:r.ut,mt:r.at,st:two?'score':'play',sending:false});onQueue(code,null);
    GO_ON.remember(onDocLike());
    if(two){toast('두 사람 모두 패스했습니다 · 계가합니다');onScore();}
  }catch(e){
    o.sending=false;
    if(e.status===0)toast('오프라인 · 연결되면 이 수를 보냅니다');
    else{console.warn('[온라인]',e);toast('수를 보내지 못했습니다 · 대국 상태를 다시 받습니다');onQueue(code,null);await onPull();}
  }
  ui();
}
// 목록 캐시에 넣을 문서 모양 (마지막으로 받은 문서에 지금 상태를 덮어쓴 것)
function onDocLike(){
  const o=game.online,old=GO_ON.cachedOne(o.code)||{};
  return{...old,code:o.code,moves:game.moves.slice(),st:o.st,mt:o.mt,rs:o.rs,ut:o.ut,prop:o.prop||undefined,res:o.res||undefined};
}
// 상태 바꾸기 (계가 제안·동의·이어 두기·기권·시간승). 성공하면 서버 상태를 다시 받는다
async function onWrite(fields,mask,okMsg){
  const o=game.online;if(o.sending)return false;
  o.sending=true;ui();
  try{await ONL.write(o.code,fields,mask,{ut:o.ut});o.sending=false;if(okMsg)toast(okMsg);await onPull();return true;}
  catch(e){
    o.sending=false;console.warn('[온라인]',e);
    toast(e.status===0?'인터넷에 연결되어야 합니다':'처리하지 못했습니다 · 상대가 먼저 무언가를 했을 수 있어 다시 받습니다');
    if(e.status!==0)await onPull();
    ui();return false;
  }
}
async function onResign(){
  if(!(await ask('기권할까요?',`${game.online.opp.name}님의 승리로 대국을 끝냅니다.`,'기권')))return;
  onWrite({st:'done',res:{w:3-game.human,how:'resign',d:0,by:ONL.uid()}},['st','res']);
}
async function onClaimTime(){
  if(!(await ask('시간승으로 끝낼까요?',`${game.online.opp.name}님의 한 수 기한이 지났습니다. 내 승리로 대국을 끝냅니다.`,'시간승')))return;
  onWrite({st:'done',res:{w:game.human,how:'time',d:0,by:ONL.uid()}},['st','res']);
}

// ---------- 계가 ----------
// 죽은 돌을 들어낸 뒤, 한 색에만 닿은 빈 영역을 그 색의 집으로 (중국식: 산 돌 + 집)
function onScoreOf(dead){
  const b=board,own=new Float32Array(b.size),seen=new Uint8Array(b.size);let bs=0,ws=0;
  const col=p=>dead.has(p)?EMPTY:b.c[p];
  for(const p of b.pts){
    const v=col(p);
    if(v===BLACK){bs++;own[p]=1;continue;}
    if(v===WHITE){ws++;own[p]=-1;continue;}
    if(seen[p])continue;
    const reg=[],st=[p];seen[p]=1;let tb=false,tw=false;
    while(st.length){
      const q=st.pop();reg.push(q);
      for(const dd of b.d){const r=q+dd;if(b.c[r]===EDGE)continue;const cv=col(r);
        if(cv===EMPTY){if(!seen[r]){seen[r]=1;st.push(r);}}else if(cv===BLACK)tb=true;else tw=true;}
    }
    const o=tb&&!tw?1:tw&&!tb?-1:0;for(const q of reg)own[q]=o;
    if(o>0)bs+=reg.length;else if(o<0)ws+=reg.length;
  }
  const diff=bs-ws-game.komi;
  return{bs,ws,w:diff>0?BLACK:WHITE,d:Math.abs(diff),own};
}
function onChain(p){
  const b=board,c=b.c[p],out=[p],seen=new Set([p]);
  for(let i=0;i<out.length;i++)for(const dd of b.d){const r=out[i]+dd;if(b.c[r]===c&&!seen.has(r)){seen.add(r);out.push(r);}}
  return out;
}
function onShowDead(dead){deadSet=new Set(dead);ownMap=Array.from(onScoreOf(deadSet).own);}
function onScore(){
  const o=game.online;
  if(scoreEdit)return; // 내가 고치는 중
  if(o.prop){onShowDead(o.prop.dead);return;}
  if(game.human&&!deadSet&&!thinking)onGuessDead(); // 아직 제안이 없으면 AI가 먼저 죽은 돌을 표시
}
async function onGuessDead(){
  const ep=epoch,n=game.n;thinking=true;thinkFor=0;ui();
  const r=(await kataReady())?await Kata.ownership(stateOf()):await callEngine({type:'estimate',state:stateOf(),sims:n>=19?240:n>=13?400:700});
  if(ep!==epoch||!isOnline())return;
  thinking=false;
  // 사슬 단위로: 돌들의 소유 평균이 상대 쪽이면 죽은 돌
  const dead=[],seen=new Set();
  for(const p of board.pts){
    const v=board.c[p];if(v===EMPTY||seen.has(p))continue;
    const ch=onChain(p);ch.forEach(q=>seen.add(q));
    const avg=ch.reduce((s,q)=>s+r.own[q],0)/ch.length;
    if((v===BLACK&&avg<-0.3)||(v===WHITE&&avg>0.3))dead.push(...ch);
  }
  scoreEdit=!game.online.prop;onShowDead(game.online.prop?game.online.prop.dead:dead);draw();ui();
}
// 계가 고치는 중: 돌을 누르면 그 사슬을 죽은 돌 ↔ 산 돌로
function onTap(p){
  if(!scoreEdit||!p||board.c[p]===EMPTY||thinking)return;
  const on=!deadSet.has(p);for(const q of onChain(p))on?deadSet.add(q):deadSet.delete(q);
  ownMap=Array.from(onScoreOf(deadSet).own);sound('stone');draw();ui();
}
function onEdit(){scoreEdit=true;if(!deadSet)onGuessDead();draw();ui();}
function onPropose(){
  const s=onScoreOf(deadSet);
  onWrite({prop:{by:ONL.uid(),dead:[...deadSet],bs:s.bs,ws:s.ws,w:s.w,d:s.d}},['prop'],'계가를 제안했습니다 · 상대가 동의하면 끝납니다').then(ok=>{if(ok){scoreEdit=false;ui();}});
}
function onAccept(){const p=game.online.prop;onWrite({st:'done',res:{w:p.w,how:'score',d:p.d,by:ONL.uid()}},['st','res']);}
async function onResume(){
  if(!(await ask('이어서 둘까요?','계가를 멈추고 대국을 이어 갑니다. 다툼이 있는 돌을 실제로 따내거나 살려서 정리하세요. 두 사람이 다시 이어서 패스하면 다시 계가합니다.','이어 두기')))return;
  scoreEdit=false;deadSet=null;ownMap=null;
  onWrite({st:'play',rs:game.moves.length},['st','prop','rs'],'대국을 이어 갑니다');
}
const scoreText=s=>`흑 ${s.bs}집 · 백 ${s.ws}집 + 덤 ${game.komi} → <b>${NAME[s.w]} ${s.d}집 승</b>`;

// ---------- 끝 ----------
function onEnd(d){
  const r=d.res,o=game.online;scoreEdit=false;
  clearInterval(onPoll);onUnlisten();onQueue(o.code,null);
  if(r.how==='score'&&d.prop)onShowDead(d.prop.dead);else{deadSet=null;ownMap=null;}
  const loser=NAME[3-r.w];
  const detail=r.how==='resign'?`${loser}이 기권했습니다`:r.how==='time'?`${loser}의 한 수 기한이 지났습니다`:`흑 ${d.prop.bs}집 · 백 ${d.prop.ws}집 + 덤 ${game.komi}`;
  const how=r.how==='score'?`${r.d}집 승`:r.how==='time'?'시간승':'불계승';
  if(game.human)GO_ON.settle(d);
  const ch=GO_ON.change(d.code);if(ch)o.rchg=ch;
  endGame(r.w,detail,how);
}

// ---------- 화면 ----------
// 머리 카드: 상태 글과 버튼
function onUi(){
  const card=$('#onCard'),on=isOnline()&&!game.over;
  card.classList.toggle('hidden',!on);
  $('.home-btn').href=game&&game.online&&!recView?'online/':'home/';
  if(!on)return;
  const o=game.online,dl=o.mt+o.days*864e5,late=dl<Date.now(),me=ONL.uid();
  const dlText=`기한 ${GO_ON.when(dl)} (${GO_ON.left(dl)})`;
  let t='',btns=[];
  const B=(id,label,cls='ghost')=>btns.push(`<button type="button" class="${cls}" id="${id}">${label}</button>`);
  if(o.sending)t='보내는 중…';
  else if(o.st==='open'){t=`상대를 기다리는 중 · 방 코드 <b>${o.code}</b>`;B('onInvite','초대 보내기','primary');}
  else if(!game.human)t=`보기만 하는 중 · ${o.st==='score'?'계가 중':NAME[board.turn]+' 차례'}`;
  else if(o.st==='play'){
    if(board.turn===game.human)t=`<b>내 차례</b> · ${dlText}`;
    else{t=`${esc(o.opp.name)}님 차례 · ${dlText}`;B('onRefresh','새로고침');if(late)B('onTime','시간승으로 끝내기','primary');}
  }else if(o.st==='score'){
    const s=deadSet?onScoreOf(deadSet):null;
    if(thinking)t='죽은 돌을 찾는 중…';
    else if(scoreEdit){t=`<b>계가</b> · 죽은 돌을 눌러 고치세요<br>${s?scoreText(s):''}`;B('onResume','이어 두기');B('onPropose','이대로 제안','primary');}
    else if(o.prop&&o.prop.by===me){t=`계가를 제안했습니다 · ${esc(o.opp.name)}님 확인을 기다립니다<br>${scoreText(o.prop)} · ${dlText}`;B('onResume','이어 두기');B('onRefresh','새로고침');if(late)B('onAccept','제안대로 끝내기','primary');}
    else if(o.prop){t=`${esc(o.opp.name)}님의 계가 제안 (판에 죽은 돌 표시)<br>${scoreText(o.prop)}`;B('onResume','이어 두기');B('onEdit','고쳐서 제안');B('onAccept','동의','primary');}
    else t='계가: 죽은 돌을 확인하세요';
  }
  $('#onText').innerHTML=t;
  $('#onBtns').innerHTML=btns.join('');
  const bind=(id,f)=>{const el=document.getElementById(id);if(el)el.onclick=f;};
  bind('onRefresh',()=>{onPull();toast('새로 받는 중…');});bind('onTime',onClaimTime);bind('onResume',onResume);
  bind('onPropose',onPropose);bind('onAccept',onAccept);bind('onEdit',onEdit);
  bind('onInvite',async()=>{const d=GO_ON.cachedOne(o.code);if(!d)return;const r=await ONL.share(GO_ON.inviteText(d),GO_ON.link(o.code));if(r==='copied')toast('초대 글과 링크를 복사했습니다');});
}
// 차례 줄 (위쪽 상태)
function onStatus(){
  const o=game.online;
  if(o.st==='open')return '<b>상대 기다리는 중</b>';
  if(o.st==='score')return '<b>계가 중</b>';
  return `<b>${NAME[board.turn]}</b> 차례${board.turn===game.human?' · 내 차례':game.human?' · 상대 차례':''}`;
}
