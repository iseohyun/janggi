/**
 * @fileoverview 기보 텍스트 생성/파싱, 클립보드 연동, localStorage 기보 보관함 관리 모듈.
 * @module record
 * @depends state, rules, board, ai
 */

/**
 * 상차림 번호(0~3)를 한글 상차림 이름으로 변환합니다.
 * @param {number} type - 상차림 번호
 * @returns {string} 상차림 이름
 */
function getLayoutName(type) {
  const names = ["마상마상", "마상상마", "상마마상", "상마상마"];
  return names[type] || "마상마상";
}

/**
 * 현재 점수 우세 문자열(예: "초_2.5점")을 반환합니다.
 * @returns {string} 점수 우세 요약 문자열
 */
function getScoreLeadString() {
  const { scoreCho, scoreHan } = calculateTeamScores();

  if (scoreHan > scoreCho) {
    return `한_${(scoreHan - scoreCho).toFixed(1)}점`;
  } else if (scoreCho > scoreHan) {
    return `초_${(scoreCho - scoreHan).toFixed(1)}점`;
  } else {
    return `동점_0.0점`;
  }
}

/**
 * initPieces 배열로부터 64자리 초기 배치 문자열을 생성합니다.
 * @returns {string} 64자리 배치 코드
 */
function getStartingCode() {
  let code = "";
  for (let idx = 0; idx < 32; idx++) {
    code += `${initPieces[idx].x}${initPieces[idx].y}`;
  }
  return code;
}

/**
 * localStorage에서 저장된 기보 목록을 안전하게 읽어옵니다.
 * @returns {Array<{id: number, name: string, date: string, text: string}>}
 */
function getSavedRecords() {
  try {
    const raw = localStorage.getItem("janggi_saved_records");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("저장된 기보 목록을 불러오는 중 오류가 발생했습니다:", e);
    return [];
  }
}

/**
 * localStorage에 기보 목록을 안전하게 저장합니다.
 * @param {Array<{id: number, name: string, date: string, text: string}>} records
 */
function setSavedRecords(records) {
  try {
    localStorage.setItem("janggi_saved_records", JSON.stringify(records));
  } catch (e) {
    console.error("기보 목록 저장 실패:", e);
  }
}

/**
 * 현재까지의 log 배열을 기반으로 각 수의 출발/도착 좌표와 기물명을 재구성합니다.
 * @returns {Array<Object>} 수순 히스토리 배열
 */
function rebuildHistory() {
  const tempPieces = [];
  for (let idx = 0; idx < 32; idx++) {
    tempPieces[idx] = { x: initPieces[idx].x, y: initPieces[idx].y };
  }
  
  const history = [];
  for (let step = 0; step < log.length; step++) {
    const moveInfo = log[step];
    const i = moveInfo.i;
    const endX = moveInfo.x;
    const endY = moveInfo.y;
    const t = moveInfo.t;
    
    const startX = tempPieces[i].x;
    const startY = tempPieces[i].y;
    
    // Bottom player (0..15) is always called "초" (Zol) in the record text representation.
    // Top player (16..31) is always called "한" (Byeong).
    const player = (i <= 15) ? "초" : "한";
    
    let pieceName = "";
    if (i === 0) pieceName = "궁";
    else if (i === 1 || i === 2) pieceName = "차";
    else if (i === 3 || i === 4) pieceName = "포";
    else if (i === 5 || i === 6) pieceName = "마";
    else if (i === 7 || i === 8) pieceName = "상";
    else if (i === 9 || i === 10) pieceName = "사";
    else if (i >= 11 && i <= 15) pieceName = "졸";
    else if (i === 16) pieceName = "궁";
    else if (i === 17 || i === 18) pieceName = "차";
    else if (i === 19 || i === 20) pieceName = "포";
    else if (i === 21 || i === 22) pieceName = "마";
    else if (i === 23 || i === 24) pieceName = "상";
    else if (i === 25 || i === 26) pieceName = "사";
    else if (i >= 27 && i <= 31) pieceName = "병";
    
    history.push({
      step: step + 1,
      player,
      pieceName,
      startX,
      startY,
      endX,
      endY,
      captured: t,
      comment: moveInfo.comment || ""
    });
    
    tempPieces[i].x = endX;
    tempPieces[i].y = endY;
    if (t < NO_PIECE) {
      tempPieces[t].x = 0;
      tempPieces[t].y = 0;
    }
  }
  
  return history;
}

