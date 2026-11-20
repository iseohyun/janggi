/**
 * @fileoverview 변화도(분기 그래프) SVG. git 그래프 모양만 빌립니다.
 *  - 본선(실제 기보)은 가운데 세로줄, 위에서 아래로 수순이 늘어난다.
 *  - 가지는 variation.js의 side/lane 값대로 좌우 바깥 칸에 그린다.
 *  - 본선으로 복귀한 가지는 끝에서 본선으로 점선을 그린다.
 *  - 점을 누르면 onSelect(varId, step)를 부르고, 현재 위치(cursor)를 고리로 강조한다.
 *  - 가지(점·선·번호)를 우클릭하면 onDelete(varId)를 부른다 (preview.js deleteVariationById가 지울지 묻는다). 본선 우클릭은 브라우저 메뉴 그대로.
 *  - 그래프 오른쪽에 지금 보고 있는 줄(본선 또는 커서가 있는 가지)의 수순을 글자로 적는다. 글자를 눌러도 이동한다.
 *    글자는 기본으로 숨기고, 변화도 머리의 눈 아이콘으로 켠다 (toggleVariationMoveTexts, localStorage "vtShowMoveTexts").
 *  - 크기: 기본은 40수가 변화도 칸 높이에 들어가도록 줄 간격을 정하고, 그보다 긴 수순은 세로로 스크롤한다 (지금 수가 보이게).
 *    머리의 "전체 보기" 아이콘을 켜면 트리 전체가 한 화면에 들어가도록 줄 간격을 줄인다 (vtFitAll, localStorage "vtFitAll").
 *    점·선 굵기도 줄 간격에 맞춰 줄어든다. 가로는 칸 폭을 채우도록 가지 칸을 넓힌다.
 *    수순 글자를 켜면 글자가 겹치지 않도록 줄 간격을 VT_TEXT_ROW_H 아래로 줄이지 않는다 (이때는 세로로 스크롤).
 *  - 가지 재생 중(preview.js playVariation)에는 지나가는 수순을 노랗게 강조한다.
 *  - 가지 번호: 가지가 갈라진 첫 수 옆에 번호(가지 id의 숫자, v3 → 3)를 적는다. 점 툴팁에도 "가지 N번".
 *  - 색: 본선은 흰색, 갈라져 나온 가지(if story)는 가지마다 다른 색(variationColorOf). 가지 끝에 나중에 돌아와 이어 둔
 *    수는 노란색(테두리)으로 표시하고, 새 가지가 아니라 같은 색·같은 줄로 이어 간다 (preview.js가 v.joins에 기록). 점 가운데 외통을 피할 수 없게 된 첫 수
 *    (착수 뒤 국면이 처음으로 강제 외통이 된 수)는 빨강, 착수 전후 승률이 10%p 이상 바뀐 착수는 노랑
 *    (eval-history.js ehTreeFlags·ehFlagColor, 형세 그래프와 같은 색).
 *  - 추천수에 마우스를 올리면 그 수가 이미 있는 가지만 남기고 다른 가지를 흐리게 한다 (vtFocusMove / vtClearFocus).
 * @module variation-tree
 * @depends variation, commentary-facts
 */

