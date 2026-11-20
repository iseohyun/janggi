/**
 * @fileoverview 유명 기보 목록 (왼쪽 서랍 "저장된 기보" 영역 아래). 누르면 그 기보를 불러온다 (record.js importRecordFromText).
 * - 기보 글은 앱의 기보 텍스트 형식 그대로 둔다 (상차림·대국자·대회명·대국정보 + "N. 초 79졸78" 수순).
 * - 수순은 사실 정보로 보고 해설은 넣지 않는다. 출처는 각 항목의 source에 적는다.
 * - 다른 기보를 더하려면 FAMOUS_GAMES에 같은 꼴로 넣는다.
 * - 프로 대국 묶음은 data/famous-games.json(있을 때만)에서 읽어 FAMOUS_GAMES 뒤에 붙인다. 파일이 없거나 file://로 열면 내장 기보만 보인다.
 *   형식: {games:[{id, event, round, year, date, cho, han, opening, layout:[초,한], n, result, srcPath, m:"79졸78 41병42 ..."}]}
 *   기보 글은 famousGameText가 수순(m)으로 만든다. 만드는 곳: 저장소 밖 작업 폴더 scripts/build-famous.mjs
 * - 검색·필터: 검색어(대회명·대국자명), 포진, 연도. 맞는 기보를 FAMOUS_PAGE개씩 보여 주고 "더 보기"로 늘린다.
 *   기보가 FAMOUS_FILTER_MIN개 이상일 때만 필터 줄을 보인다.
 * - "저장된 기보" 영역은 두 묶음: 내 기보(직접 저장하거나 불러온 대국, 위) / 유명 기보(아래). 묶음 머리를 누르면 접힌다
 *   (toggleRecordGroup, localStorage "recordGroupCollapsed_<묶음>"). 내 기보가 없으면 그 묶음은 숨긴다 (syncRecordGroups).
 * @module famous-games
 * @depends record, ui
 */

