/**
 * @fileoverview 국면별 형세(초의 어림 승률) 기록과 그 쓰임새.
 *  - 기록: 헤더 형세 줄·추천수 분석·빈 국면 채우기가 구한 엔진 결과를 국면 열쇠(recContext().key와 같은 꼴)마다 모은다
 *    (ehRecordResult). 강제 외통이면 이기는 쪽(mateWinner)도 남긴다.
 *  - 저장: 기록은 localStorage("janggiEvalCache")에 짧은 열쇠로 남겨 두었다가 다시 불러 쓴다 (새로고침·브라우저를 껐다 켜도 남는다).
 *    이미 분석한 국면은 다시 계산하지 않는다. 기록마다 얼마나 정교하게 판단했는지(탐색 깊이, 분석 시간 ms, 분석한 시각)를 함께 남긴다.
 *  - 정밀화: 사용자가 EH_REFINE_IDLE_MS 동안 아무것도 하지 않고 엔진이 쉬고 있으면, 지금 수부터 그 줄의 끝까지
 *    분석 시간을 EH_REFINE_LEVELS_MS 단계(1초 → 3초 → 8초)로 늘려 가며 다시 판단한다. 다른 일이 생기면 바로 양보한다.
 *  - 빈 국면 채우기: 엔진이 한가할 때 국면당 0.25초씩. 형세 그래프 창이 열려 있으면 그 줄들을 먼저, 쉬지 않고 채운다.
 *  - 변화도 색 (ehTreeFlags): 외통을 피할 수 없게 된 첫 수(빨강: 착수 뒤 국면이 처음으로 강제 외통이 된 수),
 *    착수 전후 승률이 10%p 이상 바뀐 수(노랑, "변화가 많은 수").
 *  - 형세 그래프 창: 지금 가지에 있으면 본선 → 가지 → 가지 속 가지 … → 지금 가지까지 끊기지 않게 구간마다 그 가지 색으로 잇는다.
 *    헤더 그래프(시간·기물점수·형세 어디든)를 누르면 본선 0수부터 기보의 마지막 수까지, 그리고 지금 국면에서 갈라진 가지(추천수 가지 등)를
 *    꺾은선으로 그린다. 점 색은 변화도와 같다. 계산되지 않은 국면은 비워 두고 계산되는 대로 채운다.
 *    재생(자동 재생·가지 재생) 중이면 잠시 멈췄다가 닫을 때 이어 간다.
 * 공개 함수: ehRecordResult(key, res), ehCachedEval(key), ehTreeFlags(), ehCompactKey(key), ehExpandKey(compact),
 *           openEvalChart(), closeEvalChart(), isEvalChartOpen(), evalChartGoTo(step)
 * @module eval-history
 * @depends state, rules, ai, commentary-facts, engine-fsf, variation, preview, header-graph
 */

const EH_BIG_CHANGE = 0.1; // 착수 전후 승률이 이만큼(10%p) 바뀌면 "변화가 많은 수"
const EH_FORCED_HOLD = 0.85; // 짧은 분석이 외통 수순을 놓친 국면이라도 이기는 쪽 승률이 이 이상이면 외통 흐름이 이어진 것으로 본다
const EH_FILL_MOVETIME = 250; // 빈 국면 하나를 채우는 엔진 시간 (ms)
const EH_FILL_TICK_MS = 500; // 채우기 확인 주기
const EH_REDRAW_MS = 350; // 기록이 바뀐 뒤 변화도·그래프를 다시 그리기까지
const EH_STORAGE_KEY = "janggiEvalCache";
const EH_STORAGE_MAX = 5000; // 저장해 두는 국면 수 (넘으면 오래된 것부터 버린다)
const EH_SAVE_DELAY_MS = 2000;
const EH_REFINE_LEVELS_MS = [1000, 3000, 8000]; // 기다리면 이 순서로 분석 시간을 늘린다
const EH_REFINE_IDLE_MS = 3000; // 마우스·키보드 입력이 이만큼 없으면 정밀화를 시작한다

const EH_COLOR_MAIN = "#e2e8f0"; // 변화도 본선과 같은 색
const EH_COLOR_BRANCH = "#22c55e"; // 변화도 가지와 같은 색
const EH_COLOR_FORCED = "#ef4444"; // 외통을 피할 수 없게 된 첫 수
const EH_COLOR_BIG = "#eab308"; // 변화가 많은 수

const ehRates = new Map(); // 국면 열쇠 → { rate(초 승률 0~1), depth, src, mateWinner: "cho"|"han"|null }
const ehMates = new Map(); // 국면 열쇠 → 둘 수 없는 외통 국면인지
let ehFilling = false;
let ehRedrawTimer = null;
let ehSaveTimer = null;
let ehNeeded = []; // 변화도에서 승률이 필요한 국면들 [{key, team, snap}]
let ehChartResume = null; // 그래프 창을 닫을 때 이어 갈 재생
let ehLastActivity = Date.now(); // 마지막 마우스·키보드 입력 시각
let ehRefineInfo = null; // 정밀화 진행 상황 {ms, done, total} (없으면 null)

