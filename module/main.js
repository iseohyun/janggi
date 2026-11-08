/**
 * @fileoverview 앱 초기화(Entry Point), 기물 선택/착수 컨트롤러, 수순 탐색(prev/next), 상차림/진영 전환 모듈.
 * @module main
 * @depends state, rules, board, ai, flip, record, keyboard, settings, ui
 */

/**
 * 32개 기물 데이터 배열을 초기화하고 URL 파라미터 및 DOM 엘리먼트를 바인딩합니다.
 */
function initData() {
  for (let i = 0; i < 32; i++) {
    pieces[i] = { x: 0, y: 0, e: null, animId: null };
  }

  getData();

  initElements();
}

/**
 * 현재 진영(iAmCho)에 맞춰 0~15(하단) 및 16~31(상단) 기물 SVG 엘리먼트와 클릭 핸들러를 바인딩합니다.
 */
function initElements() {
  const choIds = [
    "cho-king", "cho-cha1", "cho-cha2", "cho-po1", "cho-po2",
    "cho-ma1", "cho-ma2", "cho-sang1", "cho-sang2", "cho-sa1", "cho-sa2",
    "cho-zol1", "cho-zol2", "cho-zol3", "cho-zol4", "cho-zol5"
  ];
  const hanIds = [
    "han-king", "han-cha1", "han-cha2", "han-po1", "han-po2",
    "han-ma1", "han-ma2", "han-sang1", "han-sang2", "han-sa1", "han-sa2",
    "han-zol1", "han-zol2", "han-zol3", "han-zol4", "han-zol5"
  ];

  const bottomIds = iAmCho ? choIds : hanIds;
  const topIds = iAmCho ? hanIds : choIds;

  for (let i = 0; i < 16; i++) {
    pieces[i].e = document.getElementById(bottomIds[i]);
    pieces[i + 16].e = document.getElementById(topIds[i]);
  }
  
  // Rebind onclick handlers to matching indices to prevent selection mismatch after changeNation()
  for (let i = 0; i < 32; i++) {
    if (pieces[i].e) {
      pieces[i].e.onclick = function () { selected(i); };
    }
  }
}

/**
 * URL 쿼리 파라미터(cho, p, log, t)를 파싱하여 초기 대국 상태를 구성합니다.
 */