const FAMOUS_GAMES = [
  {
    id: "2007-myungin-final-1",
    title: "제15회 명인전 결승 제1국",
    year: 2007,
    players: "김기영 3단 vs 황문수 9단",
    event: "제15회 명인전",
    cho: "김기영 3단",
    han: "황문수 9단",
    opening: "귀마 대 귀마 (엇상)",
    moves: 139,
    result: "외통",
    source: "janggi.pl 보관본 (Wayback 2017-01), 원본 오타 8곳 보정",
    text: "상차림: 초하(마상마상) vs 한상(마상마상)\n초나라: 김기영 3단\n한나라: 황문수 9단\n대회명: 제15회 명인전\n대국정보: 결승 제1국 (2007)\n총평: 원본은 janggi.pl 보관본(Antonio Barra 입력). 원본 오타 8곳을 앞뒤 수순에 맞춰 보정했고, 해설은 넣지 않음\n\n1. 초 79졸78\n2. 한 41병42\n3. 초 02마83\n4. 한 12마33\n5. 초 82포85\n6. 한 32포35\n7. 초 75졸74\n8. 한 17마36\n9. 초 03상75\n10. 한 45병46\n11. 초 08상76\n12. 한 13상45\n13. 초 04사94\n14. 한 25궁26\n15. 초 06사96\n16. 한 11차51\n17. 초 77졸67\n18. 한 16사25\n19. 초 07마86\n20. 한 35포15\n21. 초 09차99\n22. 한 38포35\n23. 초 88포68\n24. 한 45상73\n25. 초 74졸73\n26. 한 51차56\n27. 초 01차07\n28. 한 33마45\n29. 초 95궁06\n30. 한 15포13\n31. 초 71졸72\n32. 한 13포17\n33. 초 73졸74\n34. 한 43병53\n35. 초 78졸77\n36. 한 26궁16\n37. 초 68포62\n38. 한 14사24\n39. 초 62포02\n40. 한 42병52\n41. 초 96사95\n42. 한 47병48\n43. 초 76상48 (장군)\n44. 한 49병48\n45. 초 99차19\n46. 한 17포19\n47. 초 72졸73\n48. 한 19포17\n49. 초 07차09\n50. 한 16궁15\n51. 초 06궁05\n52. 한 48병47\n53. 초 09차29\n54. 한 17포13\n55. 초 02포06\n56. 한 56차58\n57. 초 29차27\n58. 한 58차48\n59. 초 83마71\n60. 한 48차49\n61. 초 67졸66\n62. 한 13포16\n63. 초 66졸56\n64. 한 49차59\n65. 초 77졸67\n66. 한 15궁14\n67. 초 05궁04\n68. 한 16포34\n69. 초 71마83\n70. 한 53병54\n71. 초 56졸46\n72. 한 47병46\n73. 초 85포05\n74. 한 52병53\n75. 초 67졸57\n76. 한 34포16\n77. 초 75상07\n78. 한 59차69\n79. 초 57졸47\n80. 한 45마66\n81. 초 47졸37\n82. 한 36마15\n83. 초 27차17\n84. 한 16포34\n85. 초 17차18\n86. 한 53병63\n87. 초 18차48\n88. 한 46병47\n89. 초 48차98\n90. 한 54병53\n91. 초 06포84\n92. 한 63병73\n93. 초 74졸73\n94. 한 66마54\n95. 초 86마65\n96. 한 54마73\n97. 초 65마73\n98. 한 69차63\n99. 초 98차78\n100. 한 53병54\n101. 초 83마71\n102. 한 63차53\n103. 초 71마52\n104. 한 54병64\n105. 초 05포03\n106. 한 64병63\n107. 초 78차58\n108. 한 53차23\n109. 초 58차68\n110. 한 25사26\n111. 초 03포63\n112. 한 14궁25\n113. 초 63포03\n114. 한 23차21\n115. 초 03포05\n116. 한 15마23\n117. 초 73마54\n118. 한 24사14\n119. 초 54마35\n120. 한 23마35\n121. 초 68차65\n122. 한 25궁16\n123. 초 65차35\n124. 한 14사25\n125. 초 35차45\n126. 한 21차51\n127. 초 07상75\n128. 한 47병57\n129. 초 45차48\n130. 한 16궁15\n131. 초 75상43 (장군)\n132. 한 15궁14\n133. 초 48차44\n134. 한 14궁24\n135. 초 43상11\n136. 한 51차11\n137. 초 44차34 (장군)\n138. 한 24궁34\n139. 초 52마44 (외통)\n"
  }
];

