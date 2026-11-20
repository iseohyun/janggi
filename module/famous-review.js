/**
 * @fileoverview 포진 판정 검수 (로컬 전용). 프로 대국 묶음(data/famous-games.json)을 localhost에서 열었을 때만 동작한다.
 * - 유명 기보를 불러오면 "저장된 기보 > 유명 기보" 위에 검수 칸을 띄운다:
 *   포진 이름, 판정 근거(상차림 → 계열, 면에 처음 앉은 기물과 그 수), 근거 수로 가는 버튼,
 *   맞음 / 틀림 / 애매 표시와 메모, 다음 기보·다음 미검수 기보로 넘어가기, 진행 현황, CSV 내보내기.
 * - 판정 근거(why)는 저장소 밖 작업 폴더의 scripts/build-famous.mjs가 opening-names.mjs 규칙으로 계산해 데이터에 넣는다.
 * - 검수 기록은 이 브라우저의 localStorage "famousReview_v1"에만 남는다 ({key: {v, memo, t}}). 기보 key = 원본 파일#판 번호.
 * - famous-games.js가 부른다: famousReviewOnData(데이터 읽은 뒤), famousReviewShow(기보 불러온 뒤), famousReviewBadge(목록 줄 표시).
 * @module famous-review
 * @depends famous-games, preview, ui
 */

const FAMOUS_REVIEW_KEY = "famousReview_v1";
const FAMOUS_REVIEW_VERDICTS = { ok: "맞음", bad: "틀림", meh: "애매" };
const FAMOUS_REVIEW_MARKS = { ok: "✓", bad: "✗", meh: "?" };
let famousReviewIndex = -1; // 지금 검수 칸에 띄운 기보 (famousAll() 위치)

function famousReviewEnabled() {
  return typeof FAMOUS_DATA_ENABLED !== "undefined" && FAMOUS_DATA_ENABLED && typeof famousExtra !== "undefined" && famousExtra.length > 0;
}