function getData() {
  const urlParams = new URLSearchParams(window.location.search);
  
  // 1. Parse param_cho first to set active nation
  const paramCho = urlParams.get("cho");
  if (paramCho === null) {
    changeNation(true);
  } else {
    changeNation(paramCho === "Y");
  }

  // 2. Parse param_P and normalize it for matching starting layout types
  const paramP = urlParams.get("p");
  if (paramP === null) {
    // 나: 마상마상 - 너 : 마상마상 (Standard starting layout)
    applyLayoutCode("5910902888207030804060173757779752119123832171318141611434547494");
  } else {
    const normalizedP = normalizeLayoutCode(paramP, !iAmCho);
    let choIdx = 0;
    let hanIdx = 0;
    for (let i = 0; i < 4; i++) {
      if (normalizedP.includes(knownStart[0][i])) {
        choIdx = i;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (normalizedP.includes(knownStart[1][i])) {
        hanIdx = i;
      }
    }
    if (iAmCho) {
      newGameState[0] = choIdx;
      newGameState[1] = hanIdx;
    } else {
      newGameState[0] = hanIdx;
      newGameState[1] = choIdx;
    }
    applyLayoutCode(paramP);
  }

  // 상차림 단추 색상 및 미니어처 예시 배치도 동기화
  syncCharimButtonStyles();

  // 3. Parse log parameter
  const paramLog = urlParams.get("log");
  if (paramLog !== null) {
    const logArr = paramLog.split(",");
    logArr.forEach(logStr => {
      if (logStr.length !== 0) {
        let j = 1;
        for (; j < logStr.length; j++) {
          if (logStr.charAt(j) > "A") break;
        }

        const i = parseInt(logStr.substring(0, j), 10);
        const x = charToCoord(logStr.charAt(j));
        const y = charToCoord(logStr.charAt(j + 1));
        const t = (logStr.length === (j + 2)) ? NO_PIECE : parseInt(logStr.substring(j + 2, logStr.length), 10);
        log.push({ i, x, y, t });
      }
    });
  }

  const paramTurn = urlParams.get("t");
  const turn = document.getElementById("turn");
  if (paramTurn !== null) {
    const parsedTurn = parseInt(paramTurn, 10);
    if (!isNaN(parsedTurn) && turn) {
      turn.value = parsedTurn;
    }
  } else if (turn) {
    turn.value = log.length;
  }
}

/**
 * 기물이 선택되었을 때 합법수 후보지 마커를 계산하고 화면에 표시합니다.
 * @param {number} i - 선택된 기물 인덱스 (0~31)
 */
function selected(i) {
  if (gameEnded) return;
  kbCursorActive = false;
  updateKeyboardCursor();

  const turnEl = document.getElementById("turn");
  const curTurn = turnEl ? parseInt(turnEl.value, 10) : log.length;
  const isChoTurn = (curTurn % 2 === 0);
  const currentTeam = isChoTurn ? "cho" : "han";

  // 턴 및 조작 제한 (기본 턴 제한 + AI 전용 가드)
  const isChoPiece = (i < 16) === iAmCho;
  if (isChoTurn) {
    if (!isChoPiece) return; // 초의 턴인데 한의 기물을 조작하려고 하는 경우 차단
  } else {
    if (isChoPiece) return; // 한의 턴인데 초의 기물을 조작하려고 하는 경우 차단
  }

  // 만약 AI 모드가 켜져 있고, 현재 턴이 AI(위쪽)의 턴이면 사용자 조작 차단
  if (aiMode === 1) {
    const isUserTurn = (isChoTurn === iAmCho);
    if (!isUserTurn) return;
  }

  if (curSelect === i) {
    clearCandiBox();
    moveSelectBox(i, false);
    curSelect = NO_PIECE;
    return;
  }

  moveSelectBox(i);
  curSelect = i;

  // 이전에 이미 선택된 객체로부터 그려진 이동가능 경로를 삭제합니다.
  clearCandiBox();

  // 해당 진영의 장군 회피 가능한 실제 합법적인 수들만 필터링하여 그립니다.
  const validMoves = getFilteredLegalMoves(currentTeam);
  renderCandidateMarkers(i, validMoves);
}

/**
 * 기물을 지정된 좌표로 이동시키고 포획, 수순 기록, 외통수 판정 및 AI 응답을 트리거합니다.
 * @param {number} i - 이동할 기물 인덱스
 * @param {number} x - 목표 X 좌표 (1~9)
 * @param {number} y - 목표 Y 좌표 (1~9, 0)
 */
function move(i, x, y) {
  kbCursorActive = false;
  updateKeyboardCursor();
  currentLoadedRecordId = null;
  updateSavedRecordsListUI();

  // 따먹은 객체가 있다면 처리
  const t = whoIsit(x, y);
  if (t < NO_PIECE) {
    setPieces(t, 0, 0);

    // 점수 재계산
    updateScore();
  }

  // 이동 기록 관리
  const turn = document.getElementById("turn");
  const curTurn = parseInt(turn.value, 10);
  document.getElementById("prev").disabled = false;

  // 로그를 되돌린 상태에서의 동작은 이후의 로그를 삭제하게 해요.
  while (log.length > curTurn) {
    log.pop();
  }

  log.push({ i, x, y, t });
  turn.value = curTurn + 1;

  // 객체 이동
  setPieces(i, x, y, true);

  // 선택 상자 및 이동가능 경로 후보지 삭제
  clearCandiBox();
  
  const tmpAxis = getAxis(x, y);
  selectBox.setAttribute("x", tmpAxis.x - unitSize / 2);
  selectBox.setAttribute("y", tmpAxis.y - unitSize / 2);

  const recordBox = document.getElementById("record-box");
  if (recordBox && recordBox.style.display === "flex") {
    updateRecordUI();
  }
  updateCommentBubble();

  // 외통수 여부 판단
  checkGameStatus();

  // AI 플레이 대기 및 실행 트리거
  if (!gameEnded) {
    checkAndRunAI();
  }
}

/**
 * 기록된 기보에서 한 수 앞으로(다음 수) 진행합니다.
 */
function next() {
  clearCandiBox();

  const turn = document.getElementById("turn");
  const curTurn = parseInt(turn.value, 10);

  if (log.length > curTurn) {
    setPieces(log[curTurn].i, log[curTurn].x, log[curTurn].y, true);

    curSelect = NO_PIECE;
    moveSelectBox(log[curTurn].i);

    if (log[curTurn].t !== NO_PIECE) {
      setPieces(log[curTurn].t, 0, 0, true);
    }

    turn.value = curTurn + 1;

    if (log.length - 1 === curTurn) {
      document.getElementById("next").disabled = true;
    }
    document.getElementById("prev").disabled = false;
  }
  updateScore();
  
  const recordBox = document.getElementById("record-box");
  if (recordBox && recordBox.style.display === "flex") {
    updateRecordUI();
  }

  checkGameStatus();
  updateCommentBubble();
  checkAndRunAI();
}

/**
 * 단일 수순을 한 수 뒤로(이전 수) 되돌립니다.
 */
function performSinglePrev() {
  clearCandiBox();
  gameEnded = false;

  const turn = document.getElementById("turn");
  const curTurn = parseInt(turn.value, 10) - 1;

  if (curTurn >= 0) {
    if (log[curTurn].t !== NO_PIECE) {
      setPieces(log[curTurn].t, log[curTurn].x, log[curTurn].y, true);
    }

    const originPos = whereWasIt(log[curTurn].i, curTurn - 1);
    setPieces(log[curTurn].i, originPos.x, originPos.y, true);

    curSelect = NO_PIECE;
    moveSelectBox(log[curTurn].i);

    turn.value = curTurn;

    if (curTurn === 0) {
      document.getElementById("prev").disabled = true;
    }
    document.getElementById("next").disabled = false;
  }
  updateScore();
  
  const recordBox = document.getElementById("record-box");
  if (recordBox && recordBox.style.display === "flex") {
    updateRecordUI();
  }
  updateCommentBubble();
}

/**
 * 한 수(AI 대국 시 내 차례면 두 수) 무르기를 수행합니다.
 */
function prev() {
  if (aiMode !== 0) {
    const turn = document.getElementById("turn");
    if (turn) {
      const curTurn = parseInt(turn.value, 10);
      const isChoTurn = (curTurn % 2 === 0);
      const isUserTurnNow = (isChoTurn === iAmCho);
      
      if (isUserTurnNow && log.length >= 2) {
        performSinglePrev();
        performSinglePrev();
        checkAndRunAI();
        return;
      }
    }
  }
  performSinglePrev();
  checkAndRunAI();
}

/**
 * 하단(0) 또는 상단(1) 진영의 상차림을 변경합니다.
 * @param {0|1} group - 0: 하단(나), 1: 상단(상대)
 * @param {0|1|2|3} type - 0: 마상마상, 1: 마상상마, 2: 상마마상, 3: 상마상마
 * @param {HTMLElement|null} [element] - 클릭된 버튼 엘리먼트
 */
function changeCharim(group, type, element) {
  newGameState[group] = type;
  syncCharimButtonStyles();
  saveCurrentConfigToSlot();
  currentLoadedRecordId = null;
  updateSavedRecordsListUI();
}

/**
 * 상차림 선택 버튼의 활성화 색상과 미리보기 배치를 동기화합니다.
 */
function syncCharimButtonStyles() {
  let charimGroup = document.getElementsByClassName("charim0");
  Array.from(charimGroup).forEach((element, i) => {
    element.style.backgroundColor = (i === newGameState[0]) ? "#3b82f6" : "#1e293b";
  });

  charimGroup = document.getElementsByClassName("charim1");
  Array.from(charimGroup).forEach((element, i) => {
    element.style.backgroundColor = (i === newGameState[1]) ? "#3b82f6" : "#1e293b";
  });
  
  updateCharimPreview();
}

/**
 * 설정창 내 상/하단 상차림 미니어처 미리보기를 렌더링합니다.
 */
function updateCharimPreview() {
  const previewHan = document.getElementById("preview-han");
  const previewCho = document.getElementById("preview-cho");
  if (!previewHan || !previewCho) return;
  
  const layouts = [
    ["馬", "象", "馬", "象"], // 0: 마상마상
    ["馬", "象", "象", "馬"], // 1: 마상상마
    ["象", "馬", "馬", "象"], // 2: 상마마상
    ["象", "馬", "象", "馬"]  // 3: 상마상마
  ];
  
  const hanL = layouts[newGameState[1]];
  const choL = layouts[newGameState[0]];
  
  const topIsCho = !iAmCho;
  const bottomIsCho = iAmCho;
  
  const topTokenClass = topIsCho ? "preview-token-cho" : "preview-token-han";
  const bottomTokenClass = bottomIsCho ? "preview-token-cho" : "preview-token-han";
  
  previewHan.innerHTML = `
    <span class="preview-token preview-token-neutral">車</span>
    <span class="preview-token ${topTokenClass}">${hanL[0]}</span>
    <span class="preview-token ${topTokenClass}">${hanL[1]}</span>
    <span class="preview-token preview-token-neutral">士</span>
    <span class="preview-token preview-token-empty"></span>
    <span class="preview-token preview-token-neutral">士</span>
    <span class="preview-token ${topTokenClass}">${hanL[2]}</span>
    <span class="preview-token ${topTokenClass}">${hanL[3]}</span>
    <span class="preview-token preview-token-neutral">車</span>
  `;
  
  previewCho.innerHTML = `
    <span class="preview-token preview-token-neutral">車</span>
    <span class="preview-token ${bottomTokenClass}">${choL[0]}</span>
    <span class="preview-token ${bottomTokenClass}">${choL[1]}</span>
    <span class="preview-token preview-token-neutral">士</span>
    <span class="preview-token preview-token-empty"></span>
    <span class="preview-token preview-token-neutral">士</span>
    <span class="preview-token ${bottomTokenClass}">${choL[2]}</span>
    <span class="preview-token ${bottomTokenClass}">${choL[3]}</span>
    <span class="preview-token preview-token-neutral">車</span>
  `;
}

/**
 * 플레이어의 진영(초/한)을 설정하고 기물 바인딩 및 상차림 미리보기를 갱신합니다.
 * @param {boolean} amIcho - 하단 플레이어가 초나라인지 여부
 */
function changeNation(amIcho) {
  iAmCho = amIcho;
  const topEl = document.getElementById("nation-top");
  const bottomEl = document.getElementById("nation-bottom");
  if (!topEl || !bottomEl) return;
  
  if (amIcho) {
    bottomEl.style.backgroundColor = "#3b82f6";
    bottomEl.style.color = "white";
    bottomEl.textContent = "초";
    
    topEl.style.backgroundColor = "#ef4444";
    topEl.style.color = "white";
    topEl.textContent = "한";
  } else {
    bottomEl.style.backgroundColor = "#ef4444";
    bottomEl.style.color = "white";
    bottomEl.textContent = "한";
    
    topEl.style.backgroundColor = "#3b82f6";
    topEl.style.color = "white";
    topEl.textContent = "초";
  }
  
  // Re-bind pieces elements to match the new iAmCho state
  initElements();
  
  updateCharimPreview();
  saveCurrentConfigToSlot();
  currentLoadedRecordId = null;
  updateSavedRecordsListUI();
}

/**
 * 초/한 진영을 맞바꾸고 새 초기 배치 상태로 보드를 재설정합니다.
 */
function toggleNation() {
  changeNation(!iAmCho);
  
  // 1. 착수 로그 및 상태 초기화
  log.length = 0;
  const turnEl = document.getElementById("turn");
  if (turnEl) turnEl.value = 0;
  gameEnded = false;
  curSelect = NO_PIECE;
  clearCandiBox();
  const selectBox = document.getElementById("select-box");
  if (selectBox) {
    selectBox.setAttribute("x", HIDDEN_COORD);
    selectBox.setAttribute("y", HIDDEN_COORD);
  }

  // 2. 현재 설정한 상차림에 부합하는 배치 데이터 산출 및 복원
  const startingLayoutCode = getStartingLayoutCode();
  applyLayoutCode(startingLayoutCode);

  // 3. 보드 및 기물 위치 갱신
  svg.classList.add("no-transition");
  initBoard();
  initPositions();
  svg.offsetHeight; // Force reflow
  svg.classList.remove("no-transition");

  saveCurrentConfigToSlot();
  checkAndRunAI();
}

/**
 * 현재 장기판 SVG를 PNG 이미지(janggi.png)로 변환하여 다운로드합니다.
 */
function download() {
  const svgData = new XMLSerializer().serializeToString(svg);
  const svgImage = new Image();
  svgImage.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = boardWidth;
    canvas.height = boardHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(svgImage, 0, 0, boardWidth, boardHeight);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = "janggi.png";
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  svgImage.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);
}

