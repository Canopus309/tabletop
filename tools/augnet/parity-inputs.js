// 맞대기 시험용 장면: 9줄 무작위 대국 몇 장면의 KataGo 입력(대칭 0)을 tmp/parity-in.json 에 쓴다
// 파이토치(parity.py)와 앱의 TF.js 신경망(브라우저)에 같은 입력을 넣어 출력을 비교한다
'use strict';
const fs = require('fs'), path = require('path');
const { Board, Kata, PASS } = require('./jsenv.js');
const { rootFromState, encode } = Kata._internal;
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const n = 9, area = n * n, NF = 22, NG = 19, out = [];
for (const len of [0, 3, 12, 25, 40, 60]) {
  const b = new Board(n), moves = [];
  for (let i = 0; i < len; i++) { const l = Array.from(b.pts).filter(p => b.isLegal(p, b.turn) && !b.isEye(p, b.turn)); const p = l.length ? l[Math.floor(rnd() * l.length)] : PASS; b.play(p); moves.push(p); }
  const node = rootFromState({ n, setup: [], moves });
  const bin = new Float32Array(area * NF), glob = new Float32Array(NG);
  encode(node, 7.5, 0, bin, 0, glob, 0);
  out.push({ moves, bin: Array.from(bin), glob: Array.from(glob) });
}
fs.mkdirSync(path.join(__dirname, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'tmp/parity-in.json'), JSON.stringify({ n, NF, NG, cases: out }));
console.log('장면', out.length, '개 저장');
