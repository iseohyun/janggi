/**
 * @fileoverview 앱 버전 정보 (이원화 버전 관리).
 *  - APP_VERSION: 정식 시맨틱 버전. 사용자 승인을 받은 경우에만 올린다.
 *  - BUILD_TAG  : 캐시 버스팅 태그(YYYYMMDDvN). JS·CSS를 고칠 때마다 올리고,
 *                 index.html의 모든 ?v= 값도 같은 태그로 맞춘다. (.agents/rules/project_architecture.md)
 * @module version
 */

const APP_VERSION = "2.0.0";
const BUILD_TAG = "20261120v46";

document.addEventListener("DOMContentLoaded", () => {
  const label = document.getElementById("app-version-label");
  if (label) label.textContent = `웹장기 v${APP_VERSION} (${BUILD_TAG})`;
});
