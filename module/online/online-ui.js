/**
 * @fileoverview 온라인 대국 화면.
 *  - 왼쪽 서랍 새 영역 "온라인 대국"(#ol-sec-online): 로그인(Google·이메일 로그인·회원가입·비밀번호 재설정)·로그아웃,
 *    방 만들기(내 진영·제한 시간·상차림), 초대 링크 복사·공유, 코드로 입장, 대국자, AI 도움 켜기, 무르기·기권·나가기.
 *  - 오른쪽 서랍 새 영역 "채팅"(#ol-sec-chat): 두 대국자의 채팅과 시스템 메시지(입장·퇴장·무르기·기권·AI 켬), 무르기 응답.
 *  - 영역은 이 파일이 읽힐 때(DOMContentLoaded 전) 서랍에 끼워 넣고 drawers.js의 DRAWER_TABS에 등록한다.
 *    그래서 index.html·drawers.js를 크게 고치지 않는다. 레일 아이콘도 여기서 붙인다.
 * 공개(data-action): olGoogleSignIn, olSetAuthMode, olSignOut, olCreateRoomFromForm, olJoinFromForm, olCopyInvite,
 *       olShareInvite, olRequestUndoBtn, olResignBtn, olLeaveBtn, olUndoAccept, olUndoReject
 * @module online/online-ui
 * @depends online/online-core, online/online-ai, drawers, ui
 */

const OL_CHARIM_NAMES = ["마상마상", "마상상마", "상마마상", "상마상마"];
const OL_TIME_CHOICES = [0, 5, 10, 20, 30, 60];
let olAuthMode = "signin"; // "signin" | "signup" | "reset"
let olChatSeen = 0; // 읽은 채팅 수
let olChatRendered = 0;

function olEl(id) {
  return document.getElementById(id);
}

function olEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

// ===== 영역 끼워 넣기 (읽힐 때 바로) =====

