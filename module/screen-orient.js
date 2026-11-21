/**
 * @fileoverview 모바일 화면 방향: 세로 잠금(기본) · 회전 활성 · 가로 잠금 (왼쪽 레일 맨 끝 버튼, 누를 때마다 순환).
 *  - 배치: 세로 배치 = 양쪽 레일을 합쳐 화면 아래 한 줄(html.rail-bottom), 가로 배치 = PC처럼 양쪽 세로 레일.
 *    세로 잠금이면 늘 세로 배치, 가로 잠금이면 늘 가로 배치, 회전 활성이면 기기 방향을 따른다.
 *  - 잠금을 고르면(버튼을 누른 순간 = 사용자 동작) 전체 화면으로 바꾸고 screen.orientation.lock을 시도한다.
 *    브라우저가 거부하면(iOS Safari, 데스크톱 등) 실제 화면 회전은 그대로 두고 고른 배치만 지킨다.
 *    페이지를 새로 열 때는 사용자 동작이 없어 잠글 수 없으므로 배치만 지킨다.
 *  - 모바일 판단(html.orient-device): 터치 위주 기기이면서 화면 짧은 변이 600px 이하(휴대폰), 또는 창 폭 849px 이하.
 *    모바일이 아니면 버튼을 감추고 늘 PC 배치. 모바일에서는 서랍을 한 번에 하나만 연다(drawers.js).
 *  - 판과 대국 헤더는 모바일에서 화면 위쪽에 붙인다(css/drawer.css).
 * 공개: screenOrientMode, screenOrientBottom(), screenOrientIsDevice(), cycleScreenOrient()
 * @module screen-orient
 * @depends drawers (applyDrawerLayout, DRAWER_TABS), ui (showToast)
 */

const SCREEN_ORIENT_KEY = "screenOrientMode";
const SCREEN_ORIENT_MODES = ["portrait", "auto", "landscape"]; // 누를 때마다 이 순서로
const SCREEN_ORIENT_LABEL = { portrait: "세로 잠금", auto: "회전 활성", landscape: "가로 잠금" };
const SCREEN_ORIENT_ICON = { portrait: "i-orient-portrait", auto: "i-orient-auto", landscape: "i-orient-landscape" };

var screenOrientMode = (function () {
  try {
    const v = localStorage.getItem(SCREEN_ORIENT_KEY);
    return SCREEN_ORIENT_MODES.includes(v) ? v : "portrait";
  } catch (e) {
    return "portrait";
  }
})();
let screenOrientFullscreenByUs = false; // 잠그려고 이 파일이 전체 화면을 켰는지

/** 휴대폰처럼 다룰 화면인지 */
function screenOrientIsDevice() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const phone = coarse && Math.min(window.screen.width, window.screen.height) <= 600;
  return phone || window.matchMedia("(max-width: 849px)").matches;
}

/** 지금 레일을 아래 한 줄로 합칠지 (세로 배치) */
function screenOrientBottom() {
  if (!screenOrientIsDevice()) return false;
  if (screenOrientMode === "portrait") return true;
  if (screenOrientMode === "landscape") return false;
  return window.matchMedia("(orientation: portrait)").matches;
}

/** 아래 한 줄 레일에서 왼쪽·오른쪽 레일 몫을 아이콘 수에 맞춘다 (간격이 고르게) */
function screenOrientRailShare() {
  const l = document.querySelectorAll("#left-rail .rail-btn").length;
  const r = document.querySelectorAll("#right-rail .rail-btn").length;
  const share = l + r > 0 ? (l / (l + r)) * 100 : 50;
  document.documentElement.style.setProperty("--rail-left-share", `${share.toFixed(3)}%`);
}

function screenOrientSyncButton() {
  const btn = document.getElementById("orient-btn");
  if (!btn) return;
  const label = SCREEN_ORIENT_LABEL[screenOrientMode];
  const next = SCREEN_ORIENT_LABEL[SCREEN_ORIENT_MODES[(SCREEN_ORIENT_MODES.indexOf(screenOrientMode) + 1) % SCREEN_ORIENT_MODES.length]];
  btn.title = `화면 방향: ${label} (누르면 ${next})`;
  btn.setAttribute("aria-label", `화면 방향: ${label}`);
  btn.dataset.mode = screenOrientMode;
  const use = btn.querySelector("use");
  if (use) use.setAttribute("href", `#${SCREEN_ORIENT_ICON[screenOrientMode]}`);
}

