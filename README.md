# 바둑 AI

오프라인에서 동작하는 인공지능 바둑 웹앱입니다. 브라우저에서 KataGo 신경망을 직접 실행하며, 홈 화면에 추가하면 인터넷 없이 쓸 수 있습니다 (iPhone · Android · PC).

- 9 / 13 / 19줄, 접바둑, 덤 설정
- 난이도 5단계: 입문 18급 · 초급 12급 · 중급 5급 · 고급 1단 (KaTrain 급수 보정 방식) · 최강 (b10 기준 5단+, 추정치)
- 신경망 선택: 가벼움 b6 · 표준 b10 (기본) · 강함 b15
- 대국 후 수마다 승률 분석: 승률 그래프, 수별 손익, 내 실수 찾아가기
- 내 기력 측정 (최근 10판) 과 온라인 순위표: 대국은 오프라인, 결과는 연결될 때 자동으로 올라감 (Firebase 익명 로그인 + Firestore, 규칙은 `firestore.rules`)
- 힌트, 형세 판단, 자동 계가, 복기, SGF 기보 저장

## 사용한 오픈소스

| 구성 요소 | 라이선스 |
|---|---|
| [KataGo](https://github.com/lightvector/KataGo) g170 신경망 `g170e-b10c128`, `g170e-b15c192` (`models/*.bin.gz`) | CC0 |
| [KataGo](https://github.com/lightvector/KataGo) 시험용 신경망 `g170-b6c96-s175395328-d26788732` (`models/katago-b6.js`) | MIT (`vendor/LICENSE-katago.txt`) |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) 4.22.0 (`vendor/`) | Apache-2.0 |
| [KaTrain](https://github.com/sanderland/katrain)의 급수 보정 봇 공식 (`rankNMoves`, `rankMove`) | MIT |

입력 특징·축 판독·모델 형식은 KataGo의 `nninputs.cpp`, `board.cpp`, `desc.cpp`를 따랐고, 브라우저 구현은 [web-katrain](https://github.com/Sir-Teo/web-katrain)(MIT)을 참고했습니다.
