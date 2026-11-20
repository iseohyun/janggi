/**
 * @fileoverview 형세 기록을 파일로 저장하기 (오른쪽 서랍 "AI" 영역 맨 아래 "형세 기록 파일").
 *  - 형세 기록(eval-history.js)과 추천수 분석(recommend.js)은 원래 브라우저 저장소(localStorage)에 자동으로 남는다.
 *    이 모듈은 그것을 컴퓨터의 파일로도 남긴다: 다른 브라우저·컴퓨터로 옮기거나 브라우저 데이터를 지워도 되살릴 수 있게.
 *  - 자동 저장: "자동 저장 파일 정하기"로 파일을 한 번 고르면, 기록이 바뀔 때마다 EF_AUTOSAVE_DELAY_MS 뒤 그 파일에 덮어쓴다.
 *    Chrome·Edge의 파일 저장 기능(File System Access API)을 쓴다. 고른 파일은 IndexedDB에 기억하지만, 브라우저를 다시 켜면
 *    보안상 사용자가 한 번 "다시 켜기"를 눌러 허락해야 한다. 이 기능이 없는 브라우저는 수동 내려받기만 된다.
 *  - 수동 저장: "내려받기"로 지금 기록을 JSON 파일로 받는다. "불러오기"로 그런 파일을 다시 넣는다 (더 정교한 판단만 합친다).
 *  - 파일 형식: { app: "janggi-web", kind: "eval-history", version: 1, savedAt, evals: [...], recs: [...] }
 *    evals 행 = eval-history.js ehSerialize(), recs 행 = recommend.js recSerialize()
 * 공개 함수: efMarkDirty(), chooseEvalAutoSaveFile(), resumeEvalAutoSave(), stopEvalAutoSave(),
 *           downloadEvalHistory(), importEvalHistory()
 * @module eval-file
 * @depends eval-history, recommend, ui
 */

const EF_AUTOSAVE_DELAY_MS = 5000;
const EF_DB_NAME = "janggiEvalFile";
const EF_DB_STORE = "handles";
const EF_DB_KEY = "autosave";

let efHandle = null; // 자동 저장 파일
let efState = "off"; // "off" | "on" | "needs-permission" | "unsupported"
let efTimer = null;
let efLastSaved = null; // Date
let efLastError = "";
let efWriting = false;

function efSupported() {
  return typeof window.showSaveFilePicker === "function";
}

// ===== 파일 내용 =====

function efBuildData() {
  return {
    app: "janggi-web",
    kind: "eval-history",
    version: 1,
    savedAt: new Date().toISOString(),
    build: typeof BUILD_TAG !== "undefined" ? BUILD_TAG : "",
    evals: typeof ehSerialize === "function" ? ehSerialize() : [],
    recs: typeof recSerialize === "function" ? recSerialize() : []
  };
}

function efFileStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// ===== 수동 저장·불러오기 =====

