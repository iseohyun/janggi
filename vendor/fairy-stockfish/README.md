# Fairy-Stockfish (WASM)

- 출처: npm `fairy-stockfish-nnue.wasm@1.1.12` (https://github.com/fairy-stockfish/fairy-stockfish.wasm)
- 라이선스: GPL-3.0 (`Copying.txt`), 저작자 `AUTHORS`
- 엔진 소스: https://github.com/fairy-stockfish/Fairy-Stockfish
- 이 폴더의 파일은 고치지 않은 원본이다. 웹장기는 Web Worker로 띄운 엔진과 UCI 텍스트로만 주고받는다 (`module/engine-fsf.js`).
- 여러 스레드(SharedArrayBuffer)를 쓰므로 페이지가 교차 출처 격리 상태여야 한다:
  `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`(또는 `require-corp`).
  로컬 확인은 `node tools/dev-server.mjs 5188`.
