/**
 * @fileoverview 키보드 단축키 핸들러, 커서락 조작, 단축키 커스터마이징 모달 관리 모듈.
 * @module keyboard
 * @depends state, rules, board, ai, flip, record
 */

/**
 * 입력된 키보드 이벤트가 특정 액션의 주/보조 단축키와 일치하는지 확인합니다.
 * @param {string} action - 단축키 액션 키 이름
 * @param {KeyboardEvent} keyEvent - 키보드 이벤트
 * @returns {boolean} 일치 여부
 */
function matchShortcutKey(action, keyEvent) {
  const shortcut = shortcutKeys[action];
  if (!shortcut) return false;
  
  const matchCombo = (combo) => {
    if (!combo || !combo.key) return false;
    let keyMatch = keyEvent.key.toLowerCase() === combo.key.toLowerCase();
    if (!keyMatch && combo.key === "`" && keyEvent.code === "Backquote") {
      keyMatch = true;
    }
    const ctrlMatch = (keyEvent.ctrlKey || keyEvent.metaKey) === !!combo.ctrl;
    const altMatch = keyEvent.altKey === !!combo.alt;
    const shiftMatch = keyEvent.shiftKey === !!combo.shift;
    return keyMatch && ctrlMatch && altMatch && shiftMatch;
  };
  
  return matchCombo(shortcut.primary) || matchCombo(shortcut.secondary);
}

/**
 * 전역 키보드 입력 핸들러입니다.
 * @param {KeyboardEvent} e - 키보드 이벤트
 */
