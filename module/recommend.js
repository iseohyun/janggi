/**
 * @fileoverview 추천수 (M3). Fairy-Stockfish MultiPV로 지금 국면의 좋은 수를 구해
 * 오른쪽 서랍 "AI" 영역의 목록(번호·승률)과 판 위 화살표로 보여 준다. 목록이나 판 위 번호를 누르면 그 수순(엔진 예상 수순)을
 * 초록 "추천" 가지로 만들어 한 수씩 재생한다.
 * - "추천수 보이기 (자동)"가 켜져 있으면 국면이 바뀔 때마다 분석한다. 끄면 분석도 화살표도 없다.
 * - 저장: 국면마다 추천수와 몇 번째 분석까지 했는지를 localStorage("janggiRecCache")에 남긴다. 전에 본 국면이면
 *   다시 계산하지 않고 불러오고, 끝내지 못한 깊은 분석만 이어 한다. "다시 분석" 버튼만 처음부터 새로 계산한다.
 * - 점점 깊게: 먼저 1초 분석한 결과를 보여 주고, 이어서 2·3·4초 분석으로 지금 추천수들의 승률을 고친다.
 *   그 사이 지금 목록보다 승률이 높은 새 수가 나오면 다음 번호로 덧붙인다 (번호는 바뀌지 않는다).
 * - 목록·판 위 번호에 마우스를 올리면 그 수가 이미 있는 가지만 남기고 변화도의 다른 가지를 흐리게 한다.
 * - 거꾸로, 변화도에서 고른 수순이 가지에 있고 그 가지가 다음에 두는 수가 추천수 가운데 하나면, 그 추천수만 남기고
 *   나머지 추천수(목록·판 위 화살표)를 음영 처리한다 (recFollowIndex). 본선에서는 음영 없이 모두 보통으로 보인다.
 * - 외통 발견 시 알림: 분석 중 차례인 쪽이 외통으로 이기는 수순을 찾으면 한 번 알린다 (켜고 끄기: setMateAlert).
 * - 분석은 AI 착수 같은 다른 엔진 질문이 오면 양보한다 (engine-fsf.js fsfAsk).
 * @module recommend
 * @depends state, board, rules, commentary-facts, engine-fsf, variation, preview, variation-tree
 */

const REC_COLORS = ["#22c55e", "#a3e635", "#facc15", "#38bdf8", "#f472b6", "#c084fc"];
const REC_LAYER_ID = "recommend-layer";
const REC_PASSES_MS = [1000, 2000, 3000, 4000]; // 점점 깊게 분석하는 시간

var recommendAuto = true; // 추천수 보이기 (자동)
var mateAlertOn = true; // 외통 발견 시 알림 (AI 영역 체크)
let recMateAlertedKey = null; // 같은 국면에서 한 번만 알린다
let recSeq = 0; // 늦게 온 분석 결과를 버리기 위한 번호
let recKey = null; // 결과가 맞는 국면의 열쇠
let recResults = null; // [{...fsfAnalyze 결과, prevRate}] (번호 = 순서 + 1, 순서는 바꾸지 않는다)
let recTimer = null;
let recPendingKey = null; // 분석을 예약했거나 하는 중인 국면의 열쇠
const REC_CACHE_KEY = "janggiRecCache";
const REC_CACHE_MAX = 150; // 저장해 두는 국면 수
const recCache = new Map(); // 국면 열쇠 → { results, pass(마친 분석 번째, 0부터) }
let recCacheSaveTimer = null;

/** 저장 행들 [짧은 열쇠, 마친 분석 번째, 추천수 목록] (eval-file.js 파일 저장도 같은 행을 쓴다) */
function recSerialize() {
  const rows = [];
  recCache.forEach((v, key) => rows.push([ehCompactKey(key), v.pass, v.results]));
  return rows.slice(Math.max(0, rows.length - REC_CACHE_MAX));
}

