/**
 * @fileoverview 대국 규칙 (오른쪽 서랍 "새 대국" 영역의 "대국 규칙").
 *  - 규칙 묶음: "카장룰"(카카오 장기 규칙을 따름) 또는 "직접 설정". 개별 규칙을 바꾸면 "직접 설정"이 된다.
 *      카장룰 = 같은 국면 3번째 금지 · 장군 받는 쪽 예외 · 고득점자 양보 끔 · 빅장 금지 · 200수 종료 · 10점 미만 종료
 *  - 200수 종료: 실제 대국이 200수가 되면 끝나고 기물 점수(한 덤 1.5 포함)가 높은 쪽이 이긴다.
 *  - 10점 미만 종료: 둔 뒤 어느 한쪽 기물 점수가 10점 미만이면 끝나고 점수가 높은 쪽이 이긴다.
 *  - 반복수: 두면 같은 국면(같은 기물 배치·같은 차례)이 세 번째가 되는 수는 둘 수 없다 (후보에서 빠진다).
 *      장군 받는 쪽 예외: 장군을 받고 있는 쪽은 반복이 되어도 둘 수 있다 (장군 부르는 쪽만 막혀 연속 장군 금지가 된다).
 *      고득점자 양보: 켜면 반복 금지는 기물 점수(한 덤 1.5 포함)가 높은 쪽에만 걸린다.
 *      반복은 지금 보고 있는 줄(본선 또는 놓아보기 가지)의 처음부터 지금까지 국면으로 센다.
 *  - 빅장(두 궁이 같은 세로줄에서 사이에 아무것도 없이 마주 봄):
 *      금지 = 빅장이 되는 수는 둘 수 없다. 허용 = 빅장이 되면 대국이 끝나고 기물 점수가 높은 쪽이 이긴다.
 *  - 적용 방법: 전역 getFilteredLegalMoves(ai.js)를 감싼다. 판의 후보 표시·키보드·AI(내장)·Fairy-Stockfish(searchmoves)·
 *    추천수가 모두 이 함수를 쓰므로 한 곳에서 걸린다. 반복 검사는 지금 판 국면(줄의 마지막 국면)을 물을 때만 한다
 *    (내장 AI가 수읽기 중 기물을 옮겨 보는 국면에는 걸지 않는다).
 *  - 저장: localStorage "janggiRules"
 * 공개 함수: getGameRules(), setRulePreset(value), setRuleRepetition(checked), setRuleCheckExempt(checked),
 *           setRuleHigherYields(checked), setRuleBikjang(value), setRuleMoveLimit(checked), setRuleUnder10(checked),
 *           isBikjangNow()
 * @module game-rules
 * @depends state, rules, ai, main, variation, preview, app-dialog, ui
 */

const GR_STORAGE_KEY = "janggiRules";
const GR_MOVE_LIMIT = 200;
const GR_MIN_SCORE = 10;
const GR_PRESETS = {
  kakao: { repetition: true, checkExempt: true, higherYields: false, bikjang: "forbid", moveLimit: true, under10: true }
};
let gameRules = Object.assign({ preset: "kakao" }, GR_PRESETS.kakao);

function getGameRules() {
  return Object.assign({}, gameRules);
}

