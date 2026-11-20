/**
 * @fileoverview LLM 해설(오른쪽 서랍의 #ai-comment-section) 제어 모듈.
 * 요청 만들기(commentary-facts) → 공급자 고르기(commentary-providers) → 결과 표시 → 코멘트/총평 저장.
 * @module commentary
 * @depends state, ai, record, ui, commentary-facts, commentary-providers, (preview: 요청 버튼 → 두어보기 진입)
 */

var aiCommentController = null; // 진행 중인 해설의 AbortController
var aiCommentLastResult = null; // { kind, step, title, question, text }

function aiCommentEl(id) {
  return document.getElementById(id);
}

function getAICommentProviderPref() {
  const saved = localStorage.getItem("aiCommentProvider");
  return saved && (saved === "auto" || getCommentaryProvider(saved)) ? saved : "auto";
}

/** 해설 창을 엽니다 (툴바 버튼, 단축키 C). */
/** AI 해설 열기 (단축키 C): 오른쪽 서랍의 "AI" 영역(추천수·외통 알림·해설)으로 갑니다. 이름은 예전 모달 때 그대로 둔다. */
function openAICommentModal() {
  if (!aiCommentEl("ai-comment-section")) return;
  syncAICommentSettingsUI();
  updateAICommentStepLabel();
  if (typeof jumpToDrawerSection === "function") jumpToDrawerSection("rd-sec-ai");
  refreshAICommentProviderStatus();
}

/** AI 해설 닫기: 좁은 화면이면 오른쪽 서랍을 닫는다 (넓은 화면에서는 서랍이 고정). */
function closeAICommentModal() {
  hideSettingsPanel();
}

function updateAICommentStepLabel() {
  const label = aiCommentEl("ai-comment-step-label");
  if (label) label.textContent = `현재 ${cfCurrentStep()}수 / 전체 ${log.length}수`;
}

// ===== 공급자 설정 =====

function syncAICommentSettingsUI() {
  const providerSelect = aiCommentEl("ai-comment-provider-select");
  if (providerSelect) providerSelect.value = getAICommentProviderPref();

  const modelSelect = aiCommentEl("ai-comment-model-select");
  if (modelSelect && !modelSelect.options.length) {
    WEBLLM_MODELS.forEach(m => modelSelect.add(new Option(m.label, m.id)));
  }
  if (modelSelect) modelSelect.value = webLlmProvider.modelId();

  const portInput = aiCommentEl("ai-comment-port-input");
  if (portInput) portInput.value = localStorage.getItem("aiCommentBridgePort") || String(MCP_BRIDGE_DEFAULT_PORT);

  const pref = getAICommentProviderPref();
  const modelRow = aiCommentEl("ai-comment-model-row");
  const portRow = aiCommentEl("ai-comment-port-row");
  const mcpHelp = aiCommentEl("ai-comment-mcp-help");
  if (modelRow) modelRow.style.display = (pref === "webllm" || pref === "auto") ? "" : "none";
  if (portRow) portRow.style.display = (pref === "mcp" || pref === "auto") ? "" : "none";
  if (mcpHelp) mcpHelp.style.display = pref === "mcp" ? "" : "none";
}

function changeAICommentProvider(value) {
  localStorage.setItem("aiCommentProvider", value);
  syncAICommentSettingsUI();
  refreshAICommentProviderStatus();
}

function changeAICommentModel(value) {
  localStorage.setItem("aiCommentWebllmModel", value);
  refreshAICommentProviderStatus();
}

function changeAICommentBridgePort(value) {
  const port = parseInt(value, 10);
  if (port >= 1024 && port <= 65535) {
    localStorage.setItem("aiCommentBridgePort", String(port));
    refreshAICommentProviderStatus();
  }
}

async function refreshAICommentProviderStatus() {
  const statusEl = aiCommentEl("ai-comment-provider-status");
  if (!statusEl) return;
  statusEl.textContent = "공급자 확인 중…";
  statusEl.dataset.state = "checking";
  try {
    const { provider, status } = await resolveCommentaryProvider(getAICommentProviderPref());
    statusEl.textContent = provider ? `${provider.label}: ${status.detail}` : status.detail;
    statusEl.dataset.state = status.state;
  } catch (e) {
    statusEl.textContent = `공급자 확인 실패: ${e.message}`;
    statusEl.dataset.state = "unavailable";
  }
}