(function olBuildSections() {
  const sprite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sprite.setAttribute("aria-hidden", "true");
  sprite.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  sprite.innerHTML = `
    <symbol id="i-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
    <symbol id="i-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>
    <symbol id="i-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></symbol>`;
  document.body.appendChild(sprite);

  const charimOpts = sel => OL_CHARIM_NAMES.map((n, k) => `<option value="${k}"${k === sel ? " selected" : ""}>${n}</option>`).join("");
  const timeOpts = OL_TIME_CHOICES.map(m => `<option value="${m}">${m ? `${m}분` : "없음"}</option>`).join("");

  const left = document.createElement("div");
  left.className = "setting-category drawer-section ol-section";
  left.id = "ol-sec-online";
  left.innerHTML = `
    <p id="ol-backend-note" class="ol-backend-note"></p>
    <div id="ol-auth-out" class="ol-block">
      <p id="ol-join-hint" class="ol-hint ol-hint-strong" hidden></p>
      <button type="button" class="ol-btn ol-google" data-action="olGoogleSignIn">
        <svg class="ol-g" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>
        <span id="ol-google-label">Google로 로그인</span>
      </button>
      <div class="ol-divider"><span>또는 이메일</span></div>
      <div class="ol-seg" role="tablist" aria-label="이메일 로그인 방식">
        <button type="button" role="tab" data-action="olSetAuthMode" data-value="signin">로그인</button>
        <button type="button" role="tab" data-action="olSetAuthMode" data-value="signup">회원가입</button>
        <button type="button" role="tab" data-action="olSetAuthMode" data-value="reset">비밀번호 찾기</button>
      </div>
      <form id="ol-email-form" class="ol-form" novalidate>
        <label class="ol-field ol-only-signup"><span>대국자 이름</span><input id="ol-name" name="name" type="text" maxlength="40" autocomplete="nickname" placeholder="상대에게 보일 이름"></label>
        <label class="ol-field"><span>이메일</span><input id="ol-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
        <label class="ol-field ol-no-reset"><span>비밀번호</span><input id="ol-password" name="password" type="password" autocomplete="current-password" minlength="6" placeholder="6자 이상"></label>
        <button type="submit" id="ol-email-submit" class="ol-btn ol-primary">로그인</button>
        <p id="ol-auth-msg" class="ol-msg" role="status" aria-live="polite"></p>
      </form>
    </div>

    <div id="ol-auth-in" class="ol-block" hidden>
      <div class="ol-me">
        <span id="ol-avatar" class="ol-avatar" aria-hidden="true"></span>
        <span class="ol-me-text"><b><span id="ol-me-name"></span> <span id="ol-me-badge" class="ol-chip"></span></b><small id="ol-me-email"></small></span>
        <button type="button" class="ol-btn ol-small" data-action="olSignOut">로그아웃</button>
      </div>

      <div id="ol-lobby">
        <h4 class="ol-h">방 만들기</h4>
        <div class="ol-grid">
          <label class="ol-field"><span>내 진영</span>
            <select id="ol-side"><option value="random">무작위</option><option value="cho">초 (먼저 둠)</option><option value="han">한</option></select></label>
          <label class="ol-field"><span>제한 시간 (한 사람)</span><select id="ol-time">${timeOpts}</select></label>
          <label class="ol-field"><span>초 상차림</span><select id="ol-charim-cho">${charimOpts(0)}</select></label>
          <label class="ol-field"><span>한 상차림</span><select id="ol-charim-han">${charimOpts(0)}</select></label>
        </div>
        <p id="ol-create-locked" class="ol-hint ol-hint-strong" hidden>이메일 인증을 마치면 방을 만들 수 있습니다. 초대 링크나 코드로 들어가는 것은 지금도 됩니다.</p>
        <button type="button" id="ol-create-btn" class="ol-btn ol-primary" data-action="olCreateRoomFromForm">방 만들고 초대 링크 받기</button>
        <h4 class="ol-h">초대 코드로 들어가기</h4>
        <form id="ol-join-form" class="ol-row">
          <input id="ol-join-code" type="text" maxlength="40" autocomplete="off" placeholder="코드 또는 초대 링크" aria-label="초대 코드 또는 링크">
          <button type="submit" class="ol-btn">입장</button>
        </form>
      </div>

      <div id="ol-room" hidden>
        <div class="ol-room-head">
          <span>방 <code id="ol-room-code"></code></span>
          <span id="ol-room-status" class="ol-status"></span>
        </div>
        <div class="ol-seats">
          <div class="ol-seat cho" id="ol-seat-cho"></div>
          <div class="ol-seat han" id="ol-seat-han"></div>
        </div>
        <p id="ol-room-meta" class="ol-hint"></p>
        <div id="ol-invite" class="ol-invite">
          <input id="ol-invite-link" type="text" readonly aria-label="초대 링크">
          <div class="ol-row">
            <button type="button" class="ol-btn" data-action="olCopyInvite"><svg class="ico sm" aria-hidden="true"><use href="#i-copy"/></svg> 링크 복사</button>
            <button type="button" class="ol-btn" data-action="olShareInvite"><svg class="ico sm" aria-hidden="true"><use href="#i-share"/></svg> 공유</button>
          </div>
        </div>
        <h4 class="ol-h">AI 도움 <small id="ol-ai-note"></small></h4>
        <div class="ol-ai" id="ol-ai">
          <label class="ol-check"><input type="checkbox" data-ol-ai="rec"> 추천수</label>
          <label class="ol-check"><input type="checkbox" data-ol-ai="threat"> 위협 알림</label>
          <label class="ol-check"><input type="checkbox" data-ol-ai="eval"> 형세 그래프</label>
        </div>
        <div class="ol-row ol-actions">
          <button type="button" id="ol-undo-btn" class="ol-btn" data-action="olRequestUndoBtn">무르기 요청</button>
          <button type="button" id="ol-resign-btn" class="ol-btn ol-danger" data-action="olResignBtn">기권</button>
          <button type="button" class="ol-btn" data-action="olLeaveBtn">방 나가기</button>
        </div>
      </div>
    </div>`;

  const right = document.createElement("div");
  right.className = "setting-category drawer-section ol-section";
  right.id = "ol-sec-chat";
  right.innerHTML = `
    <div id="ol-undo-ask" class="ol-undo-ask" hidden>
      <span id="ol-undo-text"></span>
      <span class="ol-row">
        <button type="button" class="ol-btn ol-primary ol-small" data-action="olUndoAccept">받아들이기</button>
        <button type="button" class="ol-btn ol-small" data-action="olUndoReject">거절</button>
      </span>
    </div>
    <div id="ol-chat-log" class="ol-chat-log" role="log" aria-live="polite" aria-label="채팅"></div>
    <p id="ol-chat-hint" class="ol-hint">온라인 대국 방에 들어가면 상대와 채팅할 수 있습니다.</p>
    <form id="ol-chat-form" class="ol-row ol-chat-form">
      <input id="ol-chat-input" type="text" maxlength="${OL_CHAT_MAX}" autocomplete="off" placeholder="메시지 (Enter로 보내기)" aria-label="채팅 메시지" disabled>
      <button type="submit" class="ol-btn ol-primary" id="ol-chat-send" disabled>보내기</button>
    </form>`;

  const leftAnchor = document.getElementById("lv-sec-saved");
  const rightAnchor = document.getElementById("rd-sec-shortcut");
  if (leftAnchor) leftAnchor.after(left);
  if (rightAnchor) rightAnchor.after(right);

  // 서랍 탭 등록 (drawers.js의 DOMContentLoaded보다 먼저)
  if (typeof DRAWER_TABS !== "undefined") {
    if (!DRAWER_TABS.left.includes("ol-sec-online")) DRAWER_TABS.left.push("ol-sec-online");
    if (!DRAWER_TABS.right.includes("ol-sec-chat")) DRAWER_TABS.right.push("ol-sec-chat");
  }
  if (typeof DRAWER_TAB_TITLES !== "undefined") {
    DRAWER_TAB_TITLES["ol-sec-online"] = "온라인 대국";
    DRAWER_TAB_TITLES["ol-sec-chat"] = "채팅";
  }

  const railBtn = (value, icon, title, extra) => {
    const b = document.createElement("button");
    b.className = "rail-btn";
    b.dataset.action = "jumpToDrawerSection";
    b.dataset.value = value;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${icon}"/></svg>${extra || ""}`;
    return b;
  };
  const lr = document.getElementById("left-rail");
  const rr = document.getElementById("right-rail");
  if (lr) lr.appendChild(railBtn("ol-sec-online", "i-users", "온라인 대국 (로그인·방·초대)"));
  if (rr) rr.appendChild(railBtn("ol-sec-chat", "i-chat", "채팅 (온라인 대국)", `<span id="ol-chat-badge" class="ol-badge" hidden></span>`));
})();

