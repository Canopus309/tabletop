/* 지난 대국 기록: 세 게임의 대국을 이 기기(IndexedDB)에 모두 저장하고 기보 파일로 내려받는다
 *  기록 = {key:'go:대국id', type:'go'|'omok'|'chess', id, t:마지막 저장 시각, game:대국 그대로, meta:목록 표시용, file:기보 파일 내용}
 *  meta = {opp:상대, side:내 색('' = 두 사람), info:판 정보, len:수 표시, out:'win'|'loss'|'draw'|'done'|'open', res:결과 글}
 *  각 게임 화면은 저장할 때마다 REC.put 을 부른다 (같은 대국은 덮어씀, 한 수도 없으면 지움)
 */
'use strict';
const REC=(()=>{
  const DB='tabletop-records',ST='games';
  const EXT={go:'sgf',omok:'sgf',chess:'pgn'};
  let dbp=null;
  function open(){
    if(!dbp)dbp=new Promise((res,rej)=>{
      if(!window.indexedDB){rej(new Error('IndexedDB 없음'));return;}
      const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>{const s=r.result.createObjectStore(ST,{keyPath:'key'});s.createIndex('type','type');};
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
    });
    return dbp;
  }
  // 저장소 거래 하나: req 가 만든 요청의 결과를 거래가 끝난 뒤 돌려준다
  async function run(mode,req){
    const db=await open();
    return new Promise((res,rej)=>{
      const t=db.transaction(ST,mode),q=req(t.objectStore(ST));
      t.oncomplete=()=>res(q&&q.result);t.onerror=t.onabort=()=>rej(t.error);
    });
  }
  function put(type,game,meta,file){
    if(!game||!game.id)return Promise.resolve();
    const key=type+':'+game.id;
    const job=game.moves&&game.moves.length
      ?run('readwrite',s=>{const g=JSON.parse(JSON.stringify(game));delete g.analyzing;return s.put({key,type,id:game.id,t:Date.now(),game:g,meta,file});})
      :run('readwrite',s=>s.delete(key));
    return job.catch(e=>console.warn('[기록]',e));
  }
  const get=(type,id)=>run('readonly',s=>s.get(type+':'+id));
  const list=type=>run('readonly',s=>s.index('type').getAll(type)).then(a=>(a||[]).sort((x,y)=>y.id-x.id));
  const pad=n=>String(n).padStart(2,'0');
  // 목록에 보일 날짜: 올해면 '10월 6일 14:32', 아니면 연도까지
  function when(id){
    const d=new Date(id),y=d.getFullYear()!==new Date().getFullYear()?d.getFullYear()+'년 ':'';
    return `${y}${d.getMonth()+1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const stamp=id=>{const d=new Date(id);return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;};
  const fileName=(type,id)=>`tabletop-${type}-${stamp(id)}.${EXT[type]}`;
  const allName=type=>`tabletop-${type}-all-${stamp(Date.now()).slice(0,8)}.${EXT[type]}`;
  // 파일 내려받기. iPhone·iPad 는 공유 시트(파일에 저장)로, 나머지는 바로 내려받는다
  function download(name,text){
    const blob=new Blob([text],{type:'text/plain;charset=utf-8'});
    const anchor=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);};
    const ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    if(ios&&navigator.canShare){
      try{
        const f=new File([blob],name,{type:'text/plain'});
        if(navigator.canShare({files:[f]})){navigator.share({files:[f]}).catch(e=>{if(e.name!=='AbortError')anchor();});return;}
      }catch(e){}
    }
    anchor();
  }
  return{put,get,list,when,fileName,allName,download};
})();
