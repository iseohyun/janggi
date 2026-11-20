/**
 * @fileoverview 이메일 숫자 코드 인증 화면 (왼쪽 서랍 "온라인 대국" 영역, 로그인한 뒤).
 *  - 이메일·비밀번호로 가입하면 6자리 코드를 메일로 보낸다(online-ui.js가 가입 직후 olVerifySend를 부름).
 *  - 코드를 넣어 맞으면 "실제 사용자"가 되어 방을 만들 수 있다. 인증 전에는 초대받은 방 입장만 된다.
 *  - 코드 남은 시간(10분)과 다시 보내기까지 남은 시간(60초)을 1초마다 보여 준다. 새로고침해도 이어지게
 *    보낸 시각은 탭에 남긴다(sessionStorage "olVerify_<uid>").
 *  - 규칙(만료·보내기 제한·5번 틀리면 잠금)은 서버(functions/)가 정한다. 화면은 받은 이유를 글로 바꿀 뿐이다.
 * 공개: olVerifySend(), olVerifySubmit(ev), olResendCode()
 * @module online/online-verify
 * @depends online/online-core, online/online-ui
 */

let olVerifyState = null; // { uid, expiresAt, resendAt, lockedUntil, msg, kind }
let olVerifyTimer = null;

const OL_VERIFY_REASON = {
  "too-soon": ms => `조금 뒤에 다시 보낼 수 있습니다 (${Math.ceil(ms / 1000)}초).`,
  "daily-limit": () => "오늘은 코드를 더 보낼 수 없습니다. 내일 다시 해 주세요.",
  locked: ms => `5번 틀려 잠겼습니다. ${Math.ceil(ms / 60000)}분 뒤에 새 코드를 받으세요.`,
  "no-code": () => "먼저 코드를 받으세요.",
  expired: () => "코드가 만료되었습니다. 새 코드를 받으세요.",
  "bad-format": () => "6자리 숫자를 넣어 주세요.",
  mismatch: (ms, left) => `코드가 맞지 않습니다. 남은 기회 ${left}번.`
};

function olVerifyKey(uid) {
  return `olVerify_${uid}`;
}

function olVerifyLoad() {
  if (!olUser) {
    olVerifyState = null;
    return;
  }
  if (olVerifyState && olVerifyState.uid === olUser.uid) return;
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(olVerifyKey(olUser.uid)) || "null");
  } catch (e) {
    saved = null;
  }
  olVerifyState = Object.assign({ uid: olUser.uid, expiresAt: 0, resendAt: 0, lockedUntil: 0, msg: "", kind: "" }, saved || {});
}