// ===== 해설 실행 =====

function setAICommentBusy(busy) {
  ["ai-comment-move-btn", "ai-comment-review-btn", "ai-comment-ask-btn"].forEach(id => {
    const el = aiCommentEl(id);
    if (el) el.disabled = busy;
  });
  const stopBtn = aiCommentEl("ai-comment-stop-btn");
  if (stopBtn) stopBtn.style.display = busy ? "" : "none";
  updateAICommentSaveButtons(busy);
}

function updateAICommentSaveButtons(busy) {
  const hasText = !!(aiCommentLastResult && aiCommentLastResult.text && aiCommentLastResult.text.trim());
  const commentBtn = aiCommentEl("ai-comment-save-comment-btn");
  const summaryBtn = aiCommentEl("ai-comment-save-summary-btn");
  const canComment = hasText && !busy && aiCommentLastResult.step > 0 && aiCommentLastResult.kind !== "review";
  const canSummary = hasText && !busy && aiCommentLastResult.kind === "review";
  if (commentBtn) commentBtn.style.display = canComment ? "" : "none";
  if (summaryBtn) summaryBtn.style.display = canSummary ? "" : "none";
}

function setAICommentStatus(text, progress) {
  const statusEl = aiCommentEl("ai-comment-run-status");
  if (statusEl) statusEl.textContent = text || "";
  const bar = aiCommentEl("ai-comment-progress");
  const fill = aiCommentEl("ai-comment-progress-fill");
  if (bar && fill) {
    if (typeof progress === "number" && progress >= 0) {
      bar.style.display = "";
      fill.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    } else {
      bar.style.display = "none";
    }
  }
}

function setAICommentOutput(text) {
  const out = aiCommentEl("ai-comment-output");
  if (out) out.textContent = text;
}

/**
 * @param {() => Promise<Object|null>|Object|null} buildRequest
 */
async function runAICommentary(buildRequest) {
  if (aiCommentController) return;
  const controller = new AbortController();
  aiCommentController = controller;
  aiCommentLastResult = null;
  updateAICommentStepLabel();
  setAICommentBusy(true);
  setAICommentOutput("");
  setAICommentStatus("엔진이 국면을 분석하는 중…", null);

  try {
    // 엔진 분석은 화면을 잠깐 멈추게 하므로, 상태 문구가 먼저 그려지도록 한 박자 쉽니다.
    await new Promise(r => setTimeout(r, 30));
    const request = await buildRequest(controller.signal);
    if (!request) {
      setAICommentStatus("해설할 수순이 없습니다. 먼저 수를 두거나 기보를 불러와 주세요.", null);
      return;
    }

    const { provider, status } = await resolveCommentaryProvider(getAICommentProviderPref());
    if (!provider || status.state === "unavailable") {
      setAICommentStatus(status.detail, null);
      return;
    }
    if (status.state === "download" && provider.id === "webllm" &&
        !confirm(`웹 내장 AI 모델을 처음 내려받습니다.\n${WEBLLM_MODELS.find(m => m.id === webLlmProvider.modelId()).label}\n와이파이 환경에서 진행해 주세요. 계속할까요?`)) {
      setAICommentStatus("내려받기를 취소했습니다.", null);
      return;
    }

    const result = { kind: request.kind, step: request.step, title: request.title, question: request.question || "", text: "" };
    aiCommentLastResult = result;
    const text = await provider.generate(request, {
      signal: controller.signal,
      onText: full => {
        result.text = full;
        setAICommentOutput(full);
      },
      onStatus: (msg, progress) => setAICommentStatus(msg, progress)
    });
    result.text = (text || result.text || "").trim();
    setAICommentOutput(result.text || "(빈 응답)");
    setAICommentStatus(`${request.title} · ${provider.label}`, null);
  } catch (e) {
    if (e && e.name === "AbortError") {
      setAICommentStatus("중지했습니다.", null);
    } else {
      console.error("[AI Commentary]", e);
      setAICommentStatus(`해설 실패: ${e && e.message ? e.message : e}`, null);
    }
  } finally {
    aiCommentController = null;
    setAICommentBusy(false);
    refreshAICommentProviderStatus();
  }
}

