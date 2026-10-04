# Table Top

인터넷 없이 두는 AI 보드게임 웹앱입니다. 한 번 열어 두면 오프라인에서도 동작하고, 홈 화면에 추가하면 앱처럼 쓸 수 있습니다 (iPhone · Android · PC).

주소: https://canopus309.github.io/tabletop/

## 게임

### 바둑 (`go/`)
- 브라우저에서 KataGo 신경망을 직접 실행 (WebGPU → WebGL → WASM → CPU 중 결과가 맞는 가장 빠른 것)
- 9 / 13 / 19줄, 접바둑, 덤 설정
- 난이도 5단계: 입문 18급 · 초급 12급 · 중급 5급 · 고급 1단 (KaTrain 급수 보정 방식) · 최강 (b10 기준 5단+, 추정치)
- 신경망 선택: 가벼움 b6 · 표준 b10 (기본) · 강함 b15
- 대국 후 수마다 승률 분석 (승률 그래프, 실수·블런더 찾아가기)
- 내 기력 측정 (최근 10판)과 온라인 순위표: 대국은 오프라인, 결과는 연결될 때 자동으로 올라감
- 힌트, 형세 판단, 자동 계가, 복기, SGF 기보 저장

### 오목 (`omok/`, 렌주 룰)
- 15×15, 흑 첫 수는 천원. 흑은 33 · 44 · 장목 금수 (거짓 3 판정 포함), 백은 제한 없음
- 흑 차례에 금수 자리 표시, 5목 승리선 표시, 복기
- AI 5단계: 패턴 평가 + 알파베타 탐색 + 연속 4 승리 수순(VCF) 탐색. 백일 때는 흑을 금수 자리로 몰아넣는 수도 노림

### 체스 — 준비 중

## 구조
- `index.html` 홈 (게임 고르기), `sw.js` 오프라인 캐시, `manifest.webmanifest`
- `common/` 공통 스타일·대화상자·효과음 (`base.css`, `ui.js`), 온라인 순위표 (`leaderboard.js`: Firebase 익명 로그인 + Firestore, 규칙은 `firestore.rules`)

## 사용한 오픈소스

| 구성 요소 | 라이선스 |
|---|---|
| [KataGo](https://github.com/lightvector/KataGo) g170 신경망 `g170e-b10c128`, `g170e-b15c192` (`go/models/*.bin.gz`) | CC0 |
| [KataGo](https://github.com/lightvector/KataGo) 시험용 신경망 `g170-b6c96-s175395328-d26788732` (`go/models/katago-b6.js`) | MIT (`go/vendor/LICENSE-katago.txt`) |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) 4.22.0 (`go/vendor/`) | Apache-2.0 |
| [KaTrain](https://github.com/sanderland/katrain)의 급수 보정 봇 공식 (`rankNMoves`, `rankMove`) | MIT |

바둑 엔진의 입력 특징·축 판독·모델 형식은 KataGo의 `nninputs.cpp`, `board.cpp`, `desc.cpp`를 따랐고, 브라우저 구현은 [web-katrain](https://github.com/Sir-Teo/web-katrain)(MIT)을 참고했습니다. 오목 엔진은 직접 작성했습니다.