function recCacheSave() {
  clearTimeout(recCacheSaveTimer);
  recCacheSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(REC_CACHE_KEY, JSON.stringify(recSerialize()));
    } catch (e) {
      console.warn("[recommend] 추천수 저장 실패:", e);
    }
  }, 1500);
  if (typeof efMarkDirty === "function") efMarkDirty();
}

/**
 * 파일에서 불러온 추천수 행을 합칩니다. 분석을 더 많이 마친 것만 덮어쓴다.
 * @returns {number} 새로 쓰거나 고친 국면 수
 */
function recMergeRows(rows) {
  let changed = 0;
  rows.forEach(row => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !Array.isArray(row[2])) return;
    const key = ehExpandKey(row[0]);
    const old = recCache.get(key);
    if (old && old.pass >= row[1]) return;
    recCache.set(key, { pass: row[1], results: row[2] });
    changed += 1;
  });
  if (changed) recCacheSave();
  return changed;
}

function recCacheLoad() {
  try {
    const raw = localStorage.getItem(REC_CACHE_KEY);
    if (!raw || typeof ehExpandKey !== "function") return;
    JSON.parse(raw).forEach(([compact, pass, results]) => recCache.set(ehExpandKey(compact), { pass, results }));
  } catch (e) {
    console.warn("[recommend] 추천수 불러오기 실패:", e);
  }
}

function recCachePut(key, pass) {
  recCache.delete(key); // 최근 것을 뒤로 (넘치면 앞에서부터 버린다)
  recCache.set(key, { pass, results: recResults.map(r => ({ ...r, isNew: false })) });
  recCacheSave();
}

function recEl(id) {
  return document.getElementById(id);
}

/** 지금 보고 있는 국면 (두어보기 중이면 가지 국면) */
function recContext() {
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  const step = inPreview ? previewCursor.step : cfCurrentStep();
  const team = cfSideToMove(step);
  return { step, team, key: `${team}|${JSON.stringify(cfSnapshot())}` };
}

/** 차례인 쪽의 승률 (0~1) */
function recRateFor(r, team) {
  return team === "cho" ? r.winRate : 1 - r.winRate;
}

function recSameMove(a, b) {
  return a && b && a.i === b.i && a.x === b.x && a.y === b.y;
}

/**
 * 지금 고른 수순이 가지(두어보기 가지)에 있고 그 가지가 다음에 두는 수가 추천수 가운데 하나면 그 번호(0부터), 아니면 -1.
 * 본선을 골랐을 때는 늘 -1 (음영 없음, 사용자 결정 "가지만 적용").
 * 예: 추천 1로 만든 가지의 한 수를 고르면, 그 가지가 이어 가는 수와 같은 추천수만 또렷하게 남는다.
 */
function recFollowIndex() {
  if (!recResults || !recResults.length) return -1;
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  if (!inPreview || !previewCursor.varId) return -1;
  const c = previewCursor;
  const v = typeof getVariation === "function" ? getVariation(c.varId) : null;
  const next = v ? v.moves[c.step - v.parentStep] : null;
  if (!next) return -1;
  return recResults.findIndex(r => recSameMove(r, next));
}

// ===== 분석 =====

/**
 * 국면이 바뀌었으면 추천수를 다시 구합니다. 국면이 바뀔 때마다 부릅니다 (header-graph.js 국면 감시, preview.js).
 * @param {boolean} [force] - 같은 국면이어도 다시 분석 ("다시 분석" 버튼)
 */