/**
 * 현재 대국의 메타데이터, 상차림, 수순을 표준 기보 텍스트로 변환합니다.
 * @returns {string} 기보 텍스트
 */
function generateGameRecordText() {
  const choLayout = getLayoutName(iAmCho ? newGameState[0] : newGameState[1]);
  const hanLayout = getLayoutName(iAmCho ? newGameState[1] : newGameState[0]);
  
  // Game record normalized description (Cho bottom, Han top)
  const sideLayoutDesc = `초하(${choLayout}) vs 한상(${hanLayout})`;
  
  const lines = [];
  lines.push(`상차림: ${sideLayoutDesc}`);
  
  if (gameMetadata.choPlayer) lines.push(`초나라: ${gameMetadata.choPlayer}`);
  if (gameMetadata.hanPlayer) lines.push(`한나라: ${gameMetadata.hanPlayer}`);
  if (gameMetadata.tournament) lines.push(`대회명: ${gameMetadata.tournament}`);
  if (gameMetadata.round) lines.push(`대국정보: ${gameMetadata.round}`);
  if (gameMetadata.nickname) lines.push(`기보별명: ${gameMetadata.nickname}`);
  if (gameMetadata.summary) {
    const cleanSummary = gameMetadata.summary.replace(/\r?\n/g, "  ");
    lines.push(`총평: ${cleanSummary}`);
  }
  
  lines.push("");
  
  const history = rebuildHistory();
  history.forEach(h => {
    const commentSuffix = h.comment ? ` (${h.comment})` : "";
    lines.push(`${h.step}. ${h.player} ${h.startY}${h.startX}${h.pieceName}${h.endY}${h.endX}${commentSuffix}`);
  });
  
  return lines.join("\n");
}

/**
 * 기보 관리 패널을 엽니다.
 */
function openRecordModal() {
  const recordBox = document.getElementById("record-box");
  if (recordBox) {
    recordBox.style.display = "flex";
    
    const article = document.getElementById("janggi-app");
    if (article) article.classList.add("record-open");
    
    updateRecordUI();
    updateSavedRecordsListUI();
  }
}

/**
 * 기보 관리 패널을 닫습니다.
 */
function closeRecordModal() {
  const recordBox = document.getElementById("record-box");
  if (recordBox) {
    recordBox.style.display = "none";
    
    const article = document.getElementById("janggi-app");
    if (article) article.classList.remove("record-open");
  }
}

/**
 * 클립보드에서 기보 텍스트를 읽어와 대국을 복원합니다.
 */
function loadRecordFromClipboard() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(text => {
      if (text && text.trim()) {
        importRecordFromText(text);
        currentLoadedRecordId = null;
        updateSavedRecordsListUI();
        showToast("기보를 복원하였습니다.");
      } else {
        fallbackPromptLoad();
      }
    }).catch(err => {
      console.warn("Failed to read clipboard using Clipboard API, trying prompt fallback:", err);
      fallbackPromptLoad();
    });
  } else {
    fallbackPromptLoad();
  }
}

/**
 * 클립보드 API를 사용할 수 없을 때 프롬프트 입력창을 통해 기보를 복원합니다.
 */
function fallbackPromptLoad() {
  const text = prompt("클립보드에서 가져오지 못했습니다. 복사한 기보 텍스트를 여기에 붙여넣어 주세요:");
  if (text && text.trim()) {
    importRecordFromText(text);
    currentLoadedRecordId = null;
    updateSavedRecordsListUI();
    showToast("기보를 복원하였습니다.");
  }
}