function requestAIMoveCommentary() {
  if (typeof enterPreviewFromCommentary === "function") enterPreviewFromCommentary(); // 두어보기 진입 (preview.js)
  runAICommentary(signal => buildMoveCommentaryRequest(signal));
}

function requestAIReviewCommentary() {
  if (typeof enterPreviewFromCommentary === "function") enterPreviewFromCommentary(); // 두어보기 진입 (preview.js)
  runAICommentary(signal => buildReviewCommentaryRequest(
    (done, total) => setAICommentStatus(`엔진이 기보 전체를 분석하는 중… (${done}/${total} 국면)`, done / total),
    signal
  ));
}

function requestAIQuestionCommentary() {
  const input = aiCommentEl("ai-comment-question-input");
  const question = input ? input.value.trim() : "";
  if (!question) {
    showToast("질문을 입력해 주세요.");
    if (input) input.focus();
    return;
  }
  if (typeof enterPreviewFromCommentary === "function") enterPreviewFromCommentary(); // 두어보기 진입 (preview.js)
  runAICommentary(signal => buildQuestionCommentaryRequest(question, signal));
}

/** 질문 입력칸에서 Enter로 바로 묻기 */
function handleAICommentQuestionKey(e) {
  if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    requestAIQuestionCommentary();
  }
}

function stopAICommentary() {
  if (aiCommentController) aiCommentController.abort();
}

// ===== 저장 =====

/** 기보 텍스트의 코멘트는 (괄호) 안에 한 줄로 들어가므로 괄호·줄바꿈을 바꿉니다. */
function sanitizeForRecordComment(text) {
  return text.replace(/\(/g, "（").replace(/\)/g, "）").replace(/\s*\r?\n\s*/g, " ").trim();
}

function saveAICommentToStepComment() {
  const r = aiCommentLastResult;
  if (!r || !r.text || r.step <= 0 || !log[r.step - 1]) return;
  const body = r.kind === "question" ? `Q. ${r.question} A. ${r.text}` : r.text;
  const clean = sanitizeForRecordComment(`[AI] ${body}`);
  const existing = log[r.step - 1].comment || "";
  if (existing.trim() && !confirm(`${r.step}수에 이미 코멘트가 있습니다. AI 해설로 바꿀까요?\n\n기존: ${existing.slice(0, 120)}`)) return;

  log[r.step - 1].comment = clean;
  const formInput = document.getElementById("current-step-comment");
  if (formInput && cfCurrentStep() === r.step) formInput.value = clean;
  updateCommentBubble();
  const recordBox = document.getElementById("record-box");
  if (recordBox && recordBox.style.display === "flex") updateRecordUI();
  showToast(`${r.step}수 코멘트에 AI 해설을 저장했습니다.`);
}

function saveAICommentToSummary() {
  const r = aiCommentLastResult;
  if (!r || !r.text || r.kind !== "review") return;
  if (gameMetadata.summary && gameMetadata.summary.trim() &&
      !confirm("이미 총평이 있습니다. AI 복기로 바꿀까요?")) return;
  gameMetadata.summary = `[AI 복기] ${r.text}`;
  updateMetadataFormFromState();
  updateMetadataDisplay();
  showToast("AI 복기를 기보 총평에 저장했습니다.");
}

async function copyAIMcpCommand() {
  const text = "장기 해설 의뢰 처리해줘";
  try {
    await navigator.clipboard.writeText(text);
    showToast("복사했습니다. 구독 중인 AI 앱에 붙여 넣어 주세요.");
  } catch (e) {
    showToast(`AI 앱에 이렇게 말해 주세요: ${text}`);
  }
}

// 질문 입력칸 Enter 처리 (dispatcher는 input 이벤트만 다루므로 직접 연결)
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("ai-comment-question-input");
  if (input) input.addEventListener("keydown", handleAICommentQuestionKey);
});
