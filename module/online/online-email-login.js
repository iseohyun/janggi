/**
 * @fileoverview 이메일 "다른 기기 승인형" 로그인 화면 (왼쪽 서랍 "온라인 대국" 영역, 로그인 전).
 *  - 이메일만 넣으면 서버가 승인 메일을 보내고, 이 화면에는 확인 숫자(2자리)가 뜬다.
 *  - 메일의 승인 페이지(online-approve.html, 휴대폰이든 이 컴퓨터든)에서 이 숫자를 골라 [승인]하면
 *    이 화면이 3초마다 묻다가(claimEmailLogin) 받은 토큰으로 로그인한다. 같은 브라우저에서 승인하면
 *    BroadcastChannel("janggi-online-login")로 바로 알려 와 기다리지 않는다.
 *  - 기다리는 요청(요청 id·claimSecret·숫자)은 이 탭에만 둔다(sessionStorage "olEmailLogin"). 새로고침해도 이어서 기다린다.
 *  - 규칙(10분 만료·60초에 1번·하루 10번·대기 3개·IP 제한)은 서버(functions/email-login-core.js)가 정한다.
 * 공개(data-action): olEmailResend, olEmailCancel
 * @module online/online-email-login
 * @depends online/online-core, online/online-ui
 */

const OL_EMAIL_KEY = "olEmailLogin";
const OL_EMAIL_POLL_MS = 3000;
const OL_LOGIN_CHANNEL = "janggi-online-login";

let olEmailState = null; // { req, claimSecret, number, email, name, expiresAt, resendAt }
let olEmailTimer = null;
let olEmailPolling = false;
let olEmailLastPoll = 0;
let olEmailBusy = false;

const OL_EMAIL_REASON = {
  "bad-email": () => "이메일 주소 형식이 맞지 않습니다.",
  "bad-app-url": () => "이 주소에서는 이메일 로그인을 쓸 수 없습니다 (functions/.env APP_ORIGINS).",
  "too-soon": ms => `조금 뒤에 다시 보낼 수 있습니다 (${Math.ceil(ms / 1000)}초).`,
  "daily-limit": () => "이 이메일로는 오늘 더 보낼 수 없습니다. 내일 다시 해 주세요.",
  "too-many-pending": ms => `기다리는 요청이 3개입니다. 메일함의 승인 메일을 쓰거나 ${Math.ceil(ms / 60000)}분 뒤에 다시 해 주세요.`,
  "ip-limit": ms => `이 네트워크에서 요청이 너무 많습니다. ${Math.ceil(ms / 60000)}분 뒤에 다시 해 주세요.`
};

