/**
 * @fileoverview 장기판 우클릭 메뉴와 "좌표 클릭" (빈 교차점을 눌러 키보드 커서 만들기).
 *  - 판(#janggi-svg)에서 우클릭하면 메뉴가 뜬다:
 *      좌우 반전 · 상하 반전 · 180도 회전 · AI에게 위임 · 좌표 켜기/끄기 · 커서락(커서가 있을 때만) ·
 *      커서 끄기(커서가 있을 때만) · 좌표 클릭 · 기보 저장(놓아보기가 아닐 때, Ctrl+S와 같음) · 포기
 *    포기 = 확인 팝업 뒤 대국을 끝낸다. AI 대국이면 사용자 쪽이, 아니면 지금 차례인 쪽이 포기한다 (resignGame).
 *    상하 반전 = 180도 회전(flipBoardVertical) 뒤 좌우 반전(flipBoardHorizontal). 두 애니메이션이 이어서 돈다.
 *    AI에게 위임 = 지금 차례인 진영을 AI가 두게 한다 (진영 이름 우클릭의 "AI"와 같은 설정, header-graph.js).
 *  - 좌표 클릭(켜기/끄기, localStorage "coordClickMode"): 켜져 있으면 판의 빈 교차점(가까운 곳을 눌러도 됨)을 누를 때
 *    그 자리에 키보드 커서가 생긴다. 기물·후보 자리를 누르는 것은 지금처럼 선택·착수.
 *  - 메뉴 모양은 진영 메뉴(.side-menu, css/controls.css)를 쓰고 구분선 등은 css/board-menu.css.
 * 공개 함수: openBoardMenu(ev), closeBoardMenu(), isBoardMenuOpen(), boardMenuDo(action), resignGame(),
 *           toggleCoordClickMode(), rotateBoard180(), mirrorBoardVertical(), delegateTurnToAI()
 * @module board-menu
 * @depends board, flip, keyboard, header-graph, ai, main, ui
 */

const BM_COORD_TOLERANCE = 0.45; // 교차점에서 칸 크기의 이 비율 안을 누르면 그 교차점으로 본다
let coordClickMode = false;

function bmEl() {
  return document.getElementById("board-menu");
}

function isBoardMenuOpen() {
  const m = bmEl();
  return !!m && !m.hidden;
}

function closeBoardMenu() {
  const m = bmEl();
  if (m) m.hidden = true;
}

/** 지금 판에서 차례인 진영 (놓아보기 중이면 그 국면) */
function bmSideToMove() {
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  const step = inPreview ? previewCursor.step : cfCurrentStep();
  return cfSideToMove(step);
}

/** 메뉴 항목 (지금 상태에 맞춰 보이는 것만) */
function bmItems() {
  const team = bmSideToMove();
  const teamName = team === "cho" ? "초" : "한";
  const items = [
    { action: "flipH", label: "좌우 반전", key: "flipHorizontal" },
    { action: "flipV", label: "상하 반전" },
    { action: "rotate", label: "180도 회전", key: "flipVertical" },
    { sep: true },
    {
      action: "delegate",
      label: `AI에게 위임 (${teamName})`,
      disabled: typeof isAITeam === "function" && isAITeam(team),
      title: `지금 차례인 ${teamName} 진영을 AI가 둡니다`
    },
    { sep: true },
    { action: "coords", label: showCoordinates ? "좌표 끄기" : "좌표 켜기", checked: !!showCoordinates, key: "toggleCoordinates" }
  ];
  if (kbCursorActive) {
    items.push({ action: "cursorLock", label: "커서락", checked: !!cursorLockMode, key: "cursorLockToggle" });
    items.push({ action: "cursorOff", label: "커서 끄기" });
  }
  items.push({ action: "coordClick", label: "좌표 클릭", checked: coordClickMode, title: "켜면 판의 빈 교차점을 눌러 커서를 만듭니다" });
  items.push({ sep: true });
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  // 기보 저장: 놓아보기가 아닐 때만 (단축키 Ctrl + S = 저장된 기보에 넣고 클립보드에 복사)
  if (!inPreview) items.push({ action: "saveRecord", label: "기보 저장", key: "copyNotation", keyPref: "ctrl", title: "지금 기보를 저장된 기보에 넣고 클립보드에 복사합니다" });
  const loser = bmResignSide();
  items.push({
    action: "resign",
    label: `포기 (${loser === "cho" ? "초" : "한"})`,
    disabled: gameEnded || inPreview,
    title: inPreview ? "놓아보기 중에는 포기할 수 없습니다" : (gameEnded ? "대국이 이미 끝났습니다" : "이 대국을 포기합니다")
  });
  return items;
}