function ehKey(team, snap) {
  return `${team}|${JSON.stringify(snap)}`;
}

/** "cho|[{x,y}…]" → "c1203…" (저장용 짧은 열쇠: 진영 한 글자 + 기물 32개의 x·y 한 자리씩) */
function ehCompactKey(key) {
  const bar = key.indexOf("|");
  const snap = JSON.parse(key.slice(bar + 1));
  return (key.slice(0, bar) === "cho" ? "c" : "h") + snap.map(p => `${p.x}${p.y}`).join("");
}

/** ehCompactKey의 반대 */
function ehExpandKey(compact) {
  const team = compact[0] === "c" ? "cho" : "han";
  const snap = [];
  for (let k = 1; k + 1 < compact.length; k += 2) snap.push({ x: Number(compact[k]), y: Number(compact[k + 1]) });
  return ehKey(team, snap);
}

// ===== 기록 =====

/**
 * 엔진 분석 결과(fsfAnalyze)를 그 국면의 형세로 기록합니다. 더 깊은 결과만 덮어쓴다.
 * @param {string} key - "cho|[...]" 꼴 국면 열쇠
 * @param {Array} res - fsfAnalyze 결과 (빈 배열 = 둘 수 없음)
 */
/**
 * @param {number} [ms] - 이 결과를 얻는 데 쓴 분석 시간 (정밀도 기록용)
 */
function ehRecordResult(key, res, ms) {
  if (!key || !res) return;
  const team = key.split("|")[0];
  if (!res.length) {
    // 둘 수가 없으면 차례인 쪽이 진다 (계산할 것이 없으니 가장 정교한 판단으로 친다)
    const winner = team === "cho" ? "han" : "cho";
    ehStore(key, team === "cho" ? 0 : 1, 99, "fsf", winner, 99999);
    return;
  }
  const top = res[0];
  const mateWinner = top.mate === null || top.mate === undefined ? null : (top.mate > 0 ? "cho" : "han");
  ehStore(key, top.winRate, top.depth || 0, "fsf", mateWinner, ms || 0);
}

/**
 * 기록합니다. 더 정교한 판단(깊이가 더 깊거나, 깊이가 같으면 분석 시간이 더 긴 것)만 덮어쓴다.
 * 기록: { rate, depth, ms(분석 시간), at(분석한 시각, 초), src, mateWinner }
 */
function ehStore(key, rate, depth, src, mateWinner, ms) {
  const old = ehRates.get(key);
  const t = ms || 0;
  if (old && (old.depth > depth || (old.depth === depth && (old.ms || 0) > t))) {
    // 더 얕은 결과는 버리되, 이만큼 시간을 들여 확인했다는 것은 남긴다 (같은 국면을 정밀화가 되풀이하지 않게)
    if (t > (old.ms || 0)) {
      old.ms = t;
      old.at = Math.round(Date.now() / 1000);
      ehScheduleSave();
    }
    return;
  }
  if (old && old.depth === depth && (old.ms || 0) === t &&
    Math.abs(old.rate - rate) < 0.0005 && old.mateWinner === (mateWinner || null)) return;
  ehRates.set(key, {
    rate, depth, src,
    mateWinner: mateWinner || null,
    ms: Math.max(t, old && old.depth === depth ? old.ms || 0 : 0),
    at: Math.round(Date.now() / 1000)
  });
  ehScheduleRedraw();
  if (src !== "builtin") ehScheduleSave();
}

/** 기록의 정밀도 글: "깊이 15 · 3초" */
function ehPrecisionText(r) {
  if (!r) return "";
  if (r.depth >= 99) return "끝난 국면";
  const sec = (r.ms || 0) >= 1000 ? `${Math.round(r.ms / 100) / 10}초` : r.ms ? `${r.ms}ms` : "";
  return `깊이 ${r.depth}${sec ? ` · ${sec}` : ""}`;
}

function ehRateOf(key) {
  const r = ehRates.get(key);
  return r ? r.rate : null;
}

/** 저장된 형세 (헤더 형세 줄이 다시 계산하기 전에 먼저 쓴다) */
function ehCachedEval(key) {
  const r = ehRates.get(key);
  return r && r.src !== "builtin" ? r : null;
}

/** 변화도와 그래프 창을 조금 뒤에 다시 그린다 (기록이 여러 번 바뀌어도 한 번만) */
function ehScheduleRedraw() {
  clearTimeout(ehRedrawTimer);
  ehRedrawTimer = setTimeout(() => {
    if (typeof pvRefresh === "function" && !(typeof isPreviewWalking === "function" && isPreviewWalking())) pvRefresh();
    if (isEvalChartOpen()) ehRenderChart();
  }, EH_REDRAW_MS);
}