function olEmailSave() {
  try {
    if (olEmailState) sessionStorage.setItem(OL_EMAIL_KEY, JSON.stringify(olEmailState));
    else sessionStorage.removeItem(OL_EMAIL_KEY);
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

function olEmailLoad() {
  try {
    olEmailState = JSON.parse(sessionStorage.getItem(OL_EMAIL_KEY) || "null");
  } catch (e) {
    olEmailState = null;
  }
}

function olEmailFmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function olEmailMsg(text, kind) {
  const el = document.getElementById("ol-auth-msg");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind || "";
}

(function olBuildEmailWait() {
  const form = document.getElementById("ol-email-form");
  if (!form) return;
  const box = document.createElement("div");
  box.id = "ol-email-wait";
  box.className = "ol-email-wait";
  box.hidden = true;
  box.innerHTML = `
    <p class="ol-email-wait-title">승인 메일을 보냈습니다</p>
    <p class="ol-hint" id="ol-email-wait-to"></p>
    <p class="ol-hint">메일의 승인 페이지에서 <b>이 숫자</b>를 고르세요.</p>
    <p class="ol-email-number" id="ol-email-number" aria-label="확인 숫자"></p>
    <p class="ol-email-timer" id="ol-email-timer" aria-live="off"></p>
    <div class="ol-row">
      <button type="button" id="ol-email-resend" class="ol-btn ol-small" data-action="olEmailResend">다시 보내기</button>
      <button type="button" class="ol-btn ol-small" data-action="olEmailCancel">다른 이메일로</button>
    </div>
    <p class="ol-hint">메일이 안 보이면 스팸함도 봐 주세요. 다른 사람이 보낸 요청이라면 승인 페이지에서 [내가 요청한 게 아님]을 누르면 됩니다.</p>`;
  form.insertAdjacentElement("afterend", box);
})();

function olEmailRender() {
  const box = document.getElementById("ol-email-wait");
  const form = document.getElementById("ol-email-form");
  if (!box || !form) return;
  const st = olEmailState;
  const waiting = !!(st && !olUser);
  box.hidden = !waiting;
  form.querySelectorAll(".ol-field, #ol-email-submit, .ol-hint").forEach(el => {
    el.hidden = waiting;
  });
  if (!waiting) return;
  const now = Date.now();
  document.getElementById("ol-email-wait-to").textContent = `${st.email}로 보냈습니다. 10분 안에 승인해 주세요.`;
  document.getElementById("ol-email-number").textContent = String(st.number);
  const timer = document.getElementById("ol-email-timer");
  timer.textContent = st.expiresAt > now ? `남은 시간 ${olEmailFmt(st.expiresAt - now)}` : "만료되었습니다";
  const resend = document.getElementById("ol-email-resend");
  const wait = Math.max(0, (st.resendAt || 0) - now);
  resend.disabled = wait > 0 || olEmailBusy;
  resend.textContent = wait > 0 ? `다시 보내기 (${Math.ceil(wait / 1000)}초)` : "다시 보내기";
}

/** 1초마다 화면을 새로 그리고, 3초마다 서버에 묻는다 */
function olEmailTick() {
  if (!olEmailState || olUser) {
    clearInterval(olEmailTimer);
    olEmailTimer = null;
    olEmailRender();
    return;
  }
  olEmailRender();
  if (Date.now() - olEmailLastPoll >= OL_EMAIL_POLL_MS) olEmailPoll();
}

function olEmailStartTimer() {
  if (!olEmailTimer) olEmailTimer = setInterval(olEmailTick, 1000);
  olEmailTick();
}

function olEmailDone(text, kind) {
  olEmailState = null;
  olEmailSave();
  olEmailRender();
  olEmailMsg(text, kind);
}

async function olEmailPoll() {
  const st = olEmailState;
  if (!st || olEmailPolling || !olBackend || olUser) return;
  olEmailPolling = true;
  olEmailLastPoll = Date.now();
  try {
    const r = await olAuth.emailClaim(st.req, st.claimSecret);
    if (olEmailState !== st) return; // 그 사이 다시 보내기·취소
    if (r.status === "approved") {
      olEmailDone("");
      olToast("로그인했습니다.", 2500);
    } else if (r.status === "denied") {
      olEmailDone("승인 페이지에서 거부되었습니다 (숫자가 틀렸거나 [내가 요청한 게 아님]). 다시 받아 주세요.", "error");
    } else if (r.status === "expired") {
      olEmailDone("10분이 지나 요청이 만료되었습니다. 다시 받아 주세요.", "error");
    } else if (r.status === "gone") {
      olEmailDone("이 요청은 더 이상 쓸 수 없습니다. 다시 받아 주세요.", "error");
    }
  } catch (e) {
    // 잠깐 끊긴 것은 다음 차례에 다시 묻는다
    console.warn("[online] 로그인 승인 확인 실패:", e && (e.code || e.message));
    if (olEmailState === st) olEmailMsg(olErrorText(e), "error");
  } finally {
    olEmailPolling = false;
  }
}

async function olEmailSend(email, name) {
  if (!olBackend || olEmailBusy) return;
  olEmailBusy = true;
  olEmailMsg("로그인 메일을 보내는 중…");
  olEmailRender();
  try {
    const r = await olAuth.emailStart(email, name, window.location.href);
    olEmailState = { req: r.req, claimSecret: r.claimSecret, number: r.number, email, name, expiresAt: r.expiresAt, resendAt: r.resendAt };
    olEmailSave();
    olEmailMsg("");
    olEmailLastPoll = Date.now();
    olEmailStartTimer();
  } catch (e) {
    const d = e && e.details;
    const f = d && OL_EMAIL_REASON[d.reason];
    olEmailMsg(f ? f(d.retryAfterMs || 0) : olErrorText(e), "error");
    if (d && d.reason === "too-soon" && olEmailState) olEmailState.resendAt = Date.now() + (d.retryAfterMs || 0);
  } finally {
    olEmailBusy = false;
    olEmailRender();
  }
}

function olEmailSubmit(ev) {
  ev.preventDefault();
  const email = document.getElementById("ol-email").value.trim();
  const name = document.getElementById("ol-name").value.trim();
  if (!email) {
    olEmailMsg("이메일을 넣어 주세요.", "error");
    return;
  }
  olEmailSend(email, name);
}

function olEmailResend() {
  if (olEmailState) olEmailSend(olEmailState.email, olEmailState.name);
}

function olEmailCancel() {
  olEmailDone("");
  const input = document.getElementById("ol-email");
  if (input) input.focus();
}

window.olEmailResend = olEmailResend;
window.olEmailCancel = olEmailCancel;

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("ol-email-form");
  if (form) form.addEventListener("submit", olEmailSubmit);
  olEmailLoad();
  // 승인 페이지가 같은 브라우저에 열려 승인하면 바로 묻는다
  if ("BroadcastChannel" in window) {
    const chan = new BroadcastChannel(OL_LOGIN_CHANNEL);
    chan.onmessage = ev => {
      const m = ev.data || {};
      if (olEmailState && m.req === olEmailState.req) olEmailPoll();
    };
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && olEmailState) olEmailPoll();
  });
  olOnChange(what => {
    if (what === "backend" && olEmailState) olEmailStartTimer();
    if (what === "auth") olEmailRender();
  });
  if (olEmailState) olEmailStartTimer();
  else olEmailRender();
});