/** 단축키 글자 (keyboard.js formatKeyCombination). 배정되지 않았으면 "" */
function bmShortcutText(action, pref) {
  if (!action || typeof shortcutKeys === "undefined" || !shortcutKeys[action]) return "";
  const sk = shortcutKeys[action];
  // pref "ctrl": Ctrl 조합이 배정돼 있으면 그것을 보여 준다 (기보 저장 = Ctrl + S)
  const ctrlCombo = pref === "ctrl" ? [sk.primary, sk.secondary].find(c => c && c.ctrl) : null;
  const combo = ctrlCombo || sk.primary || sk.secondary;
  if (!combo || !combo.key || typeof formatKeyCombination !== "function") return "";
  return formatKeyCombination(combo);
}

/** 판 우클릭: 메뉴를 마우스 자리에 연다 */
function openBoardMenu(ev) {
  const menu = bmEl();
  if (!menu) return;
  if (typeof closeSideMenu === "function") closeSideMenu();
  menu.innerHTML = "";
  bmItems().forEach(it => {
    if (it.sep) {
      const hr = document.createElement("div");
      hr.className = "board-menu-sep";
      hr.setAttribute("role", "separator");
      menu.appendChild(hr);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "side-menu-item";
    btn.setAttribute("role", it.checked === undefined ? "menuitem" : "menuitemcheckbox");
    if (it.checked !== undefined) {
      btn.classList.toggle("checked", it.checked);
      btn.setAttribute("aria-checked", it.checked ? "true" : "false");
    }
    if (it.disabled) btn.disabled = true;
    if (it.title) btn.title = it.title;
    btn.dataset.action = "boardMenuDo";
    btn.dataset.value = it.action;
    const label = document.createElement("span");
    label.className = "board-menu-label";
    label.textContent = it.label;
    btn.appendChild(label);
    // 배정된 단축키 (오른쪽, 흐리게). 단축키 설정에서 바꾸면 그대로 따라간다
    const keyText = bmShortcutText(it.key, it.keyPref);
    if (keyText) {
      const k = document.createElement("span");
      k.className = "board-menu-key";
      k.textContent = keyText;
      btn.appendChild(k);
    }
    menu.appendChild(btn);
  });
  menu.hidden = false;
  const x = ev && ev.clientX ? ev.clientX : window.innerWidth / 2;
  const y = ev && ev.clientY ? ev.clientY : window.innerHeight / 2;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
  const first = menu.querySelector(".side-menu-item:not(:disabled)");
  if (first) first.focus();
}

/** 메뉴 항목 실행 (dispatcher: data-action="boardMenuDo" data-value) */
function boardMenuDo(action) {
  closeBoardMenu();
  switch (action) {
    case "flipH": flipBoardHorizontal(); break;
    case "flipV": mirrorBoardVertical(); break;
    case "rotate": rotateBoard180(); break;
    case "delegate": delegateTurnToAI(); break;
    case "coords": toggleCoordinates(); break;
    case "cursorLock": toggleCursorLock(); break;
    case "cursorOff":
      kbCursorActive = false;
      updateKeyboardCursor();
      break;
    case "coordClick": toggleCoordClickMode(); break;
    case "resign": resignGame(); break;
    case "saveRecord":
      if (typeof saveRecordToLibrary === "function") saveRecordToLibrary(null);
      break;
    default: break;
  }
}

/** 180도 회전 (flip.js의 상하좌우 회전) */
function rotateBoard180() {
  flipBoardVertical();
}

/** 앞 애니메이션이 끝나면 fn을 부른다 */
function bmAfterAnimation(fn, tries) {
  const left = tries === undefined ? 100 : tries;
  if (typeof boardAnimating !== "undefined" && boardAnimating && left > 0) {
    setTimeout(() => bmAfterAnimation(fn, left - 1), 60);
    return;
  }
  fn();
}

/** 상하 반전 = 180도 회전 + 좌우 반전 */
function mirrorBoardVertical() {
  if (typeof boardAnimating !== "undefined" && boardAnimating) return;
  flipBoardVertical();
  bmAfterAnimation(() => flipBoardHorizontal());
}

/** 지금 차례인 진영을 AI에게 맡긴다 (진영 이름 우클릭 메뉴의 "AI"와 같다) */
function delegateTurnToAI() {
  const team = bmSideToMove();
  const menu = document.getElementById("side-menu");
  if (menu && typeof setSideController === "function") {
    menu.dataset.side = team;
    setSideController("ai");
    return;
  }
  aiSidePref = team;
  aiMode = 1;
  if (typeof checkAndRunAI === "function") checkAndRunAI();
}

/** 포기하는 쪽: AI 대국이면 사용자 쪽, 아니면 실제 대국에서 지금 차례인 쪽 */
function bmResignSide() {
  if (aiMode === 1 && typeof aiPlaysSide === "function") return aiPlaysSide() === "cho" ? "han" : "cho";
  return cfSideToMove(log.length);
}

/** 포기: 확인 팝업 뒤 대국을 끝낸다 (gameEnded) */
function resignGame() {
  if (gameEnded) return;
  if (typeof isPreviewActive === "function" && isPreviewActive()) return;
  const loser = bmResignSide();
  const loserName = loser === "cho" ? "초나라" : "한나라";
  const winnerName = loser === "cho" ? "한나라" : "초나라";
  showAppDialog({
    title: "포기하시겠습니까?",
    message: `${loserName}가 ${log.length}수에서 포기합니다. 대국이 끝나고 ${winnerName}가 이깁니다.`,
    tone: "warn",
    cancelValue: "cancel",
    buttons: [
      { label: "취소", value: "cancel" },
      { label: "포기", value: "resign", primary: true }
    ]
  }).then(v => {
    if (v !== "resign" || gameEnded) return;
    gameEnded = true;
    if (typeof clearCandiBox === "function") clearCandiBox();
    curSelect = NO_PIECE;
    showAppDialog({
      title: "대국 종료",
      message: `${loserName}가 포기했습니다. ${winnerName} 승리 (${log.length}수).`,
      tone: "win",
      buttons: [{ label: "닫기", value: null, primary: true }]
    });
  });
}

/** "좌표 클릭" 켜기/끄기 */
function toggleCoordClickMode() {
  coordClickMode = !coordClickMode;
  try {
    localStorage.setItem("coordClickMode", coordClickMode ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  if (typeof showToast === "function") {
    showToast(coordClickMode ? "좌표 클릭 켜짐: 빈 교차점을 누르면 커서가 생깁니다" : "좌표 클릭 꺼짐");
  }
}

/** 화면 좌표 → 가장 가까운 교차점 {x, y} (허용 오차 밖이면 null) */
function bmNearestPoint(svgEl, clientX, clientY) {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  let best = null;
  let bestD = Infinity;
  for (let x = 1; x <= 9; x++) {
    for (let y = 0; y <= 9; y++) {
      const a = getAxis(x, y);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best && bestD <= unitSize * BM_COORD_TOLERANCE ? best : null;
}

/** 좌표 클릭: 빈 교차점을 누르면 그 자리에 키보드 커서 */
function bmHandleBoardClick(e) {
  if (!coordClickMode || e.button !== 0) return;
  if (typeof boardAnimating !== "undefined" && boardAnimating) return;
  // 기물·후보 자리는 지금처럼 선택·착수
  if (e.target.closest && e.target.closest(".candi-svg")) return;
  if (pieces.some(p => p.e === e.target || (p.e && p.e.contains && p.e.contains(e.target)))) return;
  const svgEl = e.currentTarget;
  const pt = bmNearestPoint(svgEl, e.clientX, e.clientY);
  if (!pt) return;
  if (whoIsit(pt.x, pt.y) < NO_PIECE) return;
  kbCursorX = pt.x;
  kbCursorY = pt.y;
  kbCursorActive = true;
  updateKeyboardCursor();
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    coordClickMode = localStorage.getItem("coordClickMode") === "1";
  } catch (e) {
    coordClickMode = false;
  }
  const menu = bmEl();
  // body에 perspective가 있어 fixed 메뉴는 <html> 바로 아래에 둔다 (진영 메뉴와 같은 이유)
  if (menu) document.documentElement.appendChild(menu);
  const svgEl = document.getElementById("janggi-svg");
  if (svgEl) {
    svgEl.addEventListener("contextmenu", e => {
      e.preventDefault();
      openBoardMenu(e);
    });
    svgEl.addEventListener("click", bmHandleBoardClick);
  }
  // 메뉴 밖을 누르면 닫기
  document.addEventListener("pointerdown", e => {
    if (!isBoardMenuOpen()) return;
    if (menu && menu.contains(e.target)) return;
    closeBoardMenu();
  });
  window.addEventListener("resize", closeBoardMenu);
});
