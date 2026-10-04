/* Table Top 공통 도우미: DOM, 저장소, 대화상자, 토스트, 효과음
 * 각 게임 페이지는 soundEnabled() 를 정의해 효과음 설정을 알려 준다 (없으면 켜짐) */
'use strict';
const $=s=>document.querySelector(s);
function load(k,def){try{const v=JSON.parse(localStorage.getItem(k));return v?Object.assign({},def,v):def;}catch(e){return def;}}
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 난이도 단계를 중간에 끼워 넣었을 때 저장된 단계 번호를 한 칸씩 민다
// (v2: 모든 게임의 1번 자리에 '초보' 추가 → 기존 1번 이상은 +1). 대국·마지막 선택·기록의 level 을 옮긴다
function migrateLevels(game,keys){
  const vk='tt-levels-'+game;
  try{
    if(localStorage.getItem(vk)==='2')return;
    const shift=o=>{if(o&&typeof o.level==='number'&&o.level>=1)o.level++;};
    for(const k of keys){
      const raw=localStorage.getItem(k);if(!raw)continue;
      const v=JSON.parse(raw);
      if(Array.isArray(v))v.forEach(shift);else{shift(v);if(v&&Array.isArray(v.history))v.history.forEach(shift);}
      localStorage.setItem(k,JSON.stringify(v));
    }
    localStorage.setItem(vk,'2');
  }catch(e){}
}

// 대화상자: 폼 제출 없이 JS로만 열고 닫는다 (미리보기 창 등 폼이 막힌 환경에서도 동작)
const NATIVE_DLG=typeof HTMLDialogElement==='function'&&'showModal' in HTMLDialogElement.prototype;
// close 이벤트에 의존하지 않고 닫힐 때 핸들러를 직접 호출한다
const dlgDone=new Map();
function openDlg(d,onClose){
  if(onClose)dlgDone.set(d,onClose);
  if(NATIVE_DLG){if(!d.open)d.showModal();}
  else{d.setAttribute('open','');document.body.classList.add('dlg-fallback');}
}
function closeDlg(d,val){
  if(!d||!d.hasAttribute('open'))return;
  if(NATIVE_DLG)d.close();
  else{d.removeAttribute('open');document.body.classList.remove('dlg-fallback');}
  const f=dlgDone.get(d);dlgDone.delete(d);
  if(f)f(val);
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-close]');if(b)closeDlg(b.closest('dialog'),b.dataset.close);});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('cancel',e=>{e.preventDefault();closeDlg(d,'cancel');}));
document.addEventListener('keydown',e=>{if(!NATIVE_DLG&&e.key==='Escape'){const d=document.querySelector('dialog[open]');if(d)closeDlg(d,'cancel');}});

function ask(title,text,yes){
  return new Promise(res=>{
    const d=$('#dlgConfirm');$('#cfTitle').textContent=title;$('#cfText').textContent=text;$('#cfYes').textContent=yes;
    openDlg(d,v=>res(v==='yes'));
  });
}

let toastT=0;
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2600);}

// ---------- 효과음 (Web Audio로 합성, 파일 불필요) ----------
let actx=null;
function audioCtx(){
  actx=actx||new (window.AudioContext||window.webkitAudioContext)();
  if(actx.state==='suspended')actx.resume().catch(()=>{});
  return actx;
}
const soundOn=()=>typeof soundEnabled!=='function'||soundEnabled();
document.addEventListener('pointerdown',()=>{if(soundOn())try{audioCtx();}catch(e){}},{once:true,capture:true});
function sound(kind,cap){
  if(!soundOn())return;
  try{
    audioCtx();
    const t=actx.currentTime,out=actx.destination;
    const tone=(f,dur,type,vol,at=0)=>{const o=actx.createOscillator(),g=actx.createGain();o.type=type;o.frequency.value=f;
      g.gain.setValueAtTime(vol,t+at);g.gain.exponentialRampToValueAtTime(0.001,t+at+dur);o.connect(g).connect(out);o.start(t+at);o.stop(t+at+dur);};
    if(kind==='stone'||kind==='cap'){
      const len=0.09,buf=actx.createBuffer(1,actx.sampleRate*len|0,actx.sampleRate),d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,8);
      const src=actx.createBufferSource(),f=actx.createBiquadFilter(),g=actx.createGain();
      src.buffer=buf;f.type='bandpass';f.frequency.value=1900;f.Q.value=0.9;g.gain.value=1.4;
      src.connect(f).connect(g).connect(out);src.start(t);tone(210,0.07,'sine',0.35);
      if(kind==='cap')for(let i=0;i<Math.min(cap,4);i++)tone(900+i*120,0.05,'triangle',0.08,0.09+i*0.05);
    }else if(kind==='pass')tone(440,0.15,'sine',0.12);
    else if(kind==='bad')tone(150,0.12,'square',0.05);
    else if(kind==='win'){[523,659,784].forEach((f,i)=>tone(f,0.25,'triangle',0.12,i*0.11));}
  }catch(e){}
}
