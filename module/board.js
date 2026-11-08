/**
 * @fileoverview 장기판 SVG 렌더링, 기물 위치 배치, 이동 후보지 마커 표시 및 점수 막대 갱신 (board.js)
 */

/**
 * 뷰포트 및 컨테이너 크기에 맞춰 장기판 크기(unitSize, boardWidth, boardHeight)를 계산하고 보드를 초기화합니다.
 */
function initBoard() {
  const controlBox = document.getElementById("control-box");
  const container = controlBox.parentElement || document.body;

  let containerWidth = container.clientWidth || window.innerWidth;

  const header = document.querySelector("header");
  const headerHeight = header ? header.offsetHeight : 0;

  const headerGap = headerHeight > 0 ? headerHeight + 5 : 5;
  controlBox.style.marginTop = `${headerGap}px`;

  const containerRect = container.getBoundingClientRect();
  const topOffset = containerRect.top > 0 ? containerRect.top : 0;
  const viewportRemainingHeight = window.innerHeight - topOffset - headerGap;

  let containerHeight = container.clientHeight;
  if (!containerHeight || containerHeight > viewportRemainingHeight) {
    containerHeight = viewportRemainingHeight;
  }

  if (showCoordinates) {
    boardPaddingLeft = 45;
    boardPaddingTop = 45;
  } else {
    boardPaddingLeft = 20;
    boardPaddingTop = 20;
  }
  boardPaddingRight = 20;
  boardPaddingBottom = 20;

  const marginOffset = 2 * boardMargin;
  const tmpWidth = containerWidth - marginOffset;
  const tmpHeight = containerHeight - controlBox.offsetHeight - marginOffset - 15;

  const gridAvailableWidth = tmpWidth - (boardPaddingLeft + boardPaddingRight);
  const gridAvailableHeight = tmpHeight - (boardPaddingTop + boardPaddingBottom);

  const unitByWidth = gridAvailableWidth / 9;
  const unitByHeight = gridAvailableHeight / 10;
  unitSize = Math.max(20, Math.min(unitByWidth, unitByHeight));

  boardWidth = unitSize * 9 + boardPaddingLeft + boardPaddingRight;
  boardHeight = unitSize * 10 + boardPaddingTop + boardPaddingBottom;

  controlBox.style.width = `${boardWidth}px`;

  drawBoard();

  for (let i = 0; i < 32; i++) {
    const ratio = getPieceSizeRatio(i);
    pieces[i].e.setAttribute("width", unitSize * ratio);
    pieces[i].e.setAttribute("height", unitSize * ratio);
    pieces[i].e.style.width = `${unitSize * ratio}px`;
    pieces[i].e.style.height = `${unitSize * ratio}px`;
    pieces[i].e.onclick = function () {
      selected(i);
    };
  }
}

/**
 * 장기판 격자선, 궁성 대각선, 초소 마커 및 좌표 라벨을 SVG로 그립니다.
 */
