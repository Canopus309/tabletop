/* 학습·퍼즐 화면 공통 (바둑 학습, 오목 퍼즐)
 *  - 문제 목록(탭·단계별 칸), 푼 기록, 주소(#문제 번호)로 화면 전환
 *  - 선 위에 두는 판(바둑·오목) 그리기: 판의 일부만 잘라 보여 줄 수 있다
 *  - 판 객체는 { n, c[], pt(x,y), xy(p) } 모양이면 된다 (바둑 Board, 오목은 간단한 배열 판)
 * 페이지는 이 파일보다 먼저 LEARN(문제 자료)을 불러오고, 끝에서 startLearn(설정)을 부른다.
 */
'use strict';
const ST_E=0,ST_B=1,ST_W=2;
let LC=null; // 페이지 설정
const SETS=LEARN.sets;
const byId=new Map();SETS.forEach(s=>s.items.forEach((it,i)=>{it.set=s;it.idx=i;byId.set(it.id,it);}));
// 푼 기록: 1 = 한 번에 맞힘, 2 = 힌트·정답 보기·실패 뒤에 맞힘
let prog=null;
const saveProg=()=>store(LC.storeKey,prog);

// ---------- 목록 ----------
function setOf(key){return SETS.find(s=>s.key===key)||SETS[0];}
function renderTabs(){
  $('#tabs').innerHTML='';
  for(const s of SETS){
    const b=document.createElement('button');b.className='tab'+(s.key===prog.tab?' on':'');b.textContent=s.name;
    b.onclick=()=>{prog.tab=s.key;saveProg();renderList();};
    $('#tabs').appendChild(b);
  }
}
function renderList(){
  renderTabs();
  const s=setOf(prog.tab),body=$('#setBody');
  const done=s.items.filter(it=>prog.done[it.id]).length;
  body.innerHTML=`<div class="set-head"><h2>${s.name}</h2><span>${done} / ${s.items.length}</span></div><p class="set-desc">${s.desc}</p>`;
  if(LC.renderSet&&LC.renderSet(s,body))return; // 페이지가 직접 그리는 목록
  for(let lv=0;lv<LC.levels.length;lv++){
    const items=s.items.filter(it=>it.lv===lv);if(!items.length)continue;
    const box=document.createElement('div');box.className='lv';
    box.innerHTML=`<h3>${LC.levels[lv]}</h3>`;
    const tiles=document.createElement('div');tiles.className='tiles';
    items.forEach(it=>{
      const d=prog.done[it.id],t=document.createElement('button');
      t.className='tile'+(d===1?' clean':d===2?' help':'');
      t.innerHTML=`<b>${it.idx+1}</b><small>${it.title||''}</small>`;
      t.onclick=()=>go(it.id);tiles.appendChild(t);
    });
    box.appendChild(tiles);body.appendChild(box);
  }
}

// ---------- 화면 전환 (주소의 #문제번호) ----------
function go(id){location.hash=id?'#'+id:'';}
function route(){
  const id=decodeURIComponent(location.hash.slice(1)),it=byId.get(id);
  stopDemo();
  if(!it){
    $('#probView').classList.add('hidden');$('#listView').classList.remove('hidden');
    $('#hTitle').textContent=LC.title;$('#back').href=LC.backHref;
    renderList();window.scrollTo(0,0);return;
  }
  prog.tab=it.set.key;saveProg();
  $('#listView').classList.add('hidden');$('#probView').classList.remove('hidden');
  $('#hTitle').textContent=it.set.name;
  $('#back').href='#';
  openItem(it);
}
window.addEventListener('hashchange',route);

