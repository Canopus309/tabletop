/* 온라인 대국 목록·초대·참가 화면 (바둑·오목·체스 공통)
 * 페이지는 OLP = {core: 게임별 onlineCore, game: '바둑', ranks: '../../ranks/#gor'} 를 정하고,
 * 본문(내 레이팅 카드·목록 칸)과 새 대국 대화상자(#dlgCreate: color 라디오, #selDays, #optRated, 바둑은 size 라디오·#selHandi)를 둔 뒤
 * ui.js, leaderboard.js, rating.js, online.js, online-core.js, 게임별 core.js 다음에 이 파일을 불러온다.
 * 초대·참가·확인 대화상자는 여기서 만든다.
 */
'use strict';
const OLP=window.OLP,ON=OLP.core;
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NAME={1:'흑',2:'백'};
let busy=false,lastAt=0;

document.body.insertAdjacentHTML('beforeend',`
<dialog id="dlgInvite"><div class="dlg">
  <h2>상대를 초대하세요</h2>
  <p class="info" id="invInfo"></p>
  <div class="code-big" id="invCode"></div>
  <p class="small">링크를 카카오톡 등으로 보내거나, 상대에게 방 코드를 알려 주세요. 상대는 Table Top → ${OLP.game} → 온라인 대국 → '코드로 참가'에서 코드를 넣으면 됩니다.</p>
  <div class="dlg-actions"><button type="button" class="ghost" id="invCancel">초대 취소</button><button type="button" class="primary" id="invShare">초대 보내기</button></div>
</div></dialog>
<dialog id="dlgJoin"><div class="dlg">
  <h2>코드로 참가</h2>
  <div class="code-row"><input class="code-in" id="joinCode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234"><button type="button" class="ghost" id="joinPaste">붙여넣기</button></div>
  <p class="small">초대한 사람에게 받은 여섯 글자 방 코드를 넣으세요. 초대 글이나 코드를 복사해 왔다면 '붙여넣기'를 누르세요.</p>
  <div class="dlg-actions"><button type="button" class="ghost" data-close="cancel">취소</button><button type="button" class="primary" data-close="ok">다음</button></div>
</div></dialog>
<dialog id="dlgJoinInfo"><div class="dlg">
  <h2 id="jiTitle">대국 초대</h2>
  <p class="info" id="jiInfo"></p>
  <div class="on-name hidden" id="jiName"><p>상대에게 보일 닉네임</p><div class="lb-name"><input id="jiNameIn" maxlength="12" placeholder="닉네임" autocomplete="off"></div></div>
  <div class="app-join" id="jiApp">
    <p>홈 화면에 Table Top을 설치해 쓰고 있다면 <b>앱에서 참가</b>하세요. 앱과 이 브라우저는 기록이 따로 저장되어, 여기서 참가한 대국은 앱에 보이지 않습니다.</p>
    <button type="button" class="primary" id="jiCopy">코드 복사하고 앱에서 참가</button>
    <p class="steps hidden" id="jiSteps"></p>
  </div>
  <div class="dlg-actions"><button type="button" class="ghost" data-close="cancel">닫기</button><button type="button" class="primary" data-close="ok" id="jiOk">참가</button></div>
</div></dialog>
<dialog id="dlgConfirm"><div class="dlg">
  <h2 id="cfTitle"></h2>
  <p id="cfText" style="margin:0 0 16px;color:var(--muted);font-size:14px"></p>
  <div class="dlg-actions"><button type="button" class="ghost" data-close="no">취소</button><button type="button" class="primary" data-close="yes" id="cfYes"></button></div>
</div></dialog>
<div id="toast" role="status" aria-live="polite"></div>`);
// 나중에 만든 대화상자도 Esc 로 닫을 때 닫힘 처리를 거치게
for(const id of ['dlgInvite','dlgJoin','dlgJoinInfo','dlgConfirm'])document.getElementById(id).addEventListener('cancel',e=>{e.preventDefault();closeDlg(e.target,'cancel');});

