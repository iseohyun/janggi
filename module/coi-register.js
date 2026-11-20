/**
 * @fileoverview 교차 출처 격리용 서비스워커(coi-sw.js) 등록.
 * 페이지가 아직 crossOriginIsolated가 아니면 서비스워커를 등록하고, 서비스워커가 페이지를 맡으면
 * 한 번만 새로고침한다. 그 뒤로는 서비스워커가 COOP/COEP 헤더를 붙여 주므로 Fairy-Stockfish를 쓸 수 있다.
 * 다른 스크립트보다 먼저 읽도록 index.html <head>에서 defer 없이 부른다.
 * 새로고침은 한 탭 세션에 한 번만 시도한다 (격리가 안 되는 환경에서 무한 새로고침 방지).
 * @module coi-register
 */
(function () {
  if (window.crossOriginIsolated) return;
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;

  const TRIED_KEY = "coiReloadTried";
  // Chrome 계열만 credentialless를 확실히 지원한다
  const coep = window.chrome ? "credentialless" : "require-corp";
  const swUrl = new URL(`coi-sw.js?coep=${coep}`, document.baseURI);

  function reloadOnce() {
    let tried = null;
    try {
      tried = sessionStorage.getItem(TRIED_KEY);
      sessionStorage.setItem(TRIED_KEY, "1");
    } catch (e) {
      tried = null;
    }
    if (tried) return; // 이미 한 번 해 봤는데도 격리가 안 됨 → 내장 엔진으로
    window.location.reload();
  }

  navigator.serviceWorker.register(swUrl).then(() => {
    if (navigator.serviceWorker.controller) reloadOnce();
    else navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
  }).catch(err => {
    console.warn("[coi-register] 서비스워커 등록 실패, 내장 엔진으로 둡니다:", err);
  });
})();
