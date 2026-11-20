/**
 * @fileoverview 양쪽 서랍과 레일.
 *  - 왼쪽 서랍 = 기보 (#preview-panel). 여닫기 상태는 preview.js의 openRecordView/closeRecordView가 맡는다.
 *  - 오른쪽 서랍 = 대국·설정 (#setting-box). 여닫기 상태는 settings.js의 showSettingsPanel/hideSettingsPanel이 맡는다.
 *    두 서랍 모두 hidden 속성으로 닫힘을 나타내고, css/drawer.css가 밀어 넣고 빼는 애니메이션을 그린다.
 *  - 레일(#left-rail, #right-rail): 늘 보이는 아이콘 줄. 아이콘 하나 = 서랍의 영역 하나(탭).
 *    다른 아이콘을 누르면 스크롤하지 않고, 지난 영역이 접히고 새 영역이 펼쳐진다 (drawerShowTab).
 *    고정 여부와 서랍 크기는 아이콘(영역)마다 따로 기억한다 (localStorage "drawerPin_<영역 id>",
 *    "drawerWidth_<영역 id>", 모바일 높이 "drawerHeight_<영역 id>").
 *    데스크톱은 화면 왼쪽·오른쪽 끝의 세로 줄, 모바일(849px 이하)은 화면 아래의 가로 줄(왼쪽 반·오른쪽 반).
 *  - 고정(핀): 고정한 서랍은 판을 덮지 않고 판 자리를 줄인다. 고정하지 않은 서랍은 반투명하게 판 위에 덮인다.
 *  - 크기 조절: 서랍 안쪽 가장자리(모바일은 위 가장자리)의 손잡이를 끈다. 크기·고정은 localStorage에 남는다.
 *  - 1200px 이상에서는 처음 열 때 두 서랍을 펼쳐 둔다.
 * 공개 함수: isDrawerPinned(side), isLeftDrawerOpen(), isRightDrawerOpen(), toggleLeftDrawer(), toggleRightDrawer(),
 *           closeLeftDrawer(), closeRightDrawer(), toggleDrawerPin(side), jumpToDrawerSection(sectionId),
 *           syncDrawerButtons(), applyDrawerLayout()
 * @module drawers
 * @depends preview, settings, ui, keyboard
 */

const DRAWER_MOBILE_QUERY = "(max-width: 849px)";
const DRAWER_WIDE_QUERY = "(min-width: 1200px)";
const DRAWER_RAIL = 48; // 레일 두께 (css/drawer.css --rail-size와 같게)
const DRAWER_DEFAULT_W = 320;
const DRAWER_MIN_W = 240;
const DRAWER_MAX_W = 640;
const DRAWER_MIN_H = 140;
const DRAWER_ANIM_MS = 280;

// 서랍마다 영역(탭) 목록. 레일 아이콘 순서와 같다
const DRAWER_TABS = {
  left: ["lv-sec-tree", "metadata-category", "lv-sec-saved"],
  right: ["rd-sec-newgame", "rd-sec-ai", "board-view-category", "settings-category", "rd-sec-shortcut"]
};
const DRAWER_TAB_ANIM_MS = 260;
// 왼쪽 서랍 머리 제목 (영역마다). 수순 이동 버튼·대회명·그림 저장은 "현재 기보"에서만 보인다 (css/drawer.css .lv-tree-only)
const DRAWER_TAB_TITLES = {
  "lv-sec-tree": "현재 기보",
  "metadata-category": "기보 정보",
  "lv-sec-saved": "저장된 기보",
  // 오른쪽 서랍: 영역의 초기화·슬롯·복사 버튼도 서랍 머리에 (css/drawer.css .rd-tab-actions)
  "rd-sec-newgame": "새 대국",
  "rd-sec-ai": "AI",
  "board-view-category": "그래픽",
  "settings-category": "인터페이스",
  "rd-sec-shortcut": "단축키"
};

