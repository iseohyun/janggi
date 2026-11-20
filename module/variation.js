/**
 * @fileoverview 두어보기 가지(변화) 데이터 모듈.
 * 본선(log)에서 갈라진 수순을 "가지"로 보관합니다. 실제 기보(log)는 절대 바꾸지 않습니다.
 *
 * 가지 하나의 모양:
 *   { id, parentStep, parentVarId, moves:[{i,x,y}], source, label, side, lane, returned }
 *   - parentStep : 갈라진 국면의 절대 수순 (0=첫 배치). 가지의 k번째 수(0부터)는 parentStep+k+1수다.
 *   - parentVarId: 가지 속 가지면 부모 가지 id, 본선에서 갈라졌으면 null
 *   - source     : "user" | "ai" | "recommend" | "threat" | "hypo" | "mate" (색 구분용)
 *   - side/lane  : 변화도 배치 (side 1=오른쪽, -1=왼쪽 / lane 1부터 바깥으로). varLayout()이 다시 계산한다.
 *   - returned   : 본선 복귀 점선을 그릴지 여부
 *
 * 저장: 가지는 판(기보)마다 따로 localStorage "janggiVariationLibrary"에 남는다 (기보 30개까지, 오래된 것부터 버림).
 *   같은 기보를 다시 열거나 새로고침한 뒤 그 기보를 불러오면 그 기보의 가지(추천 가지 등)가 되살아난다 (loadVariationsForGame).
 *   다른 기보를 열거나 새 대국을 시작해도 앞 기보의 가지는 지우지 않는다. clearVariations()만 지금 기보의 가지를 지운다.
 *
 * 다른 모듈(M3 추천수, M4 노림수, M5 가정 착수, M6 외통 감지)은 createVariation()으로 가지를 만들고
 * playVariation()(preview.js)으로 재생합니다.
 * @module variation
 * @depends state, commentary-facts
 */

const VARIATION_STORAGE_KEY = "janggiVariations";

/** source별 변화도 색 */
const VARIATION_COLORS = {
  main: "#e2e8f0",
  user: "#94a3b8",
  ai: "#22c55e",
  recommend: "#22c55e",
  threat: "#ef4444",
  hypo: "#3b82f6",
  mate: "#eab308"
};

const VARIATION_SOURCE_LABELS = {
  user: "직접 둔 수",
  ai: "AI 수",
  recommend: "추천수",
  threat: "상대 노림수",
  hypo: "가정 착수",
  mate: "외통 수순"
};

var variations = []; // 생긴 순서대로 보관
var variationSeq = 0;

const VARIATION_LIBRARY_KEY = "janggiVariationLibrary";
const VARIATION_LIBRARY_MAX = 30; // 가지를 남겨 두는 기보 수
let variationGameId = null; // 지금 판의 가지 묶음 id (기보마다)

// ===== 조회 =====

function getVariations() {
  return variations;
}

function getVariation(id) {
  return variations.find(v => v.id === id) || null;
}

/** @param {string|null} parentVarId @param {number} [atStep] 갈라진 수순으로 거르기 */
function getChildVariations(parentVarId, atStep) {
  return variations.filter(v => v.parentVarId === parentVarId &&
    (atStep === undefined || v.parentStep === atStep));
}

/** 가지의 마지막 수순 번호 */
function variationEndStep(v) {
  return v.parentStep + v.moves.length;
}

/** 본선에서 갈라진 맨 위 조상 가지 */
function variationRoot(v) {
  let cur = v;
  while (cur && cur.parentVarId) cur = getVariation(cur.parentVarId);
  return cur;
}

/**
 * 가지 v의 step수 국면까지 둔 수 목록(본선 접두 포함, 첫 배치부터).
 * @param {string|null} varId - null이면 본선
 * @param {number} step - 절대 수순
 * @returns {Array<{i:number,x:number,y:number}>}
 */
function variationLineMoves(varId, step) {
  if (!varId) return log.slice(0, Math.min(step, log.length)).map(m => ({ i: m.i, x: m.x, y: m.y }));
  const v = getVariation(varId);
  if (!v) return [];
  const upto = Math.min(step, variationEndStep(v));
  const base = variationLineMoves(v.parentVarId, v.parentStep);
  return base.concat(v.moves.slice(0, Math.max(0, upto - v.parentStep)));
}

/**
 * 가지 국면의 기물 좌표를 계산합니다. 화면과 pieces는 바꾸지 않습니다.
 * @returns {Array<{x:number,y:number}>} 32개 좌표
 */