// ===== 저장·불러오기 =====

function ehScheduleSave() {
  clearTimeout(ehSaveTimer);
  ehSaveTimer = setTimeout(ehSave, EH_SAVE_DELAY_MS);
  // 파일 자동 저장이 켜져 있으면 그쪽에도 (eval-file.js)
  if (typeof efMarkDirty === "function") efMarkDirty();
}

/**
 * 저장 행들. [짧은 열쇠, 초 승률, 깊이, 외통 승자(c/h/""), 분석 시간 ms, 분석한 시각(초)]
 * 넘치면 먼저 기록한 것(Map 앞쪽)부터 버린다. (eval-file.js 파일 저장도 같은 행을 쓴다)
 */
function ehSerialize() {
  const rows = [];
  ehRates.forEach((v, key) => {
    if (v.src === "builtin") return;
    rows.push([ehCompactKey(key), Math.round(v.rate * 10000) / 10000, v.depth, v.mateWinner ? v.mateWinner[0] : "", v.ms || 0, v.at || 0]);
  });
  return rows.slice(Math.max(0, rows.length - EH_STORAGE_MAX));
}

function ehSave() {
  try {
    localStorage.setItem(EH_STORAGE_KEY, JSON.stringify(ehSerialize()));
  } catch (e) {
    console.warn("[eval-history] 형세 기록 저장 실패:", e);
  }
}

/**
 * 파일에서 불러온 행을 합칩니다. 더 정교한 판단(깊이·분석 시간)만 덮어쓴다.
 * @returns {number} 새로 쓰거나 고친 국면 수
 */
function ehMergeRows(rows) {
  let changed = 0;
  rows.forEach(row => {
    if (!Array.isArray(row) || typeof row[0] !== "string") return;
    const [compact, rate, depth, w, ms, at] = row;
    const key = ehExpandKey(compact);
    const old = ehRates.get(key);
    const better = !old || old.src === "builtin" || depth > old.depth || (depth === old.depth && (ms || 0) > (old.ms || 0));
    if (!better) return;
    const mateWinner = w === "c" ? "cho" : w === "h" ? "han" : null;
    ehRates.set(key, { rate, depth, src: "fsf", mateWinner, ms: ms || 0, at: at || 0 });
    changed += 1;
  });
  if (changed) {
    ehSave();
    ehScheduleRedraw();
  }
  return changed;
}

function ehLoad() {
  try {
    const raw = localStorage.getItem(EH_STORAGE_KEY);
    if (!raw) return;
    JSON.parse(raw).forEach(([compact, rate, depth, w, ms, at]) => {
      const mateWinner = w === "c" ? "cho" : w === "h" ? "han" : null;
      ehRates.set(ehExpandKey(compact), { rate, depth, src: "fsf", mateWinner, ms: ms || 0, at: at || 0 });
    });
  } catch (e) {
    console.warn("[eval-history] 형세 기록 불러오기 실패:", e);
  }
}

// ===== 줄의 국면들 =====

/**
 * 줄(varId, null = 본선)의 0수부터 toStep수까지 국면을 차례로 만듭니다.
 * @returns {Array<{step:number, team:string, snap:Array, key:string}>}
 */
function ehLinePositions(varId, toStep) {
  const moves = varId ? variationLineMoves(varId, toStep) : log.slice(0, toStep);
  const out = [];
  cfWithPositionAt(0, () => {
    const push = step => {
      const team = cfSideToMove(step);
      const snap = cfSnapshot();
      out.push({ step, team, snap, key: ehKey(team, snap) });
    };
    push(0);
    moves.forEach((m, k) => {
      cfDoMove(m);
      push(k + 1);
    });
  });
  return out;
}

/** 이 국면이 둘 수 없는 외통인지 (차례인 쪽이 장군을 받았고 둘 수가 없음) */
function ehIsMate(pos) {
  if (ehMates.has(pos.key)) return ehMates.get(pos.key);
  const now = cfSnapshot();
  let mate = false;
  try {
    cfRestore(pos.snap);
    mate = isKingInCheck(pos.team) && getFilteredLegalMoves(pos.team).length === 0;
  } finally {
    cfRestore(now);
  }
  ehMates.set(pos.key, mate);
  return mate;
}

/** 이 국면에서 외통으로 이기게 되어 있는 쪽 ("cho"|"han"|null). 둘 수 없는 외통 국면이면 계산 없이 안다. */
function ehMateWinner(pos) {
  if (ehIsMate(pos)) return pos.team === "cho" ? "han" : "cho";
  const r = ehRates.get(pos.key);
  return r ? r.mateWinner : null;
}

/**
 * 줄의 착수 하나(before → after)에 대한 표시.
 * forced: 착수 뒤 국면이 처음으로 강제 외통이 된 수 (앞 국면은 아니었음) = 외통을 피할 수 없게 된 첫 수.
 */
