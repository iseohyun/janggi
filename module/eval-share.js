/**
 * @fileoverview 기보별 형세 분석 파일 (오른쪽 서랍 "AI" 영역 > "기보별 형세 분석 폴더").
 *  - 폴더: 사용자가 janggi-kibo-work 폴더를 한 번 고르면 그 안의 analysis 하위 폴더를 쓴다 (없으면 만든다).
 *    고른 폴더는 IndexedDB에 기억하지만, 브라우저를 다시 켜면 보안상 "다시 켜기"로 한 번 허락해야 한다 (Chrome·Edge).
 *  - 자동 저장: 기록(형세·추천수·가지)이 바뀌면 ES_SAVE_DELAY_MS 뒤 지금 기보의 분석을
 *    "analysis/<기보 이름> (형세분석).json"에 쓴다. 같은 이름의 다른 기보·다른 사람 파일이 있으면 이름 뒤에 [식별값 8자]를 붙인다.
 *  - 같은 기보 찾기: 첫 배치 + 본선 수순으로 만든 식별값(gameHash)으로 찾는다. 이름이 달라도 같은 대국이면 찾고,
 *    이름이 같아도 다른 대국은 섞지 않는다.
 *  - 기보를 열 때: 폴더에서 같은 기보의 분석이 1개면 자동으로 가져오고, 2개 이상이면 목록 팝업에서 고른다
 *    (좋아요 → 정밀도 → 최신 순). 가져오기는 더 정교한 판단만 합치고, 지금 기보에 가지가 없으면 파일의 가지도 붙인다.
 *  - 좋아요(likes): 파일에 칸만 두고 정렬에 쓴다. 누르기·여러 사람 집계는 온라인 서비스(서버) 단계에서.
 *  - 파일 형식(kind "eval-analysis", version 1):
 *    { app, kind, version, gameHash, gameName, gameText, author:{id,name}, createdAt, updatedAt, likes,
 *      precision:{positions, avgDepth, at1s, at3s, at8s}, evals:[행], recs:[행], variations:[가지] }
 * 공개 함수: esMarkDirty(), chooseEvalShareFolder(), resumeEvalShareFolder(), stopEvalShareFolder(),
 *           esCheckCurrentGame(), esPickAnalysis(index), closeEvalSharePicker(), isEvalSharePickerOpen()
 * @module eval-share
 * @depends eval-history, eval-file, recommend, variation, record, ui
 */

const ES_SAVE_DELAY_MS = 8000;
const ES_DB_KEY = "shareDir"; // eval-file.js와 같은 IndexedDB 저장소를 쓴다
const ES_SUBDIR = "analysis";
const ES_TAG = "(형세분석)";

let esDir = null; // analysis 폴더 핸들
let esRoot = null; // 사용자가 고른 폴더 핸들
let esState = "off"; // "off" | "on" | "needs-permission" | "unsupported"
let esTimer = null;
let esWriting = false;
let esLastSaved = null; // { name, at: Date }
let esLastError = "";
let esPickList = []; // 팝업에 띄운 분석 목록

function esSupported() {
  return typeof window.showDirectoryPicker === "function";
}

// ===== 기보 식별값·이름 =====