// 아이콘 하나가 영역 여러 개를 함께 보여 주는 경우 (지금은 없음: 추천수는 오른쪽 서랍 "AI" 영역으로 옮김)
const DRAWER_TAB_SECTIONS = {};

/** 아이콘(영역 id)이 보여 주는 영역 id 목록 */
function drawerTabSections(id) {
  return DRAWER_TAB_SECTIONS[id] || [id];
}

const drawerActiveTab = { left: DRAWER_TABS.left[0], right: DRAWER_TABS.right[0] };
const drawerTabPins = {}; // 영역 id → 고정 여부 (없으면 고정)
const drawerPins = { left: true, right: true }; // 지금 보이는 영역의 고정 여부
const drawerWidths = { left: DRAWER_DEFAULT_W, right: DRAWER_DEFAULT_W }; // 지금 보이는 영역의 서랍 폭
const drawerHeights = { left: 0, right: 0 }; // 지금 보이는 영역의 모바일 높이 (0이면 화면의 45%)
const drawerTabWidths = {}; // 영역 id → 서랍 폭 (없으면 서랍 기본값)
const drawerTabHeights = {}; // 영역 id → 모바일 높이
const drawerSideDefaultW = { left: DRAWER_DEFAULT_W, right: DRAWER_DEFAULT_W }; // 예전 판에서 서랍마다 저장한 폭
const drawerSideDefaultH = { left: 0, right: 0 };
let drawerForcing = false; // 사용자가 직접 닫는 중이면 고정된 서랍도 닫는다
let drawerLayoutTimer = null;
let drawerWinResizeTimer = null;
let drawerReady = false; // DOMContentLoaded 뒤에만 배치를 계산한다
let drawerReadyToAnimate = false; // 첫 배치는 바로
let drawerLastOpen = null;
let drawerAnimTimer = null;

function drawerIsMobile() {
  return window.matchMedia(DRAWER_MOBILE_QUERY).matches;
}

function drawerEl(side) {
  return document.getElementById(side === "left" ? "preview-panel" : "setting-box");
}

/**
 * 서랍이 고정되어 있는지. 고정된 서랍은 새 대국·ESC 같은 자동 닫기에 닫히지 않는다.
 * @param {"left"|"right"} [side] - 없으면 둘 중 하나라도
 */
function isDrawerPinned(side) {
  if (drawerForcing) return false;
  if (!side) return drawerPins.left || drawerPins.right;
  return !!drawerPins[side];
}

function isLeftDrawerOpen() {
  return typeof isRecordViewOpen === "function" && isRecordViewOpen();
}

function isRightDrawerOpen() {
  const box = drawerEl("right");
  return !!box && !box.hidden;
}

function drawerOpen(side) {
  if (side === "left") {
    if (typeof openRecordView === "function") openRecordView();
  } else {
    showSettingsPanel();
  }
}

/** 사용자가 직접 닫기: 고정되어 있어도 닫는다 */
function drawerClose(side) {
  drawerForcing = true;
  try {
    if (side === "left") {
      if (typeof closeRecordView === "function") closeRecordView();
    } else {
      hideSettingsPanel();
    }
  } finally {
    drawerForcing = false;
  }
  syncDrawerButtons();
}

/** 헤더 왼쪽 버튼 */
function toggleLeftDrawer() {
  if (isLeftDrawerOpen()) drawerClose("left");
  else drawerOpen("left");
}

/** 헤더 오른쪽 버튼 */
function toggleRightDrawer() {
  if (isRightDrawerOpen()) drawerClose("right");
  else drawerOpen("right");
}

function closeLeftDrawer() {
  drawerClose("left");
}

function closeRightDrawer() {
  drawerClose("right");
}

function drawerTabPinned(id) {
  return drawerTabPins[id] !== false;
}

function drawerSideOf(id) {
  if (DRAWER_TABS.left.includes(id)) return "left";
  if (DRAWER_TABS.right.includes(id)) return "right";
  return null;
}

