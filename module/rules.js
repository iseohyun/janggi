/**
 * @fileoverview 장기 행마 규칙, 좌표계 변환 및 기물 점수 계산 유틸리티 (rules.js)
 * - Y축 좌표 흐름: 1(최상단) → 2 → ... → 9 → 0(최하단 10번째 줄)
 * - 기물 ID: 0~15(하단 진영), 16~31(상단 진영), 32(NO_PIECE: 빈 칸)
 */

/**
 * URL 로그용 알파벳 문자('A'~'J')를 수치 좌표(0~9)로 변환합니다.
 * @param {string} c - 알파벳 문자
 * @returns {number} 좌표 값
 */
function charToCoord(c) {
  return c.charCodeAt(0) - 65;
}
const Az2n = charToCoord;

/**
 * 수치 좌표(0~9)를 URL 로그용 알파벳 문자('A'~'J')로 변환합니다.
 * @param {number} n - 좌표 값
 * @returns {string} 알파벳 문자
 */
function coordToChar(n) {
  const str = "ABCDEFGHIJK";
  return str[n];
}
const n2Az = coordToChar;

/**
 * 논리 좌표(x, y)의 실제 SVG 도화지 픽셀 중심 위치를 반환합니다.
 * @param {number} x - 가로 좌표 (1~9)
 * @param {number} y - 세로 좌표 (1~9, 최하단은 0)
 * @returns {{x: number, y: number}}
 */
function getAxis(x, y) {
  const rowIndex = (y + 9) % 10; // y=1→0(상단), y=2→1, ..., y=9→8, y=0→9(하단)
  return {
    x: Math.floor((x - 1) * unitSize + boardPaddingLeft + unitSize / 2),
    y: Math.floor(rowIndex * unitSize + boardPaddingTop + unitSize / 2)
  };
}

/**
 * Y 좌표를 상하 반전(180도 회전 기준)합니다.
 * @param {number} y - 원본 Y 좌표 (0~9)
 * @returns {number} 반전된 Y 좌표 (0~9)
 */
function flipYCoordinate(y) {
  const r = (y + 9) % 10;
  const flippedR = 9 - r;
  return (flippedR + 1) % 10;
}

/**
 * 64자리 배치 코드를 180도 회전(좌우·상하 반전 및 진영 스왑)합니다.
 * @param {string} code - 64자리 배치 문자열
 * @returns {string} 회전된 64자리 배치 문자열
 */
function rotateLayoutCode180(code) {
  if (!code || code.length !== 64) return code;
  const coords = [];
  for (let i = 0; i < 32; i++) {
    const px = parseInt(code[2 * i], 10);
    const py = parseInt(code[2 * i + 1], 10);
    if (px === 0 && py === 0) {
      coords.push({ x: 0, y: 0 });
    } else {
      coords.push({ x: 10 - px, y: flipYCoordinate(py) });
    }
  }
  const rotated = [];
  for (let i = 0; i < 16; i++) {
    rotated[i] = coords[i + 16];
    rotated[i + 16] = coords[i];
  }
  return rotated.map(c => `${c.x}${c.y}`).join("");
}

/**
 * 배치 코드를 뒤집힘 여부에 따라 정규화합니다.
 * @param {string} code - 64자리 배치 문자열
 * @param {boolean} flipped - 반전 여부
 * @returns {string}
 */
function normalizeLayoutCode(code, flipped) {
  if (!flipped || !code || code.length !== 64) return code;
  return rotateLayoutCode180(code);
}

/**
 * 현재 상차림(newGameState)과 진영(iAmCho)에 맞는 64자리 초기 배치 코드를 반환합니다.
 * @returns {string} 64자리 초기 배치 문자열
 */
function getStartingLayoutCode() {
  let choIdx, hanIdx;
  if (iAmCho) {
    choIdx = newGameState[0];
    hanIdx = newGameState[1];
  } else {
    choIdx = newGameState[1];
    hanIdx = newGameState[0];
  }
  const stdCode = knownStart[0][choIdx] + knownStart[1][hanIdx];
  return normalizeLayoutCode(stdCode, !iAmCho);
}