function ehMoveFlag(before, after) {
  const ra = ehRateOf(after.key);
  const rb = ehRateOf(before.key);
  const delta = ra !== null && rb !== null ? ra - rb : null;
  const wAfter = ehMateWinner(after);
  const wBefore = ehMateWinner(before);
  return {
    forced: wAfter !== null && wAfter !== wBefore,
    mate: ehIsMate(after),
    mateWinner: wAfter,
    precision: ehPrecisionText(ehRates.get(after.key)),
    big: delta !== null && Math.abs(delta) >= EH_BIG_CHANGE - 1e-9,
    rate: ra,
    delta
  };
}

/**
 * 변화도 점마다 색 표시: 외통을 피할 수 없게 된 첫 수, 승률이 크게 바뀐 수.
 * @returns {Map<string, {forced:boolean, mate:boolean, mateWinner:string|null, big:boolean, rate:number|null, delta:number|null}>}
 *   "가지 id(본선은 빈 글자):수순" → 표시
 */
function ehTreeFlags() {
  const flags = new Map();
  const needed = new Map();
  const mark = (varId, positions, fromStep) => {
    for (let s = Math.max(1, fromStep); s < positions.length; s++) {
      const before = positions[s - 1];
      const after = positions[s];
      if (ehRateOf(after.key) === null) needed.set(after.key, after);
      if (ehRateOf(before.key) === null) needed.set(before.key, before);
      const flag = ehMoveFlag(before, after);
      flag.forced = false; // 빨강은 아래에서 줄마다 한 수만 정한다
      flags.set(`${varId || ""}:${s}`, flag);
    }
    const first = ehForcedStart(positions);
    if (first !== null && first >= Math.max(1, fromStep)) {
      const f = flags.get(`${varId || ""}:${first}`);
      if (f) f.forced = true;
    }
  };
  mark(null, ehLinePositions(null, log.length), 1);
  getVariations().forEach(v => {
    // 가지가 맡은 수순(갈라진 다음 수부터 끝까지)만 표시한다
    mark(v.id, ehLinePositions(v.id, variationEndStep(v)), v.parentStep + 1);
  });
  ehNeeded = [...needed.values()];
  return flags;
}

/**
 * 줄에서 외통을 피할 수 없게 된 첫 수의 수순.
 * 줄 끝(아직 분석되지 않았으면 마지막으로 분석된 국면)이 강제 외통(이기는 쪽 W)일 때, 끝에서부터 거꾸로 W의 외통 흐름이 이어지는 구간을 찾고
 * 그 구간에서 처음으로 W의 외통이 확인된 국면을 만든 수를 돌려준다.
 * 짧은 분석이 외통 수순을 놓친 국면(외통 표시 없음)도 W의 승률이 EH_FORCED_HOLD 이상이면 흐름이 이어진 것으로 본다.
 * @returns {number|null}
 */
function ehForcedStart(positions) {
  if (positions.length < 2) return null;
  // 줄 끝이 아직 분석되지 않았으면 마지막으로 판단이 있는 국면을 기준으로 삼는다
  let last = positions.length - 1;
  while (last > 0 && !ehIsMate(positions[last]) && !ehRates.has(positions[last].key)) last -= 1;
  positions = positions.slice(0, last + 1);
  if (positions.length < 2) return null;
  const w = ehMateWinner(positions[positions.length - 1]);
  if (!w) return null;
  const holds = pos => {
    const mw = ehMateWinner(pos);
    if (mw) return mw === w;
    const r = ehRateOf(pos.key);
    if (r === null) return false;
    return (w === "cho" ? r : 1 - r) >= EH_FORCED_HOLD;
  };
  let k = positions.length - 1;
  while (k - 1 >= 0 && holds(positions[k - 1])) k -= 1;
  for (let s = Math.max(1, k); s < positions.length; s++) {
    if (ehMateWinner(positions[s]) === w) return s;
  }
  return null;
}

/** 표시 → 점 색 (변화도·그래프 공통). 해당 없으면 null */
function ehFlagColor(flag) {
  if (!flag) return null;
  if (flag.forced) return EH_COLOR_FORCED;
  if (flag.big) return EH_COLOR_BIG;
  return null;
}

// ===== 빈 국면 채우기 =====

function ehEngineReady() {
  return typeof aiEnginePref === "function" && aiEnginePref() === "fsf" &&
    typeof fsfStatus === "function" && fsfStatus().state === "ready";
}

function ehEngineIdle() {
  return typeof fsfCurrentKind !== "undefined" && fsfCurrentKind === null && fsfWaiting === 0;
}

/** 엔진을 쓸 수 없을 때: 내장 평가를 승률로 */
function ehBuiltinRate(pos) {
  const now = cfSnapshot();
  try {
    cfRestore(pos.snap);
    return typeof hgBuiltinRate === "function" ? hgBuiltinRate() : 0.5;
  } finally {
    cfRestore(now);
  }
}