function variationPositionAt(varId, step) {
  if (!varId) return cfWithPositionAt(step, cfSnapshot);
  const v = getVariation(varId);
  const root = variationRoot(v);
  const tail = variationLineMoves(varId, step).slice(root.parentStep);
  return cfWithPositionAt(root.parentStep, () => {
    tail.forEach(m => cfDoMove(m));
    return cfSnapshot();
  });
}

// ===== 만들기·고치기 =====

/**
 * 가지를 새로 만듭니다.
 * @param {number} parentStep - 갈라지는 국면의 절대 수순
 * @param {Array<{i:number,x:number,y:number}>} moves
 * @param {string} [source="user"]
 * @param {string} [label]
 * @param {string|null} [parentVarId=null] - 가지 속 가지면 부모 가지 id
 * @returns {Object} 만든 가지
 */
function createVariation(parentStep, moves, source, label, parentVarId) {
  const src = source && VARIATION_COLORS[source] ? source : "user";
  variationSeq += 1;
  const v = {
    id: `v${variationSeq}`,
    parentStep,
    parentVarId: parentVarId || null,
    moves: (moves || []).map(m => ({ i: m.i, x: m.x, y: m.y })),
    source: src,
    label: label || `${VARIATION_SOURCE_LABELS[src]} ${variationSeq}`,
    side: 1,
    lane: 1,
    returned: false
  };
  variations.push(v);
  varLayout();
  saveVariations();
  return v;
}

function appendVariationMove(id, m) {
  const v = getVariation(id);
  if (!v) return null;
  v.moves.push({ i: m.i, x: m.x, y: m.y });
  varLayout();
  saveVariations();
  return v;
}

/** 가지와 그 속 가지를 모두 지웁니다. */
function removeVariation(id) {
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    variations.forEach(v => {
      if (v.parentVarId && doomed.has(v.parentVarId) && !doomed.has(v.id)) {
        doomed.add(v.id);
        grew = true;
      }
    });
  }
  variations = variations.filter(v => !doomed.has(v.id));
  varLayout();
  saveVariations();
}

/** 지금 기보의 가지를 모두 지웁니다 (저장분도). 다른 기보의 가지는 그대로 둔다. */
function clearVariations() {
  variations = [];
  variationSeq = 0;
  try {
    localStorage.removeItem(VARIATION_STORAGE_KEY);
  } catch (e) {
    console.warn("[variation] 저장소 비우기 실패:", e);
  }
  if (variationGameId) {
    const lib = varLibRead();
    delete lib[variationGameId];
    varLibWrite(lib);
  }
}

/** 새 대국: 지금 화면의 가지만 비우고 새 묶음을 시작한다 (앞 기보의 가지 저장분은 그대로) */
function variationsStartNewGame() {
  variations = [];
  variationSeq = 0;
  variationGameId = varNewGameId();
}

function sameMove(a, b) {
  return !!a && !!b && a.i === b.i && a.x === b.x && a.y === b.y;
}

// ===== 변화도 배치 =====

/**
 * side/lane을 생긴 순서대로 다시 계산합니다.
 * 본선 가지는 오른쪽 → 왼쪽 → 오른쪽 … 번갈아, 가지 속 가지는 부모와 같은 쪽 바깥.
 * 같은 쪽·같은 칸에서 세로 구간이 겹치면 한 칸 더 바깥으로 갑니다.
 */
function varLayout() {
  const used = { "1": [], "-1": [] }; // side → [{lane, from, to}]
  let rootCount = 0;
  variations.forEach(v => {
    let minLane = 1;
    if (v.parentVarId) {
      const p = getVariation(v.parentVarId);
      v.side = p ? p.side : 1;
      minLane = p ? p.lane + 1 : 1;
    } else {
      v.side = (rootCount % 2 === 0) ? 1 : -1;
      rootCount += 1;
    }
    const from = v.parentStep;
    const to = variationEndStep(v) + (v.returned ? 1 : 0);
    const list = used[String(v.side)];
    let lane = minLane;
    while (list.some(u => u.lane === lane && u.from <= to && from <= u.to)) lane += 1;
    v.lane = lane;
    list.push({ lane, from, to });
  });
}

// ===== 저장 =====

/** 가지가 매달린 본선이 같은 판인지 확인하는 서명 */
function variationBaseSignature() {
  return {
    init: initPieces.map(p => (p ? `${p.x}${p.y}` : "")).join(","),
    main: log.map(m => `${m.i}.${m.x}.${m.y}`)
  };
}