function handleKeyDown(e) {
  if (boardAnimating) return;
  
  const isEscape = (e.key === "Escape");
  const activeEl = document.activeElement;
  if (!isEscape && activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
    return;
  }

  if (isRecordingKey !== null) return; // 단축키 입력 녹화 중에는 전역 단축키 핸들러 작동 정지

  // 1. 새 게임 (게임이 끝났어도 새 게임은 가능해야 함)
  if (matchShortcutKey("newGame", e)) {
    e.preventDefault();
    e.stopPropagation();
    startNewGame();
    return;
  }

  // 2. 기보 불러오기
  if (matchShortcutKey("loadNotation", e)) {
    e.preventDefault();
    e.stopPropagation();
    loadRecordFromClipboard();
    return;
  }

  // 3. 기보 복사 및 저장
  if (matchShortcutKey("copyNotation", e)) {
    e.preventDefault();
    e.stopPropagation();
    saveRecordToLibrary(null);
    return;
  }

  // 4. 앞으로 이동 (복기용)
  if (matchShortcutKey("forwardStep", e)) {
    e.preventDefault();
    e.stopPropagation();
    next();
    return;
  }

  // 5. 뒤로 이동 (복기용)
  if (matchShortcutKey("backwardStep", e)) {
    e.preventDefault();
    e.stopPropagation();
    prev();
    return;
  }

  // 6. 맨 앞으로 이동 (복기용)
  if (matchShortcutKey("goToStart", e)) {
    e.preventDefault();
    e.stopPropagation();
    goToStart();
    return;
  }

  // 7. 맨 뒤로 이동 (복기용)
  if (matchShortcutKey("goToEnd", e)) {
    e.preventDefault();
    e.stopPropagation();
    goToEnd();
    return;
  }

  // 8. 자동 재생 토글 (복기용)
  if (matchShortcutKey("autoplayToggle", e)) {
    e.preventDefault();
    e.stopPropagation();
    toggleAutoplay();
    return;
  }

  // 8a. 단축키 지정 설정창 열기
  if (matchShortcutKey("openShortcutSettings", e)) {
    e.preventDefault();
    e.stopPropagation();
    openShortcutModal();
    return;
  }

  // 8b. 현재 수순 코멘트 편집창 열기
  if (matchShortcutKey("openCommentEdit", e)) {
    e.preventDefault();
    e.stopPropagation();
    openCommentModal();
    return;
  }

  // 8c. 상대 AI 모드 토글 (Z)
  if (matchShortcutKey("toggleOpponentAI", e)) {
    e.preventDefault();
    e.stopPropagation();
    toggleOpponentAI();
    return;
  }

  // 8d. AI 훈수 받기 (X)
  if (matchShortcutKey("requestAIHint", e)) {
    e.preventDefault();
    e.stopPropagation();
    requestAIHint();
    return;
  }

  // 8e. 판 좌우 반전 ([)
  if (matchShortcutKey("flipHorizontal", e)) {
    e.preventDefault();
    e.stopPropagation();
    flipBoardHorizontal();
    return;
  }

  // 8f. 판 상하 반전 (])
  if (matchShortcutKey("flipVertical", e)) {
    e.preventDefault();
    e.stopPropagation();
    flipBoardVertical();
    return;
  }

  // 8g. 좌표보기 토글 (/)
  if (matchShortcutKey("toggleCoordinates", e)) {
    e.preventDefault();
    e.stopPropagation();
    toggleCoordinates();
    return;
  }

  // 9. 커서락 모드 토글
  if (matchShortcutKey("cursorLockToggle", e)) {
    e.preventDefault();
    e.stopPropagation();
    cursorLockMode = !cursorLockMode;
    localStorage.setItem("cursorLockMode", cursorLockMode);
    
    // UI 업데이트
    const cursorLockSelect = document.getElementById("cursor-lock-select");
    if (cursorLockSelect) cursorLockSelect.value = cursorLockMode ? "true" : "false";
    
    showToast(cursorLockMode ? "커서락 모드 활성화" : "커서락 모드 비활성화");
    return;
  }

  // 10. ESC 취소 및 설정 창 열기 (단축키/코멘트 대화창 열려있으면 해당 모달을 저장하지 않고 닫음)
  if (matchShortcutKey("cancel", e)) {
    e.preventDefault();
    e.stopPropagation();
    
    // 1) 코멘트 편집창이 열려있다면 저장하지 않고 닫기
    const commentModal = document.getElementById("comment-modal");
    if (commentModal && commentModal.style.display === "flex") {
      closeCommentModal();
      return;
    }
    
    // 2) 단축키 설정 모달이 열려있다면 닫기
    const shortcutModal = document.getElementById("shortcut-modal");
    if (shortcutModal && shortcutModal.style.display === "flex") {
      closeShortcutModal();
      return;
    }

    // 3) 상차림 설정창이 열려있다면 닫기
    const settingBox = document.getElementById("setting-box");
    if (settingBox && settingBox.style.display === "flex") {
      hideSettingsPanel();
      return;
    }

    if (kbCursorActive) {
      if (curSelect < NO_PIECE) {
        selected(curSelect); // 선택 해제
      } else {
        // 이미 선택 해제되어 있는 상태에서 ESC를 한번 더 누르면 상차림(설정) 열기
        kbCursorActive = false;
        updateKeyboardCursor();
        showSettingsPanel();
      }
    } else {
      // 키보드 커서가 안 켜져 있을 때 ESC를 누르면 바로 상차림 열기
      showSettingsPanel();
    }
    return;
  }

  // 이 아래 기물 조작(착수) 관련 입력은 게임 진행 중일 때만 반응
  if (gameEnded) return;

  // 방향키 처리 (지정된 up, down, left, right 키)
  const isUp = matchShortcutKey("up", e);
  const isDown = matchShortcutKey("down", e);
  const isLeft = matchShortcutKey("left", e);
  const isRight = matchShortcutKey("right", e);

  if (isUp || isDown || isLeft || isRight) {
    e.preventDefault();
    e.stopPropagation();
    
    if (cursorLockMode) {
      const turnEl = document.getElementById("turn");
      const curTurn = turnEl ? parseInt(turnEl.value, 10) : log.length;
      const isChoTurn = (curTurn % 2 === 0);
      const currentTeam = isChoTurn ? "cho" : "han";
      const allFilteredMoves = getFilteredLegalMoves(currentTeam);
      
      const isForward = (isRight || isDown);
      
      if (curSelect === NO_PIECE) {
        // 커서락 모드 - 선택 기물 고르기
        const selectablePieceIds = Array.from(new Set(allFilteredMoves.map(m => m.i))).sort((a, b) => a - b);
        if (selectablePieceIds.length > 0) {
          let currIdx = selectablePieceIds.findIndex(id => pieces[id].x === kbCursorX && pieces[id].y === kbCursorY);
          
          if (!kbCursorActive) {
            kbCursorActive = true;
            // 최초 활성화 시에는 현재 턴 왕의 위치와 가장 가까운 기물이나 첫 기물 선택
            const kingIdx = (isChoTurn === iAmCho) ? 0 : 16;
            currIdx = selectablePieceIds.indexOf(kingIdx);
            if (currIdx === -1) currIdx = 0;
          } else {
            if (isForward) {
              currIdx = (currIdx + 1) % selectablePieceIds.length;
            } else {
              currIdx = (currIdx - 1 + selectablePieceIds.length) % selectablePieceIds.length;
            }
          }
          
          kbCursorX = pieces[selectablePieceIds[currIdx]].x;
          kbCursorY = pieces[selectablePieceIds[currIdx]].y;
        }
      } else {
        // 커서락 모드 - 기물이 이미 선택된 상태에서 가용한 후보 영역 중에서만 순환 이동
        const validMoves = allFilteredMoves.filter(m => m.i === curSelect);
        if (validMoves.length > 0) {
          let currIdx = validMoves.findIndex(m => m.x === kbCursorX && m.y === kbCursorY);
          
          if (!kbCursorActive) {
            kbCursorActive = true;
            currIdx = 0;
          } else {
            if (isForward) {
              currIdx = (currIdx + 1) % validMoves.length;
            } else {
              currIdx = (currIdx - 1 + validMoves.length) % validMoves.length;
            }
          }
          
          kbCursorX = validMoves[currIdx].x;
          kbCursorY = validMoves[currIdx].y;
        }
      }
    } else {
      // 일반 자유 이동 모드
      if (!kbCursorActive) {
        kbCursorActive = true;
        
        // 이미 선택된 기물이 있다면 해당 기물 좌표에서 시작, 아니면 현재 턴 왕의 위치에서 시작
        if (curSelect < NO_PIECE && pieces[curSelect].x !== 0) {
          kbCursorX = pieces[curSelect].x;
          kbCursorY = pieces[curSelect].y;
        } else {
          const turnEl = document.getElementById("turn");
          const curTurn = turnEl ? parseInt(turnEl.value, 10) : log.length;
          const isChoTurn = (curTurn % 2 === 0);
          const kingIdx = (isChoTurn === iAmCho) ? 0 : 16;
          kbCursorX = pieces[kingIdx].x;
          kbCursorY = pieces[kingIdx].y;
        }
      }
      
      // 키보드 모드 활성화 여부와 상관없이 항상 이동 명령을 즉각 실행
      if (isUp) {
        const ny = yPrev(kbCursorY);
        if (ny !== -1) kbCursorY = ny;
      } else if (isDown) {
        const ny = yNext(kbCursorY);
        if (ny !== -1) kbCursorY = ny;
      } else if (isLeft) {
        if (kbCursorX > 1) kbCursorX -= 1;
      } else if (isRight) {
        if (kbCursorX < 9) kbCursorX += 1;
      }
    }
    
    updateKeyboardCursor();
    return;
  }

  // 엔터 또는 스페이스바로 선택 및 착수 실행
  if (matchShortcutKey("select", e)) {
    if (!kbCursorActive) return;
    e.preventDefault();

    const turnEl = document.getElementById("turn");
    const curTurn = turnEl ? parseInt(turnEl.value, 10) : log.length;
    const isChoTurn = (curTurn % 2 === 0);
    const currentTeam = isChoTurn ? "cho" : "han";

    if (curSelect === NO_PIECE) {
      // 기물 선택 시도
      const pIdx = whoIsit(kbCursorX, kbCursorY);
      if (pIdx < NO_PIECE) {
        // 내 기물일 때만 선택 허용
        const isChoPiece = (pIdx < 16) === iAmCho;
        if (isChoTurn === isChoPiece) {
          selected(pIdx);
        }
      }
    } else {
      // 기물이 이미 선택되어 있는 경우
      const validMoves = getFilteredLegalMoves(currentTeam);
      const matchedMove = validMoves.find(m => m.i === curSelect && m.x === kbCursorX && m.y === kbCursorY);
      
      if (matchedMove) {
        // 이동 실행!
        move(curSelect, kbCursorX, kbCursorY);
      } else {
        // 후보 이동지가 아닌 경우, 해당 좌표에 내 다른 기물이 있으면 해당 기물로 선택 변경
        const pIdx = whoIsit(kbCursorX, kbCursorY);
        const isChoPiece = (pIdx < 16) === iAmCho;
        if (pIdx < NO_PIECE && (isChoTurn === isChoPiece)) {
          selected(pIdx);
        } else {
          // 허공이나 상대 기물 클릭 시 선택 취소
          selected(curSelect);
        }
      }
    }
    updateKeyboardCursor();
  }
}