function scheduleRecommendations(force) {
  if (!recommendAuto && !force) {
    recSeq += 1; // 하던 분석 결과는 버린다
    recKey = null;
    recPendingKey = null;
    recResults = null;
    recClearArrows();
    recRender("추천수 보이기가 꺼져 있습니다. 다시 분석을 누르면 이번 국면만 구합니다.");
    return;
  }
  const ctx = recContext();
  if (!force && ctx.key === recKey) {
    recDrawArrows(); // 판이 다시 그려졌을 수 있다
    return;
  }
  if (!force && ctx.key === recPendingKey) return; // 이미 이 국면을 분석하는 중
  clearTimeout(recTimer);
  recClearArrows();
  // 전에 분석한 국면이면 불러오고, 끝내지 못한 깊은 분석만 이어 한다 ("다시 분석"은 처음부터)
  const cached = !force ? recCache.get(ctx.key) : null;
  if (cached && cached.results && cached.results.length) {
    recSeq += 1; // 하던 다른 국면 분석은 버린다
    recKey = ctx.key;
    recResults = cached.results.map(r => ({ ...r }));
    const last = cached.pass >= REC_PASSES_MS.length - 1;
    const depth = Math.max(0, ...recResults.map(r => r.depth || 0));
    recRender(last ? `저장된 분석 · 깊이 ${depth}` : `저장된 분석 · 이어서 더 깊이 계산 중…`);
    recDrawArrows();
    if (typeof hgOnEngineResult === "function") hgOnEngineResult(ctx.key, recBestFirst(ctx.team));
    if (last) {
      recPendingKey = null;
      return;
    }
    recPendingKey = ctx.key;
    recTimer = setTimeout(() => recRun(ctx, cached.pass + 1), 250);
    return;
  }
  recKey = null;
  recResults = null;
  recPendingKey = ctx.key;
  recTimer = setTimeout(() => recRun(ctx, 0), 250);
}

/** 지금 목록을 차례인 쪽 승률이 높은 순으로 (헤더 형세에 넘길 때 1위가 맨 앞) */
function recBestFirst(team) {
  return [...recResults].sort((a, b) => recRateFor(b, team) - recRateFor(a, team));
}

/**
 * 1초 분석 결과를 보여 주고, 2·3·4초 분석으로 승률을 고치며 더 좋은 새 수를 덧붙인다.
 * @param {Object} ctx - recContext()
 * @param {number} [startPass=0] - 저장된 분석을 이어 할 때 시작할 번째
 */
async function recRun(ctx, startPass) {
  if (aiEnginePref() !== "fsf") {
    recPendingKey = null;
    recRender("추천수는 Fairy-Stockfish 엔진에서만 볼 수 있습니다. 설정 > 새 대국 > AI 엔진에서 고르세요.");
    return;
  }
  const seq = ++recSeq;
  const first = startPass || 0;
  if (first === 0) recRender("엔진이 추천수를 찾는 중…");
  for (let p = first; p < REC_PASSES_MS.length; p++) {
    let res = null;
    try {
      res = await fsfAnalyze(ctx.team, { multipv: 3, movetime: REC_PASSES_MS[p] });
    } catch (err) {
      console.error("[recommend] 분석 실패:", err);
    }
    if (seq !== recSeq || recContext().key !== ctx.key) return; // 그사이 국면이 바뀜
    if (res === null) {
      if (p === 0) {
        recPendingKey = null;
        recRender(fsfStatus().detail);
      }
      break;
    }
    if (p === 0 || !recResults) {
      recKey = ctx.key;
      recResults = res.map(r => ({ ...r, prevRate: null }));
    } else {
      recMerge(res, ctx.team);
    }
    recCachePut(ctx.key, p);
    // 헤더 형세 줄도 같은 분석 결과를 쓴다 (header-graph.js)
    if (typeof hgOnEngineResult === "function") hgOnEngineResult(ctx.key, res, REC_PASSES_MS[p]);
    const last = p === REC_PASSES_MS.length - 1;
    const depth = Math.max(0, ...recResults.map(r => r.depth || 0));
    recRender(!recResults.length ? "둘 수 있는 수가 없습니다."
      : last ? `깊이 ${depth}까지 계산함` : `더 깊이 계산 중… (${REC_PASSES_MS[p + 1] / 1000}초, 지금 깊이 ${depth})`);
    recDrawArrows();
    recCheckMate(ctx);
    if (!recResults.length) break;
  }
  if (seq === recSeq) recPendingKey = null;
}