// ---------- 판 그리기 (일부만 잘라 보여 줄 수 있다) ----------
// (체스처럼 칸에 두는 판은 페이지가 직접 그리므로 캔버스가 없을 수 있다)
const cv=$('#cv'),ctx=cv?cv.getContext('2d'):null,bw=$('#bw');
let V={x0:0,y0:0,x1:8,y1:8,n:9},G={cell:0,ox:0,oy:0,w:0,h:0,dpr:1};
// 화면 상태: 판, 표시(번호·힌트·표적·틀린 수·좋은 자리·금수·5목 선). 점이 없으면 -1
let D={b:null,nums:new Map(),hints:[],targets:[],bad:-1,good:[],last:-1,forbid:[],line:null};
function setD(b,o={}){D=Object.assign({b,nums:new Map(),hints:[],targets:[],bad:-1,good:[],last:-1,forbid:[],line:null},o);}
// 좌표(LC.cols 가 있을 때): 글자는 판 가장자리 쪽 바깥 띠에 (가로 글자는 위·아래, 세로 숫자는 왼쪽·오른쪽 중 하나)
const LBW=0.62;
function setView(n,x0,y0,x1,y1){
  V={n,x0:Math.max(0,x0),y0:Math.max(0,y0),x1:Math.min(n-1,x1),y1:Math.min(n-1,y1)};
  const k=0.62,c=0.5,lb=LC&&LC.cols?LBW:0;
  V.colSide=V.y0!==0&&V.y1===n-1?'b':'t';V.rowSide=V.x0!==0&&V.x1===n-1?'r':'l';
  const ml=(V.x0===0?k:c)+(V.rowSide==='l'?lb:0),mr=(V.x1===n-1?k:c)+(V.rowSide==='r'?lb:0),
    mt=(V.y0===0?k:c)+(V.colSide==='t'?lb:0),mb=(V.y1===n-1?k:c)+(V.colSide==='b'?lb:0);
  V.m={ml,mr,mt,mb,lb};
  bw.style.aspectRatio=`${V.x1-V.x0+ml+mr} / ${V.y1-V.y0+mt+mb}`;
  resize();
}
function resize(){
  if(!ctx)return;const w=bw.clientWidth;if(!w||!V.m)return;
  // 화면 높이를 넘지 않게 너비를 줄인다
  const ar=(V.x1-V.x0+V.m.ml+V.m.mr)/(V.y1-V.y0+V.m.mt+V.m.mb);
  const maxH=Math.max(260,window.innerHeight-(window.innerWidth<=860?300:110));
  bw.style.maxWidth=Math.round(maxH*ar)+'px';
  const ww=bw.clientWidth,hh=ww/ar,dpr=window.devicePixelRatio||1;
  cv.width=Math.round(ww*dpr);cv.height=Math.round(hh*dpr);
  const cell=ww/(V.x1-V.x0+V.m.ml+V.m.mr);
  G={cell,ox:V.m.ml*cell,oy:V.m.mt*cell,w:ww,h:hh,dpr};draw();
}
if(ctx)new ResizeObserver(resize).observe(bw);
const PX=x=>G.ox+(x-V.x0)*G.cell,PY=y=>G.oy+(y-V.y0)*G.cell;
function draw(){
  const b=D.b;if(!ctx||!b||!G.cell)return;
  const {cell,w,h,dpr}=G,r=cell*0.48,n=V.n;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='rgba(40,28,10,.82)';ctx.lineWidth=Math.max(1,cell*0.03);
  ctx.beginPath();
  // 잘린 쪽은 선을 끝까지 긋되 좌표 띠는 비워 둔다
  const L=V.m.lb*cell,lx0=V.x0===0?PX(0):V.rowSide==='l'?L:0,lx1=V.x1===n-1?PX(n-1):V.rowSide==='r'?w-L:w,
    ly0=V.y0===0?PY(0):V.colSide==='t'?L:0,ly1=V.y1===n-1?PY(n-1):V.colSide==='b'?h-L:h;
  for(let y=V.y0;y<=V.y1;y++){const v=Math.round(PY(y)*dpr)/dpr+0.5/dpr;ctx.moveTo(lx0,v);ctx.lineTo(lx1,v);}
  for(let x=V.x0;x<=V.x1;x++){const v=Math.round(PX(x)*dpr)/dpr+0.5/dpr;ctx.moveTo(v,ly0);ctx.lineTo(v,ly1);}
  ctx.stroke();
  // 판 가장자리는 굵게
  ctx.lineWidth=Math.max(1.5,cell*0.055);ctx.beginPath();
  if(V.y0===0){ctx.moveTo(lx0,PY(0));ctx.lineTo(lx1,PY(0));}
  if(V.y1===n-1){ctx.moveTo(lx0,PY(n-1));ctx.lineTo(lx1,PY(n-1));}
  if(V.x0===0){ctx.moveTo(PX(0),ly0);ctx.lineTo(PX(0),ly1);}
  if(V.x1===n-1){ctx.moveTo(PX(n-1),ly0);ctx.lineTo(PX(n-1),ly1);}
  ctx.stroke();
  if(L){
    ctx.fillStyle='rgba(40,28,10,.72)';ctx.font=`600 ${cell*0.3}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    const cy=V.colSide==='t'?L/2:h-L/2,rx=V.rowSide==='l'?L/2:w-L/2;
    for(let x=V.x0;x<=V.x1;x++)ctx.fillText(LC.cols[x],PX(x),cy);
    for(let y=V.y0;y<=V.y1;y++)ctx.fillText(String(n-y),rx,PY(y));
  }
  ctx.fillStyle='rgba(40,28,10,.9)';
  for(const [x,y] of LC.stars(n))if(x>=V.x0&&x<=V.x1&&y>=V.y0&&y<=V.y1){ctx.beginPath();ctx.arc(PX(x),PY(y),Math.max(2,cell*0.1),0,7);ctx.fill();}
  // 흑 금수 자리
  if(D.forbid.length){ctx.strokeStyle='rgba(200,50,40,.85)';ctx.lineWidth=Math.max(1.5,cell*0.07);const q=cell*0.17;
    for(const p of D.forbid){const [x,y]=b.xy(p);if(b.c[p]!==ST_E)continue;ctx.beginPath();ctx.moveTo(PX(x)-q,PY(y)-q);ctx.lineTo(PX(x)+q,PY(y)+q);ctx.moveTo(PX(x)+q,PY(y)-q);ctx.lineTo(PX(x)-q,PY(y)+q);ctx.stroke();}}
  for(let y=V.y0;y<=V.y1;y++)for(let x=V.x0;x<=V.x1;x++){
    const p=b.pt(x,y),v=b.c[p];if(v!==ST_B&&v!==ST_W)continue;
    drawStone(PX(x),PY(y),r,v,1);
    if(D.nums.has(p)){
      ctx.fillStyle=v===ST_B?'#f2f2f2':'#1a1a1a';const t=String(D.nums.get(p));
      ctx.font=`600 ${cell*(t.length>1?0.4:0.46)}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(t,PX(x),PY(y)+cell*0.02);
    }else if(D.targets.includes(p)){
      ctx.fillStyle='#e0463f';const q=cell*0.17;ctx.beginPath();ctx.moveTo(PX(x),PY(y)-q);ctx.lineTo(PX(x)+q*0.95,PY(y)+q*0.65);ctx.lineTo(PX(x)-q*0.95,PY(y)+q*0.65);ctx.closePath();ctx.fill();
    }
  }
  if(D.last>=0&&(b.c[D.last]===ST_B||b.c[D.last]===ST_W)&&!D.nums.has(D.last)){
    const [x,y]=b.xy(D.last);ctx.strokeStyle=b.c[D.last]===ST_B?'#fff':'#222';ctx.lineWidth=Math.max(1.5,cell*0.06);
    ctx.beginPath();ctx.arc(PX(x),PY(y),r*0.42,0,7);ctx.stroke();
  }
  if(D.line){const [a,c2]=D.line,[ax,ay]=b.xy(a),[cx,cy]=b.xy(c2);ctx.strokeStyle='rgba(224,70,63,.9)';ctx.lineWidth=Math.max(2,cell*0.12);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(PX(ax),PY(ay));ctx.lineTo(PX(cx),PY(cy));ctx.stroke();ctx.lineCap='butt';}
  if(D.bad>=0&&b.c[D.bad]!==ST_E){const [x,y]=b.xy(D.bad);ctx.strokeStyle='#e0463f';ctx.lineWidth=Math.max(2,cell*0.08);ctx.beginPath();ctx.arc(PX(x),PY(y),r*1.02,0,7);ctx.stroke();}
  for(const p of D.hints){const [x,y]=b.xy(p);ctx.fillStyle='rgba(47,140,110,.85)';ctx.beginPath();ctx.arc(PX(x),PY(y),r*0.55,0,7);ctx.fill();}
  for(const p of D.good){const [x,y]=b.xy(p);ctx.strokeStyle='rgba(47,140,110,.95)';ctx.lineWidth=Math.max(2,cell*0.08);ctx.beginPath();ctx.arc(PX(x),PY(y),r*0.9,0,7);ctx.stroke();
    if(b.c[p]===ST_E){ctx.fillStyle='rgba(47,140,110,.95)';ctx.font=`700 ${cell*0.5}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('☆',PX(x),PY(y)+cell*0.02);}}
}
function drawStone(x,y,r,col,alpha){
  ctx.save();ctx.globalAlpha=alpha;
  if(alpha===1){ctx.beginPath();ctx.arc(x+r*0.07,y+r*0.12,r,0,7);ctx.fillStyle='rgba(0,0,0,.28)';ctx.fill();}
  const g=ctx.createRadialGradient(x-r*.35,y-r*.4,r*.08,x,y,r);
  if(col===ST_B){g.addColorStop(0,'#5d5d5d');g.addColorStop(.55,'#202020');g.addColorStop(1,'#060606');}
  else{g.addColorStop(0,'#ffffff');g.addColorStop(.65,'#eeeeec');g.addColorStop(1,'#c4c4c0');}
  ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fillStyle=g;ctx.fill();
  ctx.restore();
}
// 누른 자리 (없으면 -1)
function pointAt(e){
  const rc=cv.getBoundingClientRect(),fx=(e.clientX-rc.left-G.ox)/G.cell+V.x0,fy=(e.clientY-rc.top-G.oy)/G.cell+V.y0;
  const x=Math.round(fx),y=Math.round(fy);
  if(x<V.x0||x>V.x1||y<V.y0||y>V.y1)return -1;
  if((fx-x)**2+(fy-y)**2>0.3)return -1;
  return D.b.pt(x,y);
}
let onBoard=null;
if(cv)cv.addEventListener('click',e=>{const p=pointAt(e);if(p>=0&&onBoard)onBoard(p);});

// ---------- 공통 화면 ----------
let cur=null,demoT=0,demoGen=0;
function stopDemo(){demoGen++;clearTimeout(demoT);}
const wait=ms=>{const g=demoGen;return new Promise((res,rej)=>{demoT=setTimeout(()=>g===demoGen?res():rej('stop'),ms);});};
function msg(t,cls){const m=$('#pMsg');m.innerHTML=t;m.className='msg'+(cls?' '+cls:'');}
function mark(it,v){const o=prog.done[it.id];if(!o||v<o)prog.done[it.id]=v;saveProg();summary();}
// 홈 화면 카드에 보일 요약
function summary(){
  try{const s=JSON.parse(localStorage.getItem('tt-summary'))||{};let n=0,t=0;
    SETS.forEach(st=>st.items.forEach(it=>{t++;if(prog.done[it.id])n++;}));
    if(n)s[LC.summaryKey]=`${n} / ${t} 완료`;else delete s[LC.summaryKey];localStorage.setItem('tt-summary',JSON.stringify(s));}catch(e){}
}
const turnName=c=>c===ST_B?'흑':'백';
const dot=c=>`<span class="dot ${c===ST_B?'b':'w'}"></span>`;
function openItem(it){
  cur={it};
  $('#pTags').innerHTML='';$('#pNote').textContent='';
  $('#pBtns').classList.remove('hidden');$('#bHint').classList.remove('hidden');
  const nx=it.set.items[it.idx+1];
  $('#bNext').textContent=nx?(LC.nextLabel?LC.nextLabel(it):'다음 문제 ›'):'목록으로';
  $('#bNext').onclick=()=>go(nx?nx.id:'');
  $('#bList').onclick=()=>go('');
  LC.open[it.set.kind](it);
}
function startLearn(cfg){
  LC=cfg;
  prog=load(cfg.storeKey,{done:{},tab:SETS[0].key});
  summary();route();
}