function varNewGameId() {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function varLibRead() {
  try {
    const d = JSON.parse(localStorage.getItem(VARIATION_LIBRARY_KEY) || "{}");
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch (e) {
    return {};
  }
}

function varLibWrite(lib) {
  try {
    const ids = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0));
    ids.slice(VARIATION_LIBRARY_MAX).forEach(id => delete lib[id]);
    localStorage.setItem(VARIATION_LIBRARY_KEY, JSON.stringify(lib));
  } catch (e) {
    console.warn("[variation] 가지 저장 실패:", e);
  }
}

/** 지금 기보의 가지를 저장합니다 (기보마다 따로). 가지가 없으면 그 기보의 저장분을 지운다. */
function saveVariations() {
  // 기보별 형세 분석 파일에도 가지가 들어가므로 (eval-share.js)
  if (typeof esMarkDirty === "function") esMarkDirty();
  if (!variationGameId) variationGameId = varNewGameId();
  const lib = varLibRead();
  if (variations.length) {
    lib[variationGameId] = { base: variationBaseSignature(), seq: variationSeq, list: variations, savedAt: Date.now() };
  } else {
    delete lib[variationGameId];
  }
  varLibWrite(lib);
}

/** 두 서명의 본선 공통 수 */
function varCommonSteps(a, b) {
  const sa = Array.isArray(a.main) ? a.main : [];
  const sb = Array.isArray(b.main) ? b.main : [];
  let c = 0;
  while (c < sa.length && c < sb.length && sa[c] === sb[c]) c++;
  return c;
}

/**
 * 지금 본선(판)에 맞는 저장된 가지를 찾아 불러옵니다. 기보를 불러오거나 새로고침했을 때 부른다.
 * 첫 배치가 같고 본선이 서로 앞부분을 공유하며(한쪽이 다른 쪽의 앞부분), 가지가 갈라진 수순까지 같은 묶음 가운데
 * 가장 많이 겹치는 것을 고른다. 맞는 묶음이 없으면 새 묶음을 시작한다.
 */
function loadVariationsForGame() {
  variations = [];
  variationSeq = 0;
  const now = variationBaseSignature();
  const lib = varLibRead();
  let best = null;
  Object.keys(lib).forEach(id => {
    const e = lib[id];
    if (!e || !e.base || e.base.init !== now.init || !Array.isArray(e.list) || !e.list.length) return;
    const savedLen = Array.isArray(e.base.main) ? e.base.main.length : 0;
    const common = varCommonSteps(e.base, now);
    // 빈 판(새로고침 직후 등)은 빈 판에서 만든 가지만, 아니면 한쪽이 다른 쪽의 앞부분이어야 같은 기보로 본다
    if (now.main.length === 0 ? savedLen !== 0 : common < Math.min(savedLen, now.main.length)) return;
    const rootMax = Math.max(0, ...e.list.filter(v => !v.parentVarId).map(v => v.parentStep));
    if (common < rootMax && common < savedLen) return;
    if (!best || common > best.common || (common === best.common && (e.savedAt || 0) > (best.e.savedAt || 0))) {
      best = { id, e, common };
    }
  });
  if (!best) {
    variationGameId = varNewGameId();
    varLayout();
    return;
  }
  variationGameId = best.id;
  const kept = new Set();
  best.e.list.forEach(v => {
    const okParent = v.parentVarId ? kept.has(v.parentVarId) : v.parentStep <= best.common;
    if (okParent && Array.isArray(v.moves)) kept.add(v.id);
  });
  variations = best.e.list.filter(v => kept.has(v.id));
  variationSeq = Math.max(best.e.seq || 0,
    variations.reduce((mx, v) => Math.max(mx, parseInt(String(v.id).slice(1), 10) || 0), 0));
  varLayout();
}

/** 처음 열 때: 예전 한 묶음 저장분(janggiVariations)을 기보별 저장으로 옮기고, 지금 판의 가지를 불러온다 */
function loadVariations() {
  try {
    const old = JSON.parse(localStorage.getItem(VARIATION_STORAGE_KEY) || "null");
    if (old && Array.isArray(old.list) && old.list.length && old.base) {
      const lib = varLibRead();
      lib[varNewGameId()] = { base: old.base, seq: old.seq || 0, list: old.list, savedAt: Date.now() };
      varLibWrite(lib);
    }
    localStorage.removeItem(VARIATION_STORAGE_KEY);
  } catch (e) {
    // 옮기지 못해도 새 저장은 된다
  }
  loadVariationsForGame();
}

document.addEventListener("DOMContentLoaded", loadVariations);
