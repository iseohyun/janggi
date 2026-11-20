/**
 * @fileoverview 온라인 대국 설정 (한 곳에서만 고친다).
 *  - JANGGI_ONLINE_BACKEND: "fake"     = 같은 브라우저의 탭끼리 BroadcastChannel로 주고받는 개발용 가짜 백엔드
 *                           "firebase" = 실제 Firebase (Authentication + Firestore)
 *    기본은 "firebase"(localhost 개발 서버와 배포 주소 모두). file:// 로 열었을 때만 "fake".
 *    두 탭으로 가짜 대국을 시험하려면 주소 뒤에 ?backend=fake 를 붙인다.
 *    주소 뒤에 ?backend=fake 또는 ?backend=firebase 를 붙이면 잠깐 바꿔 볼 수 있다 (online-core.js의 olBackendKind).
 *  - JANGGI_FIREBASE_CONFIG: Firebase 웹 앱 설정값. 공개해도 되는 값이고, 데이터 보안은 firestore.rules가 지킨다.
 *    Analytics(measurementId)는 쓰지 않는다 (개인정보 최소화).
 *  - JANGGI_FIREBASE_SDK: Firebase JS SDK 버전(CDN 주소에 그대로 들어간다). 정확한 버전으로 고정한다.
 *  - 데이터는 games/janggi/... 아래에만 쓴다 (같은 Firebase 프로젝트를 다른 게임과 나눠 쓰기 위해).
 * @module firebase-config
 */

var JANGGI_ONLINE_BACKEND = (function () {
  // file://는 Firebase 로그인이 불가능(승인된 도메인 아님)하므로 가짜. localhost는 Firebase 기본 승인 도메인이라 실제 Firebase.
  return window.location.protocol === "file:" ? "fake" : "firebase";
})();

var JANGGI_FIREBASE_SDK = "11.10.0";

var JANGGI_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCJAJVJhg1wA6U3Sdc7HYkoLo6kWO3jSc4",
  authDomain: "any-match-hub.firebaseapp.com",
  projectId: "any-match-hub",
  storageBucket: "any-match-hub.firebasestorage.app",
  messagingSenderId: "803268788694",
  appId: "1:803268788694:web:1f291f1eef5db0ad1d2477"
};

/** Firestore에서 이 게임 데이터의 뿌리 경로 (rooms 컬렉션의 부모 문서) */
var JANGGI_ONLINE_ROOT = "games/janggi";
