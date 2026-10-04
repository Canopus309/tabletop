# Table Top

인터넷 없이 두는 AI 보드게임 웹앱입니다. 한 번 열어 두면 오프라인에서도 동작하고, 홈 화면에 추가하면 앱처럼 쓸 수 있습니다 (iPhone · Android · PC).

주소: https://canopus309.github.io/tabletop/

## 게임

### 바둑 (`go/`)
- 브라우저에서 KataGo 신경망을 직접 실행 (WebGPU → WebGL → WASM → CPU 중 결과가 맞는 가장 빠른 것)
- 9 / 13 / 19줄, 접바둑, 덤 설정
- 난이도 6단계: 입문 18급 · 초보 15급 · 초급 12급 · 중급 5급 · 고급 1단 (KaTrain 급수 보정 방식) · 최강 (b10 기준 5단+, 추정치)
- 신경망 선택: 가벼움 b6 · 표준 b10 (기본) · 강함 b15
- 대국 후 수마다 승률 분석 (승률 그래프, 실수·블런더 찾아가기)
- 내 기력 측정 (최근 10판)과 온라인 순위표: 대국은 오프라인, 결과는 연결될 때 자동으로 올라감
- 힌트, 형세 판단, 자동 계가, 복기, SGF 기보 저장

### 오목 (`omok/`, 렌주 룰)
- 15×15, 흑 첫 수는 천원. 흑은 33 · 44 · 장목 금수 (거짓 3 판정 포함), 백은 제한 없음
- 흑 차례에 금수 자리 표시, 5목 승리선 표시, 복기
- AI 6단계: 패턴 평가 + 알파베타 탐색 + 연속 4 승리 수순(VCF) 탐색. 백일 때는 흑을 금수 자리로 몰아넣는 수도 노림. 초반 몇 수는 무작위로 변화
- 급수: 입문 18급 · 초보 15급 · 초급 12급 · 중급 9급 · 고급 7급 · 최강 1단. 앱 자체 척도로, AI 단계끼리 대국해 잰 레이팅 차이를 입문=18급, 80점=1급으로 환산
- 내 급수(Glicko-2 레이팅을 급수로 표시, 무르기·힌트 쓴 대국 제외)와 온라인 순위표

### 체스 (`chess/`)
- Stockfish 19 Lite (WASM, 1.8MB) 를 Web Worker 로 실행. 규칙은 chess.js
- AI 7단계를 레이팅으로 표시: 입문 600 · 초보 800 · 초급 1050 · 중급 1400 · 고급 1800 · 상급 2200 · 최강 2800 (1320 이상은 Stockfish 의 UCI_Elo, 그 아래는 1400 단계와 대국해 추정)
- 내 레이팅: Glicko-2 (무르기·힌트를 쓴 대국은 미반영), 온라인 순위표는 레이팅 순
- 눌러서/끌어서 두기, 갈 수 있는 칸·체크 표시, 프로모션, 기보, 대국 후 수마다 승률 분석·실수 찾기

## 구조
- `index.html` 홈 (게임 고르기), `sw.js` 오프라인 캐시, `manifest.webmanifest`
- `common/` 공통 스타일·대화상자·효과음 (`base.css`, `ui.js`), 온라인 순위표 (`leaderboard.js`: Firebase 익명 로그인 + Firestore, 규칙은 `firestore.rules`), 체스·오목 레이팅과 레이팅 순위표 (`rating.js`)

## 사용한 오픈소스

| 구성 요소 | 라이선스 |
|---|---|
| [KataGo](https://github.com/lightvector/KataGo) g170 신경망 `g170e-b10c128`, `g170e-b15c192` (`go/models/*.bin.gz`) | CC0 |
| [KataGo](https://github.com/lightvector/KataGo) 시험용 신경망 `g170-b6c96-s175395328-d26788732` (`go/models/katago-b6.js`) | MIT (`go/vendor/LICENSE-katago.txt`) |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) 4.22.0 (`go/vendor/`) | Apache-2.0 |
| [KaTrain](https://github.com/sanderland/katrain)의 급수 보정 봇 공식 (`rankNMoves`, `rankMove`) | MIT |
| [Stockfish](https://github.com/official-stockfish/Stockfish) 19 Lite WASM ([nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js)) (`chess/vendor/`) | GPL-3.0 |
| [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 (`chess/vendor/chess.js`) | BSD-2-Clause |
| cburnett 체스 말 그림 (`chess/pieces/`, lichess) | GPL-2.0+ |

바둑 엔진의 입력 특징·축 판독·모델 형식은 KataGo의 `nninputs.cpp`, `board.cpp`, `desc.cpp`를 따랐고, 브라우저 구현은 [web-katrain](https://github.com/Sir-Teo/web-katrain)(MIT)을 참고했습니다. 오목 엔진은 직접 작성했습니다.