/**
 * 기보 텍스트 영역 UI를 최신화합니다.
 */
function updateRecordUI() {
  const recordTextArea = document.getElementById("record-text-area");
  if (recordTextArea) {
    recordTextArea.value = generateGameRecordText();
  }
}

/**
 * 현재 기보를 클립보드에 복사하고 로컬 기보 보관함에 저장합니다.
 * @param {HTMLElement|null} btn - 클릭된 버튼 엘리먼트 (시각적 피드백용)
 */
function saveRecordToLibrary(btn) {
  const recordText = generateGameRecordText();
  
  // 1. 클립보드 복사
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(recordText).then(() => {
      showToast("기보가 클립보드에 복사 및 저장되었습니다!");
      if (btn) {
        btn.classList.add("success");
        btn.disabled = true;
        setTimeout(() => {
          btn.classList.remove("success");
          btn.disabled = false;
        }, 1000);
      }
    }).catch(err => {
      console.error("클립보드 복사 실패", err);
      alert("클립보드 복사에 실패하였습니다.");
    });
  }

  // 2. localStorage 보관함 저장
  const bottomLayout = getLayoutName(newGameState[0]);
  const topLayout = getLayoutName(newGameState[1]);
  let sideLayoutDesc = "";
  if (iAmCho) {
    sideLayoutDesc = `초하(${bottomLayout}) vs 한상(${topLayout})`;
  } else {
    sideLayoutDesc = `한하(${bottomLayout}) vs 초상(${topLayout})`;
  }
  const recordName = `${sideLayoutDesc}_${log.length}수_${getScoreLeadString()}`;
  
  const now = new Date();
  const saveDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  const newRecord = {
    id: Date.now(),
    name: recordName,
    date: saveDate,
    text: recordText
  };
  
  const saved = getSavedRecords();
  saved.unshift(newRecord);
  setSavedRecords(saved);
  
  // 방금 저장한 기보를 현재 불러온 기보로 활성화 처리
  currentLoadedRecordId = newRecord.id;

  // 3. UI 갱신
  updateSavedRecordsListUI();
}

/**
 * 보관함에 저장된 특정 기보의 이름을 변경합니다.
 * @param {number} id - 기보 고유 ID
 */
function renameSavedRecord(id) {
  const saved = getSavedRecords();
  const recordIndex = saved.findIndex(r => r.id === id);
  if (recordIndex === -1) return;
  
  const currentName = saved[recordIndex].name;
  const newName = prompt("기보 이름을 변경하시겠습니까?", currentName);
  if (newName === null) return; // User cancelled
  
  const trimmedName = newName.trim();
  if (!trimmedName) {
    alert("이름은 비워둘 수 없습니다.");
    return;
  }
  
  saved[recordIndex].name = trimmedName;
  setSavedRecords(saved);
  updateSavedRecordsListUI();
  showToast("이름이 수정되었습니다.");
}

/**
 * 저장된 기보 보관함 리스트 UI를 안전하게(XSS 방지 및 이벤트 위임 적용) 렌더링합니다.
 */