/** 묶음 머리: 내 기보 / 유명 기보 접기·펴기 */
function toggleRecordGroup(group) {
  const box = document.getElementById(`record-group-${group}`);
  if (!box) return;
  const collapsed = !box.classList.contains("collapsed");
  recordGroupSetCollapsed(group, collapsed);
  try {
    localStorage.setItem(`recordGroupCollapsed_${group}`, collapsed ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

function recordGroupSetCollapsed(group, collapsed) {
  const box = document.getElementById(`record-group-${group}`);
  if (!box) return;
  box.classList.toggle("collapsed", collapsed);
  const head = box.querySelector(".record-group-head");
  if (head) head.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

/**
 * 내 기보 묶음을 기보 수에 맞춥니다 (record.js updateSavedRecordsListUI가 부름).
 * @param {number} count - 내 기보 수
 */
function syncRecordGroups(count) {
  const mine = document.getElementById("record-group-mine");
  if (mine) mine.hidden = count === 0;
  const mineCount = document.getElementById("record-group-mine-count");
  if (mineCount) mineCount.textContent = count ? String(count) : "";
  const famousCount = document.getElementById("record-group-famous-count");
  if (famousCount) famousCount.textContent = String(famousAll().length);
}

// ===== 프로 대국 묶음 (data/famous-games.json) =====
const FAMOUS_DATA_URL = "data/famous-games.json";
const FAMOUS_PAGE = 30; // 한 번에 보이는 줄 수
const FAMOUS_FILTER_MIN = 5; // 이보다 적으면 필터 줄을 숨긴다
let famousExtra = []; // 파일에서 읽은 기보
const famousFilter = { q: "", opening: "", year: "" };
let famousShown = FAMOUS_PAGE;

/** 내장 기보 + 파일 기보 */
function famousAll() {
  return FAMOUS_GAMES.concat(famousExtra);
}

/** 파일 기보 한 판의 기보 글 (record.js importRecordFromText가 읽는 형식) */
function famousGameText(g) {
  if (g.text) return g.text;
  const info = [g.round, g.date || (g.year ? String(g.year) : "")].filter(Boolean).join(" · ") || "미상";
  const moves = (g.m || "").split(" ").filter(Boolean).map((m, k) => `${k + 1}. ${k % 2 === 0 ? "초" : "한"} ${m}`);
  return [
    `상차림: 초하(${g.layout[0]}) vs 한상(${g.layout[1]})`,
    `초나라: ${g.cho}`,
    `한나라: ${g.han}`,
    `대회명: ${g.event}`,
    `대국정보: ${info}`,
    `총평: 출처 장기도사 기보 자료실(${g.srcPath || "홈페이지 기보"}). 결과 ${g.result}. 해설은 넣지 않음`,
    "",
    ...moves
  ].join("\n") + "\n";
}

/** 목록 줄에 쓰는 값 (내장 기보와 파일 기보의 이름 차이를 맞춘다) */
function famousRow(g) {
  return {
    title: g.title || [g.event, g.round].filter(Boolean).join(" "),
    year: g.year || null,
    players: g.players || `${g.cho} vs ${g.han}`,
    moves: g.moves || g.n,
    result: g.result,
    opening: g.opening || "",
    source: g.source || "장기도사 기보 자료실 (janggidosa.co.kr)"
  };
}

/** "2010 제3회 ..."처럼 연도를 앞에 붙인다. 대회명에 이미 그 연도가 있으면 붙이지 않는다 */
function famousTitleWithYear(r) {
  if (!r.year || r.title.includes(String(r.year))) return r.title;
  return `${r.year} ${r.title}`;
}

function famousMatches(g) {
  const f = famousFilter;
  if (f.opening && g.opening !== f.opening) return false;
  if (f.year && String(g.year || "미상") !== f.year) return false;
  if (f.q) {
    const hay = [g.title, g.event, g.round, g.players, g.cho, g.han].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, "");
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every(w => hay.includes(w))) return false;
  }
  return true;
}

/** 필터 줄의 포진·연도 고르기 칸을 지금 기보로 채운다 */
function famousFillFilterOptions() {
  const all = famousAll();
  const bar = document.getElementById("famous-filter");
  if (bar) bar.hidden = all.length < FAMOUS_FILTER_MIN;
  const fill = (id, label, values, current) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.replaceChildren(new Option(label, ""));
    values.forEach(([v, n]) => sel.add(new Option(`${v} (${n})`, v)));
    sel.value = values.some(([v]) => v === current) ? current : "";
  };
  const count = key => {
    const m = new Map();
    all.forEach(g => {
      const v = key(g);
      if (v) m.set(v, (m.get(v) || 0) + 1);
    });
    return [...m];
  };
  fill("famous-filter-opening", "포진 전체", count(g => g.opening).sort((a, b) => b[1] - a[1]), famousFilter.opening);
  fill("famous-filter-year", "연도 전체", count(g => String(g.year || "미상")).sort((a, b) => (b[0] === "미상" ? -1 : a[0] === "미상" ? 1 : +b[0] - +a[0])), famousFilter.year);
}

/** 유명 기보 목록을 그립니다 (필터를 거친 앞 famousShown개). */
function renderFamousGames() {
  const list = document.getElementById("famous-games-list");
  if (!list) return;
  list.replaceChildren();
  const all = famousAll();
  const hits = [];
  all.forEach((g, idx) => {
    if (famousMatches(g)) hits.push(idx);
  });
  hits.slice(0, famousShown).forEach(idx => {
    const r = famousRow(all[idx]);
    const li = document.createElement("li");
    li.className = "famous-game-item";
    li.setAttribute("data-action", "loadFamousGame");
    li.setAttribute("data-index", String(idx));
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    li.title = `${r.title}${r.year ? ` (${r.year})` : ""} · ${r.players} · ${r.moves}수 ${r.result}${r.opening ? `\n포진: ${r.opening}` : ""}\n출처: ${r.source}\n누르면 이 기보를 불러옵니다`;
    const title = document.createElement("span");
    title.className = "famous-game-title";
    title.textContent = famousTitleWithYear(r);
    const meta = document.createElement("span");
    meta.className = "famous-game-meta";
    meta.textContent = `${r.players} · ${r.moves}수 ${r.result}`;
    li.append(title, meta);
    if (r.opening) {
      const op = document.createElement("span");
      op.className = "famous-game-opening";
      op.textContent = r.opening;
      li.appendChild(op);
    }
    list.appendChild(li);
  });
  if (!hits.length) {
    const empty = document.createElement("li");
    empty.className = "famous-games-empty";
    empty.textContent = "조건에 맞는 기보가 없습니다";
    list.appendChild(empty);
  }
  const status = document.getElementById("famous-filter-status");
  if (status) status.textContent = hits.length === all.length ? `${all.length}국` : `${hits.length} / ${all.length}국`;
  const more = document.getElementById("famous-more");
  if (more) {
    more.hidden = hits.length <= famousShown;
    more.textContent = `더 보기 (${Math.max(0, hits.length - famousShown)}국 남음)`;
  }
}

/** 검색어 칸 (대회명·대국자명) */
function setFamousQuery(value) {
  famousFilter.q = String(value || "").trim();
  famousShown = FAMOUS_PAGE;
  renderFamousGames();
}

/** 포진 고르기 */
function setFamousOpening(value) {
  famousFilter.opening = value || "";
  famousShown = FAMOUS_PAGE;
  renderFamousGames();
}

/** 연도 고르기 ("미상" = 연도 모름) */
function setFamousYear(value) {
  famousFilter.year = value || "";
  famousShown = FAMOUS_PAGE;
  renderFamousGames();
}

/** 필터 비우기 */
function resetFamousFilter() {
  famousFilter.q = "";
  famousFilter.opening = "";
  famousFilter.year = "";
  famousShown = FAMOUS_PAGE;
  const q = document.getElementById("famous-filter-q");
  if (q) q.value = "";
  famousFillFilterOptions();
  renderFamousGames();
}

/** 더 보기 */
function showMoreFamousGames() {
  famousShown += FAMOUS_PAGE;
  renderFamousGames();
}

/** data/famous-games.json을 읽어 목록에 붙인다. 없으면 조용히 내장 기보만 쓴다 */
async function loadFamousGameData() {
  try {
    const res = await fetch(FAMOUS_DATA_URL, { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.games)) return;
    famousExtra = data.games.filter(g => g && g.m && Array.isArray(g.layout));
  } catch (e) {
    return; // 파일 없음, file:// 등
  }
  famousFillFilterOptions();
  renderFamousGames();
  if (typeof getSavedRecords === "function") syncRecordGroups(getSavedRecords().length);
}

/**
 * 유명 기보 하나를 불러옵니다 (지금 판은 바뀐다).
 * @param {number} index - famousAll()에서의 위치
 */
function loadFamousGame(index) {
  const g = famousAll()[index];
  if (!g || typeof importRecordFromText !== "function") return;
  importRecordFromText(famousGameText(g));
  const r = famousRow(g);
  if (typeof showToast === "function") showToast(`${famousTitleWithYear(r)}을(를) 불러왔습니다`);
}

document.addEventListener("DOMContentLoaded", () => {
  famousFillFilterOptions();
  renderFamousGames();
  ["mine", "famous"].forEach(group => {
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(`recordGroupCollapsed_${group}`) === "1";
    } catch (e) {
      collapsed = false;
    }
    recordGroupSetCollapsed(group, collapsed);
  });
  if (typeof getSavedRecords === "function") syncRecordGroups(getSavedRecords().length);
  loadFamousGameData();
});