// ===== 그리기 =====

function olRenderBackend() {
  const note = olEl("ol-backend-note");
  if (!note) return;
  if (olBackendError) {
    note.textContent = `온라인 기능을 시작하지 못했습니다: ${olBackendError.message || olBackendError}`;
    note.classList.add("error");
    return;
  }
  if (!olBackend) {
    note.textContent = "온라인 연결 준비 중…";
    return;
  }
  note.classList.toggle("fake", olBackend.kind === "fake");
  note.textContent = olBackend.kind === "fake"
    ? "개발용 가짜 백엔드: 같은 브라우저의 다른 탭끼리만 둘 수 있습니다."
    : "";
  note.hidden = olBackend.kind !== "fake";
  const g = olEl("ol-google-label");
  if (g) g.textContent = olBackend.kind === "fake" ? "Google로 로그인 (가짜 사용자)" : "Google로 로그인";
}

function olRenderAuthMode() {
  const form = olEl("ol-email-form");
  if (!form) return;
  form.dataset.mode = olAuthMode;
  document.querySelectorAll("#ol-sec-online .ol-seg [data-value]").forEach(b => {
    const on = b.dataset.value === olAuthMode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  const pw = olEl("ol-password");
  if (pw) pw.autocomplete = olAuthMode === "signup" ? "new-password" : "current-password";
  const submit = olEl("ol-email-submit");
  if (submit) submit.textContent = { signin: "로그인", signup: "가입하고 로그인", reset: "재설정 메일 보내기" }[olAuthMode];
}

function olRenderAuth() {
  const out = olEl("ol-auth-out");
  const inn = olEl("ol-auth-in");
  if (!out || !inn) return;
  out.hidden = !!olUser;
  inn.hidden = !olUser;
  const hint = olEl("ol-join-hint");
  const want = olUrlRoom();
  if (hint) {
    hint.hidden = !(want && !olUser);
    hint.textContent = want ? `초대받은 방 ${want}에 들어가려면 먼저 로그인하세요. 로그인하면 바로 들어갑니다.` : "";
  }
  if (olUser) {
    olEl("ol-me-name").textContent = olUser.name;
    olEl("ol-me-email").textContent = olUser.email || "";
    olEl("ol-avatar").textContent = (olUser.name || "?").slice(0, 1);
    const verified = olIsVerified();
    const badge = olEl("ol-me-badge");
    badge.textContent = verified ? "실제 사용자" : "인증 전";
    badge.dataset.state = verified ? "ok" : "pending";
    badge.title = verified ? "Google 로그인 또는 이메일 인증을 마친 사용자" : "이메일 인증 전: 초대받은 방 입장만 할 수 있습니다";
    olEl("ol-create-locked").hidden = verified;
    olEl("ol-create-btn").disabled = !verified;
  }
}

function olSeatHtml(side) {
  const seat = olRoom && olRoom.seats[side];
  const me = seat && olUser && seat.uid === olUser.uid;
  const turn = olRoom && olRoom.status === "playing" && olSideOfPly(olRoom.ply) === side;
  return `<span class="ol-seat-side">${olSideName(side)}</span>
    <span class="ol-seat-name">${seat ? olEsc(seat.name) : "<em>비어 있음</em>"}${me ? " <small>(나)</small>" : ""}</span>
    ${turn ? `<span class="ol-turn-dot" title="둘 차례"></span>` : ""}`;
}

function olRenderRoom() {
  const lobby = olEl("ol-lobby");
  const roomBox = olEl("ol-room");
  if (!lobby || !roomBox) return;
  const inRoom = !!(olRoomId && olRoom);
  lobby.hidden = inRoom || (!!olRoomId && !olRoom);
  roomBox.hidden = !inRoom;
  document.documentElement.classList.toggle("ol-in-room", inRoom);
  if (!inRoom) {
    olRenderChatState();
    return;
  }
  olEl("ol-room-code").textContent = olRoomId;
  const st = olEl("ol-room-status");
  const status = olRoom.status;
  let text = "";
  if (status === "waiting") text = "상대를 기다리는 중";
  else if (status === "playing") {
    const side = olSideOfPly(olRoom.ply);
    text = side === olMySide ? `내 차례 (${olSideName(side)})` : `상대 차례 (${olSideName(side)})`;
  } else if (status === "ended") text = `끝 · ${olResultText(olRoom)}`;
  else if (status === "closed") text = "닫힌 방";
  st.textContent = text;
  st.dataset.status = status;
  olEl("ol-seat-cho").innerHTML = olSeatHtml("cho");
  olEl("ol-seat-han").innerHTML = olSeatHtml("han");
  const tl = olRoom.timeLimitMin ? `제한 시간 한 사람 ${olRoom.timeLimitMin}분` : "제한 시간 없음";
  const pick = olRoom.sidePick === "random" ? " · 진영은 무작위로 정함" : "";
  olEl("ol-room-meta").textContent =
    `${tl} · ${olRoom.ply}수 둠${pick}
상차림: 초 ${OL_CHARIM_NAMES[olRoom.charim.cho]} · 한 ${OL_CHARIM_NAMES[olRoom.charim.han]}`;
  const invite = olEl("ol-invite");
  invite.hidden = status !== "waiting";
  olEl("ol-invite-link").value = olInviteLink();
  const undoBtn = olEl("ol-undo-btn");
  undoBtn.disabled = !olCanRequestUndo();
  undoBtn.textContent = olRoom.undo ? (olRoom.undo.by === olUser.uid ? "무르기 답을 기다리는 중" : "무르기 요청") : "무르기 요청";
  olEl("ol-resign-btn").disabled = status !== "playing";
  olRenderAi();
  olRenderUndoAsk();
  olRenderChatState();
}

function olRenderAi() {
  const gated = olAiGated();
  const note = olEl("ol-ai-note");
  if (note) {
    note.textContent = gated ? "켜면 상대에게 알림이 갑니다" :
      (olRoom && olRoom.status === "ended" ? "대국이 끝나 자유롭게 씁니다" : "대국이 시작되면 꺼집니다");
  }
  document.querySelectorAll("#ol-ai input[data-ol-ai]").forEach(cb => {
    const f = cb.dataset.olAi;
    cb.checked = f === "rec" ? (typeof recommendAuto !== "undefined" ? !!recommendAuto : olAi.rec) : !!olAi[f];
  });
}

function olRenderUndoAsk() {
  const box = olEl("ol-undo-ask");
  if (!box) return;
  const u = olRoom && olRoom.undo;
  const ask = !!(u && olUser && u.by !== olUser.uid && olRoom.status === "playing");
  box.hidden = !ask;
  if (ask) olEl("ol-undo-text").textContent = `상대(${olSideName(olOther(olMySide))})가 ${u.ply}수 무르기를 청했습니다.`;
  if (ask && typeof isRightDrawerOpen === "function" && !isRightDrawerOpen()) {
    olToast("상대가 무르기를 청했습니다. 채팅에서 답해 주세요.", 3000);
  }
}

function olRenderChatState() {
  const on = !!(olRoomId && olRoom && olUser);
  const input = olEl("ol-chat-input");
  const send = olEl("ol-chat-send");
  const hint = olEl("ol-chat-hint");
  if (input) input.disabled = !on;
  if (send) send.disabled = !on;
  if (hint) hint.hidden = on;
}

function olChatVisible() {
  const box = document.getElementById("setting-box");
  return !!(box && !box.hidden && box.dataset.tab === "ol-sec-chat" && document.visibilityState === "visible");
}

function olRenderChat() {
  const logEl = olEl("ol-chat-log");
  if (!logEl) return;
  if (!olRoomId) {
    logEl.innerHTML = "";
    olChatRendered = 0;
    olChatSeen = 0;
    olRenderBadge();
    return;
  }
  if (olChat.length < olChatRendered) {
    logEl.innerHTML = "";
    olChatRendered = 0;
  }
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  const frag = document.createDocumentFragment();
  for (let k = olChatRendered; k < olChat.length; k++) {
    const m = olChat[k];
    const row = document.createElement("div");
    const mine = olUser && m.uid === olUser.uid;
    const time = new Date(m.atMs || Date.now()).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    if (m.kind === "system") {
      row.className = "ol-msg-row system";
      row.innerHTML = `<span class="ol-msg-text">${olEsc(m.text)}</span><time>${time}</time>`;
    } else {
      row.className = `ol-msg-row${mine ? " mine" : ""} ${m.side === "han" ? "han" : "cho"}`;
      row.innerHTML = `<span class="ol-msg-name">${olEsc(m.name)}${m.side ? ` · ${olSideName(m.side)}` : ""}</span>
        <span class="ol-msg-bubble">${olEsc(m.text)}</span><time>${time}</time>`;
    }
    frag.appendChild(row);
    // 다른 사람이 쓴 새 글은 채팅이 안 보이면 잠깐 띄운다 (처음 불러온 지난 글은 빼고)
    if (olChatRendered > 0 && !mine && !olChatVisible()) {
      olToast(m.kind === "system" ? m.text : `${m.name}: ${m.text}`, 2600);
    }
  }
  const first = olChatRendered === 0;
  logEl.appendChild(frag);
  olChatRendered = olChat.length;
  if (first) olChatSeen = olChat.length;
  if (atBottom || first) logEl.scrollTop = logEl.scrollHeight;
  if (olChatVisible()) olChatSeen = olChat.length;
  olRenderBadge();
}

function olRenderBadge() {
  const badge = olEl("ol-chat-badge");
  if (!badge) return;
  const n = Math.max(0, olChat.length - olChatSeen);
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? "9+" : String(n);
}

function olRender(what) {
  if (what === "backend") {
    olRenderBackend();
    return;
  }
  if (what === "auth") {
    olRenderAuth();
    olRenderRoom();
    return;
  }
  if (what === "chat") {
    olRenderChat();
    return;
  }
  if (what === "enter" && typeof isRightDrawerOpen === "function" && isRightDrawerOpen() && typeof drawerShowTab === "function") {
    drawerShowTab("right", "ol-sec-chat", true); // 방에 들어가면 열려 있는 오른쪽 서랍을 채팅으로
  }
  olRenderRoom();
}

// ===== 버튼 =====

function olSetAuthMsg(text, kind) {
  const el = olEl("ol-auth-msg");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind || "";
}

function olSetAuthMode(mode) {
  olAuthMode = ["signin", "signup", "reset"].includes(mode) ? mode : "signin";
  olSetAuthMsg("");
  olRenderAuthMode();
}

async function olGoogleSignIn() {
  if (!olBackend) return;
  olSetAuthMsg("Google 로그인 창을 여는 중…");
  try {
    await olAuth.google();
    olSetAuthMsg("");
  } catch (e) {
    olSetAuthMsg(olErrorText(e), "error");
  }
}

async function olSubmitEmail(ev) {
  ev.preventDefault();
  if (!olBackend) return;
  const email = olEl("ol-email").value.trim();
  const pw = olEl("ol-password").value;
  const name = olEl("ol-name").value.trim();
  if (!email) {
    olSetAuthMsg("이메일을 넣어 주세요.", "error");
    return;
  }
  const btn = olEl("ol-email-submit");
  btn.disabled = true;
  try {
    if (olAuthMode === "reset") {
      await olAuth.reset(email);
      olSetAuthMsg("비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.", "ok");
    } else if (olAuthMode === "signup") {
      if (!name) {
        olSetAuthMsg("대국자 이름을 넣어 주세요.", "error");
        return;
      }
      await olAuth.signUp(email, pw, name);
      olSetAuthMsg("");
      // 가입하면 바로 인증 코드를 보낸다 (online-verify.js)
      if (typeof olVerifySend === "function") olVerifySend();
    } else {
      await olAuth.email(email, pw);
      olSetAuthMsg("");
    }
    olEl("ol-password").value = "";
  } catch (e) {
    olSetAuthMsg(olErrorText(e), "error");
  } finally {
    btn.disabled = false;
  }
}

async function olSignOut() {
  try {
    await olAuth.signOut();
  } catch (e) {
    olToast(`로그아웃하지 못했습니다: ${olErrorText(e)}`);
  }
}

async function olCreateRoomFromForm(btn) {
  const b = btn instanceof HTMLElement ? btn : null;
  if (b) b.disabled = true;
  try {
    await olCreateRoom({
      side: olEl("ol-side").value,
      timeLimitMin: parseInt(olEl("ol-time").value, 10) || 0,
      charim: { cho: parseInt(olEl("ol-charim-cho").value, 10) || 0, han: parseInt(olEl("ol-charim-han").value, 10) || 0 }
    });
    olToast("방을 만들었습니다. 초대 링크를 상대에게 보내세요.", 3000);
  } catch (e) {
    olToast(`방을 만들지 못했습니다: ${olErrorText(e)}`, 3500);
  } finally {
    if (b) b.disabled = false;
  }
}

async function olJoinFromForm(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const raw = olEl("ol-join-code").value;
  let code = raw;
  try {
    code = new URL(raw).searchParams.get("room") || raw;
  } catch (e) {
    // 링크가 아니라 코드
  }
  try {
    await olJoinRoom(code);
    olEl("ol-join-code").value = "";
  } catch (e) {
    olToast(`들어가지 못했습니다: ${olErrorText(e)}`, 3500);
  }
}

async function olCopyInvite() {
  const link = olInviteLink();
  try {
    await navigator.clipboard.writeText(link);
    olToast("초대 링크를 복사했습니다.");
  } catch (e) {
    const input = olEl("ol-invite-link");
    if (input) {
      input.focus();
      input.select();
    }
    olToast("복사하지 못했습니다. 선택된 링크를 직접 복사해 주세요.", 3000);
  }
}

async function olShareInvite() {
  const link = olInviteLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: "웹장기 한 판 둘까요?", text: `웹장기 온라인 대국 초대 (방 ${olRoomId})`, url: link });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // 사용자가 닫음
    }
  }
  olCopyInvite(); // 공유 서랍이 없는 브라우저
}

