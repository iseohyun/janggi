/**
 * @fileoverview 한수쉼 (pass-turn.js)
 * 차례인 쪽이 수를 두지 않고 차례를 넘긴다.
 *  - 기보에는 궁이 제자리로 가는 수 {i: 궁, x, y: 지금 자리, t: NO_PIECE}로 남긴다.
 *    (Fairy-Stockfish 장기 변형의 한수쉼 표기와 같은 꼴이라 수순·되돌리기·가지·반복 계산이 그대로 동작한다)
 *  - 하는 방법: 헤더 "한수쉼" 버튼, 단축키 `,`(keyboard.js passTurn), 궁을 고른 뒤 그 궁을 다시 누르기.
 *    궁을 고르면 궁 위에 "한수쉼" 표시가 뜨고, 그 표시를 눌러도 된다.
 *  - 장군을 받고 있으면 한수쉼할 수 없다.
 *  - 초와 한이 잇달아 한수쉼하면 대국이 끝난다 (game-rules.js: 카장룰은 기물 점수 높은 쪽 승, 또는 비김).
 * 공개 함수: passTurn(), canPassWithKing(i), isPassMove(step)
 * @module pass-turn
 * @depends state, rules, board, ai, main, preview, ui
 */

const PT_HINT_CLASS = "pass-hint";

function ptCurrentTeam() {
  const turnEl = document.getElementById("turn");
  const step = turnEl ? parseInt(turnEl.value, 10) : log.length;
  return ((isNaN(step) ? log.length : step) % 2 === 0) ? "cho" : "han";
}

/** team의 궁 번호 (아래쪽 진영이 0, 위쪽이 16) */
function ptKingOf(team) {
  return ((team === "cho") === iAmCho) ? 0 : 16;
}

function ptExploring() {
  const inPreview = typeof isPreviewActive === "function" && isPreviewActive();
  const reviewing = typeof pvReviewingPast === "function" && pvReviewingPast();
  return inPreview || reviewing;
}

/** 지금 한수쉼할 수 없는 까닭 (할 수 있으면 "") */
function ptBlockReason() {
  if (gameEnded && !ptExploring()) return "대국이 끝났습니다.";
  if (typeof boardAnimating !== "undefined" && boardAnimating) return "";
  const team = ptCurrentTeam();
  const king = ptKingOf(team);
  if (!pieces[king] || pieces[king].x === 0) return "궁이 없습니다.";
  if (aiMode === 1 && typeof isAITeam === "function" && isAITeam(team) && !ptExploring()) return "AI 차례에는 한수쉼할 수 없습니다.";
  if (typeof isKingInCheck === "function" && isKingInCheck(team)) return "장군을 받고 있어 한수쉼할 수 없습니다.";
  return "";
}

/** 궁 i를 고른 상태에서 한수쉼할 수 있는지 (차례인 쪽의 궁일 때만) */
function canPassWithKing(i) {
  if (i !== 0 && i !== 16) return false;
  if (i !== ptKingOf(ptCurrentTeam())) return false;
  return ptBlockReason() === "";
}

/** 차례인 쪽이 한수쉼합니다. */
function passTurn() {
  const reason = ptBlockReason();
  if (reason) {
    if (typeof showToast === "function") showToast(reason);
    return;
  }
  const team = ptCurrentTeam();
  const king = ptKingOf(team);
  if (typeof clearCandiBox === "function") clearCandiBox();
  curSelect = NO_PIECE;
  move(king, pieces[king].x, pieces[king].y);
  if (typeof showToast === "function") showToast(`${team === "cho" ? "초" : "한"} 한수쉼`);
}

/** 본선 step번째 수(0부터)가 한수쉼인지 */
function isPassMove(step) {
  const m = log[step];
  if (!m || (m.i !== 0 && m.i !== 16) || m.t < NO_PIECE) return false;
  const before = whereWasIt(m.i, step - 1);
  return !!before && before.x === m.x && before.y === m.y;
}

// ===== 궁 위 "한수쉼" 표시 =====

function ptDrawHint(king) {
  const p = pieces[king];
  if (!p || p.x === 0) return;
  const ns = "http://www.w3.org/2000/svg";
  const c = getAxis(p.x, p.y);
  const fs = Math.max(10, unitSize * 0.24);
  const h = fs * 1.55;
  const w = fs * 3.9;
  let top = c.y - unitSize * 0.62 - h;
  if (top < 2) top = c.y + unitSize * 0.62;
  const maxX = typeof boardWidth === "number" ? boardWidth : Infinity;
  const cx = Math.min(Math.max(c.x, w / 2 + 2), maxX - w / 2 - 2);
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", PT_HINT_CLASS);
  g.setAttribute("role", "button");
  g.setAttribute("aria-label", "한수쉼");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", cx - w / 2);
  rect.setAttribute("y", top);
  rect.setAttribute("width", w);
  rect.setAttribute("height", h);
  rect.setAttribute("rx", h / 2);
  rect.setAttribute("class", "pass-hint-box");
  g.appendChild(rect);
  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", cx);
  text.setAttribute("y", top + h / 2);
  text.setAttribute("font-size", fs);
  text.setAttribute("class", "pass-hint-text");
  text.textContent = "한수쉼";
  g.appendChild(text);
  const tip = document.createElementNS(ns, "title");
  tip.textContent = "한수쉼 (궁을 한 번 더 누르거나 , 키)";
  g.appendChild(tip);
  g.addEventListener("click", e => {
    e.stopPropagation();
    passTurn();
  });
  svg.appendChild(g);
  candiBoxList.push(g); // 선택이 풀리면 clearCandiBox가 함께 지운다
}

document.addEventListener("DOMContentLoaded", () => {
  // 궁을 고르면 그 위에 "한수쉼" 표시
  const origSelected = window.selected;
  if (typeof origSelected === "function") {
    window.selected = function (i) {
      const r = origSelected.apply(this, arguments);
      if (curSelect === i && canPassWithKing(i)) ptDrawHint(i);
      return r;
    };
  }
  // 고른 궁을 한 번 더 누르면 한수쉼 (선택 해제 대신). 기물 onclick보다 먼저 받도록 캡처 단계에서 본다
  if (typeof svg !== "undefined" && svg) {
    svg.addEventListener("click", e => {
      const k = curSelect;
      if (k !== 0 && k !== 16) return;
      const el = pieces[k] && pieces[k].e;
      if (!el || !(e.target === el || el.contains(e.target))) return;
      if (!canPassWithKing(k)) return;
      e.stopPropagation();
      passTurn();
    }, true);
  }
});