// ----------------------------------------------------
// 단축키 커스텀 설정 모달 구현부
// ----------------------------------------------------
var isRecordingKey = null; // 현재 바인딩 기록 대기 중인 기능 키 (예: { action, type })

const shortcutActionNames = {
  newGame: "새 대국 시작하기",
  autoplayToggle: "자동 재생 토글",
  openShortcutSettings: "단축키 지정 설정창 열기",
  openCommentEdit: "현재 수순 코멘트 편집창 열기",
  toggleOpponentAI: "상대 AI 모드 켜기/끄기",
  requestAIHint: "AI 훈수 한 수 받기",
  flipHorizontal: "판 좌우 반전",
  flipVertical: "판 상하 반전",
  toggleCoordinates: "좌표 표시 켜기/끄기",
  up: "위로 이동",
  down: "아래로 이동",
  left: "왼쪽 이동",
  right: "오른쪽 이동",
  select: "선택 및 착수",
  cursorLockToggle: "커서락 모드 토글",
  cancel: "선택 취소",
  copyNotation: "기보 클립보드 복사",
  loadNotation: "기보 클립보드 불러오기",
  forwardStep: "앞으로 이동",
  backwardStep: "뒤로 이동",
  goToStart: "맨 앞으로 이동",
  goToEnd: "맨 뒤로 이동"
};