/**
 * 현재 보드 위 생존 기물을 바탕으로 초나라/한나라 점수(한나라 덤 1.5점 포함)를 계산합니다.
 * @returns {{scoreCho: number, scoreHan: number}}
 */
function calculateTeamScores() {
  let scoreBottom = 0;
  let scoreTop = 0;

  for (let idx = 1; idx < 16; idx++) {
    if (pieces[idx] && (pieces[idx].x !== 0 || pieces[idx].y !== 0)) {
      scoreBottom += MATERIAL_SCORES[idx];
    }
    const topIdx = idx + 16;
    if (pieces[topIdx] && (pieces[topIdx].x !== 0 || pieces[topIdx].y !== 0)) {
      scoreTop += MATERIAL_SCORES[idx];
    }
  }

  if (iAmCho) {
    return {
      scoreCho: scoreBottom,
      scoreHan: scoreTop + HAN_HANDICAP
    };
  } else {
    return {
      scoreCho: scoreTop,
      scoreHan: scoreBottom + HAN_HANDICAP
    };
  }
}

/**
 * 해당 좌표에 누가 있는지 확인합니다. (0: 비었음, 1: 아군, 2: 적군)
 * @param {number} i - 기준 기물 ID
 * @param {number} x - 타겟 X 좌표
 * @param {number} y - 타겟 Y 좌표
 * @returns {number} 0 | 1 | 2
 */
function checkTeam(i, x, y) {
  const j = whoIsit(x, y);
  if (j >= NO_PIECE) return 0;
  return ((i <= 15 && j <= 15) || (i > 15 && j > 15)) ? 1 : 2;
}

/**
 * 해당 좌표에 있는 장기말의 ID(0~31)를 반환합니다. 없으면 NO_PIECE(32)를 반환합니다.
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @returns {number} 기물 ID (0~31) 또는 32
 */
function whoIsit(x, y) {
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].x == x && pieces[i].y == y) {
      return i;
    }
  }
  return NO_PIECE;
}

/**
 * 대상 기물 ID(t)가 기준 기물(i)과 같은 편인지 판별합니다. (0: 공백, 1: 아군, 2: 적군)
 * @param {number} i - 기준 기물 ID
 * @param {number} t - 대상 기물 ID
 * @returns {number} 0 | 1 | 2
 */
function isEnemy(i, t) {
  if (t >= NO_PIECE) return 0;
  return ((i <= 15 && t <= 15) || (i > 15 && t > 15)) ? 1 : 2;
}

/**
 * 해당 기물 ID가 포(包)인지 판별합니다.
 * @param {number} i - 기물 ID
 * @returns {boolean}
 */
function isPo(i) {
  return (i === 3 || i === 4 || i === 19 || i === 20);
}

/**
 * 특정 기물이 지정된 턴 이전에 마지막으로 위치했던 좌표를 조회합니다.
 * @param {number} i - 기물 ID
 * @param {number} turn - 조회 기준 턴 인덱스
 * @returns {{x: number, y: number}}
 */
function whereWasIt(i, turn) {
  while (turn >= 0) {
    if (log[turn].i == i) {
      return { x: log[turn].x, y: log[turn].y };
    }
    turn--;
  }
  return initPieces[i];
}

/**
 * Y 좌표의 다음 줄(화면 아래 방향: 1→2→...→9→0→-1)을 반환합니다.
 * @param {number} y - 현재 Y 좌표
 * @returns {number} 다음 Y 좌표 (범위 밖이면 -1)
 */
function yNext(y) {
  if (y == 0) return -1;
  if (y == 9) return 0;
  return y + 1;
}

