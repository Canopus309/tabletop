# Table Top

인터넷 없이 두는 AI 보드게임 웹앱입니다. 한 번 열어 두면 오프라인에서도 동작하고, 홈 화면에 추가하면 앱처럼 쓸 수 있습니다 (iPhone · Android · PC).

주소: https://canopus309.github.io/tabletop/

## 게임

세 게임 모두 새 게임에서 상대를 **AI** 또는 **사람**(한 폰으로 번갈아 두기)으로 고를 수 있습니다. 사람끼리 둔 대국도 끝나면 수마다 분석해 주며, 기력·레이팅·순위표에는 반영하지 않습니다. 체스는 설정에서 차례마다 판을 돌릴 수 있습니다.

### 바둑 (`go/`)
- 브라우저에서 KataGo 신경망을 직접 실행 (WebGPU → WebGL → WASM → CPU 중 결과가 맞는 가장 빠른 것)
- 9 / 13 / 19줄, 접바둑, 덤 설정 (중국식 계가, 기본 덤 7.5집 · 접바둑 0.5집)
- AI 상대 6명: 형준봇 18급 · 규형봇 15급 · 제일봇 12급 · 컨디션 좋은 제일봇 6급 · 각성한 제일봇 2급 (KaTrain 급수 봇 공식, 한 수에 신경망 한 번) · 택희봇 (탐색 1,200수, b10 기준 5단+ 추정). 급수는 KataGo 사람 흉내 신경망(Human-SL, b18c384nbt-humanv0)의 급수별 설정과 단계마다 120~230판 대국해 잰 값 (b10 기준)
- 신경망 선택: 가벼움 b6 · 표준 b10 (기본) · 강함 b15
- 대국 후 수마다 승률 분석 (승률 그래프, 실수·블런더 찾아가기). 복기 중 AI 후보 수(승률·집 차이)와 최선 수순, 판을 눌러 변화도(참고도) 두기, AI 응수
- 내 기력 측정 (최근 10판)과 온라인 순위표: 대국은 오프라인, 결과는 연결될 때 자동으로 올라감
- 힌트, 형세 판단, 자동 계가, 복기, SGF 기보 내려받기. 휴대폰에서는 위치를 정한 뒤 '착수' 버튼으로 두기