/** 문자열 → 32비트 FNV-1a 16진수 8자 */
function esHash32(text, seed) {
  let h = seed >>> 0;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 지금 기보(첫 배치 + 본선 수순)의 식별값 16자 */
function esGameHash() {
  const base = JSON.stringify(variationBaseSignature());
  return esHash32(base, 2166136261) + esHash32(base, 0x9747b28c);
}

/** 기보 이름: 별명 → 대회명·대국정보 → 대국자 → "기보_식별값" */
function esGameName() {
  const m = typeof gameMetadata !== "undefined" && gameMetadata ? gameMetadata : {};
  const titled = [m.tournament, m.round].filter(Boolean).join(" ");
  const players = m.choPlayer || m.hanPlayer ? `${m.choPlayer || "초"} 대 ${m.hanPlayer || "한"}` : "";
  return (m.nickname || titled || players || `기보_${esGameHash().slice(0, 8)}`).trim();
}

/** 파일 이름에 못 쓰는 글자를 바꾼다 */
function esSafeName(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "기보";
}

/** 이 브라우저의 작성자 id (파일마다 누가 만든 분석인지 구분) */
function esClientId() {
  try {
    let id = localStorage.getItem("janggiClientId");
    if (!id) {
      id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("janggiClientId", id);
    }
    return id;
  } catch (e) {
    return "local";
  }
}

// ===== 파일 내용 =====

/** 지금 기보(본선 + 가지)의 국면들 */
function esGamePositions() {
  const map = new Map();
  ehLinePositions(null, log.length).forEach(p => map.set(p.key, p));
  getVariations().forEach(v => ehLinePositions(v.id, variationEndStep(v)).forEach(p => map.set(p.key, p)));
  return [...map.values()];
}

/** 지금 기보의 분석 파일 내용 (기록이 없으면 null) */
function esBuildAnalysis() {
  if (!log.length) return null;
  const positions = esGamePositions();
  const evals = [];
  const recs = [];
  let depthSum = 0;
  const at = { a1: 0, a3: 0, a8: 0 };
  positions.forEach(p => {
    const r = ehRates.get(p.key);
    if (r && r.src !== "builtin") {
      evals.push([ehCompactKey(p.key), Math.round(r.rate * 10000) / 10000, r.depth, r.mateWinner ? r.mateWinner[0] : "", r.ms || 0, r.at || 0]);
      depthSum += Math.min(r.depth, 40);
      if ((r.ms || 0) >= 1000) at.a1 += 1;
      if ((r.ms || 0) >= 3000) at.a3 += 1;
      if ((r.ms || 0) >= 8000) at.a8 += 1;
    }
    const c = recCache.get(p.key);
    if (c) recs.push([ehCompactKey(p.key), c.pass, c.results]);
  });
  if (!evals.length && !recs.length) return null;
  const now = new Date().toISOString();
  return {
    app: "janggi-web",
    kind: "eval-analysis",
    version: 1,
    gameHash: esGameHash(),
    gameName: esGameName(),
    gameText: typeof generateGameRecordText === "function" ? generateGameRecordText() : "",
    author: { id: esClientId(), name: "" },
    createdAt: now,
    updatedAt: now,
    likes: 0,
    precision: {
      positions: positions.length,
      analyzed: evals.length,
      avgDepth: evals.length ? Math.round(depthSum / evals.length) : 0,
      at1s: at.a1,
      at3s: at.a3,
      at8s: at.a8
    },
    evals,
    recs,
    variations: getVariations().map(v => ({ ...v }))
  };
}

// ===== 폴더 =====

async function esReadJson(fileHandle) {
  try {
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch (e) {
    return null;
  }
}

/** analysis 폴더의 형세 분석 파일들 [{name, handle, data}] */
async function esListFiles() {
  const out = [];
  if (!esDir) return out;
  for await (const [name, handle] of esDir.entries()) {
    if (handle.kind !== "file" || !name.toLowerCase().endsWith(".json")) continue;
    const data = await esReadJson(handle);
    if (data && data.kind === "eval-analysis" && typeof data.gameHash === "string") out.push({ name, handle, data });
  }
  return out;
}

/** 지금 기보의 내 분석을 쓸 파일 이름: 같은 기보·같은 작성자 파일이 있으면 그것, 없으면 새 이름 */
async function esTargetName(files, data) {
  const mine = files.find(f => f.data.gameHash === data.gameHash && f.data.author && f.data.author.id === data.author.id);
  if (mine) return { name: mine.name, createdAt: mine.data.createdAt, likes: mine.data.likes || 0 };
  const base = `${esSafeName(data.gameName)} ${ES_TAG}`;
  let name = `${base}.json`;
  if (files.some(f => f.name === name)) name = `${base} [${data.gameHash.slice(0, 8)}].json`;
  let n = 2;
  while (files.some(f => f.name === name)) name = `${base} [${data.gameHash.slice(0, 8)}-${n++}].json`;
  return { name, createdAt: data.createdAt, likes: 0 };
}

/** 기록이 바뀌었다: 폴더가 켜져 있으면 조금 뒤 지금 기보의 분석을 저장한다 */
function esMarkDirty() {
  if (esState !== "on" || !esDir) return;
  clearTimeout(esTimer);
  esTimer = setTimeout(esWriteCurrent, ES_SAVE_DELAY_MS);
}

async function esWriteCurrent() {
  if (!esDir || esWriting) return;
  const data = esBuildAnalysis();
  if (!data) return;
  esWriting = true;
  try {
    const files = await esListFiles();
    const target = await esTargetName(files, data);
    data.createdAt = target.createdAt || data.createdAt;
    data.likes = target.likes;
    const fh = await esDir.getFileHandle(target.name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(data));
    await w.close();
    esLastSaved = { name: target.name, at: new Date() };
    esLastError = "";
  } catch (err) {
    console.warn("[eval-share] 형세 분석 저장 실패:", err);
    esLastError = err.message || String(err);
    if (err && err.name === "NotAllowedError") esState = "needs-permission";
  } finally {
    esWriting = false;
    esRender();
  }
}

/** 고른 폴더에서 analysis 폴더를 연다 (고른 폴더가 analysis면 그대로) */
async function esOpenAnalysisDir(root) {
  if (root.name === ES_SUBDIR) return root;
  return root.getDirectoryHandle(ES_SUBDIR, { create: true });
}

/** "폴더 정하기": janggi-kibo-work 폴더를 고른다 */
async function chooseEvalShareFolder() {
  if (!esSupported()) {
    if (typeof showToast === "function") showToast("이 브라우저는 폴더에 저장할 수 없습니다 (Chrome·Edge에서 됩니다)", 3000);
    return;
  }
  let root;
  try {
    root = await window.showDirectoryPicker({ id: "janggi-kibo-work", mode: "readwrite" });
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.warn("[eval-share] 폴더 고르기 실패:", err);
    return;
  }
  await esUseFolder(root, true);
}

/** 폴더를 쓰기 시작 (테스트에서도 부른다) */
async function esUseFolder(root, remember) {
  try {
    esRoot = root;
    esDir = await esOpenAnalysisDir(root);
    esState = "on";
    if (remember && typeof efDbSetKey === "function") await efDbSetKey(ES_DB_KEY, root);
  } catch (err) {
    console.warn("[eval-share] 폴더 열기 실패:", err);
    esState = "off";
  }
  esRender();
  if (esState === "on") {
    await esWriteCurrent();
    await esCheckCurrentGame();
  }
}

/** 브라우저를 다시 켠 뒤 "다시 켜기" */
async function resumeEvalShareFolder() {
  if (!esRoot) return;
  try {
    const perm = await esRoot.requestPermission({ mode: "readwrite" });
    if (perm === "granted") {
      await esUseFolder(esRoot, false);
      return;
    }
  } catch (err) {
    console.warn("[eval-share] 허락 받기 실패:", err);
  }
  esRender();
}

/** "끄기": 폴더 저장·찾기를 멈춘다 (파일은 그대로) */
async function stopEvalShareFolder() {
  clearTimeout(esTimer);
  esDir = null;
  esRoot = null;
  esState = esSupported() ? "off" : "unsupported";
  if (typeof efDbSetKey === "function") {
    try {
      await efDbSetKey(ES_DB_KEY, null);
    } catch (e) {
      // 무시
    }
  }
  esRender();
}

// ===== 기보를 열 때: 같은 기보의 분석 찾기 =====

/** 분석 정렬: 좋아요 → 정밀도(평균 깊이·1초 이상 국면) → 최신 */
function esCompare(a, b) {
  const pa = a.data.precision || {};
  const pb = b.data.precision || {};
  return (b.data.likes || 0) - (a.data.likes || 0) ||
    (pb.avgDepth || 0) - (pa.avgDepth || 0) ||
    (pb.at1s || 0) - (pa.at1s || 0) ||
    String(b.data.updatedAt || "").localeCompare(String(a.data.updatedAt || ""));
}

/** 분석 파일 하나를 지금 기보에 합친다 */
function esApplyAnalysis(data) {
  const evals = Array.isArray(data.evals) && typeof ehMergeRows === "function" ? ehMergeRows(data.evals) : 0;
  const recs = Array.isArray(data.recs) && typeof recMergeRows === "function" ? recMergeRows(data.recs) : 0;
  let vars = 0;
  if (Array.isArray(data.variations) && data.variations.length && !getVariations().length) {
    const map = {};
    data.variations.forEach(v => {
      if (!Array.isArray(v.moves) || !v.moves.length) return;
      const parent = v.parentVarId ? map[v.parentVarId] : null;
      if (v.parentVarId && !parent) return;
      const nv = createVariation(v.parentStep, v.moves, v.source, v.label, parent || null);
      if (nv) {
        map[v.id] = nv.id;
        vars += 1;
      }
    });
    if (typeof pvRefresh === "function") pvRefresh();
  }
  return { evals, recs, vars };
}

function esApplyToast(data, result) {
  if (typeof showToast !== "function") return;
  showToast(`형세 분석을 가져왔습니다: ${data.gameName || "기보"} · 형세 ${result.evals} · 추천수 ${result.recs}${result.vars ? ` · 가지 ${result.vars}` : ""}`, 3500);
}

/** 지금 기보의 분석을 폴더에서 찾는다: 1개면 바로 가져오고, 2개 이상이면 목록 팝업 */
async function esCheckCurrentGame() {
  if (esState !== "on" || !esDir || !log.length) return;
  const hash = esGameHash();
  const files = (await esListFiles()).filter(f => f.data.gameHash === hash);
  if (!files.length) return;
  if (files.length === 1) {
    esApplyToast(files[0].data, esApplyAnalysis(files[0].data));
    return;
  }
  esPickList = files.sort(esCompare);
  esOpenPicker();
}

// ===== 목록 팝업 =====

/** ISO 시각 → 이 컴퓨터 시각 "YYYY-MM-DD HH:MM" */
function esLocalTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isEvalSharePickerOpen() {
  const m = document.getElementById("es-pick-modal");
  return !!m && !m.hidden;
}

function esOpenPicker() {
  const modal = document.getElementById("es-pick-modal");
  const list = document.getElementById("es-pick-list");
  if (!modal || !list) return;
  const title = document.getElementById("es-pick-title");
  if (title) title.textContent = `${esGameName()} — 형세 분석 ${esPickList.length}개`;
  list.replaceChildren();
  const me = esClientId();
  esPickList.forEach((f, idx) => {
    const d = f.data;
    const p = d.precision || {};
    const li = document.createElement("li");
    li.className = "es-pick-item";
    const info = document.createElement("div");
    info.className = "es-pick-info";
    const name = document.createElement("div");
    name.className = "es-pick-name";
    name.textContent = f.name.replace(/\.json$/i, "");
    const meta = document.createElement("div");
    meta.className = "es-pick-meta";
    const who = d.author && d.author.id === me ? "내 분석" : (d.author && d.author.name) || "다른 사람";
    const date = esLocalTime(d.updatedAt);
    meta.textContent = `♥ ${d.likes || 0} · ${who} · 평균 깊이 ${p.avgDepth || 0} · 1초↑ ${p.at1s || 0}/${p.positions || 0}국면${date ? ` · ${date}` : ""}`;
    info.append(name, meta);
    const btn = document.createElement("button");
    btn.className = "modal-btn save es-pick-btn";
    btn.setAttribute("data-action", "esPickAnalysis");
    btn.setAttribute("data-index", String(idx));
    btn.textContent = "가져오기";
    li.append(info, btn);
    list.appendChild(li);
  });
  modal.hidden = false;
  const first = list.querySelector(".es-pick-btn");
  if (first) first.focus();
}

/** 목록에서 고른 분석을 가져온다 */
function esPickAnalysis(index) {
  const f = esPickList[index];
  if (!f) return;
  closeEvalSharePicker();
  esApplyToast(f.data, esApplyAnalysis(f.data));
}

/** 목록 팝업 닫기 (가져오지 않음) */
function closeEvalSharePicker() {
  const modal = document.getElementById("es-pick-modal");
  if (modal) modal.hidden = true;
}

function handleEvalShareBackdrop(ev) {
  if (ev && ev.target && ev.target.id === "es-pick-modal") closeEvalSharePicker();
}

// ===== 화면 =====

function esRender() {
  const status = document.getElementById("es-status");
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !on;
  };
  const folder = esRoot && esRoot.name ? esRoot.name : "";
  let text = "";
  if (esState === "unsupported") text = "이 브라우저는 폴더에 저장할 수 없습니다 (Chrome·Edge에서 됩니다).";
  else if (esState === "off") text = "꺼짐 · janggi-kibo-work 폴더를 고르면 기보마다 형세 분석 파일을 analysis 폴더에 자동으로 저장하고, 기보를 열 때 찾아 붙입니다.";
  else if (esState === "needs-permission") text = `폴더 ${folder} · 브라우저를 다시 켜서 멈춤 — "다시 켜기"를 누르세요.`;
  else text = `저장 중: ${folder}/${ES_SUBDIR}${esLastSaved ? ` · ${esLastSaved.name} (${esLastSaved.at.toTimeString().slice(0, 8)})` : ""}`;
  if (esLastError && esState === "on") text += ` · 마지막 저장 실패: ${esLastError}`;
  if (status) status.textContent = text;
  show("es-choose-btn", esState === "off");
  show("es-resume-btn", esState === "needs-permission");
  show("es-stop-btn", esState === "on" || esState === "needs-permission");
}

document.addEventListener("DOMContentLoaded", async () => {
  const modal = document.getElementById("es-pick-modal");
  if (modal) document.documentElement.appendChild(modal);
  // 기보를 불러올 때(유명 기보·내 기보·클립보드) 같은 기보의 형세 분석을 폴더에서 찾는다
  if (typeof window.importRecordFromText === "function") {
    const orig = window.importRecordFromText;
    window.importRecordFromText = function () {
      const r = orig.apply(this, arguments);
      setTimeout(() => esCheckCurrentGame(), 300);
      return r;
    };
  }
  if (!esSupported()) {
    esState = "unsupported";
    esRender();
    return;
  }
  esRender();
  try {
    const root = typeof efDbGetKey === "function" ? await efDbGetKey(ES_DB_KEY) : null;
    if (!root) return;
    esRoot = root;
    const perm = await root.queryPermission({ mode: "readwrite" });
    if (perm === "granted") {
      esDir = await esOpenAnalysisDir(root);
      esState = "on";
    } else {
      esState = "needs-permission";
    }
  } catch (err) {
    esState = "off";
  }
  esRender();
});
