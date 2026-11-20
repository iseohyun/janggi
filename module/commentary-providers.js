/**
 * @fileoverview LLM 해설 공급자(Provider) 모음. 공급자는 모두 같은 모양을 가집니다.
 *   - id, label: 식별자와 화면 이름
 *   - check(): Promise<{ state: "ready"|"download"|"unavailable", detail: string }>
 *   - generate(request, handlers): Promise<string>
 *       request  = { kind, title, system, user, ... } (commentary-facts.js가 만든 요청)
 *       handlers = { onText(fullText), onStatus(text, progress0to1|null), signal: AbortSignal }
 * 새 공급자(예: 유료 중계 서버)는 COMMENTARY_PROVIDERS에 같은 모양으로 추가하면 됩니다.
 * @module commentary-providers
 */

const WEBLLM_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm";
const WEBLLM_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B (약 1GB, 빠름)" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 3B (약 2GB, 더 나은 해설)" }
];
const MCP_BRIDGE_DEFAULT_PORT = 17861;
const MCP_POLL_INTERVAL_MS = 1500;

function cpAbortError() {
  return new DOMException("중지됨", "AbortError");
}

function cpSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(cpAbortError());
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(cpAbortError());
      }, { once: true });
    }
  });
}

// ===== ① 시스템(브라우저) 내장 LLM: Chrome Prompt API (Gemini Nano 등) =====

const chromeBuiltinProvider = {
  id: "chrome",
  label: "브라우저 내장 AI (Chrome 등)",
  _options: null,

  /** 한국어 지정으로 먼저 시도하고, 안 되면 언어 지정 없이 시도합니다. */
  async _pickOptions() {
    if (typeof LanguageModel === "undefined") return { state: "unavailable", options: null };
    const candidates = [
      { expectedInputs: [{ type: "text", languages: ["ko", "en"] }], expectedOutputs: [{ type: "text", languages: ["ko"] }] },
      { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] }
    ];
    for (const options of candidates) {
      try {
        const state = await LanguageModel.availability(options);
        if (state && state !== "unavailable") return { state, options };
      } catch (e) {
        // 언어 조합을 지원하지 않으면 예외가 날 수 있음 → 다음 후보
      }
    }
    return { state: "unavailable", options: null };
  },

  async check() {
    if (typeof LanguageModel === "undefined") {
      return { state: "unavailable", detail: "이 브라우저에는 내장 AI(Prompt API)가 없습니다." };
    }
    const { state, options } = await this._pickOptions();
    this._options = options;
    const koreanOk = options && options.expectedOutputs[0].languages[0] === "ko";
    const langNote = koreanOk ? "" : " (한국어 출력 공식 지원 아님)";
    if (state === "available") return { state: "ready", detail: "바로 사용 가능" + langNote };
    if (state === "downloadable" || state === "downloading") return { state: "download", detail: "처음 사용 시 브라우저가 모델을 내려받습니다" + langNote };
    return { state: "unavailable", detail: "이 기기에서는 브라우저 내장 AI를 쓸 수 없습니다." };
  },

  async generate(request, { onText, onStatus, signal }) {
    if (!this._options) await this.check();
    if (!this._options) throw new Error("브라우저 내장 AI를 쓸 수 없습니다.");

    onStatus("브라우저 내장 AI 준비 중…", null);
    const session = await LanguageModel.create({
      ...this._options,
      initialPrompts: [{ role: "system", content: request.system }],
      signal,
      monitor(m) {
        m.addEventListener("downloadprogress", e => onStatus("브라우저가 AI 모델을 내려받는 중…", e.loaded));
      }
    });

    try {
      onStatus("해설 작성 중…", null);
      let text = "";
      const stream = session.promptStreaming(request.user, { signal });
      for await (const chunk of stream) {
        text += chunk;
        onText(text);
      }
      return text;
    } finally {
      session.destroy();
    }
  }
};

// ===== ② 웹 내장 LLM: WebLLM (WebGPU로 브라우저 안에서 모델 실행) =====

const webLlmProvider = {
  id: "webllm",
  label: "웹 내장 AI (WebLLM)",
  _engine: null,
  _engineModel: null,
  _modulePromise: null,

  modelId() {
    const saved = localStorage.getItem("aiCommentWebllmModel");
    return WEBLLM_MODELS.some(m => m.id === saved) ? saved : WEBLLM_MODELS[0].id;
  },

  async check() {
    if (!navigator.gpu) {
      return { state: "unavailable", detail: "이 브라우저는 WebGPU를 지원하지 않아 웹 내장 AI를 쓸 수 없습니다." };
    }
    if (this._engine && this._engineModel === this.modelId()) {
      return { state: "ready", detail: "모델이 이미 올라와 있습니다" };
    }
    return { state: "download", detail: "처음 한 번 모델을 내려받습니다(이후엔 브라우저에 보관)" };
  },

  async _loadEngine(onStatus) {
    const modelId = this.modelId();
    if (this._engine && this._engineModel === modelId) return this._engine;
    if (this._engine) {
      try { await this._engine.unload(); } catch (e) { /* 무시 */ }
      this._engine = null;
    }
    if (!this._modulePromise) this._modulePromise = import(WEBLLM_MODULE_URL);
    let webllm;
    try {
      webllm = await this._modulePromise;
    } catch (e) {
      this._modulePromise = null;
      throw new Error("WebLLM 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
    }
    onStatus("웹 내장 AI 모델 준비 중…", 0);
    this._engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: report => onStatus(`모델 준비 중… ${report.text || ""}`.trim(), report.progress)
    });
    this._engineModel = modelId;
    return this._engine;
  },

  async generate(request, { onText, onStatus, signal }) {
    const engine = await this._loadEngine(onStatus);
    if (signal && signal.aborted) throw cpAbortError();
    const stopper = () => { try { engine.interruptGenerate(); } catch (e) { /* 무시 */ } };
    if (signal) signal.addEventListener("abort", stopper, { once: true });

    try {
      onStatus("해설 작성 중…", null);
      const stream = await engine.chat.completions.create({
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user }
        ],
        stream: true,
        temperature: 0.6,
        max_tokens: request.kind === "review" ? 900 : 450
      });
      let text = "";
      for await (const chunk of stream) {
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta ? chunk.choices[0].delta.content : "";
        if (delta) {
          text += delta;
          onText(text);
        }
      }
      if (signal && signal.aborted) throw cpAbortError();
      return text;
    } finally {
      if (signal) signal.removeEventListener("abort", stopper);
    }
  }
};

