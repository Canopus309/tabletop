#!/bin/bash
# 오목 AI 엔진 Rapfi(GPL-3.0, github.com/dhbloo/rapfi)를 웹(WebAssembly)용으로 빌드한다.
# GitHub Actions(.github/workflows/rapfi-wasm.yml)에서 Emscripten 을 켠 뒤 실행.
# 바꾼 점: 페이지에서 신경망 파일을 나중에 넣을 수 있게 Emscripten 파일 시스템(FS)을 내보낸다.
# 결과: out/rapfi-single-simd128.{js,wasm,data} (SIMD), out/rapfi-single.{js,wasm,data} (SIMD 없는 기기용)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${GITHUB_WORKSPACE:-$PWD}/out"
RAPFI_REF=3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7
NETS=https://raw.githubusercontent.com/dhbloo/rapfi-networks/main

git clone https://github.com/dhbloo/rapfi.git rapfi
cd rapfi && git checkout -q "$RAPFI_REF"

# 함께 넣는 파일: 고전 평가 설정(기본), 신경망 설정, 고전 평가 모델 (신경망 가중치는 페이지가 따로 받는다)
mkdir -p Networks/classical
curl -sSfL -o Networks/classical/model210901.bin "$NETS/classical/model210901.bin"
cp "$HERE/config-classical.toml" "$HERE/config-nnue.toml" "$HERE/wasm_preloads.txt" Networks/

sed -i "s/EXPORTED_RUNTIME_METHODS=\\\\\"\['cwrap'\]\\\\\"/EXPORTED_RUNTIME_METHODS=\\\\\"['cwrap','FS']\\\\\"/" Rapfi/CMakeLists.txt
grep -q "'cwrap','FS'" Rapfi/CMakeLists.txt

mkdir -p "$OUT"
for SIMD in ON OFF; do
  B="Rapfi/build/simd-$SIMD"
  emcmake cmake -S Rapfi -B "$B" -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON \
    -DUSE_WASM_SIMD=$SIMD -DUSE_WASM_SIMD_RELAXED=OFF -DNO_MULTI_THREADING=ON
  cmake --build "$B" -j4
  cp "$B"/rapfi-single*.js "$B"/rapfi-single*.wasm "$B"/rapfi-single*.data "$OUT/"
done
ls -la "$OUT"