/**
 * 구버전 단축키 설정 객체를 최신 구조({ primary, secondary })로 마이그레이션합니다.
 * @param {Object} parsedKeys - 저장소에서 불러온 단축키 객체
 * @returns {Object} 마이그레이션된 단축키 객체
 */
function migrateShortcutKeys(parsedKeys) {
  if (!parsedKeys) return shortcutKeys;
  const migrated = {};
  
  const parseSingle = (v) => {
    if (!v) return null;
    if (typeof v === "string") {
      let ctrl = false;
      let alt = false;
      const shift = false;
      let key = v;
      if (key.toLowerCase().startsWith("ctrl + ")) {
        ctrl = true;
        key = key.substring(7);
      } else if (key.toLowerCase().startsWith("alt + ")) {
        alt = true;
        key = key.substring(6);
      }
      return { key, ctrl, alt, shift };
    }
    if (typeof v === "object") {
      return {
        key: v.key || "",
        ctrl: !!v.ctrl,
        alt: !!v.alt,
        shift: !!v.shift
      };
    }
    return null;
  };

  Object.keys(shortcutKeys).forEach(key => {
    const legacyVal = parsedKeys[key];
    const defaultVal = shortcutKeys[key];
    
    if (legacyVal) {
      if (typeof legacyVal === "string") {
        migrated[key] = {
          primary: parseSingle(legacyVal),
          secondary: defaultVal ? defaultVal.secondary : null
        };
      } else if (typeof legacyVal === "object") {
        if (legacyVal.primary !== undefined || legacyVal.secondary !== undefined) {
          const prim = parseSingle(legacyVal.primary);
          const sec = parseSingle(legacyVal.secondary);
          migrated[key] = {
            primary: prim !== null ? prim : (defaultVal ? defaultVal.primary : null),
            secondary: sec !== null ? sec : (defaultVal ? defaultVal.secondary : null)
          };
        } else if (legacyVal.key !== undefined) {
          migrated[key] = {
            primary: parseSingle(legacyVal),
            secondary: defaultVal ? defaultVal.secondary : null
          };
        }
      }
    }
    
    if (!migrated[key]) {
      migrated[key] = {
        primary: defaultVal ? defaultVal.primary : null,
        secondary: defaultVal ? defaultVal.secondary : null
      };
    }
  });
  
  // 강제 핫키 정정 마이그레이션 (구버전 스토리지 마이그레이션 보호)
  if (migrated.openShortcutSettings && migrated.openShortcutSettings.primary && migrated.openShortcutSettings.primary.key === "?") {
    migrated.openShortcutSettings.primary.shift = true;
  }
  if (migrated.autoplayToggle && migrated.autoplayToggle.primary && migrated.autoplayToggle.primary.key === "p") {
    migrated.autoplayToggle.primary.ctrl = false;
  }
  if (migrated.openCommentEdit && migrated.openCommentEdit.primary && migrated.openCommentEdit.primary.key === "`") {
    migrated.openCommentEdit.primary.ctrl = false;
    migrated.openCommentEdit.primary.alt = false;
    migrated.openCommentEdit.primary.shift = false;
  }

  return migrated;
}