// ===== ③ 구독 중인 AI (MCP): 로컬 도우미 프로그램(tools/janggi-mcp-bridge) 경유 =====

const mcpBridgeProvider = {
  id: "mcp",
  label: "구독 중인 AI (MCP 도우미)",

  baseUrl() {
    const port = parseInt(localStorage.getItem("aiCommentBridgePort"), 10);
    const valid = port >= 1024 && port <= 65535 ? port : MCP_BRIDGE_DEFAULT_PORT;
    return `http://127.0.0.1:${valid}`;
  },

  async _fetchJson(path, options = {}) {
    const res = await fetch(this.baseUrl() + path, {
      ...options,
      headers: { "Content-Type": "application/json" },
      targetAddressSpace: "loopback"
    });
    if (!res.ok) throw new Error(`도우미 응답 오류 (${res.status})`);
    return res.json();
  },

  async check() {
    try {
      const health = await this._fetchJson("/health", { signal: AbortSignal.timeout(1500) });
      if (health && health.name === "janggi-mcp-bridge") {
        return { state: "ready", detail: `도우미 연결됨 (${this.baseUrl()})` };
      }
    } catch (e) {
      // 연결 실패
    }
    return { state: "unavailable", detail: "도우미 프로그램이 꺼져 있습니다. Claude 등 구독 AI 앱에 janggi MCP를 등록하면 자동으로 켜집니다." };
  },

  async generate(request, { onText, onStatus, signal }) {
    const status = await this.check();
    if (status.state !== "ready") throw new Error(status.detail);

    const created = await this._fetchJson("/requests", {
      method: "POST",
      body: JSON.stringify({ kind: request.kind, title: request.title, system: request.system, user: request.user }),
      signal
    });
    const id = created.id;
    onStatus("의뢰함에 넣었습니다. 구독 중인 AI에게 \"장기 해설 의뢰 처리해줘\"라고 말해 주세요.", null);

    try {
      for (;;) {
        await cpSleep(MCP_POLL_INTERVAL_MS, signal);
        const job = await this._fetchJson(`/requests/${encodeURIComponent(id)}`, { signal });
        if (job.status === "claimed") onStatus("구독 중인 AI가 해설을 쓰는 중…", null);
        if (job.status === "done") {
          onText(job.result || "");
          return job.result || "";
        }
        if (job.status === "cancelled" || job.status === "expired") throw new Error("의뢰가 취소되었거나 만료되었습니다.");
      }
    } catch (e) {
      if (e.name === "AbortError") {
        fetch(`${this.baseUrl()}/requests/${encodeURIComponent(id)}`, { method: "DELETE", targetAddressSpace: "loopback" }).catch(() => {});
      }
      throw e;
    }
  }
};

// ===== ④ 유료 중계 서버 (준비 중) =====

const relayProxyProvider = {
  id: "proxy",
  label: "중계 서버 (유료, 준비 중)",
  async check() {
    return { state: "unavailable", detail: "중계 서버 방식은 아직 준비 중입니다." };
  },
  async generate() {
    throw new Error("중계 서버 방식은 아직 준비 중입니다.");
  }
};

const COMMENTARY_PROVIDERS = [chromeBuiltinProvider, webLlmProvider, mcpBridgeProvider, relayProxyProvider];

function getCommentaryProvider(id) {
  return COMMENTARY_PROVIDERS.find(p => p.id === id) || null;
}

/**
 * 설정값(auto 포함)에 맞는 공급자를 고릅니다.
 * auto: 바로 쓸 수 있는 브라우저 내장 AI → 켜져 있는 MCP 도우미 → 내려받기가 필요한 공급자 순.
 * @param {string} preference
 * @returns {Promise<{provider: Object|null, status: {state:string, detail:string}}>}
 */
async function resolveCommentaryProvider(preference) {
  if (preference && preference !== "auto") {
    const provider = getCommentaryProvider(preference);
    if (!provider) return { provider: null, status: { state: "unavailable", detail: "알 수 없는 공급자" } };
    return { provider, status: await provider.check() };
  }
  const order = [chromeBuiltinProvider, mcpBridgeProvider, webLlmProvider];
  const results = [];
  for (const provider of order) {
    const status = await provider.check();
    if (status.state === "ready") return { provider, status };
    results.push({ provider, status });
  }
  const downloadable = results.find(r => r.status.state === "download");
  if (downloadable) return downloadable;
  return { provider: null, status: { state: "unavailable", detail: "이 기기에서 쓸 수 있는 해설 공급자가 없습니다. 공급자 설정에서 MCP 도우미 사용법을 확인해 주세요." } };
}