/**
 * Y 좌표의 이전 줄(화면 위 방향: 0→9→8→...→1→-1)을 반환합니다.
 * @param {number} y - 현재 Y 좌표
 * @returns {number} 이전 Y 좌표 (범위 밖이면 -1)
 */
function yPrev(y) {
  if (y == 1) return -1;
  if (y == 0) return 9;
  return y - 1;
}

/**
 * Y 좌표가 유효한 범위(0~9)인지 확인합니다.
 * @param {number} y - Y 좌표
 * @returns {boolean}
 */
function isValidY(y) {
  return y >= 0 && y <= 9;
}

/**
 * 선택된 기물 ID의 의사 합법(Pseudo-legal) 이동 가능 좌표 목록을 반환합니다.
 * @param {number} i - 기물 ID (0~31)
 * @returns {Array<{x: number, y: number}>}
 */
function getCandidateMoves(i) {
  let rawMoves = [];
  if (i === 0 || i === 9 || i === 10 || i === 16 || i === 25 || i === 26) {
    rawMoves = getKingOrGuardMoves(i);
  } else if (i === 1 || i === 2 || i === 17 || i === 18) {
    rawMoves = getChariotMoves(i);
  } else if (i === 3 || i === 4 || i === 19 || i === 20) {
    rawMoves = getCannonMoves(i);
  } else if (i === 5 || i === 6 || i === 21 || i === 22) {
    rawMoves = getHorseMoves(i);
  } else if (i === 7 || i === 8 || i === 23 || i === 24) {
    rawMoves = getElephantMoves(i);
  } else if ((i >= 11 && i <= 15) || (i >= 27 && i <= 31)) {
    rawMoves = getSoldierMoves(i);
  }
  // 보드 경계(x: 1~9, y: 0~9) 내 유효 좌표만 필터링하여 반환
  return rawMoves.filter(m => m.x >= 1 && m.x <= 9 && isValidY(m.y));
}

/**
 * 궁(장) 및 사의 행마 계산 (궁성 내부 이동)
 * @param {number} i - 기물 ID
 * @returns {Array<{x: number, y: number}>}
 */
