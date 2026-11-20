/**
 * @fileoverview 교차 출처 격리용 서비스워커.
 * 호스팅 서버가 COOP/COEP 헤더를 보내지 못해도, 이 서비스워커가 응답에 헤더를 덧붙여
 * 페이지를 crossOriginIsolated 상태로 만든다. 그래야 Fairy-Stockfish(여러 스레드 WASM)가
 * SharedArrayBuffer를 쓸 수 있다. 등록은 module/coi-register.js가 맡는다.
 * 페이지와 같은 폴더에 있어야 index.html을 다스릴 수 있다(서비스워커 범위 = 이 파일의 폴더).
 *
 * COEP 값은 등록 주소의 ?coep= 로 받는다.
 *  - credentialless: 구글 글꼴·gtag 같은 외부 자원을 쿠키 없이 그대로 불러온다 (Chrome·Edge·Firefox).
 *  - require-corp  : credentialless를 모르는 브라우저용. CORP 헤더 없는 외부 자원은 막힐 수 있다.
 */

const COI_COEP = new URL(self.location.href).searchParams.get("coep") === "require-corp"
  ? "require-corp"
  : "credentialless";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const request = event.request;
  // 개발자 도구가 보내는 특수 요청은 건드리지 않는다
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  // 온라인 대국 Google 로그인 도우미 창은 격리하지 않는다 (COOP: same-origin이면 Google 팝업과 이야기할 수 없음)
  if (request.mode === "navigate" && new URL(request.url).pathname.endsWith("/online-auth.html")) return;

  // credentialless: 외부 no-cors 요청은 쿠키 없이 보낸다
  const outgoing = (COI_COEP === "credentialless" && request.mode === "no-cors")
    ? new Request(request, { credentials: "omit" })
    : request;

  event.respondWith(
    fetch(outgoing)
      .then(response => {
        if (response.status === 0) return response; // 불투명 응답은 헤더를 고칠 수 없다
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", COI_COEP);
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        if (!headers.has("Cross-Origin-Resource-Policy")) headers.set("Cross-Origin-Resource-Policy", "cross-origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      })
      .catch(err => {
        console.error("[coi-sw] 요청 실패:", request.url, err);
        return Response.error();
      })
  );
});