/** 서랍 머리의 고정 아이콘: 지금 보이는 영역(레일 아이콘)의 고정 여부를 바꾼다 */
function toggleDrawerPin(side) {
  if (side !== "left" && side !== "right") return;
  const id = drawerActiveTab[side];
  drawerTabPins[id] = !drawerTabPinned(id);
  drawerPins[side] = drawerTabPins[id];
  try {
    localStorage.setItem(`drawerPin_${id}`, drawerTabPins[id] ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  applyDrawerLayout();
}

// ===== 영역(탭) =====

function drawerScroller(side) {
  const drawer = drawerEl(side);
  if (!drawer) return null;
  return drawer.querySelector(side === "left" ? ".preview-panel-body" : ".settings-scroll-area");
}

/** 영역 하나를 접거나 펼치는 애니메이션 (높이·여백·투명도) */
function drawerAnimateSection(sec, open) {
  const cs = getComputedStyle(sec);
  const full = {
    height: `${sec.offsetHeight}px`,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    marginBottom: cs.marginBottom,
    opacity: 1
  };
  const zero = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginBottom: "0px", opacity: 0 };
  sec.style.overflow = "hidden";
  sec.style.boxSizing = "border-box";
  const anim = sec.animate(open ? [zero, full] : [full, zero], {
    duration: DRAWER_TAB_ANIM_MS,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)"
  });
  const done = () => {
    sec.style.overflow = "";
    sec.style.boxSizing = "";
    const side = drawerSideOf(sec.id);
    if (!open && side && !drawerTabSections(drawerActiveTab[side]).includes(sec.id)) sec.classList.add("tab-off");
  };
  anim.onfinish = done;
  anim.oncancel = done;
}

/**
 * 서랍에 영역 하나만 보여 줍니다. 지난 영역은 접히고 새 영역은 펼쳐진다.
 * @param {"left"|"right"} side
 * @param {string} id - 영역 id
 * @param {boolean} animate
 */