function olRequestUndoBtn() {
  olRequestUndo();
}

function olResignBtn() {
  olResign();
}

function olLeaveBtn() {
  olLeaveRoom(false);
}

function olUndoAccept() {
  olAnswerUndo(true);
}

function olUndoReject() {
  olAnswerUndo(false);
}

window.olGoogleSignIn = olGoogleSignIn;
window.olSetAuthMode = olSetAuthMode;
window.olSignOut = olSignOut;
window.olCreateRoomFromForm = olCreateRoomFromForm;
window.olCopyInvite = olCopyInvite;
window.olShareInvite = olShareInvite;
window.olRequestUndoBtn = olRequestUndoBtn;
window.olResignBtn = olResignBtn;
window.olLeaveBtn = olLeaveBtn;
window.olUndoAccept = olUndoAccept;
window.olUndoReject = olUndoReject;

document.addEventListener("DOMContentLoaded", () => {
  olOnChange(olRender);
  olRenderBackend();
  olRenderAuthMode();
  olRenderAuth();
  olRenderRoom();

  olEl("ol-email-form").addEventListener("submit", olSubmitEmail);
  olEl("ol-join-form").addEventListener("submit", olJoinFromForm);
  olEl("ol-chat-form").addEventListener("submit", ev => {
    ev.preventDefault();
    const input = olEl("ol-chat-input");
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    olSendChat(text);
  });
  olEl("ol-ai").addEventListener("change", ev => {
    const cb = ev.target.closest("input[data-ol-ai]");
    if (cb) olSetAi(cb.dataset.olAi, cb.checked);
  });
  // 헤더 추천수 버튼 등으로 바뀌어도 체크 상자를 맞춘다
  ["setRecommendAuto"].forEach(name => {
    const orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function () {
      const r = orig.apply(this, arguments);
      olRenderAi();
      return r;
    };
  });

  // 채팅을 보면 읽음
  const seen = () => {
    if (olChatVisible()) {
      olChatSeen = olChat.length;
      olRenderBadge();
    }
  };
  document.addEventListener("click", () => setTimeout(seen, 350));
  document.addEventListener("visibilitychange", seen);

  // 초대 링크로 왔으면 온라인 대국 영역을 연다
  if (olUrlRoom() && typeof jumpToDrawerSection === "function") {
    setTimeout(() => jumpToDrawerSection("ol-sec-online"), 0);
  }
});