/** 다음에 채울 국면: 그래프 창이 열려 있으면 그 줄들 먼저, 아니면 보이는 변화도의 국면 */
function ehNextMissing() {
  if (isEvalChartOpen()) {
    const series = ehChartSeries();
    for (const line of series) {
      const miss = line.positions.find(p => ehRateOf(p.key) === null);
      if (miss) return { pos: miss, urgent: true };
    }
  }
  const treeVisible = typeof isLeftDrawerOpen === "function" && isLeftDrawerOpen();
  if (treeVisible) {
    const miss = ehNeeded.find(p => ehRateOf(p.key) === null);
    if (miss) return { pos: miss, urgent: false };
  }
  return null;
}

/**
 * 기다리는 동안 정밀화할 다음 국면: 지금 수부터 줄 끝까지, 가장 낮은 단계부터 (1초를 모두 마치면 3초, 그다음 8초).
 * @returns {{pos:Object, ms:number, done:number, total:number}|null}
 */
function ehNextRefine() {
  if (Date.now() - ehLastActivity < EH_REFINE_IDLE_MS) return null;
  if (!ehEngineReady() || !ehEngineIdle()) return null;
  const c = ehCursor();
  const v = c.varId ? getVariation(c.varId) : null;
  const end = v ? variationEndStep(v) : log.length;
  // 둘 수 없는 외통 국면과 외통 수순이 이미 확인된 국면은 더 다듬을 것이 없다
  const positions = ehLinePositions(c.varId, end).slice(c.step)
    .filter(p => !ehIsMate(p) && !((ehRates.get(p.key) || {}).mateWinner));
  if (!positions.length) return null;
  for (const ms of EH_REFINE_LEVELS_MS) {
    const done = positions.filter(p => ((ehRates.get(p.key) || {}).ms || 0) >= ms).length;
    const pos = positions.find(p => ((ehRates.get(p.key) || {}).ms || 0) < ms);
    if (pos) return { pos, ms, done, total: positions.length };
  }
  return null;
}

/** 정밀화 진행 글 (변화도 머리) */
function ehShowRefineStatus() {
  const el = document.getElementById("eh-refine-status");
  if (!el) return;
  if (!ehRefineInfo) {
    el.textContent = "";
    el.title = "";
    return;
  }
  const sec = ehRefineInfo.ms / 1000;
  el.textContent = `형세 다듬는 중 · ${sec}초 ${ehRefineInfo.done}/${ehRefineInfo.total}`;
  el.title = `기다리는 동안 지금 수부터 끝까지 형세를 국면당 ${sec}초씩 다시 판단합니다 (1초 → 3초 → 8초). 아무 입력이나 하면 멈춥니다.`;
}

async function ehRefineTick() {
  const r = ehNextRefine();
  if (!r) {
    if (ehRefineInfo) {
      ehRefineInfo = null;
      ehShowRefineStatus();
    }
    return;
  }
  ehRefineInfo = { ms: r.ms, done: r.done, total: r.total };
  ehShowRefineStatus();
  ehFilling = true;
  const t0 = performance.now();
  try {
    // "analysis"라서 사용자가 움직이거나 AI가 두려 하면 바로 멈추고 양보한다
    const res = await fsfAnalyze(r.pos.team, { position: r.pos.snap, multipv: 1, movetime: r.ms, kind: "analysis" });
    const spent = Math.round(performance.now() - t0);
    // 외통 수순을 찾아 일찍 끝났으면 그 단계를 다 본 것으로 친다. 아니면 실제로 쓴 시간 (양보해서 중간에 멈췄을 수 있다)
    const certain = res && res.length && res[0].mate !== null && res[0].mate !== undefined;
    if (res) ehRecordResult(r.pos.key, res, certain ? r.ms : Math.min(r.ms, spent));
  } catch (err) {
    console.error("[eval-history] 형세 정밀화 실패:", err);
  } finally {
    ehFilling = false;
  }
}

async function ehFillTick() {
  if (ehFilling) return;
  const next = ehNextMissing();
  if (!next) {
    await ehRefineTick();
    return;
  }
  if (ehRefineInfo) {
    ehRefineInfo = null;
    ehShowRefineStatus();
  }
  if (!ehEngineReady()) {
    // 엔진이 없으면 그래프 창에 한해 내장 평가로 채운다 (변화도 노랑·빨강 표시는 엔진 값만 쓴다)
    if (next.urgent) ehStore(next.pos.key, ehBuiltinRate(next.pos), 0, "builtin", null, 0);
    return;
  }
  // 그래프 창이 아니면 엔진이 한가할 때만 (추천수·AI 착수를 방해하지 않는다)
  if (!next.urgent && !ehEngineIdle()) return;
  ehFilling = true;
  try {
    const res = await fsfAnalyze(next.pos.team, {
      position: next.pos.snap,
      multipv: 1,
      movetime: EH_FILL_MOVETIME,
      kind: next.urgent ? "facts" : "analysis"
    });
    if (res) ehRecordResult(next.pos.key, res, EH_FILL_MOVETIME);
    else ehStore(next.pos.key, ehBuiltinRate(next.pos), 0, "builtin", null, 0);
  } catch (err) {
    console.error("[eval-history] 형세 채우기 실패:", err);
  } finally {
    ehFilling = false;
    // 그래프 창이 열려 있으면 쉬지 않고 다음 국면을 채운다
    if (next.urgent && isEvalChartOpen()) setTimeout(ehFillTick, 20);
  }
}