function getKingOrGuardMoves(i) {
  const moves = [];
  if (i === 0 || i === 9 || i === 10) {
    const px = pieces[i].x;
    const py = pieces[i].y;
    if (px === 4 && py === 0) {
      if (checkTeam(i, 4, 9) !== 1) moves.push({ x: 4, y: 9 });
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
      if (checkTeam(i, 5, 0) !== 1) moves.push({ x: 5, y: 0 });
    } else if (px === 5 && py === 0) {
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
      if (checkTeam(i, 6, 0) !== 1) moves.push({ x: 6, y: 0 });
      if (checkTeam(i, 4, 0) !== 1) moves.push({ x: 4, y: 0 });
    } else if (px === 6 && py === 0) {
      if (checkTeam(i, 6, 9) !== 1) moves.push({ x: 6, y: 9 });
      if (checkTeam(i, 5, 0) !== 1) moves.push({ x: 5, y: 0 });
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
    } else if (px === 4 && py === 9) {
      if (checkTeam(i, 4, 8) !== 1) moves.push({ x: 4, y: 8 });
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
      if (checkTeam(i, 4, 0) !== 1) moves.push({ x: 4, y: 0 });
    } else if (px === 5 && py === 9) {
      if (checkTeam(i, 5, 8) !== 1) moves.push({ x: 5, y: 8 });
      if (checkTeam(i, 6, 8) !== 1) moves.push({ x: 6, y: 8 });
      if (checkTeam(i, 6, 9) !== 1) moves.push({ x: 6, y: 9 });
      if (checkTeam(i, 6, 0) !== 1) moves.push({ x: 6, y: 0 });
      if (checkTeam(i, 5, 0) !== 1) moves.push({ x: 5, y: 0 });
      if (checkTeam(i, 4, 0) !== 1) moves.push({ x: 4, y: 0 });
      if (checkTeam(i, 4, 9) !== 1) moves.push({ x: 4, y: 9 });
      if (checkTeam(i, 4, 8) !== 1) moves.push({ x: 4, y: 8 });
    } else if (px === 6 && py === 9) {
      if (checkTeam(i, 6, 8) !== 1) moves.push({ x: 6, y: 8 });
      if (checkTeam(i, 6, 0) !== 1) moves.push({ x: 6, y: 0 });
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
    } else if (px === 4 && py === 8) {
      if (checkTeam(i, 5, 8) !== 1) moves.push({ x: 5, y: 8 });
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
      if (checkTeam(i, 4, 9) !== 1) moves.push({ x: 4, y: 9 });
    } else if (px === 5 && py === 8) {
      if (checkTeam(i, 6, 8) !== 1) moves.push({ x: 6, y: 8 });
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
      if (checkTeam(i, 4, 8) !== 1) moves.push({ x: 4, y: 8 });
    } else if (px === 6 && py === 8) {
      if (checkTeam(i, 6, 9) !== 1) moves.push({ x: 6, y: 9 });
      if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
      if (checkTeam(i, 5, 8) !== 1) moves.push({ x: 5, y: 8 });
    }
  } else {
    const px = pieces[i].x;
    const py = pieces[i].y;
    if (px === 4 && py === 3) {
      if (checkTeam(i, 4, 2) !== 1) moves.push({ x: 4, y: 2 });
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
      if (checkTeam(i, 5, 3) !== 1) moves.push({ x: 5, y: 3 });
    } else if (px === 5 && py === 3) {
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
      if (checkTeam(i, 6, 3) !== 1) moves.push({ x: 6, y: 3 });
      if (checkTeam(i, 4, 3) !== 1) moves.push({ x: 4, y: 3 });
    } else if (px === 6 && py === 3) {
      if (checkTeam(i, 6, 2) !== 1) moves.push({ x: 6, y: 2 });
      if (checkTeam(i, 5, 3) !== 1) moves.push({ x: 5, y: 3 });
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
    } else if (px === 4 && py === 2) {
      if (checkTeam(i, 4, 1) !== 1) moves.push({ x: 4, y: 1 });
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
      if (checkTeam(i, 4, 3) !== 1) moves.push({ x: 4, y: 3 });
    } else if (px === 5 && py === 2) {
      if (checkTeam(i, 5, 1) !== 1) moves.push({ x: 5, y: 1 });
      if (checkTeam(i, 6, 1) !== 1) moves.push({ x: 6, y: 1 });
      if (checkTeam(i, 6, 2) !== 1) moves.push({ x: 6, y: 2 });
      if (checkTeam(i, 6, 3) !== 1) moves.push({ x: 6, y: 3 });
      if (checkTeam(i, 5, 3) !== 1) moves.push({ x: 5, y: 3 });
      if (checkTeam(i, 4, 3) !== 1) moves.push({ x: 4, y: 3 });
      if (checkTeam(i, 4, 2) !== 1) moves.push({ x: 4, y: 2 });
      if (checkTeam(i, 4, 1) !== 1) moves.push({ x: 4, y: 1 });
    } else if (px === 6 && py === 2) {
      if (checkTeam(i, 6, 1) !== 1) moves.push({ x: 6, y: 1 });
      if (checkTeam(i, 6, 3) !== 1) moves.push({ x: 6, y: 3 });
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
    } else if (px === 4 && py === 1) {
      if (checkTeam(i, 5, 1) !== 1) moves.push({ x: 5, y: 1 });
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
      if (checkTeam(i, 4, 2) !== 1) moves.push({ x: 4, y: 2 });
    } else if (px === 5 && py === 1) {
      if (checkTeam(i, 6, 1) !== 1) moves.push({ x: 6, y: 1 });
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
      if (checkTeam(i, 4, 1) !== 1) moves.push({ x: 4, y: 1 });
    } else if (px === 6 && py === 1) {
      if (checkTeam(i, 6, 2) !== 1) moves.push({ x: 6, y: 2 });
      if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
      if (checkTeam(i, 5, 1) !== 1) moves.push({ x: 5, y: 1 });
    }
  }
  return moves;
}