/** 더 깊은 분석 결과로 지금 목록의 승률을 고치고, 지금 목록보다 승률이 높은 새 수는 다음 번호로 덧붙인다 */
function recMerge(res, team) {
  const best = Math.max(...recResults.map(r => recRateFor(r, team)));
  res.forEach(r => {
    const idx = recResults.findIndex(x => recSameMove(x, r));
    if (idx >= 0) {
      const old = recResults[idx];
      recResults[idx] = { ...r, rank: old.rank, prevRate: recRateFor(old, team) };
    } else if (recRateFor(r, team) > best + 0.0001) {
      recResults.push({ ...r, prevRate: null, isNew: true });
    }
  });
}

/** 차례인 쪽이 외통으로 이기는 추천수가 있으면 한 번 알린다 */
function recCheckMate(ctx) {
  if (!mateAlertOn || !recResults || recMateAlertedKey === ctx.key) return;
  const sign = ctx.team === "cho" ? 1 : -1;
  let best = null;
  recResults.forEach((r, idx) => {
    if (r.mate === null || r.mate === undefined || r.mate * sign <= 0) return;
    if (!best || Math.abs(r.mate) < Math.abs(best.r.mate)) best = { r, idx };
  });
  if (!best) return;
  recMateAlertedKey = ctx.key;
  const n = Math.abs(best.r.mate);
  const msg = `외통 발견! ${cfTeamName(ctx.team)} ${n}수 외통 — 추천 ${best.idx + 1}: ${recMoveText(best.r)}`;
  // 외통 선언: 닫을 때까지 남는 팝업 (app-dialog.js). 다른 팝업이 떠 있으면 알림 글로
  if (typeof showAppDialog === "function" && !(typeof isAppDialogOpen === "function" && isAppDialogOpen())) {
    const idx = best.idx;
    showAppDialog({
      title: "외통 선언",
      message: `${cfTeamName(ctx.team)}이 ${n}수 안에 외통으로 이길 수 있습니다. 첫 수는 추천 ${idx + 1}: ${recMoveText(best.r)}`,
      tone: "win",
      buttons: [
        { label: "닫기", value: null },
        { label: `추천 ${idx + 1} 두기`, value: "play", primary: true, title: `추천 ${idx + 1}을 둡니다 (번호키 ${idx + 1})` }
      ]
    }).then(v => {
      if (v === "play" && recKey === ctx.key) playRecommendation(idx);
    });
    return;
  }
  if (typeof showToast === "function") showToast(msg, 4000);
}

/** 번호키 1~5: 추천수 고르기 (keyboard.js). 추천수가 없으면 알림 */
function playRecommendationByKey(n) {
  const idx = n - 1;
  if (!recResults || !recResults[idx] || recContext().key !== recKey) {
    if (typeof showToast === "function") showToast(recommendAuto ? `추천 ${n}이 아직 없습니다` : "AI 훈수가 꺼져 있습니다 (X로 켜기)");
    return;
  }
  playRecommendation(idx);
}