function drawBoard() {
  svg.setAttribute("width", boardWidth);
  svg.setAttribute("height", boardHeight);
  svg.setAttribute("viewBox", `0 0 ${boardWidth} ${boardHeight}`);

  svg.style.width = `${boardWidth}px`;
  svg.style.height = `${boardHeight}px`;
  svg.style.display = "block";
  svg.style.margin = "0 auto";

  board.setAttribute("width", boardWidth);
  board.setAttribute("height", boardHeight);

  const lines = document.getElementById("lines");
  let lineSts = "";
  const yOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  for (let idx = 0; idx < 10; idx++) {
    let axis = getAxis(1, yOrder[idx]);
    lineSts += `M${axis.x} ${axis.y} h${Math.floor(unitSize * 8)} `;
  }
  for (let i = 0; i < 9; i++) {
    let axis = getAxis(i + 1, 1);
    lineSts += `M${axis.x} ${axis.y} v${Math.floor(unitSize * 9)} `;
  }

  // 내 궁성 (y=0,9,8)
  let tmpAxis = getAxis(4, 0);
  lineSts += `M${tmpAxis.x} ${tmpAxis.y}`;
  tmpAxis = getAxis(6, 8);
  lineSts += `L${tmpAxis.x} ${tmpAxis.y}`;

  tmpAxis = getAxis(6, 0);
  lineSts += `M${tmpAxis.x} ${tmpAxis.y}`;
  tmpAxis = getAxis(4, 8);
  lineSts += `L${tmpAxis.x} ${tmpAxis.y}`;

  // 상대 궁성 (y=1,2,3)
  tmpAxis = getAxis(4, 3);
  lineSts += `M${tmpAxis.x} ${tmpAxis.y}`;
  tmpAxis = getAxis(6, 1);
  lineSts += `L${tmpAxis.x} ${tmpAxis.y}`;
  tmpAxis = getAxis(4, 1);
  lineSts += `M${tmpAxis.x} ${tmpAxis.y}`;
  tmpAxis = getAxis(6, 3);
  lineSts += `L${tmpAxis.x} ${tmpAxis.y}`;

  // 내 마커
  lineSts += checkBoardMarker(1, 7);
  lineSts += checkBoardMarker(3, 7);
  lineSts += checkBoardMarker(5, 7);
  lineSts += checkBoardMarker(7, 7);
  lineSts += checkBoardMarker(9, 7);
  lineSts += checkBoardMarker(2, 8);
  lineSts += checkBoardMarker(8, 8);

  // 상대 마커
  lineSts += checkBoardMarker(1, 4);
  lineSts += checkBoardMarker(3, 4);
  lineSts += checkBoardMarker(5, 4);
  lineSts += checkBoardMarker(7, 4);
  lineSts += checkBoardMarker(9, 4);
  lineSts += checkBoardMarker(2, 3);
  lineSts += checkBoardMarker(8, 3);

  lines.setAttribute("d", lineSts);

  const coordsGroup = document.getElementById("coords-labels");
  if (coordsGroup) {
    coordsGroup.innerHTML = "";

    if (showCoordinates) {
      for (let x = 1; x <= 9; x++) {
        let axis = getAxis(x, 1);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", axis.x);
        text.setAttribute("y", boardPaddingTop - 25);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("fill", "#4b3621");
        text.setAttribute("font-size", `${unitSize * coordsTextScale}px`);
        text.setAttribute("font-weight", "800");
        text.setAttribute("opacity", "0.85");
        text.textContent = x;
        coordsGroup.appendChild(text);
      }

      const yLabels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
      for (let idx = 0; idx < yLabels.length; idx++) {
        let axis = getAxis(1, yLabels[idx]);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", boardPaddingLeft - 25);
        text.setAttribute("y", axis.y);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("fill", "#4b3621");
        text.setAttribute("font-size", `${unitSize * coordsTextScale}px`);
        text.setAttribute("font-weight", "800");
        text.setAttribute("opacity", "0.85");
        text.textContent = yLabels[idx];
        coordsGroup.appendChild(text);
      }
    }
  }
}

/**
 * 지정된 좌표(x, y)에 십자/대각 마커 SVG 경로 문자열을 생성합니다.
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @returns {string} SVG path d 조각
 */
function checkBoardMarker(x, y) {
  const markerSize = 10;
  let tmpAxis = getAxis(x, y);
  return `M${tmpAxis.x - markerSize / 2} ${tmpAxis.y - markerSize / 2} l${markerSize} ${markerSize} M${tmpAxis.x - markerSize / 2} ${tmpAxis.y + markerSize / 2} l${markerSize} ${-markerSize} `;
}

/**
 * 64자리 배치 코드 문자열을 파싱하여 pieces와 initPieces에 초기 좌표를 설정합니다.
 * @param {string} code - 64자리 배치 코드 문자열
 */
function applyLayoutCode(code) {
  if (typeof code !== "string" || code.length < 64) {
    console.warn("[Janggi] 유효하지 않은 배치 코드입니다. 기본 상차림으로 대체합니다:", code);
    code = "5910902888207030804060173757779752119123832171318141611434547494";
  }
  for (let i = 0; i < 64; i += 2) {
    const px = parseInt(code[i], 10);
    const py = parseInt(code[i + 1], 10);
    pieces[i / 2].x = isNaN(px) ? 0 : px;
    pieces[i / 2].y = isNaN(py) ? 0 : py;
    initPieces[i / 2] = { x: pieces[i / 2].x, y: pieces[i / 2].y };
  }
}
const setting = applyLayoutCode;

/**
 * 현재 턴(turn)까지의 로그를 반영하여 모든 기물의 논리 좌표 및 SVG 렌더링 위치를 일괄 갱신합니다.
 */