/**
 * 차(車)의 행마 계산 (직진 및 궁성 대각선)
 * @param {number} i - 기물 ID
 * @returns {Array<{x: number, y: number}>}
 */
function getChariotMoves(i) {
  const moves = [];
  const px = pieces[i].x;
  const py = pieces[i].y;

  for (let x = px - 1; x >= 1; x--) {
    if (checkTeam(i, x, py) !== 1) moves.push({ x, y: py });
    if (checkTeam(i, x, py) !== 0) break;
  }
  for (let x = px + 1; x <= 9; x++) {
    if (checkTeam(i, x, py) !== 1) moves.push({ x, y: py });
    if (checkTeam(i, x, py) !== 0) break;
  }

  for (let ty = yPrev(py); ty !== -1; ty = yPrev(ty)) {
    if (checkTeam(i, px, ty) !== 1) moves.push({ x: px, y: ty });
    if (checkTeam(i, px, ty) !== 0) break;
  }
  for (let ty = yNext(py); ty !== -1; ty = yNext(ty)) {
    if (checkTeam(i, px, ty) !== 1) moves.push({ x: px, y: ty });
    if (checkTeam(i, px, ty) !== 0) break;
  }

  if (px === 4 && py === 3) {
    if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
    if (checkTeam(i, 5, 2) === 0 && checkTeam(i, 6, 1) !== 1) moves.push({ x: 6, y: 1 });
  } else if (px === 6 && py === 3) {
    if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
    if (checkTeam(i, 5, 2) === 0 && checkTeam(i, 4, 1) !== 1) moves.push({ x: 4, y: 1 });
  } else if (px === 4 && py === 1) {
    if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
    if (checkTeam(i, 5, 2) === 0 && checkTeam(i, 6, 3) !== 1) moves.push({ x: 6, y: 3 });
  } else if (px === 6 && py === 1) {
    if (checkTeam(i, 5, 2) !== 1) moves.push({ x: 5, y: 2 });
    if (checkTeam(i, 5, 2) === 0 && checkTeam(i, 4, 3) !== 1) moves.push({ x: 4, y: 3 });
  } else if (px === 5 && py === 2) {
    if (checkTeam(i, 4, 3) !== 1) moves.push({ x: 4, y: 3 });
    if (checkTeam(i, 4, 1) !== 1) moves.push({ x: 4, y: 1 });
    if (checkTeam(i, 6, 3) !== 1) moves.push({ x: 6, y: 3 });
    if (checkTeam(i, 6, 1) !== 1) moves.push({ x: 6, y: 1 });
  } else if (px === 4 && py === 0) {
    if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
    if (checkTeam(i, 5, 9) === 0 && checkTeam(i, 6, 8) !== 1) moves.push({ x: 6, y: 8 });
  } else if (px === 6 && py === 0) {
    if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
    if (checkTeam(i, 5, 9) === 0 && checkTeam(i, 4, 8) !== 1) moves.push({ x: 4, y: 8 });
  } else if (px === 4 && py === 8) {
    if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
    if (checkTeam(i, 5, 9) === 0 && checkTeam(i, 6, 0) !== 1) moves.push({ x: 6, y: 0 });
  } else if (px === 6 && py === 8) {
    if (checkTeam(i, 5, 9) !== 1) moves.push({ x: 5, y: 9 });
    if (checkTeam(i, 5, 9) === 0 && checkTeam(i, 4, 0) !== 1) moves.push({ x: 4, y: 0 });
  } else if (px === 5 && py === 9) {
    if (checkTeam(i, 4, 0) !== 1) moves.push({ x: 4, y: 0 });
    if (checkTeam(i, 4, 8) !== 1) moves.push({ x: 4, y: 8 });
    if (checkTeam(i, 6, 0) !== 1) moves.push({ x: 6, y: 0 });
    if (checkTeam(i, 6, 8) !== 1) moves.push({ x: 6, y: 8 });
  }
  return moves;
}

