// 앱의 바둑 규칙·KataGo 입력 특징·증강 장면을 Node 에서 그대로 쓴다: go/board.js + go/aug/augboard.js + go/katago.js + go/aug/aug.js + go/aug/augstate.js
// katago.js 의 encode 는 앱이 신경망에 넣는 입력과 같다 (학습한 신경망을 앱에 넣을 때 그대로 맞물리도록)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '../..');
const src = ['go/board.js', 'go/aug/augboard.js', 'go/katago.js', 'go/aug/aug.js', 'go/aug/augstate.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
  + '\n;({Board, AugBoard, Kata, AugGame, AUGS, AUG_IDS, AugState, PASS, EMPTY, BLACK, WHITE})';
module.exports = vm.runInThisContext(src);