const VT_ROW_H = 22;
const VT_LANE_W = 18;
const VT_PAD_TOP = 14;
const VT_LABEL_W = 30; // 왼쪽 수순 번호 칸
const VT_SVG_NS = "http://www.w3.org/2000/svg";
const VT_TEXT_W = 128; // 오른쪽 수순 글자 칸
const VT_BRANCH_COLOR = "#22c55e"; // 첫 가지 색 (가지마다 VT_BRANCH_PALETTE에서 다른 색)
// 가지(if story)마다 다른 색. 빨강(외통)·노랑(변화가 많은 수·이어 둔 수)·흰색(본선)은 표시용이라 뺀다
const VT_BRANCH_PALETTE = ["#22c55e", "#38bdf8", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#a3e635", "#60a5fa"];
const VT_JOIN_COLOR = "#facc15"; // 가지 끝에 나중에 이어 둔 수

/** 가지 색: 가지 번호 순으로 팔레트를 돈다 (형세 그래프도 같은 색을 쓴다) */
function variationColorOf(varId) {
  if (!varId) return null;
  const n = parseInt(String(varId).replace(/^v/, ""), 10) || 1;
  return VT_BRANCH_PALETTE[(n - 1) % VT_BRANCH_PALETTE.length];
}

/** 이 가지의 step수가 "가지 끝에 나중에 이어 둔 첫 수"인지 */
function variationIsJoin(v, step) {
  return !!v && Array.isArray(v.joins) && v.joins.includes(step - v.parentStep - 1);
}
const VT_MATE_COLOR = "#ef4444"; // 외통을 피할 수 없게 된 첫 수
const VT_BIG_COLOR = "#eab308"; // 착수 전후 승률이 10%p 이상 바뀐 착수 ("변화가 많은 수")

var vtShowMoveTexts = false; // 수순 글자 보이기 (눈 아이콘)
var vtFitAll = false; // 전체 보기: 트리 전체를 한 화면에

/** 변화도 머리의 전체 보기 아이콘 */
function toggleVariationFitAll() {
  vtFitAll = !vtFitAll;
  try {
    localStorage.setItem("vtFitAll", vtFitAll ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  vtSyncFitButton();
  if (typeof pvRefresh === "function") pvRefresh();
}

function vtSyncFitButton() {
  const btn = document.getElementById("vt-fit-toggle");
  if (!btn) return;
  const label = vtFitAll ? "전체 보기 끄기 (40수 기준으로)" : "전체 보기 (트리 전체를 한 화면에)";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-pressed", vtFitAll ? "true" : "false");
  btn.classList.toggle("active", vtFitAll);
  const use = btn.querySelector("use");
  if (use) use.setAttribute("href", vtFitAll ? "#i-minimize" : "#i-maximize");
}
const VT_MIN_ROWS = 40; // 변화도 높이를 정할 때 기본으로 염두에 두는 수 (전체 보기가 아니면 이만큼이 한 화면)
const VT_TEXT_ROW_H = 14; // 수순 글자를 켰을 때 줄 간격의 최솟값
const VT_MIN_ROW_H = 0.75; // 아주 긴 기보에서도 이보다 좁히지 않는다 (모바일 작은 서랍에서도 한 화면에)
const VT_MAX_LANE_W = 40; // 가지 칸을 넓힐 때의 최댓값

/** 변화도 머리의 눈 아이콘: 수순 글자 보이기·숨기기 */
function toggleVariationMoveTexts() {
  vtShowMoveTexts = !vtShowMoveTexts;
  try {
    localStorage.setItem("vtShowMoveTexts", vtShowMoveTexts ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
  vtSyncEyeButton();
  if (typeof pvRefresh === "function") pvRefresh();
}

function vtSyncEyeButton() {
  const btn = document.getElementById("vt-text-toggle");
  if (!btn) return;
  const label = vtShowMoveTexts ? "수순 글자 숨기기" : "수순 글자 보이기";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-pressed", vtShowMoveTexts ? "true" : "false");
  btn.classList.toggle("active", vtShowMoveTexts);
  const use = btn.querySelector("use");
  if (use) use.setAttribute("href", vtShowMoveTexts ? "#i-eye" : "#i-eye-off");
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    vtShowMoveTexts = localStorage.getItem("vtShowMoveTexts") === "1";
    vtFitAll = localStorage.getItem("vtFitAll") === "1";
  } catch (e) {
    vtShowMoveTexts = false;
  }
  vtSyncEyeButton();
  vtSyncFitButton();
});

/**
 * 추천수 호버: 지금 국면에서 move를 둔 줄(본선 또는 가지)이 이미 있으면 그 줄과 조상·본선만 남기고 다른 가지를 흐리게 합니다.
 * @param {{varId:string|null, step:number}} cursor - 지금 국면
 * @param {{i:number,x:number,y:number}} move
 * @returns {boolean} 맞는 줄이 있었는지
 */
function vtFocusMove(cursor, move) {
  vtClearFocus();
  const svgEl = document.querySelector("#variation-tree .variation-tree-svg");
  if (!svgEl || !cursor || !move) return false;
  let target = null; // null = 본선
  let found = false;
  if (!cursor.varId && sameMove(log[cursor.step], move)) {
    found = true;
  } else {
    const cur = cursor.varId ? getVariation(cursor.varId) : null;
    if (cur && sameMove(cur.moves[cursor.step - cur.parentStep], move)) {
      target = cur; // 지금 가지를 그대로 이어 가는 수
      found = true;
    } else {
      const twin = getChildVariations(cursor.varId, cursor.step).find(v => sameMove(v.moves[0], move));
      if (twin) {
        target = twin;
        found = true;
      }
    }
  }
  if (!found) return false;
  const keep = new Set([""]); // 본선은 늘 남긴다 (모든 가지의 뿌리)
  for (let v = target; v; v = v.parentVarId ? getVariation(v.parentVarId) : null) keep.add(v.id);
  svgEl.classList.add("vt-focus");
  svgEl.querySelectorAll("[data-var]").forEach(el => {
    if (keep.has(el.getAttribute("data-var") || "")) el.classList.add("vt-keep");
  });
  return true;
}

function vtClearFocus() {
  const svgEl = document.querySelector("#variation-tree .variation-tree-svg");
  if (!svgEl) return;
  svgEl.classList.remove("vt-focus");
  svgEl.querySelectorAll(".vt-keep").forEach(el => el.classList.remove("vt-keep"));
}

function vtNode(tag, attrs, parent) {
  const el = document.createElementNS(VT_SVG_NS, tag);
  Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

function vtMoveTitle(step, m) {
  if (!m) return `${step}수 · 첫 배치`;
  return `${step}수 · ${cfTeamName(cfTeamOf(m.i))} ${cfPieceName(m.i)} → ${cfCoord(m.x, m.y)}`;
}

/**
 * @param {HTMLElement} container
 * @param {{cursor:{varId:string|null, step:number}, entryStep:number, onSelect:(varId:string|null, step:number)=>void, onDelete?:(varId:string)=>void}} opts - onDelete: 가지 우클릭 시
 */
function renderVariationTree(container, opts) {
  if (!container) return;
  const list = getVariations();
  const cursor = opts.cursor || { varId: null, step: 0 };

  let maxLeft = 0;
  let maxRight = 0;
  let maxStep = log.length;
  list.forEach(v => {
    if (v.side < 0) maxLeft = Math.max(maxLeft, v.lane);
    else maxRight = Math.max(maxRight, v.lane);
    maxStep = Math.max(maxStep, variationEndStep(v) + (v.returned ? 1 : 0));
  });
  maxLeft = Math.max(maxLeft, 1);
  maxRight = Math.max(maxRight, 1);

  // ---- 크기: 변화도 칸에 맞춘다 ----
  const cs = getComputedStyle(container);
  const availW = container.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0) - 2;
  const availH = container.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0) - 2;
  const textW = vtShowMoveTexts ? VT_TEXT_W : 0;
  // 세로: 기본은 40수가 칸 높이에 (더 긴 수순은 스크롤), 전체 보기면 트리 전체가 칸 높이에
  const rows = vtFitAll ? Math.max(VT_MIN_ROWS, maxStep) : VT_MIN_ROWS;
  let rowH = availH > 40 ? (availH - VT_PAD_TOP * 2) / rows : VT_ROW_H;
  rowH = Math.min(VT_ROW_H, Math.max(VT_MIN_ROW_H, rowH));
  if (vtShowMoveTexts) rowH = Math.max(rowH, VT_TEXT_ROW_H);
  // 가로: 가지 칸 수에 맞춰 칸 폭을 넓혀 그래프가 칸 폭(글자를 켰으면 글자 칸을 뺀 폭)을 채운다
  const lanes = maxLeft + maxRight + 1;
  const graphAvail = availW > 40 ? availW - textW - VT_LABEL_W - 6 : lanes * VT_LANE_W;
  const laneW = Math.max(10, Math.min(VT_MAX_LANE_W, graphAvail / lanes));
  // 점·선 굵기는 줄 간격과 칸 폭에 맞춘다
  const dotR = Math.max(1, Math.min(4.5, rowH * 0.42, laneW * 0.3));
  const lineW = Math.max(1, Math.min(2.5, rowH * 0.32, dotR * 0.6));
  const cx = VT_LABEL_W + (maxLeft + 0.5) * laneW;
  const graphW = cx + (maxRight + 0.5) * laneW + 6;
  const width = graphW + textW;
  const height = VT_PAD_TOP * 2 + maxStep * rowH;
  const yOf = step => VT_PAD_TOP + step * rowH;
  const scale = 1; // 크기는 위에서 직접 정한다
  const xOf = v => (v ? cx + v.side * v.lane * laneW : cx);

  const playing = typeof isVariationPlaying === "function" && isVariationPlaying();
  const svgEl = vtNode("svg", {
    class: "variation-tree-svg" + (playing ? " playing" : ""),
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "놓아보기 변화도"
  });

  const flags = typeof ehTreeFlags === "function" ? ehTreeFlags() : new Map();
  const flagColor = (varId, step) => {
    const f = flags.get(`${varId || ""}:${step}`);
    if (!f) return null;
    if (typeof ehFlagColor === "function") return ehFlagColor(f);
    if (f.forced) return VT_MATE_COLOR;
    if (f.big) return VT_BIG_COLOR;
    return null;
  };
  const flagTitle = (varId, step) => {
    const f = flags.get(`${varId || ""}:${step}`);
    if (!f) return "";
    const parts = [];
    if (f.forced) parts.push(`외통을 피할 수 없게 된 수 (${f.mateWinner === "cho" ? "초" : "한"} 승)`);
    else if (f.mate) parts.push("외통");
    if (f.rate !== null) {
      const pct = typeof hgPctText === "function" ? hgPctText(f.rate, !!f.mateWinner) : `${Math.round(f.rate * 100)}%`;
      parts.push(`초 승률 ${pct}${f.delta !== null ? ` (${f.delta >= 0 ? "+" : ""}${Math.round(f.delta * 100)}%p)` : ""}`);
    }
    if (f.mateWinner && !f.forced) parts.push(`${f.mateWinner === "cho" ? "초" : "한"} 외통 수순 있음`);
    if (f.precision) parts.push(f.precision);
    return parts.length ? ` · ${parts.join(" · ")}` : "";
  };
  svgEl.style.setProperty("--vt-lw", String(lineW));
  svgEl.style.setProperty("--vt-dw", String(Math.max(0.6, Math.min(1.5, dotR * 0.33))));
  const gLines = vtNode("g", { class: "vt-lines" }, svgEl);
  const gDots = vtNode("g", { class: "vt-dots" }, svgEl);
  const gLabels = vtNode("g", { class: "vt-labels" }, svgEl);

  // 본선 안내선 (기보보다 긴 가지가 있을 때 아래로 이어지는 흐린 선)
  if (maxStep > log.length) {
    vtNode("line", { x1: cx, y1: yOf(log.length), x2: cx, y2: yOf(maxStep), class: "vt-main-ghost", "data-var": "" }, gLines);
  }
  vtNode("line", { x1: cx, y1: yOf(0), x2: cx, y2: yOf(log.length), stroke: VARIATION_COLORS.main, class: "vt-line vt-main", "data-var": "" }, gLines);

  // 수순 번호: 글자가 겹치지 않을 만큼 띄워서 (5·10·20·…수마다) + 들어온 국면
  let labelEvery = 5;
  while (labelEvery * rowH < 12) labelEvery *= 2;
  for (let s = 0; s <= maxStep; s++) {
    if (s % labelEvery === 0 || s === opts.entryStep) {
      const t = vtNode("text", { x: VT_LABEL_W - 6, y: yOf(s), class: "vt-step-label" + (s === opts.entryStep ? " entry" : "") }, gLabels);
      t.textContent = String(s);
    }
  }

  const dot = (x, y, color, varId, step, title, extraClass) => {
    const c = vtNode("circle", {
      cx: x, cy: y, r: dotR, fill: color,
      class: "vt-dot" + (extraClass ? ` ${extraClass}` : ""),
      "data-var": varId || "", "data-step": step, tabindex: "0"
    }, gDots);
    vtNode("title", {}, c).textContent = title;
    return c;
  };

  // 본선 점
  for (let s = 0; s <= log.length; s++) {
    dot(cx, yOf(s), flagColor(null, s) || VARIATION_COLORS.main, null, s, `본선 ${vtMoveTitle(s, log[s - 1])}${flagTitle(null, s)}`, "vt-dot-main");
  }
  if (opts.entryStep >= 0 && opts.entryStep <= log.length) { // 두어보기에 들어온 국면
    vtNode("circle", { cx, cy: yOf(opts.entryStep), r: Math.max(3.5, dotR * 1.8), class: "vt-entry-ring" }, gLines);
  }

  // 가지
  list.forEach(v => {
    const color = variationColorOf(v.id) || VT_BRANCH_COLOR;
    const parent = v.parentVarId ? getVariation(v.parentVarId) : null;
    const px = xOf(parent);
    const x = xOf(v);
    const y0 = yOf(v.parentStep);
    const y1 = yOf(v.parentStep + 1);
    const end = variationEndStep(v);
    const mid = (y0 + y1) / 2;
    vtNode("path", { d: `M${px} ${y0} C${px} ${mid} ${x} ${mid} ${x} ${y1}`, stroke: color, class: "vt-line", "data-var": v.id }, gLines);
    if (end > v.parentStep + 1) {
      vtNode("line", { x1: x, y1, x2: x, y2: yOf(end), stroke: color, class: "vt-line", "data-var": v.id }, gLines);
    }
    if (v.returned) {
      const ye = yOf(end);
      const yr = yOf(end + 1);
      const m2 = (ye + yr) / 2;
      vtNode("path", { d: `M${x} ${ye} C${x} ${m2} ${cx} ${m2} ${cx} ${yr}`, stroke: color, class: "vt-line vt-return", "data-var": v.id }, gLines);
    }
    const no = String(v.id).replace(/^v/, "");
    v.moves.forEach((m, k) => {
      const step = v.parentStep + k + 1;
      const join = variationIsJoin(v, step);
      const d = dot(x, yOf(step), flagColor(v.id, step) || (join ? VT_JOIN_COLOR : color), v.id, step,
        `가지 ${no}번 (${v.label}) · ${vtMoveTitle(step, m)}${join ? " · 여기서 이어 둠" : ""}${flagTitle(v.id, step)}`,
        join ? "vt-dot-join" : "");
      if (join) d.setAttribute("stroke", "#ffffff");
    });
    // 가지 번호: 갈라진 첫 수 옆 (바깥쪽)
    const num = vtNode("text", {
      x: x + v.side * (dotR + 3),
      y: y1,
      class: "vt-branch-num",
      "text-anchor": v.side < 0 ? "end" : "start",
      "data-var": v.id
    }, gLabels);
    num.textContent = no;
  });

  // 수순 글자: 지금 보고 있는 줄 (커서가 가지에 있으면 그 가지 끝까지, 아니면 본선)
  const lineVar = cursor.varId ? getVariation(cursor.varId) : null;
  const lineMoves = lineVar ? variationLineMoves(lineVar.id, variationEndStep(lineVar)) : log;
  const ownerOf = step => {
    let v = lineVar;
    while (v && step <= v.parentStep) v = v.parentVarId ? getVariation(v.parentVarId) : null;
    return v;
  };
  const gText = vtNode("g", { class: "vt-move-texts" }, svgEl);
  if (vtShowMoveTexts) lineMoves.forEach((m, k) => {
    const step = k + 1;
    const owner = ownerOf(step);
    const isCur = step === cursor.step;
    const attrs = {
      x: graphW + 4,
      y: yOf(step),
      class: "vt-move-text" + (isCur ? " current" : ""),
      "data-var": owner ? owner.id : "",
      "data-step": step
    };
    if (owner) attrs.fill = variationColorOf(owner.id) || VT_BRANCH_COLOR;
    const t = vtNode("text", attrs, gText);
    t.textContent = `${step}. ${cfTeamName(cfTeamOf(m.i))} ${cfPieceName(m.i)} ${cfCoord(m.x, m.y)}`;
  });

  // 현재 위치 강조
  const curVar = cursor.varId ? getVariation(cursor.varId) : null;
  const curX = xOf(curVar);
  const curY = yOf(cursor.step);
  vtNode("circle", { cx: curX, cy: curY, r: Math.max(4, dotR * 1.9), class: "vt-cursor-ring" }, gDots);
  // 재생 중이면 지나가는 수순의 점도 강조
  if (playing) {
    gDots.querySelectorAll(".vt-dot").forEach(d => {
      if ((d.getAttribute("data-var") || "") === (cursor.varId || "") && parseInt(d.getAttribute("data-step"), 10) === cursor.step) {
        d.classList.add("vt-dot-playing");
      }
    });
  }

  svgEl.addEventListener("click", e => {
    const target = e.target.closest ? e.target.closest(".vt-dot, .vt-move-text") : null;
    if (!target || typeof opts.onSelect !== "function") return;
    opts.onSelect(target.getAttribute("data-var") || null, parseInt(target.getAttribute("data-step"), 10));
  });
  // 가지(점·선·번호)를 우클릭하면 그 가지를 지울지 묻는다. 본선은 브라우저 메뉴 그대로
  svgEl.addEventListener("contextmenu", e => {
    const target = e.target.closest ? e.target.closest("[data-var]") : null;
    const varId = target ? target.getAttribute("data-var") : "";
    if (!varId || typeof opts.onDelete !== "function") return;
    e.preventDefault();
    opts.onDelete(varId);
  });
  svgEl.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("vt-dot")) {
      e.preventDefault();
      e.stopPropagation();
      opts.onSelect(e.target.getAttribute("data-var") || null, parseInt(e.target.getAttribute("data-step"), 10));
    }
  });

  container.replaceChildren(svgEl);

  // 현재 위치가 보이도록 스크롤 (확대했으면 확대한 좌표로)
  const sx = curX * scale;
  const sy = curY * scale;
  const top = sy - container.clientHeight / 2;
  if (sy < container.scrollTop + 20 || sy > container.scrollTop + container.clientHeight - 20) {
    container.scrollTop = Math.max(0, top);
  }
  const left = sx - container.clientWidth / 2;
  if (sx < container.scrollLeft + 10 || sx > container.scrollLeft + container.clientWidth - 10) {
    container.scrollLeft = Math.max(0, left);
  }
}