/**
 * 포(包)의 행마 계산 (도약 행마, 포끼리 다리/포획 불가)
 * @param {number} i - 기물 ID
 * @returns {Array<{x: number, y: number}>}
 */
function getCannonMoves(i) {
  const moves = [];
  const px = pieces[i].x;
  const py = pieces[i].y;
  let bridge = false;

  for (let x = px - 1; x >= 1; x--) {
    let t = whoIsit(x, py);
    if (isPo(t)) break;
    if (bridge === false) {
      if (t < NO_PIECE) bridge = true;
    } else {
      if (isEnemy(i, t) !== 1) {
        moves.push({ x, y: py });
        if (isEnemy(i, t) === 2) break;
      } else {
        break;
      }
    }
  }

  bridge = false;
  for (let x = px + 1; x <= 9; x++) {
    let t = whoIsit(x, py);
    if (isPo(t)) break;
    if (bridge === false) {
      if (t < NO_PIECE) bridge = true;
    } else {
      if (isEnemy(i, t) !== 1) {
        moves.push({ x, y: py });
        if (isEnemy(i, t) === 2) break;
      } else {
        break;
      }
    }
  }

  bridge = false;
  for (let ty = yPrev(py); ty !== -1; ty = yPrev(ty)) {
    let t = whoIsit(px, ty);
    if (isPo(t)) break;
    if (bridge === false) {
      if (t < NO_PIECE) bridge = true;
    } else {
      if (isEnemy(i, t) !== 1) {
        moves.push({ x: px, y: ty });
        if (isEnemy(i, t) === 2) break;
      } else {
        break;
      }
    }
  }

  bridge = false;
  for (let ty = yNext(py); ty !== -1; ty = yNext(ty)) {
    let t = whoIsit(px, ty);
    if (isPo(t)) break;
    if (bridge === false) {
      if (t < NO_PIECE) bridge = true;
    } else {
      if (isEnemy(i, t) !== 1) {
        moves.push({ x: px, y: ty });
        if (isEnemy(i, t) === 2) break;
      } else {
        break;
      }
    }
  }

  if (px === 4 && py === 0) {
    let t = whoIsit(5, 9);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 6, 8) !== 1 && !isPo(whoIsit(6, 8))) moves.push({ x: 6, y: 8 });
  } else if (px === 6 && py === 0) {
    let t = whoIsit(5, 9);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 4, 8) !== 1 && !isPo(whoIsit(4, 8))) moves.push({ x: 4, y: 8 });
  } else if (px === 4 && py === 8) {
    let t = whoIsit(5, 9);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 6, 0) !== 1 && !isPo(whoIsit(6, 0))) moves.push({ x: 6, y: 0 });
  } else if (px === 6 && py === 8) {
    let t = whoIsit(5, 9);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 4, 0) !== 1 && !isPo(whoIsit(4, 0))) moves.push({ x: 4, y: 0 });
  } else if (px === 4 && py === 1) {
    let t = whoIsit(5, 2);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 6, 3) !== 1 && !isPo(whoIsit(6, 3))) moves.push({ x: 6, y: 3 });
  } else if (px === 6 && py === 1) {
    let t = whoIsit(5, 2);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 4, 3) !== 1 && !isPo(whoIsit(4, 3))) moves.push({ x: 4, y: 3 });
  } else if (px === 4 && py === 3) {
    let t = whoIsit(5, 2);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 6, 1) !== 1 && !isPo(whoIsit(6, 1))) moves.push({ x: 6, y: 1 });
  } else if (px === 6 && py === 3) {
    let t = whoIsit(5, 2);
    if (!isPo(t) && t < NO_PIECE && checkTeam(i, 4, 1) !== 1 && !isPo(whoIsit(4, 1))) moves.push({ x: 4, y: 1 });
  }
  return moves;
}