function olVerifySave() {
  if (!olVerifyState) return;
  try {
    const { uid, expiresAt, resendAt, lockedUntil } = olVerifyState;
    sessionStorage.setItem(olVerifyKey(uid), JSON.stringify({ expiresAt, resendAt, lockedUntil }));
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

function olVerifyMsg(text, kind) {
  if (!olVerifyState) return;
  olVerifyState.msg = text || "";
  olVerifyState.kind = kind || "";
  olVerifyRender();
}

function olFmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

(function olBuildVerify() {
  const host = document.getElementById("ol-auth-in");
  const lobby = document.getElementById("ol-lobby");
  if (!host || !lobby) return;
  const box = document.createElement("div");
  box.id = "ol-verify";
  box.className = "ol-verify";
  box.hidden = true;
  box.innerHTML = `
    <p class="ol-verify-title">이메일 인증</p>
    <p class="ol-hint" id="ol-verify-desc"></p>
    <form id="ol-verify-form" class="ol-row" novalidate>
      <input id="ol-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6자리 숫자" aria-label="인증 코드 6자리">
      <button type="submit" id="ol-code-submit" class="ol-btn ol-primary">확인</button>
    </form>
    <div class="ol-row ol-verify-meta">
      <span id="ol-code-timer" class="ol-code-timer" aria-live="off"></span>
      <button type="button" id="ol-resend" class="ol-btn ol-small" data-action="olResendCode">코드 받기</button>
    </div>
    <p id="ol-verify-msg" class="ol-msg" role="status" aria-live="polite"></p>`;
  host.insertBefore(box, lobby);
})();

function olVerifyRender() {
  const box = document.getElementById("ol-verify");
  if (!box) return;
  olVerifyLoad();
  const need = !!(olUser && !olIsVerified() && (olUser.provider === "password" || !olUser.provider));
  box.hidden = !need;
  if (!need) {
    clearInterval(olVerifyTimer);
    olVerifyTimer = null;
    return;
  }
  const st = olVerifyState;
  const now = Date.now();
  const sent = st.expiresAt > 0;
  document.getElementById("ol-verify-desc").textContent = sent
    ? `${olUser.email}로 보낸 6자리 숫자를 넣으면 실제 사용자로 등록됩니다. 메일이 안 보이면 스팸함도 봐 주세요.`
    : `${olUser.email}로 6자리 인증 코드를 보내 실제 사용자로 등록합니다. 인증 전에는 초대받은 방에만 들어갈 수 있습니다.`;
  const timer = document.getElementById("ol-code-timer");
  if (st.lockedUntil > now) timer.textContent = `잠김 · ${olFmtLeft(st.lockedUntil - now)} 뒤 새 코드`;
  else if (sent && st.expiresAt > now) timer.textContent = `코드 남은 시간 ${olFmtLeft(st.expiresAt - now)}`;
  else if (sent) timer.textContent = "코드가 만료되었습니다";
  else timer.textContent = "";
  timer.dataset.state = st.expiresAt > now && !(st.lockedUntil > now) ? "live" : "off";
  const resend = document.getElementById("ol-resend");
  const wait = Math.max(st.resendAt - now, st.lockedUntil - now, 0);
  resend.disabled = wait > 0 || !!st.busy;
  resend.textContent = wait > 0 ? `다시 보내기 (${Math.ceil(wait / 1000)}초)` : (sent ? "다시 보내기" : "코드 받기");
  // 코드를 다른 탭·기기에서 받았을 수도 있으므로 확인 단추는 보낸 기록과 상관없이 쓴다 (없으면 서버가 "no-code")
  document.getElementById("ol-code-submit").disabled = !!st.busy;
  const msg = document.getElementById("ol-verify-msg");
  msg.textContent = st.msg;
  msg.dataset.kind = st.kind;
  if (!olVerifyTimer && (st.expiresAt > now || wait > 0)) {
    olVerifyTimer = setInterval(() => {
      olVerifyRender();
      const s = olVerifyState;
      const t = Date.now();
      if (!s || (s.expiresAt <= t && s.resendAt <= t && s.lockedUntil <= t)) {
        clearInterval(olVerifyTimer);
        olVerifyTimer = null;
      }
    }, 1000);
  }
}

function olVerifyReason(res) {
  const f = OL_VERIFY_REASON[res.reason];
  return f ? f(res.retryAfterMs || 0, res.attemptsLeft) : (res.reason || "알 수 없는 오류");
}

/** 인증 코드 보내기 (가입 직후 자동, 그 뒤로는 단추) */
async function olVerifySend() {
  olVerifyLoad();
  if (!olVerifyState || olVerifyState.busy) return;
  olVerifyState.busy = true;
  olVerifyMsg("인증 코드를 보내는 중…");
  try {
    const r = await olAuth.sendCode();
    if (r && r.alreadyVerified) {
      olVerifyMsg("이미 인증된 계정입니다.", "ok");
      return;
    }
    olVerifyState.expiresAt = r.expiresAt;
    olVerifyState.resendAt = r.resendAt;
    olVerifyState.lockedUntil = 0;
    olVerifySave();
    olVerifyMsg(`코드를 보냈습니다. 오늘 ${r.dailyLeft}번 더 보낼 수 있습니다.`, "ok");
    const input = document.getElementById("ol-code");
    if (input) {
      input.value = "";
      input.focus();
    }
  } catch (e) {
    const d = e && e.details;
    if (d && d.reason) {
      const until = Date.now() + (d.retryAfterMs || 0);
      if (d.reason === "too-soon") olVerifyState.resendAt = until;
      if (d.reason === "locked") olVerifyState.lockedUntil = until;
      olVerifySave();
      olVerifyMsg(olVerifyReason(d), "error");
    } else {
      olVerifyMsg(olErrorText(e), "error");
    }
  } finally {
    olVerifyState.busy = false;
    olVerifyRender();
  }
}

async function olVerifySubmit(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  olVerifyLoad();
  if (!olVerifyState || olVerifyState.busy) return;
  const input = document.getElementById("ol-code");
  const code = (input.value || "").replace(/\D/g, "");
  if (code.length !== 6) {
    olVerifyMsg(OL_VERIFY_REASON["bad-format"](), "error");
    return;
  }
  olVerifyState.busy = true;
  olVerifyRender();
  try {
    const r = await olAuth.verifyCode(code);
    if (r && r.ok) {
      olVerifyState.expiresAt = 0;
      olVerifyState.resendAt = 0;
      olVerifySave();
      olToast("이메일 인증을 마쳤습니다. 이제 방을 만들 수 있습니다.", 3000);
      return;
    }
    if (r.reason === "locked") olVerifyState.lockedUntil = Date.now() + (r.retryAfterMs || 0);
    if (r.reason === "expired" || r.reason === "locked") olVerifyState.expiresAt = 0;
    olVerifySave();
    olVerifyMsg(olVerifyReason(r), "error");
    input.select();
  } catch (e) {
    olVerifyMsg(olErrorText(e), "error");
  } finally {
    olVerifyState.busy = false;
    olVerifyRender();
  }
}

function olResendCode() {
  olVerifySend();
}

window.olResendCode = olResendCode;

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("ol-verify-form");
  if (form) form.addEventListener("submit", olVerifySubmit);
  const input = document.getElementById("ol-code");
  if (input) {
    input.addEventListener("input", () => {
      const v = input.value.replace(/\D/g, "").slice(0, 6);
      if (v !== input.value) input.value = v;
    });
  }
  olOnChange(what => {
    if (what === "auth" || what === "backend") olVerifyRender();
  });
  olVerifyRender();
});