function drawerShowTab(side, id, animate) {
  if (!DRAWER_TABS[side] || !DRAWER_TABS[side].includes(id)) return;
  const prevId = drawerActiveTab[side];
  drawerActiveTab[side] = id;
  drawerPins[side] = drawerTabPinned(id);
  const drawerBox = drawerEl(side);
  if (drawerBox) drawerBox.dataset.tab = id;
  const titleEl = document.getElementById(side === "left" ? "lv-drawer-title" : "rd-drawer-title");
  if (titleEl && DRAWER_TAB_TITLES[id]) titleEl.textContent = DRAWER_TAB_TITLES[id];
  // 아이콘마다 기억한 서랍 크기 (css/drawer.css가 폭·높이 변화를 애니메이션)
  drawerWidths[side] = drawerTabWidths[id] || drawerSideDefaultW[side];
  drawerHeights[side] = drawerTabHeights[id] || drawerSideDefaultH[side];
  try {
    localStorage.setItem(`drawerTab_${side}`, id);
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  const nextIds = drawerTabSections(id);
  const prevIds = prevId !== id ? drawerTabSections(prevId) : nextIds;
  const byId = x => document.getElementById(x);
  // 지금 보이는 것 중 새 아이콘에 없는 영역 = 접을 것, 새 아이콘에서 새로 보일 영역 = 펼칠 것
  const leaving = prevIds.filter(x => !nextIds.includes(x)).map(byId).filter(sec => sec && !sec.classList.contains("tab-off"));
  const entering = nextIds.filter(x => !prevIds.includes(x) || prevId === id).map(byId).filter(Boolean);
  nextIds.map(byId).filter(Boolean).forEach(drawerExpandSection);
  DRAWER_TABS[side].forEach(x => {
    if (nextIds.includes(x)) return;
    const sec = byId(x);
    if (sec && !leaving.includes(sec)) sec.classList.add("tab-off");
  });
  const enteringHidden = entering.filter(sec => sec.classList.contains("tab-off"));
  nextIds.map(byId).filter(Boolean).forEach(sec => sec.classList.remove("tab-off"));
  const scroller = drawerScroller(side);
  if (animate && drawerReadyToAnimate && typeof document.body.animate === "function") {
    if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
    leaving.forEach(sec => drawerAnimateSection(sec, false));
    enteringHidden.forEach(sec => drawerAnimateSection(sec, true));
  } else {
    leaving.forEach(sec => sec.classList.add("tab-off"));
    if (scroller) scroller.scrollTop = 0;
  }

  // 레일 아이콘 현재 영역 표시
  const rail = document.getElementById(side === "left" ? "left-rail" : "right-rail");
  if (rail) {
    rail.querySelectorAll(".rail-btn").forEach(btn => {
      const on = btn.dataset.value === id;
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    });
  }
  if (drawerReady) applyDrawerLayout(); // 영역마다 고정 여부가 다르면 판 자리도 바뀐다
  drawerRefreshTree(side);
}

/** 변화도는 서랍 폭에 맞춰 크기를 정하므로, 보이게 되거나 서랍 폭이 바뀌면 다시 그린다 (variation-tree.js) */
function drawerRefreshTree(side) {
  if (side !== "left" || typeof pvRefresh !== "function") return;
  setTimeout(pvRefresh, DRAWER_ANIM_MS + 20);
}

// ===== 배치 =====

function drawerClampWidth(w) {
  const max = Math.max(DRAWER_MIN_W, Math.min(DRAWER_MAX_W, window.innerWidth - DRAWER_RAIL * 2 - 160));
  return Math.round(Math.min(max, Math.max(DRAWER_MIN_W, w)));
}

function drawerClampHeight(h) {
  const max = Math.max(DRAWER_MIN_H, window.innerHeight - DRAWER_RAIL - 80);
  const want = h > 0 ? h : window.innerHeight * 0.45;
  return Math.round(Math.min(max, Math.max(DRAWER_MIN_H, want)));
}

/**
 * 서랍 크기·고정 상태를 CSS 변수로 넘기고, 고정된 서랍만큼 판 자리를 줄입니다.
 * (판 크기는 #janggi-app 크기로 계산된다: board.js initBoard)
 */
function applyDrawerLayout() {
  const root = document.documentElement;
  const mobile = drawerIsMobile();
  const leftOpen = isLeftDrawerOpen();
  const rightOpen = isRightDrawerOpen();
  const wL = drawerClampWidth(drawerWidths.left);
  const wR = drawerClampWidth(drawerWidths.right);
  const hL = drawerClampHeight(drawerHeights.left);
  const hR = drawerClampHeight(drawerHeights.right);
  root.style.setProperty("--left-drawer-w", `${wL}px`);
  root.style.setProperty("--right-drawer-w", `${wR}px`);
  root.style.setProperty("--left-drawer-h", `${hL}px`);
  root.style.setProperty("--right-drawer-h", `${hR}px`);

  // 서랍이 움직이는 동안에는 흐림 효과를 끄고(css/drawer.css), 판 자리는 애니메이션이 끝난 뒤 바꾼다
  const opening = { left: leftOpen, right: rightOpen };
  const moved = drawerLastOpen && (drawerLastOpen.left !== opening.left || drawerLastOpen.right !== opening.right);
  drawerLastOpen = opening;
  if (moved) {
    root.classList.add("drawer-animating");
    clearTimeout(drawerAnimTimer);
    drawerAnimTimer = setTimeout(() => root.classList.remove("drawer-animating"), DRAWER_ANIM_MS + 40);
  }

  let boardLeft = 0;
  let boardRight = 0;
  let boardBottom = 0;
  if (mobile) {
    const pushed = Math.max(
      leftOpen && drawerPins.left ? hL : 0,
      rightOpen && drawerPins.right ? hR : 0
    );
    boardBottom = DRAWER_RAIL + pushed;
  } else {
    boardLeft = DRAWER_RAIL + (leftOpen && drawerPins.left ? wL : 0);
    boardRight = DRAWER_RAIL + (rightOpen && drawerPins.right ? wR : 0);
  }

  ["left", "right"].forEach(side => {
    root.classList.toggle(`${side}-drawer-pinned`, drawerPins[side]);
    const el = drawerEl(side);
    if (el) el.classList.toggle("pinned", drawerPins[side]);
  });
  document.querySelectorAll(".drawer-pin-btn").forEach(btn => {
    const on = !!drawerPins[btn.dataset.value];
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "고정됨: 판을 덮지 않습니다 (누르면 풀기)" : "고정 안 됨: 판 위에 덮입니다 (누르면 고정)";
  });
  syncDrawerButtons(true);

  const setBoard = () => {
    const changed = root.style.getPropertyValue("--board-left") !== `${boardLeft}px` ||
      root.style.getPropertyValue("--board-right") !== `${boardRight}px` ||
      root.style.getPropertyValue("--board-bottom") !== `${boardBottom}px`;
    if (!changed) return;
    root.style.setProperty("--board-left", `${boardLeft}px`);
    root.style.setProperty("--board-right", `${boardRight}px`);
    root.style.setProperty("--board-bottom", `${boardBottom}px`);
    window.dispatchEvent(new Event("resize")); // main.js가 판을 새 자리에 다시 그린다
  };
  clearTimeout(drawerLayoutTimer);
  if (moved && drawerReadyToAnimate) drawerLayoutTimer = setTimeout(setBoard, DRAWER_ANIM_MS + 20);
  else setBoard();
}

/** 헤더 서랍 버튼의 눌림 상태를 서랍 상태에 맞춥니다. (preview.js·settings.js가 여닫을 때 부름) */
function syncDrawerButtons(fromLayout) {
  const pairs = [["left-drawer-btn", isLeftDrawerOpen()], ["right-drawer-btn", isRightDrawerOpen()]];
  pairs.forEach(([id, open]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("active", open);
    btn.setAttribute("aria-pressed", open ? "true" : "false");
  });
  document.documentElement.classList.toggle("left-drawer-open", isLeftDrawerOpen());
  document.documentElement.classList.toggle("right-drawer-open", isRightDrawerOpen());
  if (!fromLayout && drawerReady) applyDrawerLayout();
}

// ===== 레일 바로가기 =====

/** 접힌 아코디언 영역이면 펼칩니다. */
function drawerExpandSection(sec) {
  if (!sec.classList.contains("collapsed")) return;
  if (sec.id === "metadata-category" && typeof toggleMetadataCategory === "function") {
    toggleMetadataCategory(null);
  } else if (typeof toggleSettingCategory === "function") {
    toggleSettingCategory(sec.id);
  }
}

/**
 * 레일 아이콘: 서랍을 열고 그 영역을 보여 줍니다 (스크롤하지 않고 영역을 바꾼다).
 * @param {string} sectionId - 서랍 안 영역의 id
 */
function jumpToDrawerSection(sectionId) {
  const side = drawerSideOf(sectionId);
  if (!side) return;
  const wasOpen = side === "left" ? isLeftDrawerOpen() : isRightDrawerOpen();
  // 서랍이 닫혀 있으면 영역을 먼저 바꾸고(애니메이션 없이) 서랍이 밀려 나온다
  drawerShowTab(side, sectionId, wasOpen);
  if (!wasOpen) drawerOpen(side);
}

// ===== 크기 조절 손잡이 =====

function drawerStartResize(handle, ev) {
  const side = handle.dataset.side;
  const drawer = drawerEl(side);
  if (!drawer) return;
  ev.preventDefault();
  const mobile = drawerIsMobile();
  handle.setPointerCapture(ev.pointerId);
  document.documentElement.classList.add("drawer-resizing");
  const onMove = e => {
    if (mobile) {
      drawerHeights[side] = drawerClampHeight(window.innerHeight - DRAWER_RAIL - e.clientY);
      document.documentElement.style.setProperty(`--${side}-drawer-h`, `${drawerHeights[side]}px`);
    } else {
      const w = side === "left" ? e.clientX - DRAWER_RAIL : window.innerWidth - DRAWER_RAIL - e.clientX;
      drawerWidths[side] = drawerClampWidth(w);
      document.documentElement.style.setProperty(`--${side}-drawer-w`, `${drawerWidths[side]}px`);
    }
  };
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    document.documentElement.classList.remove("drawer-resizing");
    // 지금 보이는 영역(레일 아이콘)의 크기로 기억한다
    const id = drawerActiveTab[side];
    if (mobile) drawerTabHeights[id] = drawerHeights[side];
    else drawerTabWidths[id] = drawerWidths[side];
    try {
      if (mobile) localStorage.setItem(`drawerHeight_${id}`, String(drawerHeights[side]));
      else localStorage.setItem(`drawerWidth_${id}`, String(drawerWidths[side]));
    } catch (e) {
      // 저장 못 해도 이번 화면에서는 동작
    }
    applyDrawerLayout(); // 고정된 서랍이면 판 자리도 다시 계산
    drawerRefreshTree(side);
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}

function drawerLoadPrefs() {
  try {
    ["left", "right"].forEach(side => {
      DRAWER_TABS[side].forEach(id => {
        const pin = localStorage.getItem(`drawerPin_${id}`);
        if (pin !== null) drawerTabPins[id] = pin === "1";
      });
      const tab = localStorage.getItem(`drawerTab_${side}`);
      if (tab && DRAWER_TABS[side].includes(tab)) drawerActiveTab[side] = tab;
      const w = parseInt(localStorage.getItem(`drawerWidth_${side}`) || "", 10);
      if (isFinite(w) && w > 0) drawerSideDefaultW[side] = w;
      const h = parseInt(localStorage.getItem(`drawerHeight_${side}`) || "", 10);
      if (isFinite(h) && h > 0) drawerSideDefaultH[side] = h;
      DRAWER_TABS[side].forEach(id => {
        const tw = parseInt(localStorage.getItem(`drawerWidth_${id}`) || "", 10);
        if (isFinite(tw) && tw > 0) drawerTabWidths[id] = tw;
        const th = parseInt(localStorage.getItem(`drawerHeight_${id}`) || "", 10);
        if (isFinite(th) && th > 0) drawerTabHeights[id] = th;
      });
    });
  } catch (e) {
    // 기본값 사용
  }
}

document.addEventListener("DOMContentLoaded", () => {
  drawerLoadPrefs();
  // body에 perspective가 걸려 있어 body 안의 position:fixed는 화면 기준이 아니다. 레일도 <html> 바로 아래로 옮긴다.
  ["left-rail", "right-rail"].forEach(id => {
    const rail = document.getElementById(id);
    if (rail) document.documentElement.appendChild(rail);
  });
  document.querySelectorAll(".drawer-resize").forEach(handle => {
    handle.addEventListener("pointerdown", ev => drawerStartResize(handle, ev));
  });
  // 단축키 표는 오른쪽 서랍에 늘 있으므로 처음에 채운다
  if (typeof populateShortcutTable === "function") populateShortcutTable();
  // 레일 아이콘마다 영역 하나: 처음에는 기억해 둔 영역만 보인다
  drawerShowTab("left", drawerActiveTab.left, false);
  drawerShowTab("right", drawerActiveTab.right, false);
  drawerReady = true;
  // 넓은 화면에서는 처음부터 두 서랍을 펼쳐 둔다
  if (window.matchMedia(DRAWER_WIDE_QUERY).matches) {
    drawerOpen("left");
    drawerOpen("right");
  }
  applyDrawerLayout();
  // 처음 그릴 때는 애니메이션 없이
  requestAnimationFrame(() => {
    document.documentElement.classList.add("drawers-ready");
    drawerReadyToAnimate = true;
  });
  window.addEventListener("resize", () => {
    clearTimeout(drawerWinResizeTimer);
    drawerWinResizeTimer = setTimeout(() => {
      applyDrawerLayout();
      drawerRefreshTree("left"); // 변화도는 칸 크기에 맞춰 그린다
    }, 120);
  });
});