/**
 * 마(馬)의 행마 계산 (멱 검사 포함)
 * @param {number} i - 기물 ID
 * @returns {Array<{x: number, y: number}>}
 */
function getHorseMoves(i) {
  const moves = [];
  const px = pieces[i].x;
  const py = pieces[i].y;

  if (whoIsit(px - 1, py) >= NO_PIECE) {
    let prevY = yPrev(py);
    let nextY = yNext(py);
    if (prevY !== -1 && isEnemy(i, whoIsit(px - 2, prevY)) !== 1) moves.push({ x: px - 2, y: prevY });
    if (nextY !== -1 && isEnemy(i, whoIsit(px - 2, nextY)) !== 1) moves.push({ x: px - 2, y: nextY });
  }
  if (whoIsit(px + 1, py) >= NO_PIECE) {
    let prevY = yPrev(py);
    let nextY = yNext(py);
    if (prevY !== -1 && isEnemy(i, whoIsit(px + 2, prevY)) !== 1) moves.push({ x: px + 2, y: prevY });
    if (nextY !== -1 && isEnemy(i, whoIsit(px + 2, nextY)) !== 1) moves.push({ x: px + 2, y: nextY });
  }
  {
    let py1 = yPrev(py);
    if (py1 !== -1 && whoIsit(px, py1) >= NO_PIECE) {
      let py2 = yPrev(py1);
      if (py2 !== -1) {
        if (isEnemy(i, whoIsit(px - 1, py2)) !== 1) moves.push({ x: px - 1, y: py2 });
        if (isEnemy(i, whoIsit(px + 1, py2)) !== 1) moves.push({ x: px + 1, y: py2 });
      }
    }
  }
  {
    let ny1 = yNext(py);
    if (ny1 !== -1 && whoIsit(px, ny1) >= NO_PIECE) {
      let ny2 = yNext(ny1);
      if (ny2 !== -1) {
        if (isEnemy(i, whoIsit(px - 1, ny2)) !== 1) moves.push({ x: px - 1, y: ny2 });
        if (isEnemy(i, whoIsit(px + 1, ny2)) !== 1) moves.push({ x: px + 1, y: ny2 });
      }
    }
  }
  return moves;
}

/**
 * 상(象)의 행마 계산 (이중 멱 검사 포함)
 * @param {number} i - 기물 ID
 * @returns {Array<{x: number, y: number}>}
 */