/**
 * 단축키 조합 객체를 사람이 읽기 쉬운 문자열로 변환합니다.
 * @param {{key: string, ctrl: boolean, alt: boolean, shift: boolean}|null} combo
 * @returns {string} 표시용 문자열
 */
function formatKeyCombination(combo) {
  if (!combo || !combo.key) return "미지정";
  const parts = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  
  let k = combo.key;
  const kl = k.toLowerCase();
  if (kl === " ") k = "Space";
  else if (kl === "arrowup") k = "↑";
  else if (kl === "arrowdown") k = "↓";
  else if (kl === "arrowleft") k = "←";
  else if (kl === "arrowright") k = "→";
  else if (k.length === 1) k = k.toUpperCase();
  
  parts.push(k);
  return parts.join(" + ");
}

/**
 * 단축키 모달 배경색을 변경합니다.
 * @param {string} color - HEX 색상 문자열
 */
function changeModalBgColor(color) {
  shortcutModalBgColor = color;
  const picker = document.getElementById("modal-bg-picker");
  if (picker) picker.value = color;
  applyShortcutModalTheme();
  saveCurrentConfigToSlot();
}

/**
 * 단축키 모달 불투명도를 변경합니다.
 * @param {string|number} opacity - 0.1 ~ 1.0 불투명도
 */
function changeModalOpacity(opacity) {
  shortcutModalOpacity = parseFloat(opacity);
  const slider = document.getElementById("modal-opacity-slider");
  if (slider) slider.value = opacity;
  const valEl = document.getElementById("modal-opacity-val");
  if (valEl) valEl.textContent = shortcutModalOpacity.toFixed(2);
  applyShortcutModalTheme();
  saveCurrentConfigToSlot();
}

/**
 * 단축키 모달창의 배경색과 불투명도 테마를 적용합니다.
 */
function applyShortcutModalTheme() {
  const modalContent = document.querySelector("#shortcut-modal .modal-content");
  if (!modalContent) return;
  
  const hex = shortcutModalBgColor || "#0f172a";
  const opacity = shortcutModalOpacity !== undefined ? shortcutModalOpacity : 0.9;
  
  modalContent.style.background = hexToRgba(hex, opacity);
}

/**
 * 단축키 설정 모달을 엽니다.
 */
function openShortcutModal() {
  const modal = document.getElementById("shortcut-modal");
  if (!modal) return;
  
  const picker = document.getElementById("modal-bg-picker");
  if (picker) picker.value = shortcutModalBgColor;
  const slider = document.getElementById("modal-opacity-slider");
  if (slider) slider.value = shortcutModalOpacity;
  const valEl = document.getElementById("modal-opacity-val");
  if (valEl) valEl.textContent = shortcutModalOpacity.toFixed(2);
  
  applyShortcutModalTheme();
  populateShortcutTable();
  modal.style.display = "flex";
  modal.offsetHeight; // Force reflow
  modal.classList.add("open");
}

/**
 * 단축키 설정 모달을 닫습니다.
 */
function closeShortcutModal() {
  const modal = document.getElementById("shortcut-modal");
  if (!modal) return;
  
  isRecordingKey = null;
  modal.classList.remove("open");
  setTimeout(() => {
    modal.style.display = "none";
  }, 300);
}

/**
 * 단축키 모달 오버레이 배경 클릭 시 모달을 닫습니다.
 * @param {MouseEvent} e - 클릭 이벤트
 */
function handleModalOverlayClick(e) {
  if (e.target.id === "shortcut-modal") {
    closeShortcutModal();
  }
}

/**
 * 단축키 설정 테이블 DOM을 생성합니다.
 */
