// 증강 바둑 자기 대국의 장면 (St): 앱과 같은 go/aug/augstate.js 를 쓴다 (단계 · 행동 번호 · 입력 특징 설명은 그 파일에)
'use strict';
const { AugState, Kata, PASS, EMPTY, BLACK, WHITE } = require('./jsenv.js');
const { St, syms, AUG_LIST, PASSIVE, NF, NG, NF2, NG2 } = AugState;
module.exports = { St, syms, AUG_LIST, PASSIVE, NF, NG, NF2, NG2, PASS, BLACK, WHITE, EMPTY, Kata };