/** "내려받기": 지금 형세 기록을 JSON 파일로 받는다 */
function downloadEvalHistory() {
  const data = efBuildData();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `janggi-eval-${efFileStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof showToast === "function") showToast(`형세 기록 ${data.evals.length}국면을 내려받았습니다`, 2500);
}

/** "불러오기": 내려받은 파일을 골라 지금 기록에 합친다 (더 정교한 판단만 덮어쓴다) */
function importEvalHistory() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.kind !== "eval-history" || !Array.isArray(data.evals)) {
        throw new Error("형세 기록 파일이 아닙니다");
      }
      const added = typeof ehMergeRows === "function" ? ehMergeRows(data.evals) : 0;
      const recAdded = typeof recMergeRows === "function" && Array.isArray(data.recs) ? recMergeRows(data.recs) : 0;
      if (typeof showToast === "function") {
        showToast(`불러왔습니다: 형세 ${added}국면 · 추천수 ${recAdded}국면을 새로 쓰거나 더 정교하게 고쳤습니다`, 3500);
      }
    } catch (err) {
      console.warn("[eval-file] 불러오기 실패:", err);
      if (typeof showToast === "function") showToast(`불러오지 못했습니다: ${err.message || err}`, 3500);
    }
  });
  input.click();
}

// ===== 자동 저장 =====

function efOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(EF_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(EF_DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB에 파일·폴더 핸들을 기억한다 (eval-share.js도 다른 열쇠로 쓴다). value가 null이면 지운다 */
async function efDbSetKey(key, value) {
  const db = await efOpenDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(EF_DB_STORE, "readwrite");
    if (value === null) tx.objectStore(EF_DB_STORE).delete(key);
    else tx.objectStore(EF_DB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function efDbGetKey(key) {
  const db = await efOpenDb();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(EF_DB_STORE, "readonly");
    const req = tx.objectStore(EF_DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

function efDbSet(value) {
  return efDbSetKey(EF_DB_KEY, value);
}

function efDbGet() {
  return efDbGetKey(EF_DB_KEY);
}

/** 기록이 바뀌었다 (eval-history.js·recommend.js가 저장할 때 부름). 자동 저장이 켜져 있으면 조금 뒤 파일에 쓴다 */
function efMarkDirty() {
  // 기보별 형세 분석 폴더도 (eval-share.js)
  if (typeof esMarkDirty === "function") esMarkDirty();
  if (efState !== "on" || !efHandle) return;
  clearTimeout(efTimer);
  efTimer = setTimeout(efWrite, EF_AUTOSAVE_DELAY_MS);
}

async function efWrite() {
  if (!efHandle || efWriting) return;
  efWriting = true;
  try {
    const w = await efHandle.createWritable();
    await w.write(JSON.stringify(efBuildData()));
    await w.close();
    efLastSaved = new Date();
    efLastError = "";
  } catch (err) {
    console.warn("[eval-file] 자동 저장 실패:", err);
    efLastError = err.message || String(err);
    // 허락이 풀렸으면 다시 켜기를 기다린다
    if (err && err.name === "NotAllowedError") efState = "needs-permission";
  } finally {
    efWriting = false;
    efRender();
  }
}

/** "자동 저장 파일 정하기": 저장할 파일을 고르고 바로 한 번 쓴다 */
async function chooseEvalAutoSaveFile() {
  if (!efSupported()) {
    if (typeof showToast === "function") showToast("이 브라우저는 자동 저장 파일을 쓸 수 없습니다. 내려받기를 쓰세요", 3000);
    return;
  }
  try {
    efHandle = await window.showSaveFilePicker({
      suggestedName: "janggi-eval.json",
      types: [{ description: "형세 기록 (JSON)", accept: { "application/json": [".json"] } }]
    });
  } catch (err) {
    if (err && err.name === "AbortError") return; // 고르지 않고 닫음
    console.warn("[eval-file] 파일 고르기 실패:", err);
    return;
  }
  try {
    await efDbSet(efHandle);
  } catch (e) {
    // 기억하지 못해도 이번 화면에서는 자동 저장
  }
  efState = "on";
  await efWrite();
}

/** 브라우저를 다시 켠 뒤 "다시 켜기": 기억해 둔 파일에 다시 쓰도록 허락을 받는다 */
async function resumeEvalAutoSave() {
  if (!efHandle) return;
  try {
    const perm = await efHandle.requestPermission({ mode: "readwrite" });
    if (perm === "granted") {
      efState = "on";
      await efWrite();
      return;
    }
  } catch (err) {
    console.warn("[eval-file] 허락 받기 실패:", err);
  }
  efRender();
}

/** "끄기": 자동 저장을 멈추고 기억한 파일을 잊는다 (파일은 그대로 남는다) */
async function stopEvalAutoSave() {
  clearTimeout(efTimer);
  efHandle = null;
  efState = efSupported() ? "off" : "unsupported";
  try {
    await efDbSet(null);
  } catch (e) {
    // 무시
  }
  efRender();
}

function efTimeText(d) {
  if (!d) return "";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 화면 갱신: 상태 글과 버튼 */
function efRender() {
  const status = document.getElementById("ef-status");
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !on;
  };
  const name = efHandle && efHandle.name ? efHandle.name : "";
  let text = "";
  if (efState === "unsupported") text = "이 브라우저는 자동 저장 파일을 쓸 수 없습니다 (Chrome·Edge에서 됩니다). 내려받기로 저장하세요.";
  else if (efState === "off") text = "자동 저장 꺼짐 · 브라우저 안에는 늘 자동으로 남습니다.";
  else if (efState === "needs-permission") text = `자동 저장 파일 ${name} · 브라우저를 다시 켜서 멈춤 — "다시 켜기"를 누르세요.`;
  else text = `자동 저장 중: ${name}${efLastSaved ? ` · ${efTimeText(efLastSaved)} 저장` : ""}`;
  if (efLastError && efState === "on") text += ` · 마지막 저장 실패: ${efLastError}`;
  if (status) status.textContent = text;
  show("ef-choose-btn", efState === "off");
  show("ef-resume-btn", efState === "needs-permission");
  show("ef-stop-btn", efState === "on" || efState === "needs-permission");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!efSupported()) {
    efState = "unsupported";
    efRender();
    return;
  }
  efRender();
  try {
    const handle = await efDbGet();
    if (!handle) return;
    efHandle = handle;
    const perm = await handle.queryPermission({ mode: "readwrite" });
    efState = perm === "granted" ? "on" : "needs-permission";
  } catch (err) {
    efState = "off";
  }
  efRender();
});
