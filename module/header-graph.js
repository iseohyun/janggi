/**
 * @fileoverview 대국 헤더의 그래프 3줄(시간 / 기물점수 / 형세)과 진영 이름.
 *  - 막대 방향은 화면의 진영 배치를 따른다: 초(파랑)는 왼쪽, 한(빨강)은 오른쪽.
 *  - 시간 줄 눈금: 제한 시간이 없으면 1분 단위로 늘어난다 (hgTimeMax).
 *  - 줄 이름(그래프 가운데 흰 바탕 글자): 시간은 1분을 넘기면 두 사람의 시간 차이(mm:ss), "기물 점수"는 처음 기물이
 *    잡히면 두 진영의 점수 차이로 바뀐다. "형세"는 처음과 1분마다 5초 동안 3번 깜빡인다 (설정 > 인터페이스에서 항상 보이기·끄기).
 *  - 지금 둘 차례인 진영의 이름에 연한 진영색 바탕을 깐다.
 *  - 진영 이름: 가로로 쓰고, 대국자 이름에 단수(예: 3단)가 있으면 그 아래 줄에 쓴다. AI가 두는 진영이면 "AI"를 표시한다.
 *    이름을 우클릭하면 그 진영을 "사용자"·"AI" 중에서 고르는 메뉴가 뜬다 (openSideMenu / setSideController).
 *  - 시간·기물점수 줄: 가운데에서 초는 왼쪽, 한은 오른쪽으로 자란다. 노란 차이 막대는 가운데에서
 *    더 큰 쪽으로 두 값의 차이만큼 그리고, 초·한 막대 위에 겹친다.
 *  - 형세 줄: 줄다리기. 초는 왼쪽 끝, 한은 오른쪽 끝에서 시작해 둘이 줄을 채우고 경계가 움직인다.
 *    값은 Fairy-Stockfish 어림 승률(engine-fsf.js fsfWinRate). 엔진을 못 쓰면 내장 평가(evaluateBoard)를 환산.
 * 공개 함수: hgUpdateTime(), hgUpdateMaterial(cho, han), hgUpdateNames(), hgOnEngineResult(key, res),
 *           setTimeLimitMinutes(value), hgRefreshEval()
 * @module header-graph
 * @depends state, rules, ai, (engine-fsf, recommend, preview: 있으면 씀)
 */

const HG_MIN_TIME_MAX = 180; // 제한 시간을 정하지 않았을 때 시간 줄 최대값의 최솟값 (3분)
const HG_BUILTIN_SCALE = 8; // 내장 평가 점수 → 승률: 1 / (1 + e^(-점수/8)). 졸 하나(2점) ≈ 승률 56%
const HG_ENGINE_MOVETIME = 500; // 헤더 형세용 엔진 분석 시간 (ms)
const HG_ENGINE_WAIT_MS = 8000; // 추천수 결과를 기다리다 내장 평가로 넘어가는 시간
const HG_POLL_MS = 250; // 국면 바뀜 감시 주기
const HG_EVAL_LABEL_EVERY_MS = 60000; // "형세" 글자를 다시 깜빡이는 간격
const HG_EVAL_LABEL_BLINK_MS = 5000; // 한 번에 깜빡이는 시간 (그동안 3번, css/header-graph.css hg-blink)

var evalLabelMode = "blink"; // "blink" | "always" | "off" (설정 > 인터페이스 > 형세 글자)

var timeLimitMinutes = 0; // 한 사람의 제한 시간(분). 0이면 정하지 않음

let hgLastKey = null; // 마지막으로 그린 국면 열쇠
let hgEvalSeq = 0; // 늦게 온 분석 결과를 버리기 위한 번호
let hgEvalTimer = null;
let hgEvalWaitTimer = null;
let hgRescaleTimer = null;
let hgEvalLabelTimer = null;

function hgEl(id) {
  return document.getElementById(id);
}

