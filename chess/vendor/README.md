# 체스에 쓰는 외부 구성 요소

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `stockfish-19-lite-single.js`, `stockfish-19-lite-single.wasm` | Stockfish 19 Lite WASM, [nmrugg/stockfish.js v19.0.0](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.0) (원본: [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish)) | GPL-3.0 (`LICENSE-stockfish.txt`) |
| `chess.js` | [chess.js 1.4.0](https://github.com/jhlywa/chess.js) | BSD-2-Clause (`LICENSE-chessjs.txt`) |
| `../pieces/*.svg` | cburnett 말 그림 ([lichess-org/lila](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett), 원작 Colin M.L. Burnett) | GPL-2.0 이상 |

Stockfish 는 별도 프로그램(Web Worker)으로 실행되며, UCI 문자열로만 대화합니다. Stockfish 소스 코드는 위 링크에서 받을 수 있습니다.