function updateSavedRecordsListUI() {
  const container = document.getElementById("saved-records-list");
  if (!container) return;
  
  container.innerHTML = "";
  const saved = getSavedRecords();
  
  if (saved.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "saved-records-empty";
    emptyEl.textContent = "저장된 기보가 없습니다.";
    container.appendChild(emptyEl);
    return;
  }
  
  saved.forEach(record => {
    const isCurrent = record.id === currentLoadedRecordId;
    const row = document.createElement("div");
    row.className = "saved-record-row" + (isCurrent ? " active" : "");

    const infoDiv = document.createElement("div");
    infoDiv.className = "saved-record-info";

    const nameSpan = document.createElement("span");
    nameSpan.className = "saved-record-name";
    nameSpan.textContent = record.name;

    const dateSpan = document.createElement("span");
    dateSpan.className = "saved-record-date";
    dateSpan.textContent = record.date;

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(dateSpan);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "saved-record-actions";
    actionsDiv.innerHTML = `
      <button class="saved-record-btn load-btn" data-action="loadSavedRecord" data-record-id="${record.id}" title="기보 불러오기">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
      <button class="saved-record-btn edit-btn" data-action="renameSavedRecord" data-record-id="${record.id}" title="이름 수정">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      <button class="saved-record-btn delete-btn" data-action="deleteSavedRecord" data-record-id="${record.id}" data-stop-propagation="true" title="기보 삭제">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    `;

    row.appendChild(infoDiv);
    row.appendChild(actionsDiv);
    container.appendChild(row);
  });
}

/**
 * 보관함에서 특정 ID의 기보를 불러와 대국을 복원합니다.
 * @param {number} id - 기보 고유 ID
 */
function loadSavedRecord(id) {
  const saved = getSavedRecords();
  const record = saved.find(r => r.id === id);
  if (record) {
    importRecordFromText(record.text);
    currentLoadedRecordId = id;
    updateSavedRecordsListUI();
    showToast("기보를 불러왔습니다.");
  }
}

/**
 * 보관함에서 특정 ID의 기보를 삭제합니다.
 * @param {number} id - 기보 고유 ID
 * @param {Event} [event] - 클릭 이벤트
 */
function deleteSavedRecord(id, event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  if (!confirm("이 기보를 정말 삭제하시겠습니까?")) return;
  
  const saved = getSavedRecords().filter(r => r.id !== id);
  setSavedRecords(saved);
  
  if (currentLoadedRecordId === id) {
    currentLoadedRecordId = null;
  }
  
  updateSavedRecordsListUI();
  showToast("기보가 삭제되었습니다.");
}

/**
 * 보관함에 저장된 모든 기보를 삭제합니다.
 */
function clearAllSavedRecords() {
  if (!confirm("모든 저장된 기보를 삭제하시겠습니까?")) return;
  localStorage.removeItem("janggi_saved_records");
  currentLoadedRecordId = null;
  updateSavedRecordsListUI();
  showToast("모든 기보가 삭제되었습니다.");
}

/**
 * 기보 텍스트의 개별 착수 줄을 파싱합니다.
 * @param {string} line - 파싱할 줄 문자열
 * @param {number} index - 유효 착수 인덱스 (0부터 시작)
 * @returns {Object|null} 파싱된 착수 정보 객체 또는 null
 */
