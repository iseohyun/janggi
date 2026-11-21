/**
 * @fileoverview 장기판 SVG 렌더링, 기물 위치 배치, 이동 후보지 마커 표시 및 기물점수 그래프 갱신 호출 (board.js)
 */

/**
 * 뷰포트 및 컨테이너 크기에 맞춰 장기판 크기(unitSize, boardWidth, boardHeight)를 계산하고 보드를 초기화합니다.
 */
const BOARD_MIN_UNIT = 8; // 한 칸 최소 크기(px). 예전 20px은 휴대폰 가로 모드에서 판 아래를 잘랐다

function initBoard() {
  const controlBox = document.getElementById("game-header");
  const container = controlBox.parentElement || document.body;

  let containerWidth = container.clientWidth || window.innerWidth;

  const header = document.querySelector("header");
  const headerHeight = header ? header.offsetHeight : 0;

  // 모바일(html.orient-device, screen-orient.js)은 대국 헤더와 판을 화면 위쪽에 바로 붙인다
  const topGap = document.documentElement.classList.contains("orient-device") ? 0 : 5;
  const headerGap = headerHeight > 0 ? headerHeight + topGap : topGap;
  controlBox.style.marginTop = `${headerGap}px`;

  const containerRect = container.getBoundingClientRect();
  const topOffset = containerRect.top > 0 ? containerRect.top : 0;
  const viewportRemainingHeight = window.innerHeight - topOffset - headerGap;

  let containerHeight = container.clientHeight;
  if (!containerHeight || containerHeight > viewportRemainingHeight) {
    containerHeight = viewportRemainingHeight;
  }
  // 판 자리 아래쪽이 화면 밖(주소창·도구 막대 아래)으로 나가 있으면 보이는 곳까지만 쓴다
  const visibleBottom = Math.min(containerRect.bottom > 0 ? containerRect.bottom : window.innerHeight, window.innerHeight);
  containerHeight = Math.min(containerHeight, Math.max(0, visibleBottom - topOffset));

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
  // 어떤 화면에서도 판이 잘리지 않게: 남은 자리에 맞추고, 아주 작은 화면에서만 최소 크기를 둔다
  unitSize = Math.max(BOARD_MIN_UNIT, Math.min(unitByWidth, unitByHeight));

  boardWidth = unitSize * 9 + boardPaddingLeft + boardPaddingRight;
  boardHeight = unitSize * 10 + boardPaddingTop + boardPaddingBottom;

  // 헤더는 판 폭에 맞추되, 판이 아주 작아도 그래프가 읽히도록 최소 폭을 둔다
  controlBox.style.width = `${Math.max(boardWidth, Math.min(containerWidth - 8, 360))}px`;

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
 * 양 진영의 기물 점수를 계산하여 헤더의 기물점수 그래프를 갱신합니다 (header-graph.js).
 */
function updateScore() {
  const { scoreCho, scoreHan } = calculateTeamScores();
  if (typeof hgUpdateMaterial === "function") hgUpdateMaterial(scoreCho, scoreHan);
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

const CANDI_SIZE_RATIO = 0.62; // 후보지 크기 = 칸 크기 × 이 값 (기물 크기와 상관없이 같다)
const CANDI_ANIM_MS = 220; // 후보지 하나가 나타나는 시간
const CANDI_STAGGER_MS = 28; // 가까운 거리부터: 거리 순위 한 단계마다 늦추는 시간 (앞의 것이 끝나기를 기다리지 않는다)
const CANDI_START_SCALE = 0.35; // 나타나기 시작할 때 크기
const CANDI_SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 후보지 모양을 (0,0) 가운데에 그립니다.
 * @param {SVGGElement} group
 * @param {number} size - 한 변 길이
 */
function drawCandiShape(group, size) {
  const half = size / 2;
  const mk = (tag, attrs) => {
    const el = document.createElementNS(CANDI_SVG_NS, tag);
    Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
    group.appendChild(el);
    return el;
  };
  if (candiShapeType === "corner_square") {
    // 사각형의 모서리만 그리고 변은 비운다. 누르는 자리는 투명한 사각형 전체
    mk("rect", { x: -half, y: -half, width: size, height: size, fill: "transparent", "pointer-events": "all" });
    const arm = size * 0.3;
    const d = [
      `M${-half} ${-half + arm}V${-half}H${-half + arm}`,
      `M${half - arm} ${-half}H${half}V${-half + arm}`,
      `M${half} ${half - arm}V${half}H${half - arm}`,
      `M${-half + arm} ${half}H${-half}V${half - arm}`
    ].join("");
    mk("path", {
      d,
      fill: "none",
      stroke: candiColorType,
      "stroke-width": Math.max(2.5, size * 0.07),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "pointer-events": "none"
    });
  } else if (candiShapeType === "empty_square") {
    mk("rect", {
      x: -half * 0.8, y: -half * 0.8, width: size * 0.8, height: size * 0.8, rx: size * 0.1, ry: size * 0.1,
      fill: candiColorType, "fill-opacity": "0.2", stroke: candiColorType, "stroke-width": "4", "pointer-events": "all"
    });
  } else if (candiShapeType === "filled_circle") {
    mk("circle", { cx: 0, cy: 0, r: size * 0.4, fill: candiColorType, "fill-opacity": "0.75", "pointer-events": "all" });
  } else {
    mk("circle", {
      cx: 0, cy: 0, r: size * 0.4, fill: candiColorType, "fill-opacity": "0.2",
      stroke: candiColorType, "stroke-width": "4", "pointer-events": "all"
    });
  }
}

/**
 * 선택된 기물의 이동 후보지 마커 하나를 판 위에 만듭니다.
 * 바깥 g는 착수 위치(가운데)로 옮기고, 안쪽 g가 나타나는 애니메이션을 맡는다.
 * @param {number} i - 선택된 기물 ID
 * @param {number} x - 후보지 X 좌표
 * @param {number} y - 후보지 Y 좌표
 * @returns {{box: SVGGElement, inner: SVGGElement, cx: number, cy: number}|null}
 */
function createCandiBox(i, x, y) {
  if (x < 1 || x > 9 || !isValidY(y)) {
    return null;
  }

  const center = getAxis(x, y);
  const candiBox = document.createElementNS(CANDI_SVG_NS, "g");
  candiBox.setAttribute("class", "candi-svg");
  candiBox.setAttribute("pointer-events", "all");
  candiBox.setAttribute("transform", `translate(${center.x}, ${center.y})`);
  candiBox.style.cursor = "pointer";

  const inner = document.createElementNS(CANDI_SVG_NS, "g");
  inner.setAttribute("class", "candi-inner");
  candiBox.appendChild(inner);
  drawCandiShape(inner, unitSize * CANDI_SIZE_RATIO);

  candiBoxList.push(candiBox);
  candiBox.addEventListener("click", function () {
    move(i, x, y);
  });

  svg.appendChild(candiBox);
  return { box: candiBox, inner, cx: center.x, cy: center.y };
}

/**
 * 후보지들을 가까운 거리부터 나타나게 합니다.
 * 각 후보지는 착수 위치에서 기물 쪽으로 반 칸 떨어진 곳에서 착수 위치로 다가오며, 작게 시작해 기본 크기가 된다.
 * 거리 순위마다 조금씩 늦게 시작하지만 앞의 것이 끝나기를 기다리지 않는다 (겹쳐서 나타난다).
 * @param {number} i - 선택된 기물 ID
 * @param {Array<{inner: SVGGElement, cx: number, cy: number}>} items
 */
function animateCandiMarkers(i, items) {
  if (!items.length) return;
  const from = getAxis(pieces[i].x, pieces[i].y);
  const half = unitSize / 2;
  const dists = items.map(it => Math.hypot(it.cx - from.x, it.cy - from.y));
  // 거리가 같은 후보지는 같이 나타난다
  const ranks = [...new Set(dists.map(d => Math.round(d)))].sort((a, b) => a - b);
  const anims = items.map((it, k) => {
    const d = dists[k] || 1;
    return {
      inner: it.inner,
      dx: -((it.cx - from.x) / d) * half, // 착수 위치에서 기물 쪽으로 반 칸
      dy: -((it.cy - from.y) / d) * half,
      delay: ranks.indexOf(Math.round(dists[k])) * CANDI_STAGGER_MS
    };
  });
  const setAt = (a, t) => {
    const e = 1 - Math.pow(1 - t, 3); // 감속
    const s = CANDI_START_SCALE + (1 - CANDI_START_SCALE) * e;
    a.inner.setAttribute("transform", `translate(${a.dx * (1 - e)}, ${a.dy * (1 - e)}) scale(${s})`);
    a.inner.setAttribute("opacity", String(Math.min(1, t * 1.6)));
  };
  // 설정에서 애니메이션 시간을 0으로 두었으면 바로 보인다
  if (typeof animDuration !== "undefined" && animDuration <= 0) {
    anims.forEach(a => setAt(a, 1));
    return;
  }
  anims.forEach(a => setAt(a, 0));
  const start = performance.now();
  const total = CANDI_ANIM_MS + Math.max(...anims.map(a => a.delay));
  const frame = now => {
    let running = false;
    anims.forEach(a => {
      if (!a.inner.isConnected) return;
      const t = Math.min(1, Math.max(0, (now - start - a.delay) / CANDI_ANIM_MS));
      setAt(a, t);
      if (t < 1) running = true;
    });
    if (running) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // 화면이 그려지지 않는 탭(배경)에서도 결국 제자리에 보이도록
  setTimeout(() => anims.forEach(a => a.inner.isConnected && setAt(a, 1)), total + 120);
}

/**
 * 후보 이동 위치 배열을 받아 판 위에 마커를 그리고, 가까운 거리부터 나타나게 합니다.
 * @param {number} i - 선택된 기물 ID
 * @param {Array<{x: number, y: number}>} moves - 이동 가능한 좌표 배열
 */
function renderCandidateMarkers(i, moves) {
  const items = [];
  for (const m of moves) {
    const it = createCandiBox(i, m.x, m.y);
    if (it) items.push(it);
  }
  animateCandiMarkers(i, items);
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
