/**
 * @fileoverview 기보보기 패널과 두어보기 모드.
 *
 * 흐름
 *  - 툴바의 "기보보기" 버튼이 왼쪽 패널(모바일은 아래 서랍)을 연다. 패널에는 변화도(본선+가지),
 *    수순 이동 버튼, 대국 정보·저장이 들어 있다.
 *  - 변화도의 본선 점(수순)을 누르면 실제 기보의 그 착수로 돌아간다.
 *  - 기보보기가 열린 채 과거 국면에서 본선과 다른 수를 두면, 그 수부터 두어보기(가지)가 된다.
 *    본선과 같은 수를 두면 본선을 한 수 따라간다. 마지막 국면에서 두는 수는 실제 대국으로 이어진다.
 *  - 두어보기 중에는 판에서 두는 수와 "AI가 한 수 두기"가 실제 기보(log)가 아니라 가지(variation.js)에 쌓인다.
 *    "본선 복귀"를 누르거나 본선 점을 누르면 들어오기 직전 국면으로 정확히 돌아온다.
 *  - AI 해설 창의 요청 버튼(수 해설·복기·질문)은 그 자리에서 두어보기를 시작한다.
 *  - 놓아보기(=두어보기) 켜기/끄기: 헤더 왼쪽 버튼(toggleExploreMode). 켜면 현재 기보(변화도) 영역이 열리고, 다시 누르면
 *    들어오기 직전 실제 대국 국면으로 돌아간다. 서랍을 닫아도 놓아보기는 꺼지지 않는다 (버튼으로만 끈다).
 *  - 놓아보기가 꺼져 있을 때 과거 국면(마지막 수가 아닌 곳)에서 다른 수를 두면 "무르시겠습니까?" 팝업(app-dialog.js):
 *      무르기 → 새 수가 본선이 되고, 원래 본선 뒷부분은 "원래 수순" 가지로 남는다 (pvTakeback).
 *      놓아보기로 두기 → 본선은 그대로, 놓아보기를 켜고 새 가지로 둔다.  취소 → 아무것도 두지 않는다.
 *    마지막 국면에서 두는 수는 실제 대국으로 이어진다.
 *
 * 기존 모듈을 덜 고치려고, 전역 함수(move, checkAndRunAI, next, prev …)를 DOMContentLoaded 때 감싼다.
 *
 * 공개 API (뒤 단계에서 사용):
 *   openRecordView(), closeRecordView(), toggleRecordView(), isRecordViewOpen()
 *   isPreviewActive(), enterPreviewMode(reason), exitPreviewMode()
 *   previewGoTo(varId, step), previewStep(delta), previewFirst(), previewLast()
 *   previewPlayMove(i, x, y, source), previewAIMove()
 *   playVariation(id, {intervalMs}) → Promise, isVariationPlaying()
 *   여러 수 이동은 한 수씩 밟고 간다: pvRealGoTo(step), pvWalkPreviewTo(varId, step), isPreviewWalking()
 *   단, 여러 수 뒤로는 기본이 한 번에 가기 (setWalkBackMode("jump"|"rewind"))
 * @module preview
 * @depends state, board, ai, main, ui, record, commentary-facts, variation, variation-tree, engine-fsf
 */

var recordViewOpen = false; // 기보보기 패널이 열려 있는지
var previewActive = false; // 두어보기(가지) 중인지
var previewCursor = { varId: null, step: 0 }; // 두어보기 중 보고 있는 국면
let previewEntry = null; // 두어보기 진입 직전 상태 (복귀용)
let previewTouched = new Set(); // 이번 두어보기에서 들른 가지 (복귀 점선용)
let previewBusy = false; // AI 계산 중
let previewPlayTimer = null;

function isPreviewActive() {
  return previewActive;
}

function isRecordViewOpen() {
  return recordViewOpen;
}

function pvEl(id) {
  return document.getElementById(id);
}

/** 실제 기보에서 지금 보이는 수순 (두어보기 중이면 들어온 국면) */
function pvRealStep() {
  return cfCurrentStep();
}

// ===== 기보보기 패널 =====

function openRecordView() {
  if (recordViewOpen) return;
  recordViewOpen = true;
  const panel = pvEl("preview-panel");
  if (panel) panel.hidden = false;
  document.body.classList.add("record-view-on");
  if (typeof updateSavedRecordsListUI === "function") updateSavedRecordsListUI();
  if (typeof updateMetadataFormFromState === "function") updateMetadataFormFromState();
  pvSyncToggleButton();
  pvRelayout();
  pvRefresh();
}

function closeRecordView() {
  if (!recordViewOpen) return;
  // 고정된 기보 서랍은 자동으로 닫지 않는다 (사용자가 닫을 때는 drawers.js가 강제로 닫음)
  if (typeof isDrawerPinned === "function" && isDrawerPinned("left")) return;
  // 놓아보기는 헤더 버튼으로만 끈다 (서랍을 닫아도 계속)
  recordViewOpen = false;
  const panel = pvEl("preview-panel");
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("expanded");
  }
  document.body.classList.remove("record-view-on");
  if (typeof recClearArrows === "function") recClearArrows();
  pvSyncToggleButton();
  pvRelayout();
}

