// 바둑판 규칙(go/board.js)과 사활 계산기(go/learn/tsumego.js)를 Node 에서 불러온다
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'../../..');
const ctx={console,Map,Set,Int32Array,Uint8Array,Int16Array,Math,Error};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'go/board.js'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'go/learn/tsumego.js'),'utf8').replace("if (typeof module !== 'undefined') module.exports = Tsumego;","")+'\nthis.T=Tsumego;this.Board=Board;',ctx);
const COLS='ABCDEFGHJKLMNOPQRST';
ctx.name=(b,p)=>{const [x,y]=b.xy(p);return COLS[x]+(b.n-y);};
module.exports=ctx;
