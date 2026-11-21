/**
 * @fileoverview 온라인 대국 중 AI 기능(추천수·위협 알림·형세 그래프) 끄고 켜기.
 *  - 대국이 시작되면 셋 다 끈다. 대국자가 하나를 켜면 채팅에 "초 대국자가 AI 추천수를 켰습니다" 같은 알림이 간다.
 *  - 대국이 끝나면(또는 방을 나가면) 막지 않는다. 방을 나가면 들어오기 전 추천수 설정으로 되돌린다.
 *  - 켜고 끈 상태는 방마다 이 탭에 남긴다(sessionStorage) → 새로고침해도 같은 상태, 알림도 다시 가지 않는다.
 *  - 추천수: recommend.js의 recommendAuto를 그대로 쓴다 (헤더 눈 버튼·AI 영역 체크도 이 규칙을 따른다).
 *    AI 훈수 한 수(requestAIHint)와 "다시 분석"도 추천수가 꺼져 있으면 막는다.
 *  - 위협 알림: threat-call.js의 tcOnMove를 감싸 꺼져 있으면 알리지 않는다.
 *  - 형세 그래프: 헤더 형세 줄을 가리고(css/online.css), 형세 계산(hgScheduleEval)·형세 흐름 창·변화도 색을 막는다.
 * 공개: olAi, olAiGated(), olSetAi(feature, on), olAiEnterRoom(id), olAiStartGame(), olAiEndGame(), olAiLeaveRoom()
 * @module online/online-ai
 * @depends online/online-core, recommend, threat-call, header-graph, eval-history
 */

const OL_AI_LABEL = { rec: "추천수", threat: "위협 알림", eval: "형세 그래프" };
const OL_AI_OBJ = { rec: "추천수를", threat: "위협 알림을", eval: "형세 그래프를" }; // 조사까지

var olAi = { rec: false, threat: false, eval: false };
let olAiSavedRec = null; // 방에 들어가기 전 추천수 보이기 설정
let olAiInternal = false; // 이 파일이 setRecommendAuto를 부르는 중 (알림 보내지 않음)

/** 지금 AI 기능을 막아야 하는지 (대국 중) */
function olAiGated() {
  return typeof olGameActive === "function" && olGameActive();
}

function olAiKey() {
  return `olAi_${olRoomId || ""}`;
}

function olAiSave() {
  try {
    sessionStorage.setItem(olAiKey(), JSON.stringify(olAi));
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

function olAiApplyEvalClass() {
  document.documentElement.classList.toggle("ol-eval-off", olAiGated() && !olAi.eval);
}

function olAiSetRecommend(on) {
  if (typeof setRecommendAuto !== "function") return;
  if (typeof recommendAuto !== "undefined" && recommendAuto === on) return;
  olAiInternal = true;
  try {
    setRecommendAuto(on);
  } finally {
    olAiInternal = false;
  }
}

/**
 * AI 기능 하나를 켜거나 끈다. 대국 중에 켜면 상대에게 채팅 알림이 간다.
 * @param {"rec"|"threat"|"eval"} feature
 * @param {boolean} on
 */
function olSetAi(feature, on) {
  if (!(feature in olAi)) return;
  on = !!on;
  // 관전자는 대국 중 AI 도움을 켤 수 없다 (대국자에게 수를 알려 주는 것을 막고, 알릴 채팅도 없음)
  if (on && olSpectating && olAiGated()) {
    olToast("관전 중에는 대국이 끝날 때까지 AI 도움을 켤 수 없습니다.", 3000);
    olAi[feature] = false;
    if (feature === "rec") olAiSetRecommend(false);
    if (typeof olEmit === "function") olEmit("ai");
    return;
  }
  const changed = olAi[feature] !== on;
  olAi[feature] = on;
  if (feature === "rec") olAiSetRecommend(on);
  if (feature === "threat" && !on && typeof tcClear === "function") tcClear();
  if (feature === "eval") {
    olAiApplyEvalClass();
    if (on && typeof hgRefreshEval === "function") hgRefreshEval();
  }
  olAiSave();
  if (changed && on && olAiGated()) {
    olSystem(`${olSideName(olMySide)} 대국자가 AI ${OL_AI_OBJ[feature]} 켰습니다.`);
  }
  if (typeof olEmit === "function") olEmit("ai");
}

function olAiEnterRoom(id) {
  if (olAiSavedRec === null && typeof recommendAuto !== "undefined") olAiSavedRec = recommendAuto;
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(`olAi_${id}`) || "null");
  } catch (e) {
    saved = null;
  }
  olAi = Object.assign({ rec: false, threat: false, eval: false }, saved || {});
}

/** 대국이 시작되거나 대국 중인 방에 다시 들어왔을 때 */
function olAiStartGame() {
  olAiSetRecommend(olAi.rec);
  if (!olAi.threat && typeof tcClear === "function") tcClear();
  olAiApplyEvalClass();
  if (typeof olEmit === "function") olEmit("ai");
}

/** 대국이 끝나면 막지 않는다 (켜고 끄는 것은 사용자가) */
function olAiEndGame() {
  olAiApplyEvalClass();
  if (typeof hgRefreshEval === "function") hgRefreshEval();
  if (typeof olEmit === "function") olEmit("ai");
}

function olAiLeaveRoom() {
  if (olAiSavedRec !== null) olAiSetRecommend(olAiSavedRec);
  olAiSavedRec = null;
  olAi = { rec: false, threat: false, eval: false };
  document.documentElement.classList.remove("ol-eval-off");
  if (typeof hgRefreshEval === "function") hgRefreshEval();
}

document.addEventListener("DOMContentLoaded", () => {
  const wrap = typeof olWrap === "function" ? olWrap : null;
  if (!wrap) return;
  const blocked = feature => {
    if (!olAiGated() || olAi[feature]) return false;
    olToast(`온라인 대국 중에는 꺼져 있습니다. 온라인 대국 영역에서 AI ${OL_AI_OBJ[feature]} 켜면 상대에게 알림이 갑니다.`, 3500);
    return true;
  };

  // 추천수: 헤더 눈 버튼·AI 영역 체크 상자 모두 setRecommendAuto를 거친다
  wrap("setRecommendAuto", orig => function (checked) {
    const r = orig.apply(this, arguments);
    if (!olAiInternal && olRoomId) olSetAi("rec", !!checked);
    return r;
  });
  wrap("refreshRecommendations", orig => function () {
    if (blocked("rec")) return;
    return orig.apply(this, arguments);
  });
  wrap("requestAIHint", orig => function () {
    if (blocked("rec")) return;
    return orig.apply(this, arguments);
  });

  // 위협 알림
  wrap("tcOnMove", orig => function () {
    if (olAiGated() && !olAi.threat) return;
    return orig.apply(this, arguments);
  });

  // 형세 그래프
  wrap("hgScheduleEval", orig => function () {
    if (olAiGated() && !olAi.eval) return;
    return orig.apply(this, arguments);
  });
  wrap("openEvalChart", orig => function () {
    if (blocked("eval")) return;
    return orig.apply(this, arguments);
  });
  wrap("ehTreeFlags", orig => function () {
    if (olAiGated() && !olAi.eval) return new Map();
    return orig.apply(this, arguments);
  });
});