function toggleRecordView() {
  if (recordViewOpen) closeRecordView();
  else openRecordView();
}

/** 모바일 서랍 펼치기/접기 */
function togglePreviewDrawer() {
  const panel = pvEl("preview-panel");
  if (panel) panel.classList.toggle("expanded");
}

/** 판 크기는 #janggi-app 너비에 맞춰 다시 계산되므로 패널을 열고 닫을 때 resize를 한 번 보냅니다. */
function pvRelayout() {
  // 서랍(drawers.js)이 있으면 판 자리 조정은 서랍 애니메이션이 끝난 뒤 그쪽이 한다
  if (typeof applyDrawerLayout === "function") return;
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function pvSyncToggleButton() {
  // 헤더의 기보 서랍 버튼 (drawers.js)
  if (typeof syncDrawerButtons === "function") syncDrawerButtons();
}

function pvHideSelectBox() {
  if (selectBox) {
    selectBox.setAttribute("x", HIDDEN_COORD);
    selectBox.setAttribute("y", HIDDEN_COORD);
  }
}

// ===== 두어보기 진입·종료 =====

/**
 * 지금 국면에서 두어보기를 시작합니다. 기보보기 패널도 함께 엽니다.
 * @param {string} [reason] - "branch" | "commentary" | "ai" | 뒤 단계 이름
 * @returns {boolean} 두어보기 상태인지
 */
function enterPreviewMode(reason) {
  if (previewActive) return true;
  if (typeof aiThinking !== "undefined" && aiThinking) {
    showToast("AI가 수를 생각하는 중입니다. 잠시 뒤 다시 눌러 주세요.");
    return false;
  }
  if (typeof isAutoplayActive !== "undefined" && isAutoplayActive) stopAutoplay();
  openRecordView();

  const turnEl = pvEl("turn");
  const step = pvRealStep();
  previewEntry = {
    snap: cfSnapshot(),
    turn: turnEl ? turnEl.value : String(step),
    gameEnded,
    prevDisabled: pvEl("prev") ? pvEl("prev").disabled : false,
    nextDisabled: pvEl("next") ? pvEl("next").disabled : false,
    turnDisabled: turnEl ? turnEl.disabled : false,
    reason: reason || "branch"
  };
  previewActive = true;
  previewTouched = new Set();
  previewCursor = { varId: null, step };
  if (turnEl) turnEl.disabled = true;
  document.body.classList.add("previewing");
  previewRender(false);
  return true;
}

/** 두어보기를 끝내고 들어오기 직전 국면으로 정확히 돌아갑니다. 기보보기 패널은 열어 둡니다. */
function exitPreviewMode() {
  pvWalkStop();
  if (!previewActive) return;
  pvStopPlayback();
  previewTouched.forEach(id => {
    const v = getVariation(id);
    if (v) v.returned = true;
  });
  varLayout();
  saveVariations();

  const e = previewEntry;
  previewActive = false;
  previewEntry = null;
  document.body.classList.remove("previewing");

  clearCandiBox();
  const turnEl = pvEl("turn");
  if (turnEl) {
    turnEl.value = e.turn;
    turnEl.disabled = e.turnDisabled;
  }
  gameEnded = e.gameEnded;
  cfRestore(e.snap);
  for (let i = 0; i < 32; i++) setPieces(i, e.snap[i].x, e.snap[i].y, false);
  curSelect = NO_PIECE;
  const backStep = Math.min(parseInt(e.turn, 10) || 0, log.length);
  if (backStep > 0) moveSelectBox(log[backStep - 1].i);
  else pvHideSelectBox();
  if (pvEl("prev")) pvEl("prev").disabled = e.prevDisabled;
  if (pvEl("next")) pvEl("next").disabled = e.nextDisabled;
  updateScore();
  updateCommentBubble();
  pvRefresh();
}

/**
 * 헤더 왼쪽 버튼: 놓아보기 켜기/끄기. 켜면 현재 기보(변화도) 영역을 연다. 끄면 실제 대국 국면으로 돌아간다.
 */
function toggleExploreMode() {
  if (previewActive) {
    exitPreviewMode();
    return;
  }
  if (typeof jumpToDrawerSection === "function") jumpToDrawerSection("lv-sec-tree");
  enterPreviewMode("explore");
  pvSyncExploreButton();
}

/** 헤더 놓아보기 버튼의 켜짐 표시 */
function pvSyncExploreButton() {
  const btn = pvEl("explore-btn");
  if (!btn) return;
  btn.classList.toggle("active", previewActive);
  btn.setAttribute("aria-pressed", previewActive ? "true" : "false");
  btn.title = previewActive
    ? "놓아보기 끄기: 실제 대국 국면으로 돌아갑니다 (I)"
    : "놓아보기 켜기 (현재 기보 열기): 켜면 두는 수가 새 가지가 되고 실제 대국은 그대로입니다 (I)";
}

/** 해설 창 요청 버튼에서 부릅니다. */
function enterPreviewFromCommentary() {
  enterPreviewMode("commentary");
}

function previewEntryStep() {
  if (!previewEntry) return pvRealStep();
  const n = parseInt(previewEntry.turn, 10);
  return isNaN(n) ? log.length : Math.min(n, log.length);
}

// ===== 실제 기보 이동 =====

// ===== 여러 수 이동: 한 수씩 밟고 가기 =====
// 1수에서 15수처럼 여러 수를 한 번에 옮길 때도 판이 순간 이동하지 않고, 지나가는 수순을 한 수씩 짧은 애니메이션으로 보여 준다.

const PV_WALK_STEP_MS = 240; // 한 수 간격
// 여러 수 뒤로 갈 때: "jump" = 한 번에(기본), "rewind" = 한 수씩 되감기 (설정 > 인터페이스, localStorage "walkBackMode")
var pvWalkBackMode = "jump";

/** 설정 > 인터페이스 > 여러 수 뒤로 갈 때 */
function setWalkBackMode(value) {
  pvWalkBackMode = value === "rewind" ? "rewind" : "jump";
  try {
    localStorage.setItem("walkBackMode", pvWalkBackMode);
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  const sel = pvEl("walk-back-select");
  if (sel && sel.value !== pvWalkBackMode) sel.value = pvWalkBackMode;
}
const PV_WALK_ANIM_S = 0.2; // 밟고 가는 동안의 기물 이동 시간 (설정값보다 길면 이 값)
let pvWalkTimer = null;

/** 밟고 가기를 멈추고 기물 이동 시간을 설정값으로 되돌립니다. */
function pvWalkStop() {
  if (!pvWalkTimer) return;
  clearTimeout(pvWalkTimer);
  pvWalkTimer = null;
  if (typeof svg !== "undefined" && svg) svg.style.setProperty("--anim-duration", `${animDuration}s`);
}

/** 밟고 가는 중인지 */
function isPreviewWalking() {
  return !!pvWalkTimer;
}

/**
 * 한 수씩 실행할 동작들을 차례로 실행합니다. 첫 동작은 바로, 나머지는 한 수 간격마다.
 * 뒤로 가는 수({fn, back: true})는 앞으로 가는 수보다 2배 빠르게 (간격·기물 이동 시간 모두 절반).
 * @param {Array<(() => void)|{fn: () => void, back?: boolean}>} steps
 */
function pvWalkRun(steps) {
  pvWalkStop();
  const list = steps.map(s => (typeof s === "function" ? { fn: s, back: false } : s));
  if (!list.length) return;
  // 애니메이션을 끈 설정이면 기다리지 않고 끝까지 간다
  if (list.length === 1 || !(animDuration > 0)) {
    list.forEach(s => s.fn());
    return;
  }
  const animFor = back => `${Math.min(animDuration, PV_WALK_ANIM_S) / (back ? 2 : 1)}s`;
  let k = 0;
  const runNext = () => {
    if (k >= list.length) {
      pvWalkStop();
      return;
    }
    const s = list[k++];
    if (typeof svg !== "undefined" && svg) svg.style.setProperty("--anim-duration", animFor(s.back));
    s.fn();
    if (k >= list.length) {
      // 마지막 수의 애니메이션이 끝난 뒤 설정값으로 되돌린다
      pvWalkTimer = setTimeout(pvWalkStop, s.back ? PV_WALK_STEP_MS / 2 : PV_WALK_STEP_MS);
      return;
    }
    pvWalkTimer = setTimeout(runNext, s.back ? PV_WALK_STEP_MS / 2 : PV_WALK_STEP_MS);
  };
  pvWalkTimer = -1; // 밟고 가는 중 표시 (첫 수는 바로)
  runNext();
}

/** 실제 기보의 step수로 한 번에 바꿉니다 (#turn change 처리기가 판·버튼·말풍선을 갱신, 애니메이션 없음). */
function pvRealJump(step) {
  const turnEl = pvEl("turn");
  if (!turnEl) return;
  turnEl.value = Math.max(0, Math.min(step, log.length));
  turnEl.dispatchEvent(new Event("change"));
  const last = log[parseInt(turnEl.value, 10) - 1];
  if (last) moveSelectBox(last.i);
  pvRefresh();
}

/** 실제 기보의 step수로 이동합니다. 한 수씩 앞뒤로 밟고 가며 애니메이션으로 보여 준다. */
function pvRealGoTo(step) {
  pvWalkStop();
  if (previewActive) exitPreviewMode();
  const target = Math.max(0, Math.min(step, log.length));
  const cur = pvRealStep();
  if (target === cur) {
    pvRealJump(target);
    return;
  }
  const dir = target > cur ? 1 : -1;
  // 여러 수 뒤로는 기본이 한 번에 가기 (한 수만 뒤로면 그 수를 되돌리는 애니메이션)
  if (dir < 0 && cur - target > 1 && pvWalkBackMode !== "rewind") {
    pvRealJump(target);
    return;
  }
  const steps = [];
  for (let s = cur; s !== target; s += dir) {
    // next/performSinglePrev는 preview.js가 감싸 변화도도 갱신한다. AI 자동 응수는 부르지 않는다
    steps.push(dir > 0 ? { fn: () => next() } : { fn: () => performSinglePrev(), back: true });
  }
  pvWalkRun(steps);
}

/** 가지 줄(varId, 깊은 것부터 조상까지)을 배열로 */
function pvLineChain(varId) {
  const chain = [];
  for (let v = varId ? getVariation(varId) : null; v; v = v.parentVarId ? getVariation(v.parentVarId) : null) chain.push(v);
  return chain;
}

/** 줄(chain) 위에서 step수를 맡는 가지 id (null = 본선) */
function pvOwnerOnLine(chain, step) {
  for (const v of chain) {
    if (step > v.parentStep) return v.id;
  }
  return null;
}

/**
 * 두어보기 커서를 (varId, step)으로 한 수씩 밟고 갑니다.
 * 다른 가지로 갈 때는 갈라진 점까지 한 수씩 되돌아간 뒤, 목표 줄을 따라 한 수씩 나아간다.
 */
function pvWalkPreviewTo(varId, step) {
  pvWalkStop();
  if (!previewActive && !enterPreviewMode("goto")) return;
  const target = pvNormalize(varId, step);
  const chain = pvLineChain(target.varId);
  const onTargetLine = pos => pvOwnerOnLine(chain, pos.step) === (pos.varId || null);
  const path = []; // [{varId, step, back}]
  let pos = { varId: previewCursor.varId, step: previewCursor.step };
  // 1) 목표 줄에 닿을 때까지 한 수씩 되돌아가기
  let guard = 0;
  while (!onTargetLine(pos) && pos.step > 0 && guard++ < 2000) {
    pos = pvNormalize(pos.varId, pos.step - 1);
    path.push({ ...pos, back: true });
  }
  // 2) 목표 줄을 따라 앞뒤로
  const dir = target.step >= pos.step ? 1 : -1;
  for (let s = pos.step + dir; dir > 0 ? s <= target.step : s >= target.step; s += dir) {
    path.push({ varId: pvOwnerOnLine(chain, s), step: s, back: dir < 0 });
  }
  if (!path.length) {
    previewGoTo(target.varId, target.step);
    return;
  }
  // 여러 수 뒤로 가는 앞부분은 기본이 한 번에 가기: 되돌아갈 마지막 국면으로 바로 간 뒤, 앞으로 가는 수만 한 수씩
  let lead = 0;
  while (lead < path.length && path[lead].back) lead += 1;
  if (lead > 1 && pvWalkBackMode !== "rewind") {
    const to = path[lead - 1];
    const rest = path.slice(lead);
    if (!rest.length) {
      previewGoTo(to.varId, to.step, false);
      return;
    }
    pvWalkRun([{ fn: () => previewGoTo(to.varId, to.step, false), back: true },
      ...rest.map(p => ({ fn: () => previewGoTo(p.varId, p.step, true), back: p.back }))]);
    return;
  }
  pvWalkRun(path.map(p => ({ fn: () => previewGoTo(p.varId, p.step, true), back: p.back })));
}

// ===== 두어보기 국면 이동 =====

/** 가지의 갈라진 점 이하로 가면 부모 줄로 올라갑니다. 범위를 벗어나면 끝으로 붙입니다. */
function pvNormalize(varId, step) {
  let id = varId;
  let s = Math.max(0, step);
  while (id) {
    const v = getVariation(id);
    if (!v) {
      id = null;
      break;
    }
    if (s <= v.parentStep) {
      id = v.parentVarId;
      continue;
    }
    s = Math.min(s, variationEndStep(v));
    break;
  }
  if (!id) s = Math.min(s, log.length);
  return { varId: id, step: s };
}

/**
 * 가지(varId, null=본선)의 step수 국면으로 두어보기 커서를 옮깁니다. 두어보기가 아니면 시작합니다.
 * @param {string|null} varId
 * @param {number} step
 * @param {boolean} [animate=true]
 */
function previewGoTo(varId, step, animate) {
  if (!previewActive && !enterPreviewMode("goto")) return;
  previewCursor = pvNormalize(varId, step);
  if (previewCursor.varId) previewTouched.add(previewCursor.varId);
  previewRender(animate !== false);
}

/** 패널 ◀ ▶: 두어보기 중이면 현재 줄을 따라, 아니면 실제 기보를 한 수씩 */
function previewStep(delta) {
  pvWalkStop();
  const d = Number(delta) || 0;
  if (previewActive) {
    // 갈라진 점보다 앞으로 가면 pvNormalize가 부모 줄로 올린다
    previewGoTo(previewCursor.varId, previewCursor.step + d);
    return;
  }
  pvRealGoTo(pvRealStep() + d);
}

/** 처음: 두어보기 중이면 본선에서 갈라진 점, 아니면 실제 기보 0수 */
function previewFirst() {
  if (!previewActive) {
    pvRealGoTo(0);
    return;
  }
  const c = previewCursor;
  if (!c.varId) {
    pvWalkPreviewTo(null, 0);
    return;
  }
  pvWalkPreviewTo(null, variationRoot(getVariation(c.varId)).parentStep);
}

/** 마지막: 두어보기 중이면 현재 가지의 끝, 아니면 실제 기보의 마지막 수 */
function previewLast() {
  if (!previewActive) {
    pvRealGoTo(log.length);
    return;
  }
  const c = previewCursor;
  if (!c.varId) {
    pvWalkPreviewTo(null, log.length);
    return;
  }
  pvWalkPreviewTo(c.varId, variationEndStep(getVariation(c.varId)));
}

/** 변화도 점·수순 글자를 눌렀을 때: 본선이면 실제 착수로, 가지면 두어보기로 */
function pvSelectFromTree(varId, step) {
  // 여러 수 떨어진 곳도 한 수씩 밟고 간다
  if (varId) pvWalkPreviewTo(varId, step);
  else pvRealGoTo(step);
}

// ===== 수 쌓기 =====

/**
 * 두어보기 국면에서 수를 둡니다. 가지 끝이면 이어 붙이고, 중간이면 새 가지를 냅니다.
 * 이미 같은 수가 있는 줄(본선·가지)이 있으면 새로 만들지 않고 그 줄로 따라갑니다.
 * @param {number} i @param {number} x @param {number} y
 * @param {string} [source="user"]
 */
let pvLastPlayed = null; // 마지막으로 둔 수가 만든 국면 {varId, step} (가지를 계속 두는 중인지 가리는 데 쓴다)

function previewPlayMove(i, x, y, source) {
  if (!previewActive) return;
  pvWalkStop();
  const m = { i, x, y };
  const c = previewCursor;
  const src = source || "user";
  clearCandiBox();
  curSelect = NO_PIECE;

  let target = null;
  if (c.varId) {
    const v = getVariation(c.varId);
    const k = c.step - v.parentStep;
    if (k === v.moves.length) {
      // 가지 끝에 나중에 돌아와 이어 두면(방금 이 가지를 두던 중이 아니면) 새 if story의 시작으로 기록한다.
      // 새 가지를 만들지 않고 같은 가지(같은 색·같은 줄)로 이어 가며, 변화도는 이 수를 노란색으로 표시한다
      const continuing = pvLastPlayed && pvLastPlayed.varId === v.id && pvLastPlayed.step === c.step;
      if (!continuing && v.moves.length) {
        v.joins = Array.isArray(v.joins) ? v.joins : [];
        if (!v.joins.includes(v.moves.length)) v.joins.push(v.moves.length);
      }
      appendVariationMove(v.id, m);
      target = v.id;
    } else if (sameMove(v.moves[k], m)) {
      target = v.id;
    }
  } else if (sameMove(log[c.step], m)) {
    previewGoTo(null, c.step + 1);
    return;
  }

  if (target === null) {
    const twin = getChildVariations(c.varId, c.step).find(v => sameMove(v.moves[0], m));
    target = twin ? twin.id : createVariation(c.step, [m], src, undefined, c.varId).id;
  }
  pvLastPlayed = { varId: target, step: c.step + 1 };
  previewGoTo(target, c.step + 1);
}

/** 지금 국면에서 엔진(getBestAIMove)이 한 수 둡니다. 항상 가지로 기록합니다. */
function previewAIMove() {
  if (!previewActive && !enterPreviewMode("ai")) return;
  if (previewBusy) return;
  const team = cfSideToMove(previewCursor.step);
  previewBusy = true;
  pvSetStatus("AI가 수를 고르는 중…");
  setTimeout(async () => {
    try {
      const at = JSON.stringify(previewCursor);
      // Fairy-Stockfish를 쓸 수 있으면 그것을, 아니면 내장 엔진 (engine-fsf.js)
      const best = (typeof requestAIMove === "function") ? await requestAIMove(team) : getBestAIMove(team);
      if (!previewActive || JSON.stringify(previewCursor) !== at) return; // 그사이 다른 국면으로 감
      if (!best) {
        showToast("둘 수 있는 수가 없습니다.");
        return;
      }
      previewPlayMove(best.i, best.x, best.y, "ai");
    } catch (err) {
      console.error("[preview] AI 착수 실패:", err);
      showToast("AI 착수에 실패했습니다.");
    } finally {
      previewBusy = false;
      pvUpdatePanel();
    }
  }, 30);
}

/** 지금 보고 있는 가지(와 그 속 가지)를 지웁니다. */
function deleteCurrentVariation() {
  if (!previewActive || !previewCursor.varId) return;
  deleteVariationById(previewCursor.varId);
}

/** varId 가지가 rootId 가지이거나 그 속 가지이면 true */
function pvVarIsWithin(varId, rootId) {
  let v = varId ? getVariation(varId) : null;
  while (v) {
    if (v.id === rootId) return true;
    v = v.parentVarId ? getVariation(v.parentVarId) : null;
  }
  return false;
}

/**
 * 가지 하나(와 그 속 가지)를 물어보고 지웁니다. 변화도에서 가지를 우클릭할 때도 부른다 (variation-tree.js onDelete).
 * 보고 있던 자리가 지운 가지 안이면 갈라진 자리로 돌아간다.
 * @param {string} id - 가지 id
 */
function deleteVariationById(id) {
  const v = getVariation(id);
  if (!v) return;
  const no = String(v.id).replace(/^v/, "");
  if (!confirm(`가지 ${no}번 "${v.label}"을(를) 지울까요? 이 가지에서 갈라진 가지도 함께 지워집니다.`)) return;
  const inside = previewActive && pvVarIsWithin(previewCursor.varId, v.id);
  const back = { varId: v.parentVarId, step: v.parentStep };
  removeVariation(v.id);
  previewTouched.forEach(t => {
    if (!getVariation(t)) previewTouched.delete(t);
  });
  if (inside) previewGoTo(back.varId, back.step, false);
  else pvRefresh();
}

// ===== 재생 =====

function pvStopPlayback() {
  if (previewPlayTimer) {
    clearInterval(previewPlayTimer);
    previewPlayTimer = null;
    pvRefresh(); // 변화도의 재생 강조를 지운다
  }
}

/** 가지를 한 수씩 재생하는 중인지 (variation-tree.js가 지나가는 수순을 강조) */
function isVariationPlaying() {
  return !!previewPlayTimer;
}

/**
 * 가지를 갈라진 국면(또는 opts.fromStep)부터 끝까지 한 수씩 재생합니다.
 * @param {string} id
 * @param {{intervalMs?: number, fromStep?: number}} [opts] - fromStep: 이 수순 국면부터 재생 (가지 끝에 이어 붙인 수순만 재생할 때)
 * @returns {Promise<boolean>} 끝까지 재생했으면 true
 */
function playVariation(id, opts) {
  const v = getVariation(id);
  if (!v) return Promise.resolve(false);
  if (!previewActive && !enterPreviewMode("play")) return Promise.resolve(false);
  pvStopPlayback();
  pvWalkStop();
  const interval = (opts && opts.intervalMs) || Math.max(400, animDuration * 1000 + 250);
  const end = variationEndStep(v);
  const from = opts && Number.isInteger(opts.fromStep) ? Math.min(Math.max(opts.fromStep, v.parentStep), end) : v.parentStep;
  previewGoTo(v.id, from, false);
  let step = from;
  return new Promise(resolve => {
    previewPlayTimer = setInterval(() => {
      if (!previewActive || !getVariation(id)) {
        pvStopPlayback();
        resolve(false);
        return;
      }
      step += 1;
      previewGoTo(id, step, true);
      if (step >= end) {
        pvStopPlayback();
        resolve(true);
      }
    }, interval);
  });
}

// ===== 그리기 =====

/** 두어보기 커서 국면을 판·턴 표시·변화도·패널에 반영합니다. */
function previewRender(animate) {
  if (!previewActive) return;
  const c = previewCursor;
  const target = variationPositionAt(c.varId, c.step);
  for (let i = 0; i < 32; i++) {
    const t = target[i];
    const captured = t.x === 0 && t.y === 0;
    if (pieces[i].x !== t.x || pieces[i].y !== t.y || !animate) {
      setPieces(i, t.x, t.y, !!animate && !captured);
    }
  }
  clearCandiBox();
  curSelect = NO_PIECE;
  gameEnded = false;

  const turnEl = pvEl("turn");
  if (turnEl) turnEl.value = c.step;

  const line = variationLineMoves(c.varId, c.step);
  const last = line[line.length - 1];
  if (last) moveSelectBox(last.i);
  else pvHideSelectBox();

  updateScore();
  const bubble = pvEl("comment-bubble");
  if (bubble && c.varId) bubble.style.display = "none";
  pvRefresh();
}

/** 변화도와 패널 글자를 지금 상태로 다시 그립니다. */
function pvRefresh() {
  if (!recordViewOpen) return;
  const cursor = previewActive ? previewCursor : { varId: null, step: pvRealStep() };
  renderVariationTree(pvEl("variation-tree"), {
    cursor,
    entryStep: previewActive ? previewEntryStep() : -1,
    onSelect: pvSelectFromTree,
    onDelete: deleteVariationById
  });
  pvUpdatePanel();
  if (typeof scheduleRecommendations === "function") scheduleRecommendations(); // 추천수 (recommend.js)
}

function pvSetStatus(text) {
  const el = pvEl("preview-status");
  if (el) el.textContent = text || "";
}

function pvUpdatePanel() {
  const c = previewActive ? previewCursor : { varId: null, step: pvRealStep() };
  const v = c.varId ? getVariation(c.varId) : null;
  let where;
  if (v) where = `${v.label} · ${c.step}수 (본선 ${variationRoot(v).parentStep}수에서 갈라짐)`;
  else if (previewActive) where = `본선 ${c.step}수 (놓아보기)`;
  else where = `본선 ${c.step}수 / 전체 ${log.length}수`;
  const label = pvEl("preview-position-label");
  if (label) label.textContent = where;

  const team = cfSideToMove(c.step);
  const noMoves = getFilteredLegalMoves(team).length === 0;
  // 차례·수순 글자는 헤더(진영 이름 바탕색·N수)가 보여 주므로, 둘 수가 없을 때만 알린다
  let status = "";
  if (noMoves) status = isKingInCheck(team) ? `외통: ${cfTeamName(team)}이 둘 수가 없습니다` : `${cfTeamName(team)}이 둘 수 있는 수가 없습니다`;
  if (!previewBusy) pvSetStatus(status);

  const show = (id, on) => {
    const el = pvEl(id);
    if (el) el.hidden = !on;
  };
  pvSyncExploreButton();
  show("preview-mode-chip", previewActive);
  show("preview-exit-btn", previewActive);
  show("preview-delete-btn", previewActive && !!c.varId);
  const count = pvEl("preview-var-count");
  if (count) count.textContent = getVariations().length ? `가지 ${getVariations().length}개` : "";
}

// ===== 기존 전역 함수 감싸기 =====

function pvWrap(name, makeWrapper) {
  const orig = window[name];
  if (typeof orig !== "function") {
    console.warn(`[preview] 감쌀 함수가 없습니다: ${name}`);
    return;
  }
  window[name] = makeWrapper(orig);
}

let pvTakebackNow = false; // 무르기로 실제 대국에 두는 중 (move 감싸기를 그대로 통과)

/**
 * 지난 국면에서 다른 수를 두려 할 때 묻는다: 무르기 / 놓아보기로 두기 / 취소
 * @param {number} step - 지금 보고 있는 본선 수순
 * @param {{i:number,x:number,y:number}} m
 * @param {Function} [onBranch] - "놓아보기로 두기"를 골랐을 때 (없으면 m 한 수를 새 가지로). 추천수는 예상 수순 전체를 가지로
 */
function pvAskPastMove(step, m, onBranch) {
  const ask = typeof showAppDialog === "function"
    ? showAppDialog({
      title: "무르시겠습니까?",
      message: `${step}수 국면에서 다른 수를 둡니다. 무르면 이 수가 본선이 되고, 원래 ${step + 1}수부터의 수순(${log.length - step}수)은 가지로 남습니다.`,
      tone: "warn",
      cancelValue: "cancel",
      buttons: [
        { label: "취소", value: "cancel" },
        { label: "놓아보기로 두기", value: "branch", title: "본선은 그대로 두고 새 가지로 둡니다" },
        { label: "무르기", value: "takeback", primary: true }
      ]
    })
    : Promise.resolve(window.confirm("무르시겠습니까?") ? "takeback" : "branch");
  ask.then(choice => {
    // 그사이 국면이 바뀌었으면 두지 않는다
    if (previewActive || pvRealStep() !== step || log.length <= step) return;
    if (choice === "takeback") pvTakeback(step, m);
    else if (choice === "branch") {
      if (onBranch) onBranch();
      else if (enterPreviewMode("branch")) previewPlayMove(m.i, m.x, m.y, "user");
    }
  });
}

/**
 * 무르기: step수 국면에서 m을 실제 대국에 둔다. 원래 본선 뒷부분은 "원래 수순" 가지가 되고,
 * 그 뒷부분에서 갈라졌던 가지들은 그 가지 아래로 옮긴다. m과 같은 수로 시작하던 가지는 새 본선과 겹치는 첫 수를 뗀다.
 */
function pvTakeback(step, m) {
  const tail = log.slice(step).map(t => ({ i: t.i, x: t.x, y: t.y }));
  const list = getVariations();
  const twin = getChildVariations(null, step).find(v => sameMove(v.moves[0], m));
  const old = tail.length ? createVariation(step, tail, "user", "원래 수순", null) : null;
  if (old) {
    list.forEach(v => {
      if (v !== old && !v.parentVarId && v.parentStep > step) v.parentVarId = old.id;
    });
  }
  if (twin) {
    twin.moves.shift();
    twin.parentStep += 1;
    if (!twin.moves.length) {
      list.forEach(v => {
        if (v.parentVarId === twin.id) v.parentVarId = null;
      });
      const k = list.indexOf(twin);
      if (k >= 0) list.splice(k, 1);
    }
  }
  pvTakebackNow = true;
  try {
    move(m.i, m.x, m.y);
  } finally {
    pvTakebackNow = false;
  }
  varLayout();
  saveVariations(); // 본선이 바뀌었으므로 가지 묶음의 본선 서명도 새로
  pvRefresh();
  showToast(old ? `무르기: ${step + 1}수부터 새 본선 · 원래 수순은 가지로 남겼습니다` : "무르기");
}

/** 놓아보기가 꺼진 채 과거 국면을 보는 중인지 (이때 다른 수를 두면 본선을 지우지 않고 놓아보기가 켜진다) */
function pvReviewingPast() {
  return !previewActive && pvRealStep() < log.length;
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    pvWalkBackMode = localStorage.getItem("walkBackMode") === "rewind" ? "rewind" : "jump";
  } catch (e) {
    pvWalkBackMode = "jump";
  }
  const walkSel = pvEl("walk-back-select");
  if (walkSel) walkSel.value = pvWalkBackMode;
  // body에 perspective가 걸려 있어 body 안의 position:fixed는 화면이 아니라 body 기준으로 붙는다.
  // 패널을 <html> 바로 아래로 옮겨 화면 왼쪽(데스크톱)·아래(모바일)에 정확히 붙인다.
  const panel = pvEl("preview-panel");
  if (panel) document.documentElement.appendChild(panel);

  // 판에서 둔 수: 놓아보기 중이면 가지에, 과거 국면에서 다른 수면 무르기 확인
  pvWrap("move", orig => function (i, x, y) {
    if (previewActive) return previewPlayMove(i, x, y, "user");
    if (!pvTakebackNow && pvReviewingPast()) {
      const step = pvRealStep();
      if (sameMove(log[step], { i, x, y })) {
        clearCandiBox();
        curSelect = NO_PIECE;
        return next();
      }
      clearCandiBox();
      curSelect = NO_PIECE;
      pvAskPastMove(step, { i, x, y });
      return;
    }
    const r = orig.apply(this, arguments);
    pvRefresh();
    return r;
  });
  // AI 대국 자동 응수 막기
  pvWrap("checkAndRunAI", orig => function () {
    if (previewActive) return;
    return orig.apply(this, arguments);
  });
  // 두어보기 중이거나 과거 국면에서 갈라 둘 때는 양쪽 기물을 모두 둘 수 있게 (AI 대국 차단 해제)
  pvWrap("selected", orig => function () {
    if (!previewActive && !pvReviewingPast()) return orig.apply(this, arguments);
    const savedMode = aiMode;
    aiMode = 0;
    if (previewActive) gameEnded = false;
    try {
      return orig.apply(this, arguments);
    } finally {
      aiMode = savedMode;
    }
  });
  // 수순 이동 단축키 → 두어보기 중이면 가지 줄 이동, 아니면 실제 이동 후 변화도 갱신
  const navWrap = (name, inPreview) => pvWrap(name, orig => function () {
    if (previewActive) return inPreview();
    const r = orig.apply(this, arguments);
    pvRefresh();
    return r;
  });
  navWrap("next", () => previewStep(1));
  navWrap("prev", () => previewStep(-1));
  navWrap("performSinglePrev", () => previewStep(-1));
  navWrap("goToStart", () => previewFirst());
  navWrap("goToEnd", () => previewLast());
  pvWrap("startAutoplay", orig => function () {
    if (previewActive) {
      showToast("놓아보기 중에는 자동 재생을 쓸 수 없습니다.");
      return;
    }
    return orig.apply(this, arguments);
  });
  pvWrap("toggleNation", orig => function () {
    if (previewActive) {
      showToast("놓아보기 중에는 진영을 바꿀 수 없습니다. 놓아보기를 꺼 주세요.");
      return;
    }
    return orig.apply(this, arguments);
  });
  // 화면 크기 변경 등으로 본선 좌표가 다시 그려지면 두어보기 국면을 다시 얹기
  pvWrap("initPositions", orig => function () {
    const r = orig.apply(this, arguments);
    if (previewActive) previewRender(false);
    return r;
  });
  // 해설(commentary-facts)은 본선 기준이므로, 두어보기 중에는 들어온 국면의 수순을 쓴다
  // (#turn에는 가지 수순이 들어 있어 본선 수순과 다를 수 있다)
  pvWrap("cfCurrentStep", orig => function () {
    if (previewActive) return previewEntryStep();
    return orig.apply(this, arguments);
  });
  pvWrap("updateCommentBubble", orig => function () {
    if (previewActive && previewCursor.varId) {
      const bubble = pvEl("comment-bubble");
      if (bubble) bubble.style.display = "none";
      return;
    }
    return orig.apply(this, arguments);
  });
  // 새 대국·기보 불러오기 → 두어보기 끝내고 가지 비우기
  pvWrap("startNewGame", orig => function () {
    if (previewActive) exitPreviewMode();
    // 앞 기보의 가지는 저장해 둔 채로 새 묶음을 시작한다 (variation.js)
    if (typeof variationsStartNewGame === "function") variationsStartNewGame();
    else clearVariations();
    const r = orig.apply(this, arguments);
    pvRefresh();
    return r;
  });
  pvWrap("importRecordFromText", orig => function () {
    if (previewActive) exitPreviewMode();
    const before = JSON.stringify(variationBaseSignature());
    const r = orig.apply(this, arguments);
    // 다른 기보가 되면 그 기보에 저장해 둔 가지를 불러온다 (앞 기보의 가지는 지우지 않는다)
    if (JSON.stringify(variationBaseSignature()) !== before) {
      if (typeof loadVariationsForGame === "function") loadVariationsForGame();
      else clearVariations();
    }
    pvRefresh();
    return r;
  });

  const turnEl = pvEl("turn");
  if (turnEl) turnEl.addEventListener("change", () => pvRefresh());
});