function parseMoveLine(line, index) {
  let clean = line.trim();
  if (!clean) return null;
  
  // 마크다운 강조 기호 제거
  clean = clean.replace(/[\*_`]/g, "").trim();
  
  // Extract comment if present inside parentheses
  let comment = "";
  const commentMatch = clean.match(/\(([^)]+)\)/);
  if (commentMatch) {
    comment = commentMatch[1].trim();
    clean = clean.replace(/\([^)]+\)/, "").trim();
  }
  
  // Extract step number if present at start (e.g., "1. " or "1: ")
  let step = null;
  const stepMatch = clean.match(/^(\d+)\s*[\.:]/);
  if (stepMatch) {
    step = parseInt(stepMatch[1], 10);
    clean = clean.replace(/^(\d+)\s*[\.:]/, "").trim();
  }
  
  // Extract player if present
  let player = null;
  if (clean.includes("초")) {
    player = "초";
    clean = clean.replace("초", "").trim();
  } else if (clean.includes("한")) {
    player = "한";
    clean = clean.replace("한", "").trim();
  }
  
  // Remove arrows and normalize whitespaces
  clean = clean.replace(/->|=>/g, "").replace(/\s+/g, "");
  
  // Extract all digits and optional piece character
  const pieceMatch = clean.match(/[궁차포마상사졸병]/);
  const pieceName = pieceMatch ? pieceMatch[0] : "";
  if (!pieceName) return null;
  
  const digits = clean.replace(/[^0-9]/g, "");
  
  let startStr = "";
  let endStr = "";
  
  if (digits.length === 4) {
    startStr = digits.slice(0, 2);
    endStr = digits.slice(2);
  } else if (digits.length === 5) {
    if (digits.startsWith("10")) {
      startStr = digits.slice(0, 3);
      endStr = digits.slice(3);
    } else {
      startStr = digits.slice(0, 2);
      endStr = digits.slice(2);
    }
  } else if (digits.length === 6) {
    startStr = digits.slice(0, 3);
    endStr = digits.slice(3);
  } else {
    return null;
  }
  
  const startX = parseInt(startStr.slice(-1), 10);
  let startY = parseInt(startStr.slice(0, -1), 10);
  if (startY === 10) startY = 0;
  
  const endX = parseInt(endStr.slice(-1), 10);
  let endY = parseInt(endStr.slice(0, -1), 10);
  if (endY === 10) endY = 0;
  
  if (startX < 1 || startX > 9 || startY < 0 || startY > 9) return null;
  if (endX < 1 || endX > 9 || endY < 0 || endY > 9) return null;
  
  if (!player) {
    player = (index % 2 === 0) ? "초" : "한";
  }
  if (!step) {
    step = index + 1;
  }
  
  return { step, player, startX, startY, endX, endY, pieceName, comment };
}

/**
 * 기보 텍스트 내 졸/병의 초기 Y좌표를 분석하여 하단 진영이 초나라인지 판별합니다.
 * @param {string} text - 기보 전체 텍스트
 * @returns {boolean} 초나라가 하단인지 여부
 */
function determineIAmChoFromText(text) {
  const lines = text.split("\n");
  let validLineIdx = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const parsed = parseMoveLine(lines[idx], validLineIdx);
    if (parsed) {
      validLineIdx++;
      if (parsed.pieceName) {
        const isZol = parsed.pieceName === "졸";
        const isByung = parsed.pieceName === "병";
        if (isZol || isByung) {
          const isBottom = parsed.startY >= 6 || parsed.startY === 0;
          if (isZol) {
            return isBottom;
          } else {
            return !isBottom;
          }
        }
      }
    }
  }
  return true; // Default fallback: bottom is Cho
}

/**
 * 기보 텍스트에서 상차림 헤더를 파싱합니다.
 * @param {string} text - 기보 전체 텍스트
 * @returns {{startingCode: string, determinedChoIsBottom: boolean}|null}
 */
function parseLayoutText(text) {
  const lines = text.split("\n");
  for (let line of lines) {
    const clean = line.replace(/\s+/g, "");
    // Match "초하(마상마상)vs한상(마상마상)" pattern
    const match = clean.match(/(초|한)(하|상)\((마상마상|마상상마|상마마상|상마상마)\)vs(초|한)(하|상)\((마상마상|마상상마|상마마상|상마상마)\)/);
    if (match) {
      const side1 = match[1];
      const pos1 = match[2];
      const layout1 = match[3];
      
      const side2 = match[4];
      const pos2 = match[5];
      const layout2 = match[6];
      
      let bottomLayoutStr = "";
      let topLayoutStr = "";
      let determinedChoIsBottom = true;
      
      if (pos1 === "하") {
        bottomLayoutStr = layout1;
        determinedChoIsBottom = (side1 === "초");
      } else {
        topLayoutStr = layout1;
      }
      
      if (pos2 === "하") {
        bottomLayoutStr = layout2;
        determinedChoIsBottom = (side2 === "초");
      } else {
        topLayoutStr = layout2;
      }
      
      const names = ["마상마상", "마상상마", "상마마상", "상마상마"];
      const bottomType = names.indexOf(bottomLayoutStr);
      const topType = names.indexOf(topLayoutStr);
      
      if (bottomType !== -1 && topType !== -1) {
        const startingCode = knownStart[0][bottomType] + knownStart[1][topType];
        return { startingCode, determinedChoIsBottom };
      }
    }
  }

  // Fallback: 유연한 매칭 (상차림: 키워드가 들어간 줄)
  for (let line of lines) {
    const clean = line.replace(/[\*_`]/g, "").trim();
    if (clean.startsWith("상차림:")) {
      const content = clean.substring(4).trim();
      const names = ["마상마상", "마상상마", "상마마상", "상마상마"];
      
      const foundLayouts = [];
      for (let name of names) {
        if (content.includes(name)) {
          foundLayouts.push(name);
        }
      }
      
      if (foundLayouts.length === 1) {
        const layout = foundLayouts[0];
        const typeIdx = names.indexOf(layout);
        const startingCode = knownStart[0][typeIdx] + knownStart[1][typeIdx];
        return { startingCode, determinedChoIsBottom: true };
      } else if (foundLayouts.length >= 2) {
        const typeIdx1 = names.indexOf(foundLayouts[0]);
        const typeIdx2 = names.indexOf(foundLayouts[1]);
        const startingCode = knownStart[0][typeIdx1] + knownStart[1][typeIdx2];
        return { startingCode, determinedChoIsBottom: true };
      }
    }
  }
  return null;
}