function getElephantMoves(i) {
  const moves = [];
  const px = pieces[i].x;
  const py = pieces[i].y;

  if (whoIsit(px - 1, py) >= NO_PIECE) {
    let py1 = yPrev(py);
    if (py1 !== -1 && whoIsit(px - 2, py1) >= NO_PIECE) {
      let py2 = yPrev(py1);
      if (py2 !== -1 && isEnemy(i, whoIsit(px - 3, py2)) !== 1) moves.push({ x: px - 3, y: py2 });
    }
    let ny1 = yNext(py);
    if (ny1 !== -1 && whoIsit(px - 2, ny1) >= NO_PIECE) {
      let ny2 = yNext(ny1);
      if (ny2 !== -1 && isEnemy(i, whoIsit(px - 3, ny2)) !== 1) moves.push({ x: px - 3, y: ny2 });
    }
  }
  if (whoIsit(px + 1, py) >= NO_PIECE) {
    let py1 = yPrev(py);
    if (py1 !== -1 && whoIsit(px + 2, py1) >= NO_PIECE) {
      let py2 = yPrev(py1);
      if (py2 !== -1 && isEnemy(i, whoIsit(px + 3, py2)) !== 1) moves.push({ x: px + 3, y: py2 });
    }
    let ny1 = yNext(py);
    if (ny1 !== -1 && whoIsit(px + 2, ny1) >= NO_PIECE) {
      let ny2 = yNext(ny1);
      if (ny2 !== -1 && isEnemy(i, whoIsit(px + 3, ny2)) !== 1) moves.push({ x: px + 3, y: ny2 });
    }
  }
  {
    let py1 = yPrev(py);
    if (py1 !== -1 && whoIsit(px, py1) >= NO_PIECE) {
      let py2 = yPrev(py1);
      if (py2 !== -1) {
        if (whoIsit(px - 1, py2) >= NO_PIECE) {
          let py3 = yPrev(py2);
          if (py3 !== -1 && isEnemy(i, whoIsit(px - 2, py3)) !== 1) moves.push({ x: px - 2, y: py3 });
        }
        if (whoIsit(px + 1, py2) >= NO_PIECE) {
          let py3 = yPrev(py2);
          if (py3 !== -1 && isEnemy(i, whoIsit(px + 2, py3)) !== 1) moves.push({ x: px + 2, y: py3 });
        }
      }
    }
  }
  {
    let ny1 = yNext(py);
    if (ny1 !== -1 && whoIsit(px, ny1) >= NO_PIECE) {
      let ny2 = yNext(ny1);
      if (ny2 !== -1) {
        if (whoIsit(px - 1, ny2) >= NO_PIECE) {
          let ny3 = yNext(ny2);
          if (ny3 !== -1 && isEnemy(i, whoIsit(px - 2, ny3)) !== 1) moves.push({ x: px - 2, y: ny3 });
        }
        if (whoIsit(px + 1, ny2) >= NO_PIECE) {
          let ny3 = yNext(ny2);
          if (ny3 !== -1 && isEnemy(i, whoIsit(px + 2, ny3)) !== 1) moves.push({ x: px + 2, y: ny3 });
        }
      }
    }
  }
  return moves;
}

/**
 * 졸/병(卒/兵)의 행마 계산 (전진, 좌우 및 궁성 사선 전진)
 * @param {number} i - 기물 ID
 * @returns {Array<{x: number, y: number}>}
 */
function getSoldierMoves(i) {
  const moves = [];
  const px = pieces[i].x;
  const py = pieces[i].y;

  if (isEnemy(i, whoIsit(px - 1, py)) !== 1) moves.push({ x: px - 1, y: py });
  if (isEnemy(i, whoIsit(px + 1, py)) !== 1) moves.push({ x: px + 1, y: py });

  if (i > 16) {
    let ny = yNext(py);
    if (ny !== -1 && isEnemy(i, whoIsit(px, ny)) !== 1) moves.push({ x: px, y: ny });
    if (px === 4 && py === 8) {
      if (isEnemy(i, whoIsit(5, 9)) !== 1) moves.push({ x: 5, y: 9 });
    } else if (px === 6 && py === 8) {
      if (isEnemy(i, whoIsit(5, 9)) !== 1) moves.push({ x: 5, y: 9 });
    } else if (px === 5 && py === 9) {
      if (isEnemy(i, whoIsit(4, 0)) !== 1) moves.push({ x: 4, y: 0 });
      if (isEnemy(i, whoIsit(6, 0)) !== 1) moves.push({ x: 6, y: 0 });
    }
  } else {
    let prevY = yPrev(py);
    if (prevY !== -1 && isEnemy(i, whoIsit(px, prevY)) !== 1) moves.push({ x: px, y: prevY });
    if (px === 4 && py === 3) {
      if (isEnemy(i, whoIsit(5, 2)) !== 1) moves.push({ x: 5, y: 2 });
    } else if (px === 6 && py === 3) {
      if (isEnemy(i, whoIsit(5, 2)) !== 1) moves.push({ x: 5, y: 2 });
    } else if (px === 5 && py === 2) {
      if (isEnemy(i, whoIsit(4, 1)) !== 1) moves.push({ x: 4, y: 1 });
      if (isEnemy(i, whoIsit(6, 1)) !== 1) moves.push({ x: 6, y: 1 });
    }
  }
  return moves;
}