function renderMe(){
  const R=ON.get(),s=LB.state(),C=ON.C.rating;
  $('#myLabel').textContent=C.label;$('#myR').textContent=C.big(R);$('#myRSub').textContent=C.small(R);
  $('#nameBox').classList.toggle('hidden',!!s.name);
}
function row(d){
  const st=ON.stage(d),col=ON.colorOf(d),o=ON.opp(d),dl=ON.deadline(d),late=dl<Date.now();
  const ic=`<span class="ic ${col===1?'b':'w'}"><b>${NAME[col]||''}</b></span>`;
  let title,desc,href='../#online='+d.code;
  if(st==='open'){title=`상대 기다리는 중 · ${d.code}`;desc=`${esc(ON.info(d))} · 눌러서 초대 보내기`;href='#invite='+d.code;}
  else if(st==='done'){
    const r=d.res||{},win=r.w===col,draw=r.w===0;
    const HOWS={five:'5목',mate:'체크메이트',agree:'합의',full:'판이 가득 참',stalemate:'스테일메이트',repetition:'3회 반복',material:'기물 부족',fifty:'50수 규칙'};
    const how=r.how==='score'?`${r.d}집${win?'승':'패'}`:r.how==='time'?(win?'시간승':'시간패'):r.how==='resign'?(win?'불계승':'기권'):HOWS[r.how]||'';
    const ch=ON.change(d.code);
    title=`${esc(o.name)} · ${draw?'무승부':win?'승':'패'}${how?` (${how})`:''}`;
    desc=`${ON.when(d.mt)} · ${esc(ON.info(d))} · ${d.moves.length}수${ch?` · 레이팅 ${ch.before} → ${ch.after}`:''}`;
  }else{
    const sc=d.st==='score',offer=d.offer&&d.offer!==ONL.uid();
    title=`${esc(o.name)}${o.r?` (${Math.round(o.r)})`:''} · ${sc?'계가 중':d.moves.length+'수'}`;
    const what=sc?(st==='mine'?(d.prop?'상대 계가 제안 확인하기':'죽은 돌 표시해 계가 제안하기'):'상대가 계가 확인 중')
      :offer?'상대가 무승부를 제안했습니다':(st==='mine'?'내 차례':'상대 차례')+(d.offer?' · 무승부 제안 중':'');
    desc=`${what} · ${esc(ON.info(d))}<br>기한 ${ON.when(dl)} · <span class="${late?'late':''}">${ON.left(dl)}${late&&st==='theirs'?' (시간승을 받을 수 있음)':''}</span>`;
  }
  return `<a class="hub-row${st==='mine'?' mine':''}" href="${href}">${ic}<span class="t"><b>${title}</b><small>${desc}</small></span><span class="go">›</span></a>`;
}
function render(){
  renderMe();
  // 진행 중인 대국은 기한이 가까운 것부터
  const l=ON.cached(),by=k=>{const a=l.filter(d=>ON.stage(d)===k);if(k==='mine'||k==='theirs')a.sort((x,y)=>ON.deadline(x)-ON.deadline(y));return a;};
  const fill=(id,arr,empty)=>{$(id).innerHTML=arr.length?arr.map(row).join(''):`<div class="empty">${empty}</div>`;};
  const mine=by('mine'),open=by('open');
  fill('#lMine',mine,'지금 내 차례인 대국이 없습니다.');
  fill('#lTheirs',by('theirs'),'상대 차례인 대국이 없습니다.');
  fill('#lOpen',open,'');$('#hOpen').classList.toggle('hidden',!open.length);$('#lOpen').classList.toggle('hidden',!open.length);
  fill('#lDone',by('done').slice(0,15),'아직 끝난 대국이 없습니다.');
  $('#hMine').textContent=mine.length?`내 차례 (${mine.length})`:'내 차례';
  $('#status').textContent=busy?'받는 중…':!navigator.onLine?'오프라인 · 마지막으로 받은 목록':lastAt?'갱신 '+new Date(lastAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
}
async function refresh(){
  if(busy)return;
  if(!LB.state().uid){render();return;} // 아직 온라인 대국을 한 적 없는 기기
  busy=true;render();
  try{await ON.refresh();lastAt=Date.now();}
  catch(e){console.warn('[온라인]',e);if(e.status!==0)toast('목록을 받지 못했습니다');}
  busy=false;render();
}
$('#btnRefresh').onclick=refresh;

// 닉네임 (순위표 닉네임과 같은 값)
function saveName(v){const name=String(v||'').trim().slice(0,12);if(!name){toast('닉네임을 입력하세요');return false;}LB.set({name,pending:true,gorPending:true,omokPending:true,chessPending:true});renderMe();return true;}
$('#nameSave').onclick=()=>{if(saveName($('#nameIn').value))toast('닉네임을 저장했습니다');};

// ---------- 새 대국 ----------
const OPTK=ON.type+'-online-newopts',lastOpt=load(OPTK,{size:19,color:0,handicap:0,days:3,rated:true});
const sizeIn=()=>document.querySelector('input[name=size]:checked');
function fillHandi(){
  const sel=$('#selHandi');if(!sel)return;
  const n=+sizeIn().value,cur=+sel.value||0,max=n===9?5:9;
  sel.innerHTML='<option value="0">없음 (호선 · 덤 7.5)</option>';for(let h=2;h<=max;h++)sel.insertAdjacentHTML('beforeend',`<option value="${h}">${h}점 (덤 0.5)</option>`);
  sel.value=String(Math.min(cur,max));
}
document.querySelectorAll('input[name=size]').forEach(el=>el.onchange=fillHandi);
$('#btnCreate').onclick=()=>{
  if(!LB.state().name){$('#nameBox').classList.remove('hidden');$('#nameIn').focus();toast('먼저 닉네임을 정하세요');return;}
  const sz=document.querySelector(`input[name=size][value="${lastOpt.size}"]`);if(sz)sz.checked=true;
  const cl=document.querySelector(`input[name=color][value="${lastOpt.color}"]`);if(cl)cl.checked=true;
  if($('#selHandi')){fillHandi();$('#selHandi').value=String(lastOpt.handicap);if(!$('#selHandi').value)$('#selHandi').value='0';}
  $('#selDays').value=String(lastOpt.days);$('#optRated').checked=lastOpt.rated;
  openDlg($('#dlgCreate'),async v=>{
    if(v!=='ok')return;
    const o={color:+document.querySelector('input[name=color]:checked').value,days:+$('#selDays').value,rated:$('#optRated').checked};
    if(sizeIn())o.size=+sizeIn().value;if($('#selHandi'))o.handicap=+$('#selHandi').value;
    Object.assign(lastOpt,o);store(OPTK,lastOpt);
    toast('대국을 만드는 중…');
    try{const code=await ON.create({n:o.size,handi:o.handicap||0,color:o.color,days:o.days,rated:o.rated});render();showInvite(code);}
    catch(e){console.warn(e);toast(e.status===0?'인터넷에 연결되어야 대국을 만들 수 있습니다':'대국을 만들지 못했습니다 ('+e.message+')');}
  });
};
// 초대 보내기 / 취소
function showInvite(code){
  const d=ON.cachedOne(code);if(!d)return;
  const col=ON.colorOf(d);
  $('#invInfo').textContent=`${ON.info(d)} · 나: ${NAME[col]}${ON.C.sideNote(d,col)}`;
  $('#invCode').textContent=code;
  $('#invShare').onclick=async()=>{const r=await ONL.share(ON.inviteText(d),ON.link(code));if(r==='copied')toast('초대 글과 링크를 복사했습니다');else if(r==='fail')toast('방 코드를 직접 알려 주세요: '+code);};
  $('#invCancel').onclick=async()=>{
    closeDlg($('#dlgInvite'));
    if(!(await ask('초대를 취소할까요?','아직 아무도 들어오지 않은 대국을 지웁니다.','초대 취소')))return;
    try{await ONL.remove(code);toast('초대를 취소했습니다');}catch(e){if(e.status!==404){toast('취소하지 못했습니다 ('+e.message+')');return;}}
    try{localStorage.setItem(ON.type+'-online-list',JSON.stringify(ON.cached().filter(x=>x.code!==code)));}catch(e){}
    ON.summary();render();
  };
  openDlg($('#dlgInvite'));
}

// ---------- 참가 ----------
$('#btnJoin').onclick=()=>{$('#joinCode').value='';openDlg($('#dlgJoin'),v=>{if(v==='ok')openJoin(ONL.normCode($('#joinCode').value));});setTimeout(()=>$('#joinCode').focus(),50);};
$('#joinCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();closeDlg($('#dlgJoin'),'ok');}});
// 복사해 온 글(초대 글 전체, 링크, 코드만)에서 방 코드 찾기
function codeIn(t){
  t=String(t||'');
  const m=/#join=([A-Za-z0-9]{6})/.exec(t)||/코드\s*([A-Za-z0-9]{6})/.exec(t)||/\b([A-HJ-NP-Za-hj-np-z2-9]{6})\b/.exec(t.trim());
  return m?ONL.normCode(m[1]):'';
}
$('#joinPaste').onclick=async()=>{
  let t='';
  try{t=await navigator.clipboard.readText();}catch(e){toast('붙여넣기를 쓸 수 없습니다. 입력칸을 길게 눌러 붙여넣으세요');$('#joinCode').focus();return;}
  const c=codeIn(t);
  if(!c){toast('복사한 내용에 방 코드가 없습니다');return;}
  $('#joinCode').value=c;closeDlg($('#dlgJoin'),'ok');
};
const GAME_NAME={go:'바둑',omok:'오목',chess:'체스'};
async function openJoin(code){
  if(code.length!==6){toast('방 코드는 여섯 글자입니다');return;}
  let d;
  try{d=await ONL.get(code);}catch(e){toast(e.status===0?'인터넷에 연결되어야 참가할 수 있습니다':'대국을 찾지 못했습니다');return;}
  if(!d){toast('없는 방 코드입니다: '+code);return;}
  // 다른 게임의 방 코드면 그 게임의 참가 화면으로
  if(d.g!==ON.type){if(GAME_NAME[d.g]){toast(GAME_NAME[d.g]+' 대국입니다');location.href=`../../${d.g}/online/#join=${code}`;}else toast('없는 방 코드입니다: '+code);return;}
  const me=ONL.uid();
  if(me&&d.players.includes(me)){location.href='../#online='+code;return;} // 이미 들어 있는 대국
  if(d.st!=='open'){toast('이미 시작한 대국입니다');return;}
  const hostCol=d.bu?1:2,myCol=3-hostCol,host=hostCol===1?d.bn:d.wn;
  $('#jiTitle').textContent=`${host}님의 초대`;
  $('#jiInfo').textContent=`${ON.info(d)} · 나: ${NAME[myCol]}${ON.C.sideNote(d,myCol)}${d.rated?' · 레이팅 대국':''}`;
  const needName=!LB.state().name;$('#jiName').classList.toggle('hidden',!needName);$('#jiNameIn').value='';
  // 홈 화면 앱이 아닌 브라우저(카카오톡 안 브라우저 등)로 열었을 때: 코드를 복사해 앱에서 참가하는 길을 먼저 보여 준다
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  $('#jiApp').classList.toggle('hidden',!!standalone);$('#jiSteps').classList.add('hidden');
  $('#jiOk').textContent=standalone?'참가':'이 브라우저에서 참가';$('#jiOk').className=standalone?'primary':'ghost';
  $('#jiCopy').onclick=async()=>{
    let ok=true;try{await navigator.clipboard.writeText(code);}catch(e){ok=false;}
    const s=$('#jiSteps');s.classList.remove('hidden');
    s.innerHTML=`${ok?`코드 <b>${code}</b>를 복사했습니다.`:`코드 <b>${code}</b>를 기억해 두세요.`}<br>홈 화면의 Table Top → ${OLP.game} → 온라인 대국 → 코드로 참가 → ${ok?'붙여넣기':'코드 입력'}`;
  };
  openDlg($('#dlgJoinInfo'),async v=>{
    if(v!=='ok')return;
    if(needName&&!saveName($('#jiNameIn').value))return;
    toast('참가하는 중…');
    try{await ON.join(d);location.href='../#online='+code;}
    catch(e){console.warn(e);toast(e.status===0?'인터넷 연결을 확인하세요':'참가하지 못했습니다 · 다른 사람이 먼저 들어왔을 수 있습니다');}
  });
}

// 주소: #join=코드 (초대 링크), #invite=코드 (목록의 초대 중 대국)
function route(){
  const j=/^#join=([A-Za-z0-9]{6})$/.exec(location.hash),i=/^#invite=([A-Z0-9]{6})$/.exec(location.hash);
  // 안드로이드 카카오톡 안 브라우저로 연 초대 링크는 바깥 브라우저로 넘긴다. 크롬으로 설치한 앱이 있으면 앱이 열린다
  if(j&&/KAKAOTALK/i.test(navigator.userAgent)&&/Android/i.test(navigator.userAgent)&&!sessionStorage.getItem('kakaoOut')){
    try{sessionStorage.setItem('kakaoOut','1');}catch(e){}
    location.href='kakaotalk://web/openExternal?url='+encodeURIComponent(location.href);
    toast('앱(또는 브라우저)으로 여는 중…');
  }
  if(j||i)history.replaceState(null,'',location.pathname);
  if(j)openJoin(ONL.normCode(j[1]));else if(i)showInvite(i[1]);
}
window.addEventListener('hashchange',route);
window.addEventListener('online',refresh);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastAt>20000)refresh();});
setInterval(()=>{if(document.visibilityState==='visible'&&Date.now()-lastAt>110000)refresh();},30000); // 목록은 2분마다
render();route();refresh();
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('../../sw.js').catch(()=>{});