/**
 * 기보 텍스트 전체를 파싱하여 메타데이터, 초기 상차림, 수순 로그를 보드에 적용합니다.
 * @param {string} text - 기보 텍스트
 */
function importRecordFromText(text) {
  if (!text || !text.trim()) {
    alert("기보 데이터가 비어 있습니다.");
    return;
  }
  
  // 마크다운 강조 표시(*, **, ` 등) 제거하여 파싱 안정성 확보
  text = text.replace(/[\*_`]/g, "");
  
  gameEnded = false;
  
  // 0. 메타데이터 초기화 및 파싱
  gameMetadata = {
    choPlayer: "",
    hanPlayer: "",
    tournament: "",
    round: "",
    nickname: "",
    summary: ""
  };
  
  const rawLines = text.split("\n");
  for (let line of rawLines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    if (cleanLine.match(/^(\d+)\s*[\.:]/)) {
      break; // 첫 착수가 등장하면 헤더 파싱 중단
    }
    const parts = cleanLine.split(":");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join(":").trim();
      if (key === "초나라") gameMetadata.choPlayer = val;
      else if (key === "한나라") gameMetadata.hanPlayer = val;
      else if (key === "대회명") gameMetadata.tournament = val;
      else if (key === "대국정보") gameMetadata.round = val;
      else if (key === "기보별명") gameMetadata.nickname = val;
      else if (key === "총평") gameMetadata.summary = val;
    }
  }
  
  updateMetadataFormFromState();
  updateMetadataDisplay();

  // 1. 상차림 코드 및 진영(iAmCho) 파싱
  let startingCode = "";
  let determinedCho = true;
  
  const layoutTextMatch = parseLayoutText(text);
  if (layoutTextMatch) {
    startingCode = layoutTextMatch.startingCode;
    determinedCho = layoutTextMatch.determinedChoIsBottom;
  } else {
    const layoutMatch = text.match(/\b\d{64}\b/);
    if (layoutMatch) {
      startingCode = layoutMatch[0];
    } else {
      startingCode = getStartingCode();
    }
    determinedCho = determineIAmChoFromText(text);
  }

  // 2. 착수 로그 파싱
  const parsedMoves = [];
  let validLineIdx = 0;
  for (let line of rawLines) {
    const move = parseMoveLine(line, validLineIdx);
    if (move) {
      parsedMoves.push(move);
      validLineIdx++;
    }
  }
  
  // 3. 뒤집힌 기보 감지 및 복원 (헤더가 한하인 경우 혹은 한나라가 첫 수를 두는 경우)
  let shouldFlipImport = !determinedCho;
  if (!shouldFlipImport && parsedMoves.length > 0 && parsedMoves[0].player === "한") {
    shouldFlipImport = true;
  }
  
  if (shouldFlipImport) {
    parsedMoves.forEach(move => {
      // 플레이어 대칭 스왑
      move.player = (move.player === "초") ? "한" : "초";
      // 좌표 180도 스왑
      move.startX = 10 - move.startX;
      move.startY = flipYCoordinate(move.startY);
      move.endX = 10 - move.endX;
      move.endY = flipYCoordinate(move.endY);
      // 기물 이름 스왑 (졸 <-> 병)
      if (move.pieceName === "졸") {
        move.pieceName = "병";
      } else if (move.pieceName === "병") {
        move.pieceName = "졸";
      }
    });
  }

  // 만약 뒤집힌 기보라면 초기 상차림 및 진영도 180도 역회전 적용하여 표준(Cho bottom) 상태로 로드
  if (shouldFlipImport) {
    if (!layoutTextMatch) {
      startingCode = rotateLayoutCode180(startingCode);
    }
    determinedCho = true;
  }
  
  changeNation(determinedCho);
  
  if (parsedMoves.length === 0 && !layoutTextMatch && !text.match(/\b\d{64}\b/)) {
    alert("유효한 기보 데이터를 찾을 수 없습니다. 형식을 확인해 주세요.");
    return;
  }
  
  // 4. 보드 초기 상차림으로 재설정
  applyLayoutCode(startingCode);
  log.length = 0;
  
  // 5. 착수 시뮬레이션을 통해 log 배열 빌드 및 기물 메모리 위치 동기화
  for (let move of parsedMoves) {
    let pieceId = -1;
    for (let pIdx = 0; pIdx < 32; pIdx++) {
      if (pieces[pIdx].x === move.startX && pieces[pIdx].y === move.startY) {
        pieceId = pIdx;
        break;
      }
    }
    
    if (pieceId === -1) {
      console.warn(`기물을 찾을 수 없습니다: x=${move.startX}, y=${move.startY}`);
      continue;
    }
    
    let capturedId = NO_PIECE;
    for (let pIdx = 0; pIdx < 32; pIdx++) {
      if (pieces[pIdx].x === move.endX && pieces[pIdx].y === move.endY) {
        capturedId = pIdx;
        break;
      }
    }
    
    log.push({ i: pieceId, x: move.endX, y: move.endY, t: capturedId, comment: move.comment || "" });
    
    pieces[pieceId].x = move.endX;
    pieces[pieceId].y = move.endY;
    if (capturedId < NO_PIECE) {
      pieces[capturedId].x = 0;
      pieces[capturedId].y = 0;
    }
  }
  
  // 6. 턴 카운터 업데이트 (initPositions 호출 전에 설정해야 마지막 수까지 정확히 반영됨)
  const turnInput = document.getElementById("turn");
  if (turnInput) {
    turnInput.value = log.length;
  }

  // 7. 그래픽 보드 업데이트
  svg.classList.add("no-transition");
  initPositions();
  updateScore();
  
  // 네비게이션 버튼 처리
  document.getElementById("prev").disabled = (log.length === 0);
  document.getElementById("next").disabled = true;
  
  // 기물 선택 프레임 제거
  curSelect = NO_PIECE;
  clearCandiBox();
  const selectBox = document.getElementById("select-box");
  if (selectBox) {
    selectBox.setAttribute("x", HIDDEN_COORD);
    selectBox.setAttribute("y", HIDDEN_COORD);
  }
  
  svg.offsetHeight; // reflow 강제
  svg.classList.remove("no-transition");
  
  // 기보 텍스트 영역 최신화
  updateRecordUI();
  
  // AI 플레이 대기 및 실행 트리거
  checkAndRunAI();
}