// ===== 형세 그래프 창 =====

function isEvalChartOpen() {
  const modal = document.getElementById("eval-chart-modal");
  return !!modal && !modal.hidden;
}

/** 지금 보고 있는 국면 (두어보기 중이면 가지 국면) */
function ehCursor() {
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  return inPreview ? { varId: previewCursor.varId, step: previewCursor.step } : { varId: null, step: cfCurrentStep() };
}

/**
 * 그래프에 그릴 줄들: 본선 0수~기보 마지막 수, 그리고 지금 국면에서 갈라진 가지들(추천수 가지 등).
 * 지금 가지 위에 있으면 그 가지도 함께 그린다. 가지는 갈라진 국면부터 끝까지.
 * @returns {Array<{varId:string|null, from:number, positions:Array}>}
 */
function ehChartSeries() {
  const series = [{ varId: null, from: 0, positions: ehLinePositions(null, log.length) }];
  const c = ehCursor();
  const drawn = new Set();
  // 1) 지금 가지까지 이어지는 길: 본선에서 갈라진 가지 → 그 속 가지 → … → 지금 가지. 가지를 몇 번 옮겨 다녔든
  //    본선에서 지금 가지까지 끊기지 않게, 구간마다 그 가지 색으로 이어 그린다
  if (c.varId && getVariation(c.varId)) {
    const chain = [];
    for (let v = getVariation(c.varId); v; v = v.parentVarId ? getVariation(v.parentVarId) : null) chain.unshift(v);
    const cur = chain[chain.length - 1];
    const path = ehLinePositions(cur.id, variationEndStep(cur));
    chain.forEach((v, k) => {
      const next = chain[k + 1];
      const to = next ? next.parentStep : path.length - 1;
      series.push({ varId: v.id, from: v.parentStep, positions: path.slice(v.parentStep, to + 1), path: true });
      drawn.add(v.id);
    });
  }
  // 2) 지금 국면에서 갈라진 가지들 (추천수 가지 등)
  getChildVariations(c.varId, c.step).forEach(v => {
    if (drawn.has(v.id)) return;
    const all = ehLinePositions(v.id, variationEndStep(v));
    series.push({ varId: v.id, from: v.parentStep, positions: all.slice(v.parentStep) });
  });
  return series;
}

/** 헤더 형세 줄을 누르면 엽니다. 재생 중이면 잠시 멈춘다. */
function openEvalChart() {
  const modal = document.getElementById("eval-chart-modal");
  if (!modal) return;
  ehChartResume = null;
  if (typeof isAutoplayActive !== "undefined" && isAutoplayActive && typeof stopAutoplay === "function") {
    stopAutoplay();
    ehChartResume = { kind: "autoplay" };
  } else if (typeof isVariationPlaying === "function" && isVariationPlaying()) {
    pvStopPlayback();
    const v = getVariation(previewCursor.varId);
    if (v) ehChartResume = { kind: "variation", varId: v.id, end: variationEndStep(v) };
  } else if (typeof isPreviewWalking === "function" && isPreviewWalking()) {
    pvWalkStop();
  }
  modal.hidden = false;
  ehRenderChart();
  const closeBtn = modal.querySelector(".eval-chart-close");
  if (closeBtn) closeBtn.focus();
}

function ehChartIsFull() {
  const modal = document.getElementById("eval-chart-modal");
  return !!modal && modal.classList.contains("full");
}

/** 그래프 창의 전체 화면 아이콘: 브라우저 창 전체로 키우거나 되돌린다 */
function toggleEvalChartFull() {
  const modal = document.getElementById("eval-chart-modal");
  if (!modal) return;
  const full = !modal.classList.contains("full");
  modal.classList.toggle("full", full);
  const btn = document.getElementById("eval-chart-full-btn");
  if (btn) {
    const label = full ? "전체 화면 끝내기" : "전체 화면으로 보기";
    btn.title = label;
    btn.setAttribute("aria-label", `형세 그래프 ${label}`);
    btn.setAttribute("aria-pressed", full ? "true" : "false");
    const use = btn.querySelector("use");
    if (use) use.setAttribute("href", full ? "#i-minimize" : "#i-maximize");
  }
  requestAnimationFrame(ehRenderChart);
}