function initPositions() {
  // 1. 초기 배치(initPieces)가 존재하면 해당 상태에서 curTurn까지 메모리 상에서 정확히 재계산
  const turnEl = document.getElementById("turn");
  let curTurn = turnEl ? parseInt(turnEl.value, 10) : log.length;
  if (isNaN(curTurn)) curTurn = log.length;
  curTurn = Math.max(0, Math.min(curTurn, log.length));

  if (initPieces[0]) {
    for (let i = 0; i < 32; i++) {
      if (initPieces[i]) {
        pieces[i].x = initPieces[i].x;
        pieces[i].y = initPieces[i].y;
      }
    }
    for (let step = 0; step < curTurn; step++) {
      const entry = log[step];
      if (entry) {
        pieces[entry.i].x = entry.x;
        pieces[entry.i].y = entry.y;
        if (entry.t < NO_PIECE) {
          pieces[entry.t].x = 0;
          pieces[entry.t].y = 0;
        }
      }
    }
  }

  // 2. 계산된 최종 좌표를 바탕으로 32개 기물의 SVG 스타일을 단 1회씩만 갱신 (DOM 리플로우 최소화)
  for (let i = 0; i < 32; i++) {
    if (pieces[i].animId) {
      cancelAnimationFrame(pieces[i].animId);
      pieces[i].animId = null;
    }

    const ratio = getPieceSizeRatio(i);
    let targetX, targetY;

    if (pieces[i].x === 0 && pieces[i].y === 0) {
      targetX = -unitSize * ratio * 2;
      targetY = -unitSize * ratio * 2;
    } else {
      let tmpAxis = getAxis(pieces[i].x, pieces[i].y);
      targetX = tmpAxis.x - (unitSize * ratio) / 2;
      targetY = tmpAxis.y - (unitSize * ratio) / 2;
    }

    pieces[i].e.setAttribute("width", unitSize * ratio);
    pieces[i].e.setAttribute("height", unitSize * ratio);
    pieces[i].e.style.width = `${unitSize * ratio}px`;
    pieces[i].e.style.height = `${unitSize * ratio}px`;
    pieces[i].e.style.filter = "";

    let transformStr = `translate(${targetX}px, ${targetY}px)`;
    if (rotateActive) {
      transformStr += " rotate(-180deg)";
    } else if (flipActive) {
      transformStr += " scaleX(-1)";
    }
    pieces[i].e.style.transform = transformStr;
  }

  updatePieceGraphics();
  updateScore();
  updateKeyboardCursor();
}

/**
 * 키보드 접근성 커서(#kb-cursor)의 위치와 표시 상태를 갱신합니다.
 */
function updateKeyboardCursor() {
  const cursor = document.getElementById("kb-cursor");
  if (!cursor) return;

  if (!kbCursorActive) {
    cursor.style.display = "none";
    return;
  }

  const size = unitSize * 0.85;
  let axis = getAxis(kbCursorX, kbCursorY);
  let targetX = axis.x - size / 2;
  let targetY = axis.y - size / 2;

  cursor.setAttribute("width", size);
  cursor.setAttribute("height", size);
  cursor.style.width = `${size}px`;
  cursor.style.height = `${size}px`;
  cursor.style.display = "block";

  let transformStr = `translate(${targetX}px, ${targetY}px)`;
  if (rotateActive) {
    transformStr += " rotate(-180deg)";
  } else if (flipActive) {
    transformStr += " scaleX(-1)";
  }
  cursor.style.transform = transformStr;
}

/**
 * 양 진영의 기물 점수를 계산하여 상단 점수판 텍스트 및 게이지 막대를 갱신합니다.
 */
function updateScore() {
  const { scoreCho, scoreHan } = calculateTeamScores();

  document.getElementById("han-score-val").textContent = `한: ${scoreHan.toFixed(1)}`;
  document.getElementById("cho-score-val").textContent = `초: ${scoreCho.toFixed(1)}`;

  const scoreDiff = Math.abs(scoreHan - scoreCho);
  const diffEl = document.getElementById("diff-score-val");
  diffEl.textContent = scoreDiff.toFixed(1);

  if (scoreHan > scoreCho) {
    diffEl.style.color = "#b91c1c";
  } else if (scoreCho > scoreHan) {
    diffEl.style.color = "#1e3a8a";
  } else {
    diffEl.style.color = "#0f172a";
  }

  const total = scoreHan + scoreCho;
  let hanPercent = 50;
  let choPercent = 50;
  if (total > 0) {
    hanPercent = (scoreHan / total) * 100;
    choPercent = 100 - hanPercent;
  }

  document.getElementById("han-score-bar").style.width = `${hanPercent}%`;
  document.getElementById("cho-score-bar").style.width = `${choPercent}%`;
}

/**
 * 선택된 기물에 글로우 효과를 부여하고 선택 상자 좌표를 이동합니다.
 * @param {number} i - 선택된 기물 ID
 * @param {boolean} [visible=true] - 선택 강조 표시 여부
 */