/** 시작할 때의 최대 기물점수 (한은 덤 포함). 초·한 막대를 같은 눈금으로 그린다. */
function hgMaterialMax() {
  const base = MATERIAL_SCORES.reduce((a, b) => a + b, 0);
  return base + HAN_HANDICAP;
}

function hgFmtTime(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function hgClamp01(v) {
  if (!isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * 가운데에서 자라는 줄(시간·기물점수)을 그립니다. 값은 모두 0~1 (절반 폭 기준).
 * @param {string} key - "time" | "mat"
 * @param {number} cho
 * @param {number} han
 */
function hgDrawCenterRow(key, cho, han) {
  const c = hgClamp01(cho);
  const h = hgClamp01(han);
  const choBar = hgEl(`hg-${key}-cho`);
  const hanBar = hgEl(`hg-${key}-han`);
  const diffBar = hgEl(`hg-${key}-diff`);
  if (choBar) choBar.style.width = `${c * 50}%`;
  if (hanBar) hanBar.style.width = `${h * 50}%`;
  if (diffBar) {
    const d = Math.abs(c - h);
    diffBar.style.width = `${d * 50}%`;
    diffBar.classList.toggle("to-cho", c > h);
    diffBar.classList.toggle("to-han", h > c);
  }
}

/** 줄 가운데 글자 (줄 이름 또는 차이) */
function hgSetKind(key, text, lead) {
  const el = document.querySelector(`#hg-${key}-row .hg-kind`);
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle("lead-cho", lead === "cho");
  el.classList.toggle("lead-han", lead === "han");
}

/** 두 값의 차이 글자: "초 +1:05" / "같음" */
function hgDiffText(cho, han, fmt) {
  if (Math.abs(cho - han) < 0.05) return { text: "같음", lead: null };
  const lead = cho > han ? "cho" : "han";
  return { text: `${lead === "cho" ? "초" : "한"} +${fmt(Math.abs(cho - han))}`, lead };
}

function hgSetNums(key, choText, hanText, rowTitle) {
  const choNum = hgEl(`hg-${key}-cho-num`);
  const hanNum = hgEl(`hg-${key}-han-num`);
  if (choNum) choNum.textContent = choText;
  if (hanNum) hanNum.textContent = hanText;
  const row = hgEl(`hg-${key}-row`);
  if (row && rowTitle) {
    row.title = rowTitle;
    row.setAttribute("aria-label", rowTitle);
  }
}

// ===== 시간 줄 =====

/**
 * 시간 줄 최대값(초). 제한 시간이 있으면 제한 시간. 없으면 더 많이 쓴 사람의 시간을 1분 단위로 올림한 값(최소 3분):
 * 3분을 넘기는 순간 4분, 4분을 넘기면 5분… 으로 1분씩 늘어나고, 막대는 새 눈금에 맞춰 애니메이션으로 줄어든다.
 */
function hgTimeMax() {
  const limit = (timeLimitMinutes || 0) * 60;
  if (limit > 0) return limit;
  const used = Math.max(choTimeSpent, hanTimeSpent);
  return Math.max(HG_MIN_TIME_MAX, Math.ceil(used / 60) * 60);
}

/** 제한 시간이 있으면 제한 시간 대비, 없으면 1분 단위 눈금(최소 3분) 대비로 그립니다. */
function hgUpdateTime() {
  const limit = (timeLimitMinutes || 0) * 60;
  const max = hgTimeMax();
  const row = hgEl("hg-time-row");
  if (row) {
    // 눈금이 바뀌는 순간에는 막대가 천천히 새 눈금으로 줄어들게 한다 (css/header-graph.css .rescale)
    if (row.dataset.max && row.dataset.max !== String(max)) {
      row.classList.add("rescale");
      clearTimeout(hgRescaleTimer);
      hgRescaleTimer = setTimeout(() => row.classList.remove("rescale"), 900);
    }
    row.dataset.max = String(max);
  }
  hgDrawCenterRow("time", choTimeSpent / max, hanTimeSpent / max);
  const basis = limit > 0 ? `제한 시간 ${hgFmtTime(limit)}` : `눈금 ${hgFmtTime(max)} (1분 단위, 최소 3분)`;
  hgSetNums("time", hgFmtTime(choTimeSpent), hgFmtTime(hanTimeSpent),
    `시간 — 초 ${hgFmtTime(choTimeSpent)} · 한 ${hgFmtTime(hanTimeSpent)} · ${basis}`);
  if (row) row.classList.toggle("over", limit > 0 && (choTimeSpent >= limit || hanTimeSpent >= limit));
  // 1분을 넘기면 "시간" 대신 두 사람의 시간 차이 (어느 쪽인지는 막대가 보여 주므로 mm:ss만)
  if (Math.max(choTimeSpent, hanTimeSpent) >= 60) {
    const diff = Math.abs(choTimeSpent - hanTimeSpent);
    const mm = String(Math.floor(diff / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    hgSetKind("time", `${mm}:${ss}`, null);
  } else {
    hgSetKind("time", "시간", null);
  }
}

/** 설정 > 새 대국 > 제한 시간 */
function setTimeLimitMinutes(value) {
  const n = parseInt(value, 10);
  timeLimitMinutes = isFinite(n) && n > 0 ? n : 0;
  try {
    localStorage.setItem("timeLimitMinutes", String(timeLimitMinutes));
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  const sel = hgEl("time-limit-select");
  if (sel && sel.value !== String(timeLimitMinutes)) sel.value = String(timeLimitMinutes);
  hgUpdateTime();
}

// ===== 기물점수 줄 =====

/**
 * 시작할 때의 최대 기물점수 대비 현재 기물점수를 그립니다 (board.js updateScore가 부름).
 * @param {number} scoreCho
 * @param {number} scoreHan - 덤 포함
 */
function hgUpdateMaterial(scoreCho, scoreHan) {
  const max = hgMaterialMax();
  hgDrawCenterRow("mat", scoreCho / max, scoreHan / max);
  const diff = Math.abs(scoreCho - scoreHan);
  const lead = diff < 0.05 ? "같음" : `${scoreCho > scoreHan ? "초" : "한"} +${diff.toFixed(1)}`;
  hgSetNums("mat", scoreCho.toFixed(1), scoreHan.toFixed(1),
    `기물점수 — 초 ${scoreCho.toFixed(1)} · 한 ${scoreHan.toFixed(1)} (덤 ${HAN_HANDICAP} 포함) · 차이 ${lead} · 최대 ${max.toFixed(1)}`);
  // 어느 쪽이든 기물이 하나라도 잡혔으면 "기물 점수" 대신 두 진영의 점수 차이 (덤 포함)
  if (hgAnyCaptured()) {
    const d = hgDiffText(scoreCho, scoreHan, v => v.toFixed(1));
    hgSetKind("mat", d.text, d.lead);
  } else {
    hgSetKind("mat", "기물 점수", null);
  }
}

/** 지금 국면에서 잡힌 기물이 있는지 (잡힌 기물은 좌표가 0,0) */
function hgAnyCaptured() {
  if (typeof pieces === "undefined" || !pieces) return false;
  return pieces.some(p => p && p.x === 0 && p.y === 0);
}

// ===== "형세" 글자: 5초 동안 3번 깜빡이기 =====

function hgEvalLabelEl() {
  return document.querySelector("#hg-eval-row .hg-kind");
}

/** 5초 동안 3번 나타났다 사라진다 (깜빡임 모드일 때만) */
function hgBlinkEvalLabel() {
  const el = hgEvalLabelEl();
  if (!el || evalLabelMode !== "blink") return;
  el.classList.remove("blink");
  void el.offsetWidth; // 애니메이션을 처음부터 다시
  el.classList.add("blink");
  clearTimeout(hgEvalLabelTimer);
  hgEvalLabelTimer = setTimeout(() => el.classList.remove("blink"), HG_EVAL_LABEL_BLINK_MS + 100);
}

/** 형세 글자 모드를 화면에 반영 */
function hgApplyEvalLabelMode() {
  const el = hgEvalLabelEl();
  if (!el) return;
  el.classList.toggle("faded", evalLabelMode !== "always");
  if (evalLabelMode !== "blink") el.classList.remove("blink");
  const sel = hgEl("eval-label-select");
  if (sel && sel.value !== evalLabelMode) sel.value = evalLabelMode;
}

/** 설정 > 인터페이스 > 형세 글자: "blink"(깜빡임) | "always"(항상 보이기) | "off"(끄기) */
function setEvalLabelMode(value) {
  evalLabelMode = ["blink", "always", "off"].includes(value) ? value : "blink";
  try {
    localStorage.setItem("evalLabelMode", evalLabelMode);
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  hgApplyEvalLabelMode();
  hgBlinkEvalLabel();
}

function hgStartEvalLabelCycle() {
  try {
    const saved = localStorage.getItem("evalLabelMode");
    if (["blink", "always", "off"].includes(saved)) evalLabelMode = saved;
  } catch (e) {
    evalLabelMode = "blink";
  }
  hgApplyEvalLabelMode();
  hgBlinkEvalLabel();
  setInterval(hgBlinkEvalLabel, HG_EVAL_LABEL_EVERY_MS);
}

/** 지금 둘 차례인 진영 이름에 연한 진영색 바탕 */
function hgMarkSideToMove(team) {
  const cho = hgEl("hdr-cho-name");
  const han = hgEl("hdr-han-name");
  if (cho) cho.classList.toggle("to-move", team === "cho");
  if (han) han.classList.toggle("to-move", team === "han");
}

function hgUpdateMaterialFromBoard() {
  if (typeof calculateTeamScores !== "function") return;
  const { scoreCho, scoreHan } = calculateTeamScores();
  hgUpdateMaterial(scoreCho, scoreHan);
}

// ===== 형세 줄 =====

/**
 * 줄다리기 막대를 그립니다.
 * @param {number} choRate - 초의 어림 승률 0~1
 * @param {string} source - 툴팁에 붙일 출처
 */
/**
 * 승률 글 "53%". 외통이 확인되지 않은 국면은 반올림해 100%·0%가 되더라도 ">99%"·"<1%"로 적는다
 * (형세 점수가 아주 커도 외통 수순을 찾은 것은 아니므로).
 * @param {number} rate - 0~1
 * @param {boolean} [mate] - 외통이 확인된 국면
 */
function hgPctText(rate, mate) {
  const n = Math.round(hgClamp01(rate) * 100);
  if (!mate && n >= 100) return ">99%";
  if (!mate && n <= 0) return "<1%";
  return `${n}%`;
}

function hgSetEval(choRate, source, mate) {
  const c = hgClamp01(choRate);
  const choBar = hgEl("hg-eval-cho");
  const hanBar = hgEl("hg-eval-han");
  if (choBar) choBar.style.width = `${c * 100}%`;
  if (hanBar) hanBar.style.width = `${(1 - c) * 100}%`;
  const choT = hgPctText(c, mate);
  const hanT = hgPctText(1 - c, mate);
  hgSetNums("eval", choT, hanT, `형세 (어림 승률) — 초 ${choT} · 한 ${hanT} · ${source}`);
  const row = hgEl("hg-eval-row");
  if (row) row.classList.remove("pending");
}

/** 내장 평가(evaluateBoard, 초 기준 점수)를 승률로 바꿉니다. */
function hgBuiltinRate() {
  if (typeof evaluateBoard !== "function") return 0.5;
  const score = evaluateBoard();
  return 1 / (1 + Math.exp(-score / HG_BUILTIN_SCALE));
}

function hgSetBuiltinEval() {
  hgSetEval(hgBuiltinRate(), "내장 평가 환산 (엔진을 쓰지 않음)");
}

/** 엔진 분석 결과 1위 수 → 형세 */
function hgSetEngineEval(res, team) {
  if (!res.length) {
    // 둘 수가 없으면 차례인 쪽이 진다
    hgSetEval(team === "cho" ? 0 : 1, "둘 수 없음", true);
    return;
  }
  const top = res[0];
  const src = top.mate !== null && top.mate !== undefined
    ? `Fairy-Stockfish: ${top.mate > 0 ? "초" : "한"} ${Math.abs(top.mate)}수 외통`
    : `Fairy-Stockfish 깊이 ${top.depth}`;
  hgSetEval(top.winRate, src, top.mate !== null && top.mate !== undefined);
}

/** 지금 보고 있는 국면 (두어보기 중이면 가지 국면)의 열쇠와 차례 */
function hgContext() {
  if (typeof recContext === "function") return recContext();
  const turnEl = hgEl("turn");
  const step = turnEl ? parseInt(turnEl.value, 10) || 0 : 0;
  const team = step % 2 === 0 ? "cho" : "han";
  return { step, team, key: `${team}|${JSON.stringify(pieces.map(p => [p.x, p.y]))}` };
}

function hgEngineUsable() {
  if (typeof aiEnginePref !== "function" || aiEnginePref() !== "fsf") return false;
  if (typeof fsfAnalyze !== "function") return false;
  return !(typeof fsfStatus === "function" && fsfStatus().state === "unavailable");
}

/** 추천수(recommend.js)가 같은 국면을 분석 중이라 그 결과를 받아 쓸 수 있는지 */
function hgRecommendCovers() {
  return typeof recommendAuto !== "undefined" && recommendAuto;
}

/** 국면이 바뀌면 형세를 다시 구합니다. */
function hgScheduleEval(ctx) {
  const seq = ++hgEvalSeq;
  clearTimeout(hgEvalTimer);
  clearTimeout(hgEvalWaitTimer);
  if (!hgEngineUsable()) {
    hgSetBuiltinEval();
    return;
  }
  // 전에 분석해 둔 국면이면 다시 계산하지 않고 저장된 값을 쓴다 (eval-history.js). 추천수가 더 깊이 보면 그때 고친다
  const cached = typeof ehCachedEval === "function" ? ehCachedEval(ctx.key) : null;
  if (cached) {
    const prec = typeof ehPrecisionText === "function" ? ehPrecisionText(cached) : `깊이 ${cached.depth}`;
    const src = cached.mateWinner ? `저장된 분석: ${cached.mateWinner === "cho" ? "초" : "한"} 외통 승 (${prec})` : `저장된 분석 · ${prec}`;
    hgSetEval(cached.rate, src, !!cached.mateWinner);
    return;
  }
  const row = hgEl("hg-eval-row");
  if (row) row.classList.add("pending");
  // 너무 오래 답이 없으면 내장 평가로라도 보여 준다
  hgEvalWaitTimer = setTimeout(() => {
    if (seq === hgEvalSeq) hgSetBuiltinEval();
  }, HG_ENGINE_WAIT_MS);
  if (hgRecommendCovers()) return; // recommend.js가 hgOnEngineResult로 넘겨 준다
  hgEvalTimer = setTimeout(async () => {
    let res = null;
    try {
      res = await fsfAnalyze(ctx.team, { multipv: 1, movetime: HG_ENGINE_MOVETIME });
    } catch (err) {
      console.error("[header-graph] 형세 분석 실패:", err);
    }
    if (seq !== hgEvalSeq || hgContext().key !== ctx.key) return; // 그사이 국면이 바뀜
    clearTimeout(hgEvalWaitTimer);
    if (res === null) hgSetBuiltinEval();
    else {
      if (typeof ehRecordResult === "function") ehRecordResult(ctx.key, res, HG_ENGINE_MOVETIME);
      hgSetEngineEval(res, ctx.team);
    }
  }, 300);
}

/**
 * 추천수 분석 결과를 형세 줄에도 씁니다 (recommend.js recRun이 부름).
 * @param {string} key - recContext().key
 * @param {Array} res - fsfAnalyze 결과
 */
function hgOnEngineResult(key, res, ms) {
  // 국면별 형세 기록 (eval-history.js: 형세 그래프·변화도 색). ms = 분석 시간 (정밀도 기록)
  if (typeof ehRecordResult === "function") ehRecordResult(key, res, ms);
  if (!res || key !== hgLastKey) return;
  clearTimeout(hgEvalWaitTimer);
  clearTimeout(hgEvalTimer);
  hgEvalSeq += 1;
  hgSetEngineEval(res, key.split("|")[0]);
}

/** 엔진 설정이 바뀌었을 때 등 지금 국면의 형세를 다시 구합니다. */
function hgRefreshEval() {
  hgLastKey = null;
  hgPoll();
}

// ===== 진영 이름 =====

/** "김기영 3단" → { name: "김기영", rank: "3단" }. 단수(○단·초단·○급)가 없으면 rank는 "" */
function hgSplitRank(full) {
  const m = /^(.*?)\s*((?:\d+|초|입)단|\d+급)$/.exec(full);
  if (!m || !m[1]) return { name: full, rank: "" };
  return { name: m[1], rank: m[2] };
}

/**
 * 진영 이름: 위 줄 = 대국자 이름(없으면 AI 진영은 "AI", 아니면 초나라·한나라), 아래 줄 = 단수·"AI".
 * 같은 내용이면 DOM을 건드리지 않는다 (국면 감시가 자주 부름).
 */
function hgUpdateNames() {
  const meta = typeof gameMetadata !== "undefined" && gameMetadata ? gameMetadata : {};
  [["cho", meta.choPlayer, "초나라"], ["han", meta.hanPlayer, "한나라"]].forEach(([team, raw, fallback]) => {
    const el = hgEl(`hdr-${team}-name`);
    if (!el) return;
    const ai = typeof isAITeam === "function" && isAITeam(team);
    const full = (raw || "").trim();
    const { name, rank } = hgSplitRank(full);
    const main = name || (ai ? "AI" : fallback);
    const sub = [rank, ai && name ? "AI" : ""].filter(Boolean).join(" · ");
    const sig = `${main}|${sub}|${ai}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const mainEl = el.querySelector(".hdr-name-main");
    const subEl = el.querySelector(".hdr-name-sub");
    if (mainEl) mainEl.textContent = main;
    if (subEl) {
      subEl.textContent = sub;
      subEl.hidden = !sub;
    }
    el.classList.toggle("is-ai", ai);
    const teamName = team === "cho" ? "초" : "한";
    el.title = `${teamName}: ${full || main}${ai ? " (AI)" : ""} — 우클릭: 사용자·AI 고르기`;
  });
}

// ===== 진영 이름 우클릭 메뉴: 사용자 / AI =====

/** 진영 이름 우클릭 (dispatcher.js data-context-action) */
function openSideMenu(el, ev) {
  const menu = hgEl("side-menu");
  if (!menu || !el) return;
  const team = el.dataset.side;
  menu.dataset.side = team;
  const title = hgEl("side-menu-title");
  if (title) title.textContent = `${team === "cho" ? "초" : "한"} 진영은`;
  const ai = typeof isAITeam === "function" && isAITeam(team);
  menu.querySelectorAll(".side-menu-item").forEach(btn => {
    const on = (btn.dataset.value === "ai") === ai;
    btn.classList.toggle("checked", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
  menu.hidden = false;
  // 마우스 위치에 붙이되 화면 밖으로 나가지 않게
  const rect = el.getBoundingClientRect();
  const x = ev && ev.clientX ? ev.clientX : rect.left;
  const y = ev && ev.clientY ? ev.clientY : rect.bottom;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
  const first = menu.querySelector(".side-menu-item.checked") || menu.querySelector(".side-menu-item");
  if (first) first.focus();
}

function closeSideMenu() {
  const menu = hgEl("side-menu");
  if (menu) menu.hidden = true;
}

/**
 * 메뉴에서 고른 대로 그 진영을 사용자 또는 AI로 둔다.
 * AI는 한 진영만 둔다: 다른 쪽을 AI로 고르면 AI가 그쪽으로 옮겨 간다. AI 진영을 사용자로 고르면 2인 대국이 된다.
 * @param {"user"|"ai"} value
 */
function setSideController(value) {
  const menu = hgEl("side-menu");
  const team = menu && menu.dataset.side;
  closeSideMenu();
  if (team !== "cho" && team !== "han") return;
  if (value === "ai") {
    aiSidePref = team;
    aiMode = 1;
  } else if (isAITeam(team)) {
    aiMode = 0;
  }
  try {
    localStorage.setItem("aiMode", aiMode);
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  if (typeof saveCurrentConfigToSlot === "function") saveCurrentConfigToSlot();
  const sel = hgEl("ai-mode-select");
  if (sel) sel.value = String(aiMode);
  hgUpdateNames();
  if (typeof showToast === "function") {
    showToast(`${team === "cho" ? "초" : "한"} 진영: ${value === "ai" ? "AI가 둡니다" : "사용자가 둡니다"}`);
  }
  // 지금이 AI 차례면 바로 둔다 (지난 국면을 보는 중이면 checkAndRunAI가 알아서 멈춘다)
  if (typeof checkAndRunAI === "function") checkAndRunAI();
}

// ===== 국면 감시 =====

/** 수를 두거나 이동·두어보기로 국면이 바뀌면 기물점수·형세를 다시 그립니다. */
function hgPoll() {
  if (typeof pieces === "undefined" || !pieces || !pieces.length) return;
  let ctx;
  try {
    ctx = hgContext();
  } catch (e) {
    return; // 시작 중
  }
  hgUpdateNames(); // AI 진영이 바뀌었을 수 있다 (같으면 DOM을 건드리지 않음)
  if (ctx.key === hgLastKey) return;
  hgLastKey = ctx.key;
  // 추천수는 기보 서랍과 상관없이 국면이 바뀌면 다시 구한다 (recommend.js, "추천수 보이기"가 켜져 있을 때만)
  if (typeof scheduleRecommendations === "function") scheduleRecommendations();
  hgMarkSideToMove(ctx.team);
  hgUpdateMaterialFromBoard();
  hgScheduleEval(ctx);
  // 해설 영역은 서랍에 늘 보이므로 수순 표시도 함께 맞춘다 (commentary.js)
  if (typeof updateAICommentStepLabel === "function") updateAICommentStepLabel();
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    const saved = parseInt(localStorage.getItem("timeLimitMinutes") || "0", 10);
    timeLimitMinutes = isFinite(saved) && saved > 0 ? saved : 0;
  } catch (e) {
    timeLimitMinutes = 0;
  }
  const sel = hgEl("time-limit-select");
  if (sel) sel.value = String(timeLimitMinutes);
  hgUpdateNames();
  hgUpdateTime();
  hgStartEvalLabelCycle();
  // 우클릭 메뉴는 body의 perspective 영향을 받지 않도록 <html> 바로 아래로 옮기고, 바깥을 누르면 닫는다
  const menu = hgEl("side-menu");
  if (menu) document.documentElement.appendChild(menu);
  document.addEventListener("pointerdown", e => {
    if (menu && !menu.hidden && !menu.contains(e.target)) closeSideMenu();
  }, true);
  // ESC로 닫기는 keyboard.js (단축키 처리기가 ESC를 먼저 받는다)
  setInterval(hgPoll, HG_POLL_MS);
  // 엔진 설정을 바꾸면 형세를 다시 구한다
  const engineSel = hgEl("ai-engine-select");
  if (engineSel) engineSel.addEventListener("change", () => setTimeout(hgRefreshEval, 0));
});