function famousReviewRead() {
  try {
    return JSON.parse(localStorage.getItem(FAMOUS_REVIEW_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

function famousReviewWrite(all) {
  try {
    localStorage.setItem(FAMOUS_REVIEW_KEY, JSON.stringify(all));
  } catch (e) {
    if (typeof showToast === "function") showToast("검수 기록을 저장하지 못했습니다");
  }
}

/** 목록 줄 앞에 붙일 검수 표시 (검수 안 한 기보는 null) */
function famousReviewBadge(g) {
  if (!famousReviewEnabled() || !g || !g.key) return null;
  const rec = famousReviewRead()[g.key];
  if (!rec || !rec.v) return null;
  const s = document.createElement("span");
  s.className = `famous-review-badge ${rec.v}`;
  s.textContent = FAMOUS_REVIEW_MARKS[rec.v] || "";
  s.title = `검수: ${FAMOUS_REVIEW_VERDICTS[rec.v] || rec.v}${rec.memo ? ` · ${rec.memo}` : ""}`;
  return s;
}

/** 한 편의 판정 근거 줄들 → [{text, ply}] */
function famousReviewWhyLines(g, side) {
  const w = g.why && g.why[side];
  if (!w) return [{ text: "판정 근거가 없는 기보입니다 (데이터를 다시 만들어 주세요)", ply: null }];
  const layout = g.layout[side === "cho" ? 0 : 1];
  const lines = [{ text: `상차림 ${layout} → ${w.base} 계열`, ply: null }];
  const moves = (g.m || "").split(" ");
  if (w.ply) {
    const mv = moves[w.ply - 1] || "";
    let tail = "";
    if (w.myeon === "포") tail = w.cannonSide ? ` (${w.cannonSide} 포 → ${w.variant})` : "";
    else if (w.myeon === "상" || w.myeon === "마") tail = ` → ${w.name}`;
    lines.push({ text: `${w.ply}수 ${mv}: 면에 처음 ${w.myeon}${tail}`, ply: w.ply });
  } else {
    lines.push({ text: `처음 ${g.why.namePly}수 안에 면에 앉은 기물 없음 → 면 비움`, ply: null });
  }
  return lines;
}

/** 엇상·맞상 근거 (귀마 대 귀마일 때) */
function famousReviewMatchupLine(g) {
  if (!/엇상|맞상/.test(g.opening || "")) return null;
  const same = g.layout[0] === g.layout[1];
  return `두 편 상차림 ${g.layout[0]} / ${g.layout[1]}: 화면 기준 ${same ? "같음 → 엇상" : "다름 → 맞상"}`;
}

function famousReviewEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function famousReviewButton(label, action, attrs, cls) {
  const b = famousReviewEl("button", cls || "famous-review-btn", label);
  b.type = "button";
  b.setAttribute("data-action", action);
  Object.entries(attrs || {}).forEach(([k, v]) => b.setAttribute(k, String(v)));
  return b;
}

/** 진행 현황 글 */
function famousReviewProgressText() {
  const recs = famousReviewRead();
  const keys = new Set(famousExtra.map(g => g.key));
  const count = { ok: 0, bad: 0, meh: 0 };
  Object.entries(recs).forEach(([k, r]) => {
    if (keys.has(k) && r && count[r.v] !== undefined) count[r.v]++;
  });
  const done = count.ok + count.bad + count.meh;
  return `검수 ${done} / ${famousExtra.length} · 맞음 ${count.ok} · 틀림 ${count.bad} · 애매 ${count.meh}`;
}

/** 검수 칸을 그린다 */
function famousReviewRender() {
  const box = document.getElementById("famous-review");
  if (!box) return;
  if (!famousReviewEnabled()) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren();

  const head = famousReviewEl("div", "famous-review-head");
  head.append(famousReviewEl("span", "famous-review-title", "포진 판정 검수 (로컬 전용)"));
  head.append(famousReviewButton("CSV", "famousReviewExport", { title: "검수 기록을 CSV로 내려받기" }, "famous-review-btn small"));
  box.append(head);
  box.append(famousReviewEl("div", "famous-review-progress", famousReviewProgressText()));

  const g = famousReviewIndex >= 0 ? famousAll()[famousReviewIndex] : null;
  if (!g || !g.key) {
    box.append(famousReviewEl("div", "famous-review-hint", "아래 목록에서 프로 대국을 누르면 판정 근거가 여기에 나옵니다."));
    const nav = famousReviewEl("div", "famous-review-row");
    nav.append(famousReviewButton("첫 미검수 기보 열기", "famousReviewNext", { "data-value": "todo" }));
    box.append(nav);
    return;
  }

  const r = famousRow(g);
  box.append(famousReviewEl("div", "famous-review-game", `${famousTitleWithYear(r)} · ${r.players}`));
  box.append(famousReviewEl("div", "famous-review-opening", g.opening || "포진 미상"));

  [["cho", "초"], ["han", "한"]].forEach(([side, label]) => {
    const w = g.why && g.why[side];
    const sec = famousReviewEl("div", "famous-review-side");
    sec.append(famousReviewEl("div", `famous-review-side-name ${side}`, `${label}: ${w ? w.name + (w.variant && w.variant !== "면 비움" ? ` (${w.variant})` : "") : "?"}`));
    famousReviewWhyLines(g, side).forEach(line => {
      const row = famousReviewEl("div", "famous-review-why");
      row.append(famousReviewEl("span", "", line.text));
      if (line.ply) row.append(famousReviewButton(`${line.ply}수로`, "famousReviewJump", { "data-num": line.ply }, "famous-review-btn small"));
      sec.append(row);
    });
    box.append(sec);
  });
  const mu = famousReviewMatchupLine(g);
  if (mu) box.append(famousReviewEl("div", "famous-review-why", mu));

  const rec = famousReviewRead()[g.key] || {};
  const verdicts = famousReviewEl("div", "famous-review-row");
  Object.entries(FAMOUS_REVIEW_VERDICTS).forEach(([v, label]) => {
    const b = famousReviewButton(label, "famousReviewSet", { "data-value": v, "aria-pressed": rec.v === v ? "true" : "false" }, `famous-review-btn verdict ${v}${rec.v === v ? " on" : ""}`);
    verdicts.append(b);
  });
  box.append(verdicts);

  const memo = famousReviewEl("input", "famous-review-memo");
  memo.type = "text";
  memo.id = "famous-review-memo";
  memo.placeholder = "메모 (예: 양상인데 귀마로 잡힘)";
  memo.value = rec.memo || "";
  memo.setAttribute("data-action", "famousReviewMemo");
  memo.setAttribute("aria-label", "검수 메모");
  box.append(memo);

  const nav = famousReviewEl("div", "famous-review-row");
  nav.append(famousReviewButton("다음 기보", "famousReviewNext", { "data-value": "any" }));
  nav.append(famousReviewButton("다음 미검수", "famousReviewNext", { "data-value": "todo" }));
  box.append(nav);
}

/** 프로 대국 데이터를 읽은 뒤 (famous-games.js loadFamousGameData) */
function famousReviewOnData() {
  famousReviewRender();
}

/** 유명 기보를 불러온 뒤 (famous-games.js loadFamousGame) */
function famousReviewShow(index) {
  if (!famousReviewEnabled()) return;
  famousReviewIndex = index;
  famousReviewRender();
}

/** 판정 근거 수로 가기 */
function famousReviewJump(num) {
  const step = parseInt(num, 10);
  if (!step || typeof pvRealGoTo !== "function") return;
  pvRealGoTo(step);
}

function famousReviewUpdate(patch) {
  const g = famousAll()[famousReviewIndex];
  if (!g || !g.key) return;
  const all = famousReviewRead();
  const rec = { ...(all[g.key] || {}), ...patch, t: new Date().toISOString() };
  if (!rec.v && !rec.memo) delete all[g.key];
  else all[g.key] = rec;
  famousReviewWrite(all);
}

/** 맞음·틀림·애매 (같은 것을 다시 누르면 해제) */
function famousReviewSet(value) {
  const g = famousAll()[famousReviewIndex];
  if (!g || !FAMOUS_REVIEW_VERDICTS[value]) return;
  const cur = (famousReviewRead()[g.key] || {}).v;
  famousReviewUpdate({ v: cur === value ? "" : value });
  famousReviewRender();
  renderFamousGames(); // 목록의 검수 표시
}

/** 메모 (입력할 때마다 저장. 검수 칸은 다시 그리지 않아 입력이 끊기지 않는다) */
function famousReviewMemo(value) {
  famousReviewUpdate({ memo: String(value || "").slice(0, 300) });
  const p = document.querySelector("#famous-review .famous-review-progress");
  if (p) p.textContent = famousReviewProgressText();
}

/** 지금 필터 목록에서 다음 기보 ("todo"면 검수 안 한 기보만) */
function famousReviewNext(mode) {
  const order = famousFilteredIndexes().filter(i => famousAll()[i] && famousAll()[i].key);
  if (!order.length) {
    if (typeof showToast === "function") showToast("필터에 맞는 프로 대국이 없습니다");
    return;
  }
  const recs = famousReviewRead();
  const start = order.indexOf(famousReviewIndex);
  for (let k = 1; k <= order.length; k++) {
    const idx = order[(start + k + order.length) % order.length];
    if (mode === "todo" && recs[famousAll()[idx].key] && recs[famousAll()[idx].key].v) continue;
    loadFamousGame(idx);
    return;
  }
  if (typeof showToast === "function") showToast("이 필터의 기보를 모두 검수했습니다");
}

/** 검수 기록을 CSV로 내려받는다 (엑셀에서 한글이 깨지지 않게 BOM을 붙인다) */
function famousReviewExport() {
  const recs = famousReviewRead();
  const q = v => `"${String(v === undefined || v === null ? "" : v).replace(/"/g, '""')}"`;
  const head = ["key", "대회", "회전", "연도", "초", "한", "포진", "초 판정", "초 근거", "한 판정", "한 근거", "검수", "메모", "검수 시각"];
  const rows = [head.map(q).join(",")];
  famousExtra.forEach(g => {
    const r = recs[g.key];
    if (!r) return;
    const why = side => famousReviewWhyLines(g, side).map(l => l.text).join(" / ");
    const name = side => (g.why && g.why[side] ? `${g.why[side].name}${g.why[side].variant ? ` (${g.why[side].variant})` : ""}` : "");
    rows.push([g.key, g.event, g.round, g.year, g.cho, g.han, g.opening, name("cho"), why("cho"), name("han"), why("han"),
      FAMOUS_REVIEW_VERDICTS[r.v] || "", r.memo || "", r.t || ""].map(q).join(","));
  });
  if (rows.length === 1) {
    if (typeof showToast === "function") showToast("내보낼 검수 기록이 없습니다");
    return;
  }
  const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `포진검수_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