/** 배치 클래스를 맞추고, 바뀌었으면 서랍·판 자리를 다시 계산한다 */
function screenOrientApply() {
  const root = document.documentElement;
  const device = screenOrientIsDevice();
  const bottom = screenOrientBottom();
  const changed = root.classList.contains("rail-bottom") !== bottom || root.classList.contains("orient-device") !== device;
  root.classList.toggle("orient-device", device);
  root.classList.toggle("rail-bottom", bottom);
  root.dataset.orient = screenOrientMode;
  screenOrientRailShare();
  screenOrientSyncButton();
  if (changed && typeof applyDrawerLayout === "function" && typeof drawerReady !== "undefined" && drawerReady) {
    applyDrawerLayout();
    window.dispatchEvent(new Event("resize")); // 판을 새 자리에 다시 그린다
  }
}

/** 실제 화면 회전 잠금을 시도한다 (버튼을 누른 순간에만 가능). 되면 true */
async function screenOrientTryLock(mode) {
  const so = window.screen.orientation;
  if (!window.matchMedia("(pointer: coarse)").matches || !so) return false;
  if (mode === "auto") {
    try {
      if (typeof so.unlock === "function") so.unlock();
    } catch (e) {
      // 잠근 적이 없음
    }
    if (screenOrientFullscreenByUs && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    screenOrientFullscreenByUs = false;
    return true;
  }
  if (typeof so.lock !== "function") return false;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      screenOrientFullscreenByUs = true;
    }
    await so.lock(mode === "portrait" ? "portrait" : "landscape");
    return true;
  } catch (e) {
    return false;
  }
}

/** 왼쪽 레일 버튼: 세로 잠금 → 회전 활성 → 가로 잠금 → 세로 잠금 */
async function cycleScreenOrient() {
  const i = SCREEN_ORIENT_MODES.indexOf(screenOrientMode);
  screenOrientMode = SCREEN_ORIENT_MODES[(i + 1) % SCREEN_ORIENT_MODES.length];
  try {
    localStorage.setItem(SCREEN_ORIENT_KEY, screenOrientMode);
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  screenOrientApply();
  const locked = await screenOrientTryLock(screenOrientMode);
  const label = SCREEN_ORIENT_LABEL[screenOrientMode];
  let msg = label;
  if (screenOrientMode === "auto") msg = "회전 활성: 기기 방향에 따라 세로는 아래 레일, 가로는 양쪽 레일";
  else if (!locked) msg = `${label}: 이 브라우저는 화면 회전을 잠글 수 없어 ${screenOrientMode === "portrait" ? "세로" : "가로"} 배치만 유지합니다`;
  if (typeof showToast === "function") showToast(msg, 2600);
  screenOrientApply();
}

window.cycleScreenOrient = cycleScreenOrient;

// 판을 처음 그리기(main.js·board.js) 전에 배치 클래스를 단다 (모바일이면 헤더를 위에 붙이고 판 크기를 계산)
screenOrientApply();

// 레일 버튼과 아이콘 (index.html을 고치지 않고 여기서 붙인다)
(function screenOrientBuild() {
  const sprite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sprite.setAttribute("aria-hidden", "true");
  sprite.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  sprite.innerHTML = `
    <symbol id="i-orient-portrait" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><rect x="9.5" y="8.5" width="5" height="4" rx="1"/><path d="M10.5 8.5V7a1.5 1.5 0 0 1 3 0v1.5"/></symbol>
    <symbol id="i-orient-landscape" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M18 11v2"/><rect x="9.5" y="10.5" width="5" height="4" rx="1"/><path d="M10.5 10.5V9a1.5 1.5 0 0 1 3 0v1.5"/></symbol>
    <symbol id="i-orient-auto" viewBox="0 0 24 24"><rect x="8" y="5" width="8" height="14" rx="1.5"/><path d="M3 9a9 9 0 0 1 4-5.5M3 9V5M3 9h4"/><path d="M21 15a9 9 0 0 1-4 5.5M21 15v4M21 15h-4"/></symbol>`;
  document.body.appendChild(sprite);
})();

document.addEventListener("DOMContentLoaded", () => {
  const rail = document.getElementById("left-rail");
  if (rail && !document.getElementById("orient-btn")) {
    const b = document.createElement("button");
    b.id = "orient-btn";
    b.type = "button";
    b.className = "rail-btn rail-orient-btn";
    b.dataset.action = "cycleScreenOrient";
    b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-orient-portrait"/></svg>';
    rail.appendChild(b);
  }
  screenOrientApply();
  // 레일 아이콘은 다른 파일(online-ui.js 등)도 붙이므로 한 번 더 몫을 맞춘다
  setTimeout(screenOrientRailShare, 0);
  window.addEventListener("resize", screenOrientApply);
  window.addEventListener("orientationchange", () => setTimeout(screenOrientApply, 150));
  const pm = window.matchMedia("(orientation: portrait)");
  if (pm.addEventListener) pm.addEventListener("change", screenOrientApply);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) screenOrientFullscreenByUs = false;
  });
});