/** 닫고, 멈췄던 재생을 이어 갑니다. */
function closeEvalChart() {
  const modal = document.getElementById("eval-chart-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  const resume = ehChartResume;
  ehChartResume = null;
  if (!resume) return;
  if (resume.kind === "autoplay" && typeof startAutoplay === "function") startAutoplay();
  if (resume.kind === "variation" && typeof pvWalkPreviewTo === "function" && getVariation(resume.varId)) {
    pvWalkPreviewTo(resume.varId, resume.end);
  }
}

/** 창 바깥(어두운 바탕)을 누르면 닫는다 */
function handleEvalChartBackdrop(ev) {
  if (ev && ev.target && ev.target.id === "eval-chart-modal") closeEvalChart();
}

const EH_SVG_NS = "http://www.w3.org/2000/svg";

function ehSvg(tag, attrs, parent) {
  const el = document.createElementNS(EH_SVG_NS, tag);
  Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

/**
 * 꺾은선 그래프를 그립니다: 가로 = 수순, 세로 = 초 승률 (위가 초, 아래가 한).
 * 본선은 흰 선, 가지는 초록 선. 점 색은 변화도와 같다 (빨강 = 외통을 피할 수 없게 된 첫 수, 노랑 = 변화가 많은 수).
 * 계산 안 된 국면은 선을 끊는다.
 */
function ehRenderChart() {
  const box = document.getElementById("eval-chart-plot");
  const status = document.getElementById("eval-chart-status");
  if (!box) return;
  const series = ehChartSeries();
  const flags = ehTreeFlags();
  const cursor = ehCursor();
  const maxStep = Math.max(1, ...series.map(sr => sr.positions.length ? sr.positions[sr.positions.length - 1].step : 0));
  // 전체 화면이면 창 크기만큼 크게 그린다 (글자 크기는 그대로)
  const full = ehChartIsFull();
  const W = full ? Math.max(640, Math.floor(box.clientWidth)) : 640;
  const H = full ? Math.max(300, Math.floor(box.clientHeight)) : 300;
  const padL = 40;
  const padR = 14;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xOf = s => padL + (s / maxStep) * plotW;
  const yOf = r => padT + (1 - r) * plotH;

  const svgEl = ehSvg("svg", { viewBox: `0 0 ${W} ${H}`, class: "eval-chart-svg", role: "img", "aria-label": "형세 꺾은선 그래프 (초 승률)" });
  // 바탕: 위 = 초 우세(파랑), 아래 = 한 우세(빨강)
  ehSvg("rect", { x: padL, y: padT, width: plotW, height: plotH / 2, class: "eval-chart-cho-zone" }, svgEl);
  ehSvg("rect", { x: padL, y: padT + plotH / 2, width: plotW, height: plotH / 2, class: "eval-chart-han-zone" }, svgEl);
  [0, 0.25, 0.5, 0.75, 1].forEach(r => {
    ehSvg("line", { x1: padL, x2: W - padR, y1: yOf(r), y2: yOf(r), class: r === 0.5 ? "eval-chart-mid" : "eval-chart-grid" }, svgEl);
    const t = ehSvg("text", { x: padL - 6, y: yOf(r), class: "eval-chart-ylabel" }, svgEl);
    t.textContent = `${Math.round(r * 100)}%`; // 눈금 글 (0·25·50·75·100%)
  });
  const every = maxStep > 120 ? 20 : 10;
  for (let s = 0; s <= maxStep; s += every) {
    const t = ehSvg("text", { x: xOf(s), y: H - 8, class: "eval-chart-xlabel" }, svgEl);
    t.textContent = String(s);
  }
  // 지금 보고 있는 수
  ehSvg("line", { x1: xOf(cursor.step), x2: xOf(cursor.step), y1: padT, y2: padT + plotH, class: "eval-chart-cursor" }, svgEl);

  let known = 0;
  let total = 0;
  const seen = new Set();
  const gLines = ehSvg("g", {}, svgEl);
  const gDots = ehSvg("g", { class: "eval-chart-dots" }, svgEl);
  // 가지를 먼저(아래), 본선을 나중(위)에
  [...series].reverse().forEach(sr => {
    const isMain = !sr.varId;
    // 변화도와 같은 색: 본선 흰색, 가지는 가지마다 다른 색
    const lineColor = isMain ? EH_COLOR_MAIN : (typeof variationColorOf === "function" && variationColorOf(sr.varId)) || EH_COLOR_BRANCH;
    let seg = [];
    const flush = () => {
      if (seg.length > 1) ehSvg("polyline", { points: seg.join(" "), class: "eval-chart-line", stroke: lineColor }, gLines);
      seg = [];
    };
    sr.positions.forEach(p => {
      const r = ehRateOf(p.key);
      const id = `${sr.varId || ""}:${p.step}`;
      if (!seen.has(p.key)) {
        seen.add(p.key);
        total += 1;
        if (r !== null) known += 1;
      }
      if (r === null) {
        flush();
        if (isMain || p.step > sr.from) ehSvg("circle", { cx: xOf(p.step), cy: yOf(0.5), r: 2, class: "eval-chart-pending" }, gDots);
        return;
      }
      seg.push(`${xOf(p.step).toFixed(1)},${yOf(r).toFixed(1)}`);
      // 가지의 첫 점(갈라진 국면)은 본선 점과 겹치므로 그리지 않는다
      if (!isMain && p.step === sr.from) return;
      const flag = flags.get(id);
      const c = ehSvg("circle", {
        cx: xOf(p.step), cy: yOf(r), r: maxStep > 80 ? 2.6 : 3.5,
        fill: ehFlagColor(flag) || (!isMain && typeof variationIsJoin === "function" && variationIsJoin(getVariation(sr.varId), p.step) ? "#facc15" : lineColor),
        class: "eval-chart-dot" + (p.step === cursor.step && (sr.varId || null) === (cursor.varId || null) ? " current" : ""),
        "data-action": "evalChartGoTo",
        "data-value": isMain ? String(p.step) : `${sr.varId}:${p.step}`
      }, gDots);
      const extra = flag && flag.forced ? ` · 외통을 피할 수 없게 된 수 (${flag.mateWinner === "cho" ? "초" : "한"} 승)` : flag && flag.big ? ` · 변화가 많은 수 (${flag.delta >= 0 ? "+" : ""}${Math.round(flag.delta * 100)}%p)` : "";
      const prec = ehPrecisionText(ehRates.get(p.key));
      const mateKnown = !!ehMateWinner(p);
      const pct = v => (typeof hgPctText === "function" ? hgPctText(v, mateKnown) : `${Math.round(v * 100)}%`);
      const branchNo = isMain ? "" : ` ${String(sr.varId).replace(/^v/, "")}번`;
      ehSvg("title", {}, c).textContent = `${isMain ? "본선" : `가지${branchNo} (${(getVariation(sr.varId) || {}).label || ""})`} ${p.step}수 · 초 ${pct(r)} · 한 ${pct(1 - r)}${mateKnown ? ` · ${ehMateWinner(p) === "cho" ? "초" : "한"} 외통 승` : ""}${prec ? ` (${prec})` : ""}${extra}`;
    });
    flush();
  });
  box.replaceChildren(svgEl);
  if (status) {
    const branchNote = series.length > 1 ? ` · 가지 ${series.length - 1}개` : "";
    // 정밀도 요약: 본선 국면 중 1초·3초·8초 이상 판단한 수
    const mainRecs = series[0].positions.map(p => ehRates.get(p.key)).filter(Boolean);
    const at = ms => mainRecs.filter(r => (r.ms || 0) >= ms).length;
    const avgDepth = mainRecs.length ? Math.round(mainRecs.reduce((a, r) => a + Math.min(r.depth, 40), 0) / mainRecs.length) : 0;
    const precNote = mainRecs.length ? ` · 정밀도: 평균 깊이 ${avgDepth}, 1초↑ ${at(1000)} · 3초↑ ${at(3000)} · 8초↑ ${at(8000)}` : "";
    status.textContent = (known >= total ? `${total}개 국면 모두 계산됨` : `${known}/${total}개 국면 계산됨 · 나머지는 계산되는 대로 채웁니다`) + branchNote + precNote;
  }
}

/**
 * 그래프의 점을 누르면 그 수로 (한 수씩 밟고 간다).
 * @param {string|number} value - 본선이면 수순, 가지면 "가지 id:수순"
 */
function evalChartGoTo(value) {
  const text = String(value);
  const colon = text.lastIndexOf(":");
  const varId = colon > 0 ? text.slice(0, colon) : null;
  const step = parseInt(colon > 0 ? text.slice(colon + 1) : text, 10);
  if (!isFinite(step)) return;
  closeEvalChart();
  if (varId) pvWalkPreviewTo(varId, step);
  else pvRealGoTo(step);
}

ehLoad();

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("eval-chart-modal");
  // body의 perspective 영향을 받지 않도록 <html> 바로 아래로
  if (modal) document.documentElement.appendChild(modal);
  setInterval(ehFillTick, EH_FILL_TICK_MS);
  // 마우스·키보드 입력이 있으면 정밀화를 미룬다 (기다릴 때만 다듬는다)
  const touch = () => {
    ehLastActivity = Date.now();
  };
  ["pointerdown", "keydown", "wheel"].forEach(t => document.addEventListener(t, touch, { capture: true, passive: true }));
  // 전체 화면 그래프는 창 크기가 바뀌면 다시 그린다
  window.addEventListener("resize", () => {
    if (isEvalChartOpen() && ehChartIsFull()) requestAnimationFrame(ehRenderChart);
  });
  window.addEventListener("beforeunload", ehSave);
});