/** AI 영역 "외통 발견 시 알림" 체크 */
function setMateAlert(checked) {
  mateAlertOn = !!checked;
  try {
    localStorage.setItem("mateAlert", mateAlertOn ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

/** "다시 분석" 버튼 */
function refreshRecommendations() {
  scheduleRecommendations(true);
}

/** "추천수 보이기 (자동)" 체크 */
function setRecommendAuto(checked) {
  recommendAuto = !!checked;
  try {
    localStorage.setItem("recommendAuto", recommendAuto ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  recSyncToggleButton();
  scheduleRecommendations(recommendAuto);
}

// ===== 글자 =====

function recMoveText(m) {
  return `${cfTeamName(cfTeamOf(m.i))} ${cfPieceName(m.i)} → ${cfCoord(m.x, m.y)}`;
}

function recScoreText(r, team) {
  if (r.mate !== null) {
    const winner = r.mate > 0 ? "초" : "한";
    return `${winner} ${Math.abs(r.mate)}수 외통`;
  }
  const cp = r.score || 0;
  const lead = cp === 0 ? "균형" : `${cp > 0 ? "초" : "한"} +${(Math.abs(cp) / 100).toFixed(1)}`;
  const rate = team === "cho" ? r.winRate : 1 - r.winRate;
  return `${lead} · ${cfTeamName(team)} 승률 약 ${Math.round(rate * 100)}%`;
}

/** 목록: 번호와 승률만 (수·예상 수순은 툴팁) */
function recRender(statusText) {
  const list = recEl("recommend-list");
  const status = recEl("recommend-status");
  if (status) status.textContent = statusText || "";
  if (!list) return;
  list.replaceChildren();
  if (!recResults) return;
  const team = recContext().team;
  const follow = recFollowIndex();
  recResults.forEach((r, idx) => {
    const li = document.createElement("li");
    li.className = "recommend-item" + (r.isNew ? " is-new" : "") +
      (follow >= 0 ? (idx === follow ? " followed" : " dimmed") : "");
    li.setAttribute("data-action", "playRecommendation");
    li.setAttribute("data-index", String(idx));
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    const tail = r.pv.slice(1, 4).map(recMoveText).join(", ");
    li.title = `${recMoveText(r)} · ${recScoreText(r, team)}${tail ? `\n이후 ${tail}${r.pv.length > 4 ? " …" : ""}` : ""}\n깊이 ${r.depth} · 누르면 이 수순을 한 수씩 둡니다`;

    const rank = document.createElement("span");
    rank.className = "rec-rank";
    rank.style.background = REC_COLORS[idx % REC_COLORS.length];
    rank.textContent = String(idx + 1);

    const rate = recRateFor(r, team);
    const pct = document.createElement("span");
    pct.className = "rec-rate";
    pct.textContent = r.mate !== null && r.mate !== undefined ? `${Math.abs(r.mate)}수 외통` : `${Math.round(rate * 100)}%`;

    li.append(rank, pct);
    if (r.prevRate !== null && r.prevRate !== undefined) {
      const d = Math.round(rate * 100) - Math.round(r.prevRate * 100);
      if (d !== 0) {
        const delta = document.createElement("span");
        delta.className = `rec-delta ${d > 0 ? "up" : "down"}`;
        delta.textContent = `${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
        li.appendChild(delta);
      }
    }
    li.addEventListener("mouseenter", () => recHover(idx));
    li.addEventListener("mouseleave", recHoverEnd);
    li.addEventListener("focus", () => recHover(idx));
    li.addEventListener("blur", recHoverEnd);
    list.appendChild(li);
  });
}

// ===== 판 위 화살표 =====

function recClearArrows() {
  const layer = recEl(REC_LAYER_ID);
  if (layer) layer.remove();
}

function recDrawArrows() {
  recClearArrows();
  if (!recResults || !recResults.length || recContext().key !== recKey) return;
  const recFollowIndexCached = recFollowIndex(); // 고른 줄이 따라가는 추천수 (없으면 -1)
  const ns = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(ns, "g");
  layer.id = REC_LAYER_ID;
  layer.setAttribute("pointer-events", "none");
  const width = Math.max(3, unitSize * 0.11);
  // 3위부터 그려서 1위가 맨 위에 오게
  [...recResults].reverse().forEach(r => {
    const idx = recResults.indexOf(r);
    const color = REC_COLORS[idx % REC_COLORS.length];
    const follow = recFollowIndexCached;
    const from = getAxis(pieces[r.i].x, pieces[r.i].y);
    const to = getAxis(r.x, r.y);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const endPad = unitSize * 0.28;
    const ex = to.x - (dx / len) * endPad;
    const ey = to.y - (dy / len) * endPad;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", ex);
    line.setAttribute("y2", ey);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", width);
    line.setAttribute("stroke-linecap", "round");
    // 고른 줄이 따라가는 추천수가 있으면 나머지는 음영
    const dim = follow >= 0 && idx !== follow;
    line.setAttribute("opacity", dim ? "0.18" : idx === 0 ? "0.9" : "0.7");
    layer.appendChild(line);

    const badge = document.createElementNS(ns, "circle");
    badge.setAttribute("cx", to.x);
    badge.setAttribute("cy", to.y);
    badge.setAttribute("r", unitSize * 0.2);
    badge.setAttribute("fill", color);
    badge.setAttribute("stroke", "#0f172a");
    badge.setAttribute("stroke-width", "1.5");
    if (follow >= 0 && idx !== follow) badge.setAttribute("opacity", "0.35");
    // 판 위 번호에 마우스를 올리면 목록과 똑같이 변화도의 다른 가지를 흐리게, 누르면 그 수순을 둔다
    badge.setAttribute("pointer-events", "all");
    badge.setAttribute("class", "rec-arrow-badge");
    badge.addEventListener("mouseenter", () => recHover(idx));
    badge.addEventListener("mouseleave", recHoverEnd);
    badge.addEventListener("click", e => {
      e.stopPropagation();
      recHoverEnd();
      playRecommendation(idx);
    });
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `추천 ${idx + 1}: ${recMoveText(r)} · 누르면 이 수순을 둡니다`;
    badge.appendChild(tip);
    layer.appendChild(badge);

    const num = document.createElementNS(ns, "text");
    num.setAttribute("x", to.x);
    num.setAttribute("y", to.y);
    num.setAttribute("class", "rec-arrow-num");
    num.setAttribute("font-size", unitSize * 0.26);
    num.textContent = String(idx + 1);
    layer.appendChild(num);
  });
  svg.appendChild(layer);
}

// ===== 추천 가지로 두어보기 =====

/**
 * 추천수 하나를 엔진 예상 수순 그대로 "추천" 가지로 만들고, 그 수순을 한 수씩 애니메이션으로 재생합니다.
 * 재생 중에는 변화도에서 지나가는 수순이 노랗게 강조된다 (variation-tree.js).
 * @param {number} index - 0부터
 */
function playRecommendation(index) {
  const r = recResults && recResults[index];
  if (!r || recContext().key !== recKey) return;
  if (!isPreviewActive()) {
    // 놓아보기가 꺼져 있고 실제 대국의 마지막 국면이면: 본선에 바로 둔다 (AI 대국이면 AI가 응수)
    if (cfCurrentStep() >= log.length) {
      recPlayOnMainLine(r);
      return;
    }
    // 과거 국면을 보는 중: 본선에서 실제로 둔 수와 같으면 한 수 따라가고, 다르면 무르기 팝업 (preview.js)
    const step = cfCurrentStep();
    const first0 = r.pv[0];
    if (sameMove(log[step], first0)) {
      next();
      return;
    }
    if (typeof pvAskPastMove === "function") {
      // 무르기 → 첫 수를 본선에 · 놓아보기로 두기 → 예상 수순 전체를 새 가지로 재생
      pvAskPastMove(step, first0, () => {
        if (enterPreviewMode("recommend")) playRecommendation(index);
      });
      return;
    }
    if (!enterPreviewMode("recommend")) return;
  }
  const c = previewCursor;
  const first = r.pv[0];
  if (!c.varId && sameMove(log[c.step], first)) {
    previewGoTo(null, c.step + 1); // 본선에서 실제로 둔 수와 같다
    return;
  }
  const twin = getChildVariations(c.varId, c.step).find(v => sameMove(v.moves[0], first));
  const cur = c.varId ? getVariation(c.varId) : null;
  if (!twin && cur) {
    const k = c.step - cur.parentStep; // 이 가지에서 다음에 둘 수의 자리
    // 가지 안에서 다음 수가 추천수와 같다: 같은 가지를 그대로 따라간다
    if (k < cur.moves.length && sameMove(cur.moves[k], first)) {
      if (typeof vtClearFocus === "function") vtClearFocus();
      playVariation(cur.id, { fromStep: c.step });
      return;
    }
    // 가지 끝에서 추천수를 두면 새 가지가 아니라 같은 가지(같은 번호·색·줄)로 이어 붙인다.
    // 첫 수는 "이어 둔 수"(노랑)로 기록한다 (preview.js previewPlayMove와 같은 규칙)
    if (k === cur.moves.length) {
      if (cur.moves.length) {
        cur.joins = Array.isArray(cur.joins) ? cur.joins : [];
        if (!cur.joins.includes(cur.moves.length)) cur.joins.push(cur.moves.length);
      }
      r.pv.forEach(m => appendVariationMove(cur.id, m));
      if (typeof pvLastPlayed !== "undefined") pvLastPlayed = { varId: cur.id, step: variationEndStep(cur) };
      if (typeof vtClearFocus === "function") vtClearFocus();
      playVariation(cur.id, { fromStep: c.step });
      return;
    }
  }
  const team = cfSideToMove(c.step);
  const v = twin || createVariation(c.step, r.pv, "recommend", `추천 ${index + 1} (${recScoreText(r, team).split(" · ")[0]})`, c.varId);
  if (typeof vtClearFocus === "function") vtClearFocus();
  playVariation(v.id);
}

/** 놓아보기가 꺼져 있을 때: 추천수 첫 수를 실제 대국에 둔다 (기보에 쌓이고 AI 대국이면 AI가 응수) */
function recPlayOnMainLine(r) {
  const m = r.pv[0];
  if (!m) return;
  const team = cfSideToMove(log.length);
  if (typeof aiThinking !== "undefined" && aiThinking) {
    showToast("AI가 수를 생각하는 중입니다. 잠시 뒤 다시 눌러 주세요.");
    return;
  }
  if (typeof gameEnded !== "undefined" && gameEnded) {
    showToast("대국이 끝났습니다. 놓아보기를 켜면 가지로 둘 수 있습니다.");
    return;
  }
  if (typeof isAITeam === "function" && isAITeam(team)) {
    showToast("AI 차례입니다.");
    return;
  }
  if (typeof clearCandiBox === "function") clearCandiBox();
  curSelect = NO_PIECE;
  move(m.i, m.x, m.y);
}

/** 헤더 오른쪽 버튼: AI 추천수(목록과 판 위 화살표) 보이기/숨기기 */
function toggleRecommendVisible() {
  setRecommendAuto(!recommendAuto);
}

/** 헤더 추천수 버튼·AI 영역 체크 상자를 지금 상태에 맞춘다 */
function recSyncToggleButton() {
  const auto = recEl("recommend-auto");
  if (auto) auto.checked = recommendAuto;
  const btn = recEl("rec-toggle-btn");
  if (!btn) return;
  btn.classList.toggle("active", recommendAuto);
  btn.setAttribute("aria-pressed", recommendAuto ? "true" : "false");
  btn.title = recommendAuto ? "AI 훈수 숨기기 (추천수 목록과 판 위 화살표) (X)" : "AI 훈수 보이기 (추천수 목록과 판 위 화살표) (X)";
  const use = btn.querySelector("use");
  if (use) use.setAttribute("href", recommendAuto ? "#i-ai" : "#i-ai-off");
}

/** 추천수에 마우스를 올리면 그 수가 이미 있는 가지만 남기고 다른 가지를 흐리게 (variation-tree.js) */
function recHover(index) {
  const r = recResults && recResults[index];
  if (!r || typeof vtFocusMove !== "function") return;
  const cursor = isPreviewActive() ? previewCursor : { varId: null, step: cfCurrentStep() };
  vtFocusMove(cursor, r.pv[0]);
}

function recHoverEnd() {
  if (typeof vtClearFocus === "function") vtClearFocus();
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    recommendAuto = localStorage.getItem("recommendAuto") !== "0";
  } catch (e) {
    recommendAuto = true;
  }
  recSyncToggleButton();
  recCacheLoad();
  try {
    mateAlertOn = localStorage.getItem("mateAlert") !== "0";
  } catch (e) {
    mateAlertOn = true;
  }
  const mateBox = recEl("mate-alert");
  if (mateBox) mateBox.checked = mateAlertOn;
  // 화면 크기가 바뀌면 판 좌표가 달라지므로 화살표를 다시 그린다
  window.addEventListener("resize", () => requestAnimationFrame(recDrawArrows));
});