function populateShortcutTable() {
  const tbody = document.getElementById("shortcut-table-body");
  if (!tbody) return;
  
  tbody.innerHTML = "";
  
  Object.keys(shortcutKeys).forEach(actionKey => {
    if (actionKey === "selectAlt") return; // Deprecated
    
    const tr = document.createElement("tr");
    tr.className = "shortcut-row";
    
    const tdName = document.createElement("td");
    tdName.textContent = shortcutActionNames[actionKey] || actionKey;
    tr.appendChild(tdName);
    
    // Primary key
    const tdPrimary = document.createElement("td");
    const btnPrimary = document.createElement("button");
    btnPrimary.className = "shortcut-key-btn";
    
    const displayPrimary = formatKeyCombination(shortcutKeys[actionKey].primary);
    
    if (isRecordingKey && isRecordingKey.action === actionKey && isRecordingKey.type === "primary") {
      btnPrimary.textContent = "입력 대기...";
      btnPrimary.classList.add("recording");
    } else {
      btnPrimary.textContent = displayPrimary;
    }
    
    btnPrimary.onclick = (e) => {
      e.stopPropagation();
      startRecordingKey(actionKey, "primary");
    };
    tdPrimary.appendChild(btnPrimary);
    tr.appendChild(tdPrimary);
    
    // Secondary key
    const tdSecondary = document.createElement("td");
    const btnSecondary = document.createElement("button");
    btnSecondary.className = "shortcut-key-btn";
    
    const displaySecondary = formatKeyCombination(shortcutKeys[actionKey].secondary);
    
    if (isRecordingKey && isRecordingKey.action === actionKey && isRecordingKey.type === "secondary") {
      btnSecondary.textContent = "입력 대기...";
      btnSecondary.classList.add("recording");
    } else {
      btnSecondary.textContent = displaySecondary;
    }
    
    btnSecondary.onclick = (e) => {
      e.stopPropagation();
      startRecordingKey(actionKey, "secondary");
    };
    tdSecondary.appendChild(btnSecondary);
    tr.appendChild(tdSecondary);
    
    tbody.appendChild(tr);
  });
}

/**
 * 특정 기능의 단축키 입력을 캡처하여 바인딩합니다.
 * @param {string} actionKey - 단축키 액션 키
 * @param {"primary"|"secondary"} type - 주/보조 단축키 구분
 */
function startRecordingKey(actionKey, type) {
  isRecordingKey = { action: actionKey, type: type };
  populateShortcutTable();
  
  const handleKeyRecord = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const keyName = e.key;
    
    if (["control", "shift", "alt", "meta"].includes(keyName.toLowerCase())) {
      return;
    }
    
    if ((keyName === "Escape" || keyName === "Backspace") && isRecordingKey.action !== "cancel") {
      shortcutKeys[isRecordingKey.action][isRecordingKey.type] = null;
      isRecordingKey = null;
      saveCurrentConfigToSlot();
      populateShortcutTable();
      window.removeEventListener("keydown", handleKeyRecord, true);
      showToast("단축키가 해제되었습니다.");
      return;
    }
    
    const combo = {
      key: keyName,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      shift: e.shiftKey
    };
    
    let duplicated = false;
    Object.keys(shortcutKeys).forEach(aKey => {
      const keysObj = shortcutKeys[aKey];
      const matchCombo = (c) => {
        if (!c || !c.key) return false;
        return c.key.toLowerCase() === combo.key.toLowerCase() &&
               !!c.ctrl === !!combo.ctrl &&
               !!c.alt === !!combo.alt &&
               !!c.shift === !!combo.shift;
      };
      if (keysObj && (matchCombo(keysObj.primary) || matchCombo(keysObj.secondary))) {
        if (aKey === isRecordingKey.action) return;
        duplicated = true;
      }
    });
    
    if (duplicated) {
      showToast("이미 다른 기능에 지정된 키 조합입니다!");
      isRecordingKey = null;
      populateShortcutTable();
      window.removeEventListener("keydown", handleKeyRecord, true);
      return;
    }
    
    shortcutKeys[isRecordingKey.action][isRecordingKey.type] = combo;
    isRecordingKey = null;
    saveCurrentConfigToSlot();
    window.removeEventListener("keydown", handleKeyRecord, true);
    populateShortcutTable();
    showToast(`단축키가 '${formatKeyCombination(combo)}'(으)로 지정되었습니다.`);
  };
  
  window.addEventListener("keydown", handleKeyRecord, true);
}

/**
 * 모든 단축키를 초기 기본값(DEFAULT_SHORTCUT_KEYS)으로 복원합니다.
 */
function resetDefaultShortcuts() {
  shortcutKeys = JSON.parse(JSON.stringify(DEFAULT_SHORTCUT_KEYS));
  saveCurrentConfigToSlot();
  populateShortcutTable();
  showToast("단축키 기본값이 복원되었습니다.");
}