function moveSelectBox(i, visible = true) {
  for (let j = 0; j < 32; j++) {
    if (pieces[j] && pieces[j].e) {
      pieces[j].e.classList.remove("selected");
    }
  }

  if (visible && pieces[i] && pieces[i].e) {
    pieces[i].e.classList.add("selected");
  }

  selectBox.setAttribute("stroke-width", 0);

  let tmpAxis = getAxis(pieces[i].x, pieces[i].y);
  selectBox.setAttribute("x", tmpAxis.x - unitSize / 2);
  selectBox.setAttribute("y", tmpAxis.y - unitSize / 2);
  selectBox.setAttribute("width", unitSize);
  selectBox.setAttribute("height", unitSize);
}

/**
 * 단일 이동 후보지 마커 SVG 엘리먼트를 생성하고 클릭 이벤트를 바인딩합니다.
 * @param {number} i - 선택된 기물 ID
 * @param {number} x - 후보지 X 좌표
 * @param {number} y - 후보지 Y 좌표
 */
function createCandiBox(i, x, y) {
  if (x < 1 || x > 9 || !isValidY(y)) {
    return;
  }

  const ratio = getPieceSizeRatio(i);
  let tmpAxis = getAxis(x, y);
  let targetX = tmpAxis.x - (unitSize * ratio) / 2;
  let targetY = tmpAxis.y - (unitSize * ratio) / 2;

  const candiBox = document.createElementNS("http://www.w3.org/2000/svg", "g");
  candiBox.setAttribute("class", "candi-svg");
  candiBox.setAttribute("pointer-events", "all");
  candiBox.setAttribute("transform", `translate(${targetX}, ${targetY})`);
  candiBox.style.cursor = "pointer";

  const boxSize = unitSize * ratio;
  const center = boxSize / 2;

  if (candiShapeType === "empty_square") {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", boxSize * 0.1);
    rect.setAttribute("y", boxSize * 0.1);
    rect.setAttribute("width", boxSize * 0.8);
    rect.setAttribute("height", boxSize * 0.8);
    rect.setAttribute("rx", boxSize * 0.1);
    rect.setAttribute("ry", boxSize * 0.1);
    rect.setAttribute("fill", candiColorType);
    rect.setAttribute("fill-opacity", "0.2");
    rect.setAttribute("stroke", candiColorType);
    rect.setAttribute("stroke-width", "4");
    rect.setAttribute("pointer-events", "all");
    rect.style.pointerEvents = "auto";
    candiBox.appendChild(rect);
  } else if (candiShapeType === "filled_circle") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", center);
    circle.setAttribute("cy", center);
    circle.setAttribute("r", boxSize * 0.4);
    circle.setAttribute("fill", candiColorType);
    circle.setAttribute("fill-opacity", "0.75");
    circle.setAttribute("pointer-events", "all");
    circle.style.pointerEvents = "auto";
    candiBox.appendChild(circle);
  } else {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", center);
    circle.setAttribute("cy", center);
    circle.setAttribute("r", boxSize * 0.4);
    circle.setAttribute("fill", candiColorType);
    circle.setAttribute("fill-opacity", "0.2");
    circle.setAttribute("stroke", candiColorType);
    circle.setAttribute("stroke-width", "4");
    circle.setAttribute("pointer-events", "all");
    circle.style.pointerEvents = "auto";
    candiBox.appendChild(circle);
  }

  candiBoxList.push(candiBox);
  candiBox.addEventListener("click", function () {
    move(i, x, y);
  });

  svg.appendChild(candiBox);
}

/**
 * 후보 이동 위치 배열을 받아 판 위에 마커를 일괄 렌더링합니다.
 * @param {number} i - 선택된 기물 ID
 * @param {Array<{x: number, y: number}>} moves - 이동 가능한 좌표 배열
 */
function renderCandidateMarkers(i, moves) {
  for (const m of moves) {
    createCandiBox(i, m.x, m.y);
  }
}

/**
 * 지정된 기물 ID의 이동 가능 경로(후보지)를 계산하여 판 위에 그립니다.
 * @param {number} i - 선택된 기물 ID (0~31)
 */
function drawCandidates(i) {
  const moves = getCandidateMoves(i);
  renderCandidateMarkers(i, moves);
}

/**
 * 장기알 내부 한자 서예 이미지의 크기와 중심 정렬 오프셋을 갱신합니다.
 */
