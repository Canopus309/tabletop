# Rapfi (오목 AI 윗단계)

- 엔진: [Rapfi](https://github.com/dhbloo/rapfi) (GPL-3.0, `LICENSE-rapfi.txt`), 커밋 3c94c2a 를 `tools/rapfi/build.sh` 로 WebAssembly(단일 스레드, SIMD) 빌드.
  바꾼 점은 Emscripten 파일 시스템(FS)을 내보낸 것 하나. 함께 넣은 설정: `tools/rapfi/config-*.toml`.
- 신경망: [rapfi-networks](https://github.com/dhbloo/rapfi-networks) 의 렌주용 mix9svq (`mix9svqrenju_bs15_*.bin.lz4`, CC0, `LICENSE-networks.txt`). 최강 단계를 처음 고를 때 받는다.
- 고전 평가 모델 `model210901.bin` (CC0) 은 `rapfi-single-simd128.data` 안에 들어 있다.