/**
 * 페이지 내 input 및 button 엘리먼트의 글자 크기를 일괄 증감합니다.
 * @param {number} amount - 증감할 픽셀(px) 크기
 */
function changeFontSize(amount) {
  const elements = document.querySelectorAll("input, button");
  elements.forEach(element => {
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${fontSize + amount}px`;
  });
}

/**
 * 장기판 외곽 좌표 표시 여부를 토글합니다.
 */
function toggleCoordinates() {
  showCoordinates = !showCoordinates;
  localStorage.setItem("showCoordinates", showCoordinates);
  const btn = document.getElementById("toggle-coords-btn-settings");
  if (btn) {
    btn.textContent = showCoordinates ? "좌표 표시 중" : "좌표 숨김 중";
  }
  svg.classList.add("no-transition");
  initBoard();
  initPositions();
  svg.offsetHeight; // Force reflow
  svg.classList.remove("no-transition");
  saveCurrentConfigToSlot();
}

/**
 * 현재 선택된 상차림과 진영 설정으로 새 대국을 시작합니다.
 */
function startNewGame() {
  gameEnded = false;
  // 1. 착수 로그 비우기
  log.length = 0;
  
  // 2. 턴 수 0으로 초기화
  const turnEl = document.getElementById("turn");
  if (turnEl) turnEl.value = 0;
  
  // 3. 현재 설정한 상차림에 부합하는 배치 데이터 산출
  const startingLayoutCode = getStartingLayoutCode();
  
  // 4. 기물 위치 데이터 복원
  applyLayoutCode(startingLayoutCode);
  
  // 5. 기물 선택 상태 초기화
  curSelect = NO_PIECE;
  clearCandiBox();
  const selectBox = document.getElementById("select-box");
  if (selectBox) {
    selectBox.setAttribute("x", HIDDEN_COORD);
    selectBox.setAttribute("y", HIDDEN_COORD);
  }
  
  // 6. 점수판 및 순위 갱신
  updateScore();
  
  // 7. 기물들을 초기 배치 좌표로 즉시 이동시킵니다. (트랜지션 애니메이션 차단)
  svg.classList.add("no-transition");
  initPositions();
  svg.offsetHeight; // force reflow
  svg.classList.remove("no-transition");
  
  // 8. 설정창 닫기
  hideSettingsPanel();
  
  // 9. 메타데이터 및 타이머 리셋
  gameMetadata = {
    choPlayer: "",
    hanPlayer: "",
    tournament: "",
    round: "",
    nickname: "",
    summary: ""
  };
  updateMetadataFormFromState();
  updateMetadataDisplay();
  initScoreboardRotation();
  updateCommentBubble();
  checkAndRunAI();
}

// 글로벌 전역 액션 함수 익스포트
window.toggleNation = toggleNation;
window.disalbeSettingBox = disalbeSettingBox;
window.enalbeSettingBox = enalbeSettingBox;
window.hideSettingsPanel = hideSettingsPanel;
window.showSettingsPanel = showSettingsPanel;
window.prev = prev;
window.next = next;
window.download = download;
window.toggleCoordinates = toggleCoordinates;
window.changeCharim = changeCharim;

/**
 * 애플리케이션 초기 부트스트랩 및 전역 이벤트 리스너를 등록합니다.
 */
function initGame() {
  // 1. 데이터 및 기물 DOM 바인딩 선행 수행
  initData();
  
  // URL에서 대국 정보를 읽은 직후, 주소창의 대국 상태 파라미터(p, log, t, cho)만 비워 새로고침 시 무조건 새 게임이 시작되도록 함
  const url = new URL(window.location.href);
  if (url.searchParams.has("p") || url.searchParams.has("log") || url.searchParams.has("t") || url.searchParams.has("cho")) {
    url.searchParams.delete("p");
    url.searchParams.delete("log");
    url.searchParams.delete("t");
    url.searchParams.delete("cho");
    window.history.replaceState({}, "", url.toString());
  }
  
  // active slot 로드
  if (localStorage.getItem("janggi_active_slot") !== null) {
    activeSlot = parseInt(localStorage.getItem("janggi_active_slot"), 10);
  }
  updateSlotButtonsUI();
  
  // 슬롯으로부터 구성정보 로드
  loadConfigFromSlot();

  // 로컬 스토리지 개별값 로드 대응
  if (localStorage.getItem("aiMode") !== null) {
    aiMode = parseInt(localStorage.getItem("aiMode"), 10);
    if (aiMode === 2) aiMode = 1;
  }
  if (localStorage.getItem("cursorLockMode") !== null) {
    cursorLockMode = (localStorage.getItem("cursorLockMode") === "true");
  }
  if (localStorage.getItem("shortcutKeys") !== null) {
    try {
      const parsedKeys = JSON.parse(localStorage.getItem("shortcutKeys"));
      shortcutKeys = migrateShortcutKeys(parsedKeys);
    } catch (e) {
      console.error("Failed parsing shortcutKeys from localStorage:", e);
    }
  }
  if (localStorage.getItem("shortcutModalBgColor") !== null) {
    shortcutModalBgColor = localStorage.getItem("shortcutModalBgColor");
  }
  if (localStorage.getItem("shortcutModalOpacity") !== null) {
    shortcutModalOpacity = parseFloat(localStorage.getItem("shortcutModalOpacity"));
  }
  if (localStorage.getItem("commentBoxBgColor") !== null) {
    commentBoxBgColor = localStorage.getItem("commentBoxBgColor");
  }
  if (localStorage.getItem("commentBoxOpacity") !== null) {
    commentBoxOpacity = parseFloat(localStorage.getItem("commentBoxOpacity"));
  }
  if (localStorage.getItem("commentDisplayDuration") !== null) {
    commentDisplayDuration = parseInt(localStorage.getItem("commentDisplayDuration"), 10);
  }
  if (localStorage.getItem("autoplaySpeed") !== null) {
    autoplaySpeed = parseFloat(localStorage.getItem("autoplaySpeed"));
  }
  if (localStorage.getItem("autoplayUseAnim") !== null) {
    autoplayUseAnim = (localStorage.getItem("autoplayUseAnim") === "true");
  }

  applyLoadedConfig();

  const turnEl = document.getElementById("turn");
  if (turnEl) {
    turnEl.addEventListener("change", function() {
      let targetTurn = parseInt(this.value, 10);
      if (isNaN(targetTurn)) return;
      if (targetTurn < 0) targetTurn = 0;
      if (targetTurn > log.length) targetTurn = log.length;
      this.value = targetTurn;
      
      svg.classList.add("no-transition");
      initPositions();
      updateScore();
      
      document.getElementById("prev").disabled = (targetTurn === 0);
      document.getElementById("next").disabled = (targetTurn === log.length);
      
      curSelect = NO_PIECE;
      clearCandiBox();
      const selectBox = document.getElementById("select-box");
      if (selectBox) {
        selectBox.setAttribute("x", HIDDEN_COORD);
        selectBox.setAttribute("y", HIDDEN_COORD);
      }
      
      svg.offsetHeight;
      svg.classList.remove("no-transition");
      
      const recordBox = document.getElementById("record-box");
      if (recordBox && recordBox.style.display === "flex") {
        updateRecordUI();
      }
      
      updateCommentBubble();
      checkAndRunAI();
    });
  }

  let resizeRafId = null;
  window.addEventListener("resize", () => {
    if (resizeRafId !== null) {
      cancelAnimationFrame(resizeRafId);
    }
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = null;
      svg.classList.add("no-transition");
      initBoard();
      initPositions();
      svg.offsetHeight; // Force reflow
      svg.classList.remove("no-transition");
    });
  });

  // 키보드 단축키 방향키 및 엔터 리스너 등록
  window.addEventListener("keydown", handleKeyDown, true);
}

initGame();