### 바둑 학습 (`go/learn/`)
- 사활 60문제 (입문 · 초급 · 중급 각 20): 기본 눈 모양 + 생성기로 만든 귀·변 문제. 정답이 하나뿐이고 패 없이 해결되는 문제만 골랐습니다
- 맥 10문제: 축 · 단수 방향 · 먹여치기 · 양단수 · 환격 (▲ 표시된 백 잡기). 축 문제는 판 전체에서 축 판정으로, 나머지는 둘러싸인 모양이라 계산기로 정확히 검증
- 정석: [조세키피디아](https://www.josekipedia.com/) 링크 (인터넷 필요)
- 사활·맥은 `go/learn/tsumego.js`(사활 계산기: 문제 영역 안의 수를 끝까지 읽는 탐색 + Benson 무조건 삶 판정)로 정답·오답·가장 끈질긴 응수를 미리 계산해 `problems.js`에 넣었습니다. 학습 판에는 좌표가 표시됩니다

### 오목 (`omok/`, 렌주 룰)
- 15×15, 흑 첫 수는 천원. 흑은 33 · 44 · 장목 금수 (거짓 3 판정 포함), 백은 제한 없음
- 흑 차례에 금수 자리 표시, 5목 승리선 표시, 복기
- 대국 후 수마다 흑 승률 그래프와 실수·블런더 찾기, 실수한 장면에서 AI 추천 수(☆) 표시. 승률은 필승 수순(연속 4) 탐색 + 가상 대국 96판을 AI 대국 1703국면의 실제 결과로 보정한 값
- AI 6단계: 입문·초급은 직접 만든 엔진(패턴 평가 + 알파베타 탐색 + 연속 4(VCF) 탐색, 열린 3과 4는 반드시 막음), 중급부터는 [Rapfi](https://github.com/dhbloo/rapfi)(Gomocup 우승 엔진, WebAssembly, 읽는 노드 수로 세기 조절), 최강은 Rapfi + 렌주 신경망(처음 고를 때 약 19MB 받음). 힌트와 변화도 AI 수도 Rapfi
- 급수: 앱 자체 척도(600 = 18급, 80점 = 1급). 입문·초급은 예전 측정값, Rapfi 단계는 그 둘과 단계끼리 20판씩 대국해 이어 잰 값 (사람 기준과 비교할 방법은 없음)
- 내 급수(Glicko-2 레이팅을 급수로 표시, 무르기·힌트 쓴 대국 제외)와 온라인 순위표
- 오목 퍼즐 (`omok/learn/`): 연속 4로 이기기 41문제 (2~8수, 열린 4 · 4·4 · 4·3 · 금수 이용) · 상대의 연속 4 막기 23문제. AI끼리 둔 대국 1,800판에서 골라, 렌주 규칙을 따르는 연속 4 풀이기(`omok/learn/vcf.js`)로 정답이 하나인 것만 남겼고, 화면에서도 같은 풀이기로 채점합니다

### 체스 (`chess/`)
- Stockfish 19 Lite (WASM, 1.8MB) 를 Web Worker 로 실행. 규칙은 chess.js
- AI 7단계, 리체스(래피드) 기준 레이팅: 입문 1100 · 초보 1200 · 초급 1400 · 중급 1550 · 고급 1700 · 상급 1900 · 최강 2300+ (Stockfish 를 깊이·온도로 약하게 만든 설정. 리체스 사람 기보로 배운 Maia(1100·1500·1900, 리체스에서 사람과 둔 래피드 1477·1691·1749)와 단계마다 60판씩 대국해 잼. 최강은 Maia 를 모두 압도해 하한만 확인)
- 내 레이팅: Glicko-2 (무르기·힌트를 쓴 대국은 미반영), 온라인 순위표는 레이팅 순
- 눌러서/끌어서 두기, 갈 수 있는 칸·체크 표시, 프로모션, 기보, 대국 후 수마다 승률 분석·실수 찾기
- 체스 퍼즐 (`chess/learn/`): Lichess 퍼즐 데이터베이스(CC0)에서 고른 652개. 내 레이팅에 맞춰 나오는 레이팅 퍼즐 460개(Glicko-2 퍼즐 레이팅, 처음 푼 결과만 반영)와 주제별 퍼즐(1·2·3수 메이트, 포크, 핀·스큐어, 디스커버드 어택, 희생, 엔드게임 각 24개). 모든 수를 chess.js 로 검증했고, 마지막 수는 다른 수라도 체크메이트면 정답

## 구조
- `go/home/`, `omok/home/`, `chess/home/` 게임 홈 (이어 두기 · 새 대국 · 지난 대국 · 학습/퍼즐 · 순위표 · 규칙, `common/hub.js`). 대국 화면의 ‹ 는 게임 홈, 게임 홈의 ‹ 는 첫 화면
- `index.html` 홈 (게임 고르기), `sw.js` 오프라인 캐시, `manifest.webmanifest`
- `ranks/` 바둑 · 오목 · 체스 온라인 순위표를 한곳에서 (홈의 트로피 버튼, 각 게임 순위표의 "모아 보기"). 닉네임은 세 게임 공통
- `records/` 지난 대국: 세 게임의 대국을 한 수마다 이 기기(IndexedDB, `common/records.js`)에 저장. 누르면 각 게임 화면의 복기로 열리고(`#rec=대국id`), 한 판씩 또는 전체를 기보 파일(바둑·오목 SGF, 체스 PGN)로 내려받기
- `rules/` 바둑 · 오목(렌주) · 체스 규칙 설명 (그림 예시, 각 게임 화면의 ? 버튼)
- `go/board.js` 바둑판 규칙 (대국 화면 · AI 워커 · 학습 화면이 함께 씀)
- `common/learn.js`, `common/learn.css` 학습·퍼즐 화면 공통 (문제 목록, 푼 기록, 판 그리기)
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
| [Lichess 퍼즐 데이터베이스](https://database.lichess.org/#puzzles) (`chess/learn/problems.js`, 652개 발췌) | CC0 |
| [Rapfi](https://github.com/dhbloo/rapfi) 오목·렌주 엔진 (`omok/vendor/rapfi/`, 빌드: `tools/rapfi/`) | GPL-3.0 |
| [rapfi-networks](https://github.com/dhbloo/rapfi-networks) 렌주 신경망 mix9svq, 고전 평가 모델 (`omok/vendor/rapfi/`) | CC0 |
| cburnett 체스 말 그림 (`chess/pieces/`, lichess) | GPL-2.0+ |

바둑 엔진의 입력 특징·축 판독·모델 형식은 KataGo의 `nninputs.cpp`, `board.cpp`, `desc.cpp`를 따랐고, 브라우저 구현은 [web-katrain](https://github.com/Sir-Teo/web-katrain)(MIT)을 참고했습니다. 오목은 입문·초급 엔진을 직접 작성했고, 윗단계는 Rapfi 입니다.