function updatePieceGraphics() {
  for (let i = 0; i < 32; i++) {
    if (!pieces[i] || !pieces[i].e) continue;
    const img = pieces[i].e.querySelector("image");
    if (img) {
      let baseSize = (i >= 9 && i <= 15) || (i >= 25 && i <= 31) ? 82 : 74;
      let scale = 1.0;
      if (i === 0 || i === 16) {
        scale = fontScaleKing;
      } else if ((i >= 1 && i <= 8) || (i >= 17 && i <= 24)) {
        scale = fontScaleMiddle;
      } else {
        scale = fontScaleSmall;
      }
      let w = baseSize * scale;
      let h = baseSize * scale;
      let imgX = 50 - w / 2 - 3;
      let imgY = 50 - h / 2 - 3;
      img.setAttribute("x", imgX);
      img.setAttribute("y", imgY);
      img.setAttribute("width", w);
      img.setAttribute("height", h);
    }
  }
}

/**
 * 특정 기물의 좌표를 변경하고 포물선 3D 이동 애니메이션(또는 즉시 이동)을 수행합니다.
 * @param {number} i - 기물 ID (0~31)
 * @param {number} x - 목표 X 좌표 (포획 시 0)
 * @param {number} y - 목표 Y 좌표 (포획 시 0)
 * @param {boolean} [animate=false] - 3D 포물선 애니메이션 적용 여부
 */
function setPieces(i, x, y, animate = false) {
  pieces[i].x = x;
  pieces[i].y = y;
  const ratio = getPieceSizeRatio(i);

  if (pieces[i].animId) {
    cancelAnimationFrame(pieces[i].animId);
    pieces[i].animId = null;
  }

  if (x === 0 && y === 0) {
    let targetX = -unitSize * ratio * 2;
    let targetY = -unitSize * ratio * 2;
    pieces[i].e.style.transform = `translate(${targetX}px, ${targetY}px) scale(1)`;
    pieces[i].e.style.filter = "";
    return;
  }

  svg.appendChild(pieces[i].e);

  let tmpAxis = getAxis(x, y);
  let endX = tmpAxis.x - (unitSize * ratio) / 2;
  let endY = tmpAxis.y - (unitSize * ratio) / 2;

  if (!animate || animDuration <= 0) {
    pieces[i].e.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
    pieces[i].e.style.filter = "";
    return;
  }

  let startX = endX;
  let startY = endY;
  const transformStr = pieces[i].e.style.transform;
  if (transformStr && transformStr.includes("translate")) {
    const matches = transformStr.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (matches && matches.length >= 3) {
      startX = parseFloat(matches[1]);
      startY = parseFloat(matches[2]);
    }
  }

  if (Math.abs(startX - endX) < 0.5 && Math.abs(startY - endY) < 0.5) {
    pieces[i].e.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
    pieces[i].e.style.filter = "";
    return;
  }

  let dx = endX - startX;
  let dy = endY - startY;
  let dist = Math.sqrt(dx * dx + dy * dy);
  let archH = dist * 0.22 * animHeight;

  let p1X = (startX + endX) / 2;
  let p1Y = (startY + endY) / 2 - archH;

  let startTime = performance.now();
  let duration = animDuration * 1000;

  function animateFrame(now) {
    let elapsed = now - startTime;
    let t = Math.min(elapsed / duration, 1);
    let te = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    let xt = (1 - te) * (1 - te) * startX + 2 * (1 - te) * te * p1X + te * te * endX;
    let yt = (1 - te) * (1 - te) * startY + 2 * (1 - te) * te * p1Y + te * te * endY;

    let scale = 1 + 0.18 * animHeight * Math.sin(te * Math.PI);
    let shadowBlur = 4 + 10 * animHeight * Math.sin(te * Math.PI);
    let shadowOffset = 4 + 8 * animHeight * Math.sin(te * Math.PI);

    pieces[i].e.style.transform = `translate(${xt}px, ${yt}px) scale(${scale})`;
    pieces[i].e.style.filter = `drop-shadow(${shadowOffset}px ${shadowOffset * 1.5}px ${shadowBlur}px rgba(0, 0, 0, 0.42))`;

    if (t < 1) {
      pieces[i].animId = requestAnimationFrame(animateFrame);
    } else {
      pieces[i].e.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
      pieces[i].e.style.filter = "";
      pieces[i].animId = null;
    }
  }

  pieces[i].animId = requestAnimationFrame(animateFrame);
}

/**
 * 판 위에 렌더링된 모든 이동 후보지 마커를 제거합니다.
 */
function clearCandiBox() {
  for (let i = candiBoxList.length - 1; i >= 0; i--) {
    if (candiBoxList[i].parentNode === svg) {
      svg.removeChild(candiBoxList[i]);
    }
    candiBoxList.pop();
  }
}