function grSave() {
  try {
    localStorage.setItem(GR_STORAGE_KEY, JSON.stringify(gameRules));
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

function grLoad() {
  try {
    const saved = JSON.parse(localStorage.getItem(GR_STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") {
      gameRules = {
        preset: saved.preset === "custom" ? "custom" : "kakao",
        repetition: saved.repetition !== false,
        checkExempt: saved.checkExempt !== false,
        higherYields: !!saved.higherYields,
        bikjang: saved.bikjang === "allow" ? "allow" : "forbid",
        moveLimit: saved.moveLimit !== false,
        under10: saved.under10 !== false
      };
      if (gameRules.preset === "kakao") Object.assign(gameRules, GR_PRESETS.kakao);
    }
  } catch (e) {
    // 기본값(카장룰)
  }
}

// ===== 설정 화면 =====

function grRender() {
  const set = (id, prop, value) => {
    const el = document.getElementById(id);
    if (el) el[prop] = value;
  };
  set("rule-preset-select", "value", gameRules.preset);
  set("rule-repetition", "checked", gameRules.repetition);
  set("rule-check-exempt", "checked", gameRules.checkExempt);
  set("rule-higher-yields", "checked", gameRules.higherYields);
  set("rule-bikjang-select", "value", gameRules.bikjang);
  set("rule-move-limit", "checked", gameRules.moveLimit);
  set("rule-under10", "checked", gameRules.under10);
  // 반복 금지가 꺼져 있으면 딸린 두 규칙은 흐리게
  ["rule-check-exempt", "rule-higher-yields"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !gameRules.repetition;
  });
}

function grChanged(custom) {
  if (custom) gameRules.preset = "custom";
  grSave();
  grRender();
  grCacheKey = null;
  grQuickKey = null;
  if (typeof clearCandiBox === "function") clearCandiBox();
  // 추천수·형세는 합법수가 바뀌었을 수 있으므로 다시 (recommend.js)
  if (typeof scheduleRecommendations === "function") scheduleRecommendations(true);
}

/** 규칙 묶음: "kakao" | "custom" */
function setRulePreset(value) {
  if (value === "kakao") {
    gameRules = Object.assign({ preset: "kakao" }, GR_PRESETS.kakao);
    grChanged(false);
    if (typeof showToast === "function") showToast("대국 규칙: 카장룰 (3번 반복 금지·장군 예외·빅장 금지·200수·10점 미만)");
  } else {
    gameRules.preset = "custom";
    grChanged(false);
  }
}

function setRuleRepetition(checked) {
  gameRules.repetition = !!checked;
  grChanged(true);
}

function setRuleCheckExempt(checked) {
  gameRules.checkExempt = !!checked;
  grChanged(true);
}

function setRuleHigherYields(checked) {
  gameRules.higherYields = !!checked;
  grChanged(true);
}

function setRuleBikjang(value) {
  gameRules.bikjang = value === "allow" ? "allow" : "forbid";
  grChanged(true);
}

function setRuleMoveLimit(checked) {
  gameRules.moveLimit = !!checked;
  grChanged(true);
}

function setRuleUnder10(checked) {
  gameRules.under10 = !!checked;
  grChanged(true);
}

// ===== 빅장 =====

function grRow(y) {
  return y === 0 ? 10 : y;
}

/** 지금 pieces에서 두 궁이 빅장(같은 세로줄, 사이에 기물 없음)인지 */
function isBikjangNow() {
  const a = pieces[0];
  const b = pieces[16];
  if (!a || !b || (a.x === 0 && a.y === 0) || (b.x === 0 && b.y === 0) || a.x !== b.x) return false;
  const lo = Math.min(grRow(a.y), grRow(b.y));
  const hi = Math.max(grRow(a.y), grRow(b.y));
  for (let k = 0; k < 32; k++) {
    if (k === 0 || k === 16) continue;
    const p = pieces[k];
    if (!p || (p.x === 0 && p.y === 0) || p.x !== a.x) continue;
    const r = grRow(p.y);
    if (r > lo && r < hi) return false;
  }
  return true;
}

/** 수 m을 두어 본 국면에서 fn()을 부르고 되돌린다 */
function grWithMove(m, fn) {
  const mover = pieces[m.i];
  const ox = mover.x;
  const oy = mover.y;
  const t = whoIsit(m.x, m.y);
  let cx = 0;
  let cy = 0;
  if (t < NO_PIECE && t !== m.i) {
    cx = pieces[t].x;
    cy = pieces[t].y;
    pieces[t].x = 0;
    pieces[t].y = 0;
  }
  mover.x = m.x;
  mover.y = m.y;
  try {
    return fn();
  } finally {
    mover.x = ox;
    mover.y = oy;
    if (t < NO_PIECE && t !== m.i) {
      pieces[t].x = cx;
      pieces[t].y = cy;
    }
  }
}

// ===== 반복수 =====

let grCacheKey = null;
let grQuickKey = null;
let grCache = null; // { counts: Map(국면 열쇠 → 횟수), head: 마지막 국면의 기물 배치 열쇠, step }

function grBoardKey(pos) {
  let s = "";
  for (let k = 0; k < 32; k++) s += `${pos[k].x}${pos[k].y}.`;
  return s;
}

/** 지금 보고 있는 줄의 수 목록 (본선이면 지금 수순까지, 놓아보기면 그 가지 국면까지) */
function grLineMoves() {
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  if (inPreview && typeof variationLineMoves === "function") {
    return variationLineMoves(previewCursor.varId, previewCursor.step);
  }
  const step = typeof cfCurrentStep === "function" ? cfCurrentStep() : log.length;
  return log.slice(0, Math.min(step, log.length)).map(m => ({ i: m.i, x: m.x, y: m.y }));
}

/** 줄의 국면마다 (배치+차례) 횟수를 센다. 같은 줄이면 다시 계산하지 않는다 */
function grHistory() {
  // 가벼운 열쇠로 먼저 거른다: 내장 AI 수읽기 중에는 이 함수가 매우 자주 불리므로 줄 전체를 매번 훑지 않는다
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  const last = log.length ? log[log.length - 1] : null;
  const i0 = initPieces[0];
  const ctx = inPreview
    ? `p|${previewCursor.varId}|${previewCursor.step}|${typeof getVariations === "function" ? getVariations().length : 0}`
    : `m|${typeof cfCurrentStep === "function" ? cfCurrentStep() : log.length}|${log.length}|${last ? `${last.i}.${last.x}.${last.y}` : ""}`;
  const quick = `${ctx}|${i0 ? `${i0.x}${i0.y}` : ""}|${iAmCho}`;
  if (quick === grQuickKey && grCache) return grCache;
  grQuickKey = quick;
  const moves = grLineMoves();
  const init = initPieces.map(p => (p ? `${p.x}${p.y}` : "")).join(",");
  const key = `${init}|${moves.map(m => `${m.i}.${m.x}.${m.y}`).join(",")}`;
  if (key === grCacheKey && grCache) return grCache;
  const pos = initPieces.map(p => ({ x: p ? p.x : 0, y: p ? p.y : 0 }));
  const counts = new Map();
  const add = step => {
    const k = `${grBoardKey(pos)}${cfSideToMove(step)}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  };
  add(0);
  moves.forEach((m, idx) => {
    for (let k = 0; k < 32; k++) {
      if (k !== m.i && pos[k].x === m.x && pos[k].y === m.y) {
        pos[k].x = 0;
        pos[k].y = 0;
      }
    }
    pos[m.i].x = m.x;
    pos[m.i].y = m.y;
    add(idx + 1);
  });
  grCacheKey = key;
  grCache = { counts, head: grBoardKey(pos), step: moves.length };
  return grCache;
}

/** team이 지금 국면에서 반복 금지에 걸리는지 (장군 예외·고득점자 양보 반영) */
function grRepetitionApplies(team) {
  if (gameRules.checkExempt && isKingInCheck(team)) return false;
  if (gameRules.higherYields && typeof calculateTeamScores === "function") {
    const s = calculateTeamScores();
    const mine = team === "cho" ? s.scoreCho : s.scoreHan;
    const theirs = team === "cho" ? s.scoreHan : s.scoreCho;
    if (mine < theirs) return false; // 점수가 낮은 쪽은 반복해도 된다
  }
  return true;
}

let grInFilter = false;

function grFilterMoves(team, moves) {
  if (grInFilter) return moves;
  grInFilter = true;
  try {
    let out = moves;
    if (gameRules.bikjang === "forbid") out = out.filter(m => !grWithMove(m, isBikjangNow));
    if (gameRules.repetition && out.length) {
      const h = grHistory();
      // 지금 판이 줄의 마지막 국면이고 그 차례일 때만 (수읽기 중 옮겨 본 국면은 건너뜀)
      if (h.head === grBoardKey(pieces) && cfSideToMove(h.step) === team && grRepetitionApplies(team)) {
        const next = team === "cho" ? "han" : "cho";
        out = out.filter(m => {
          const k = grWithMove(m, () => `${grBoardKey(pieces)}${next}`);
          return (h.counts.get(k) || 0) < 2;
        });
      }
    }
    return out;
  } finally {
    grInFilter = false;
  }
}

// ===== 점수로 끝내기: 빅장(허용일 때) · 200수 · 10점 미만 =====

/** 대국을 끝내고 기물 점수가 높은 쪽을 이긴 쪽으로 알린다 */
function grEndByScore(title, reason) {
  const s = calculateTeamScores();
  const cho = Math.round(s.scoreCho * 10) / 10;
  const han = Math.round(s.scoreHan * 10) / 10;
  const winner = cho > han ? "초나라" : "한나라";
  gameEnded = true;
  if (typeof clearCandiBox === "function") clearCandiBox();
  const msg = `${reason} 기물 점수 초 ${cho} : 한 ${han} (한 덤 포함) — ${winner} 승리.`;
  if (typeof showAppDialog === "function") {
    showAppDialog({ title, message: msg, tone: "win", buttons: [{ label: "닫기", value: null, primary: true }] });
  } else {
    alert(`${title} ${msg}`);
  }
}

/** 실제 대국에서 한 수 둔 뒤: 점수로 끝나는 규칙을 본다 */
function grCheckScoreEnd() {
  if (gameEnded) return;
  if (gameRules.bikjang === "allow" && isBikjangNow()) {
    grEndByScore("빅장!", "두 궁이 마주 보았습니다.");
    return;
  }
  if (gameRules.under10 && typeof calculateTeamScores === "function") {
    const s = calculateTeamScores();
    if (s.scoreCho < GR_MIN_SCORE || s.scoreHan < GR_MIN_SCORE) {
      const low = s.scoreCho < s.scoreHan ? "초" : "한";
      grEndByScore("10점 미만", `${low}의 기물 점수가 ${GR_MIN_SCORE}점 미만이 되었습니다.`);
      return;
    }
  }
  if (gameRules.moveLimit && log.length >= GR_MOVE_LIMIT) {
    grEndByScore(`${GR_MOVE_LIMIT}수 종료`, `${GR_MOVE_LIMIT}수에 이르렀습니다.`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  grLoad();
  grRender();
  const orig = window.getFilteredLegalMoves;
  if (typeof orig === "function") {
    window.getFilteredLegalMoves = function (team) {
      return grFilterMoves(team, orig.apply(this, arguments));
    };
  }
  // 실제 대국에서 둔 뒤 외통 판정(main.js move → checkGameStatus) 때 빅장·200수·10점 미만도 본다. AI 응수 전에 끝낸다
  const origStatus = window.checkGameStatus;
  if (typeof origStatus === "function") {
    window.checkGameStatus = function () {
      const r = origStatus.apply(this, arguments);
      grCheckScoreEnd();
      return r;
    };
  }
});
