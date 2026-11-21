/**
 * @fileoverview 온라인 대국 화면.
 *  - 왼쪽 서랍 새 영역 "온라인 대국"(#ol-sec-online): 로그인(Google·이메일 승인형은 online-email-login.js)·로그아웃·모든 기기에서 로그아웃,
 *    방 만들기(접기 가능, 기본 공개 / 비공개·내 진영·제한 시간·내 상차림), 초대 링크 복사·공유, 코드로 입장, 대국자, AI 도움 켜기, 무르기·기권·나가기.
 *    로그인 아래 "열린 대국" 목록(#ol-open): 기다리는 공개 방(누르면 입장, 로그인 필요)과 진행 중인 공개 대국(누르면 관전, 로그인 없이).
 *    목록은 영역이 화면에 보일 때만 구독한다(최근 50개, 한 쪽에 OL_OPEN_PAGE개씩).
 *  - 시작 전 방: 대국자 칸에 상차림·준비 표시, 방장은 '대국 시작', 상대는 '준비'. 오른쪽 서랍 '새 대국' 탭 위에 방 안내(#ol-ng-panel)를
 *    끼워 넣고, '새 대국 시작' 단추 글자를 '준비'·'대국 시작'으로 바꾼다 (탭의 단추는 online-guard.js가 방 설정으로 잇는다).
 *  - 오른쪽 서랍 새 영역 "채팅"(#ol-sec-chat): 두 대국자의 채팅과 시스템 메시지(입장·퇴장·무르기·기권·AI 켬), 무르기 응답.
 *  - 영역은 이 파일이 읽힐 때(DOMContentLoaded 전) 서랍에 끼워 넣고 drawers.js의 DRAWER_TABS에 등록한다.
 *    그래서 index.html·drawers.js를 크게 고치지 않는다. 레일 아이콘도 여기서 붙인다.
 * 공개(data-action): olGoogleSignIn, olSignOut, olSignOutAll, olCreateRoomFromForm, olJoinFromForm, olCopyInvite,
 *       olShareInvite, olRequestUndoBtn, olResignBtn, olLeaveBtn, olUndoAccept, olUndoReject, olReadyBtn, olStartBtn,
 *       olOpenSetupTab, olOpenPage
 * @module online/online-ui
 * @depends online/online-core, online/online-ai, drawers, ui
 */

const OL_CHARIM_NAMES = ["마상마상", "마상상마", "상마마상", "상마상마"];
const OL_TIME_CHOICES = [0, 5, 10, 20, 30, 60];
const OL_OPEN_PAGE = 5; // 열린 대국 목록 한 쪽에 보이는 수
let olChatUnread = 0; // 안 읽은 새 채팅 수 (배지)
let olChatIds = []; // 그려 둔 채팅 id (olChat 순서)
let olLobby = []; // 열린 대국 요약 (최근 50개)
let olLobbyUnsub = null;
let olLobbyAt = 0; // 구독을 건 시각 (오래되면 다시 건다)
let olOpenVisible = false; // 열린 대국 목록이 화면에 보임
const olOpenPageIdx = { open: 0, live: 0 };

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
      <form id="ol-email-form" class="ol-form" novalidate>
        <label class="ol-field"><span>이메일</span><input id="ol-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
        <label class="ol-field"><span>대국자 이름 <small>(처음 로그인할 때만, 비우면 이메일 앞부분)</small></span><input id="ol-name" name="name" type="text" maxlength="40" autocomplete="nickname" placeholder="상대에게 보일 이름"></label>
        <button type="submit" id="ol-email-submit" class="ol-btn ol-primary">로그인 메일 받기</button>
        <p class="ol-hint">비밀번호가 없습니다. 메일의 승인 페이지에서 이 화면에 뜨는 숫자를 고르면 이 브라우저가 로그인됩니다. 휴대폰에서 승인해도 됩니다.</p>
        <p id="ol-auth-msg" class="ol-msg" role="status" aria-live="polite"></p>
      </form>
    </div>

    <div id="ol-auth-in" class="ol-block" hidden>
      <div class="ol-me">
        <span id="ol-avatar" class="ol-avatar" aria-hidden="true"></span>
        <span class="ol-me-text"><b id="ol-me-name"></b><small id="ol-me-email"></small></span>
        <button type="button" class="ol-btn ol-small" data-action="olSignOut">로그아웃</button>
      </div>
      <details id="ol-devices" class="ol-devices">
        <summary>로그인한 기기 <span id="ol-devices-count"></span></summary>
        <ul id="ol-devices-list" class="ol-devices-list"></ul>
        <p class="ol-hint">모르는 기기가 있으면 아래 단추로 모두 로그아웃한 뒤 다시 로그인하세요. 브라우저·OS는 대략이고 IP·위치는 저장하지 않습니다.</p>
      </details>
      <p class="ol-signout-all"><button type="button" class="ol-link" data-action="olSignOutAll">모든 기기에서 로그아웃</button></p>

      <div id="ol-lobby">
        <details id="ol-create" class="ol-create" open>
        <summary class="ol-h ol-create-sum">방 만들기</summary>
        <div class="ol-create-body">
        <div class="ol-vis" role="radiogroup" aria-label="방 공개">
          <label class="ol-check"><input type="radio" name="ol-vis" value="public" checked> 공개 <small>열린 대국 목록에 올림</small></label>
          <label class="ol-check"><input type="radio" name="ol-vis" value="private"> 비공개 <small>초대 링크로만</small></label>
        </div>
        <div class="ol-grid">
          <label class="ol-field"><span>내 진영</span>
            <select id="ol-side"><option value="random">무작위</option><option value="cho">초 (먼저 둠)</option><option value="han">한</option></select></label>
          <label class="ol-field"><span>제한 시간 (한 사람)</span><select id="ol-time">${timeOpts}</select></label>
          <label class="ol-field"><span>내 상차림</span><select id="ol-charim">${charimOpts(0)}</select></label>
        </div>
        <p class="ol-hint">상대 상차림은 상대가 들어와서 고릅니다. 시작 전까지 오른쪽 서랍 '새 대국' 탭에서 설정을 바꿀 수 있습니다.</p>
        <button type="button" id="ol-create-btn" class="ol-btn ol-primary" data-action="olCreateRoomFromForm">방 만들고 초대 링크 받기</button>
        </div>
        </details>
        <h4 class="ol-h">초대 코드로 들어가기</h4>
        <form id="ol-join-form" class="ol-row">
          <input id="ol-join-code" type="text" maxlength="40" autocomplete="off" placeholder="코드 또는 초대 링크" aria-label="초대 코드 또는 링크">
          <button type="submit" class="ol-btn">입장</button>
        </form>
      </div>
    </div>

    <div id="ol-open" class="ol-block ol-open">
      <h4 class="ol-h">열린 대국 <small id="ol-open-note"></small></h4>
      <div class="ol-open-group">
        <p class="ol-open-title">기다리는 방 <span id="ol-open-count"></span></p>
        <ul id="ol-open-list" class="ol-open-list"></ul>
        <div class="ol-pager" id="ol-open-pager"></div>
      </div>
      <div class="ol-open-group">
        <p class="ol-open-title">진행 중 · 관전 <span id="ol-live-count"></span></p>
        <ul id="ol-live-list" class="ol-open-list"></ul>
        <div class="ol-pager" id="ol-live-pager"></div>
      </div>
      <p class="ol-hint">목록 보기와 관전은 로그인 없이 됩니다. 참가는 로그인한 뒤에 합니다. 관전에서는 채팅을 볼 수 없습니다.</p>
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
        <div id="ol-setup" class="ol-setup" hidden>
          <p id="ol-setup-text" class="ol-hint ol-hint-strong"></p>
          <div class="ol-row">
            <button type="button" id="ol-ready-btn" class="ol-btn ol-primary" data-action="olReadyBtn">준비</button>
            <button type="button" id="ol-start-btn" class="ol-btn ol-primary" data-action="olStartBtn">대국 시작</button>
            <button type="button" class="ol-btn" data-action="olOpenSetupTab">설정 ('새 대국' 탭)</button>
          </div>
        </div>
        <div id="ol-invite" class="ol-invite">
          <input id="ol-invite-link" type="text" readonly aria-label="초대 링크">
          <div class="ol-row">
            <button type="button" class="ol-btn" data-action="olCopyInvite"><svg class="ico sm" aria-hidden="true"><use href="#i-copy"/></svg> 링크 복사</button>
            <button type="button" class="ol-btn" data-action="olShareInvite"><svg class="ico sm" aria-hidden="true"><use href="#i-share"/></svg> 공유</button>
          </div>
        </div>
        <h4 class="ol-h" id="ol-ai-head">AI 도움 <small id="ol-ai-note"></small></h4>
        <div class="ol-ai" id="ol-ai">
          <label class="ol-check"><input type="checkbox" data-ol-ai="rec"> 추천수</label>
          <label class="ol-check"><input type="checkbox" data-ol-ai="threat"> 위협 알림</label>
          <label class="ol-check"><input type="checkbox" data-ol-ai="eval"> 형세 그래프</label>
        </div>
        <div class="ol-row ol-actions">
          <button type="button" id="ol-undo-btn" class="ol-btn" data-action="olRequestUndoBtn">무르기 요청</button>
          <button type="button" id="ol-resign-btn" class="ol-btn ol-danger" data-action="olResignBtn">기권</button>
          <button type="button" id="ol-leave-btn" class="ol-btn" data-action="olLeaveBtn">방 나가기</button>
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
    <button type="button" id="ol-chat-older" class="ol-btn ol-small ol-chat-older" hidden>이전 채팅 더 보기</button>
    <div id="ol-chat-log" class="ol-chat-log" role="log" aria-live="polite" aria-label="채팅"></div>
    <p id="ol-chat-hint" class="ol-hint">온라인 대국 방에 들어가면 상대와 채팅할 수 있습니다.</p>
    <form id="ol-chat-form" class="ol-row ol-chat-form">
      <input id="ol-chat-input" type="text" maxlength="${OL_CHAT_MAX}" autocomplete="off" placeholder="메시지 (Enter로 보내기)" aria-label="채팅 메시지" disabled>
      <button type="submit" class="ol-btn ol-primary" id="ol-chat-send" disabled>보내기</button>
    </form>`;

  // 오른쪽 서랍 '새 대국' 탭 위: 온라인 방 안내 (방에 있을 때만 보임)
  const ngSec = document.getElementById("rd-sec-newgame");
  if (ngSec) {
    const ng = document.createElement("div");
    ng.id = "ol-ng-panel";
    ng.className = "ol-ng-panel";
    ng.hidden = true;
    ngSec.prepend(ng);
  }

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
  }
}

let olDevicesSeq = 0;

/** "로그인한 기기" 목록 (서랍을 펼칠 때·로그인할 때 서버에서 읽음) */
async function olRenderDevices() {
  const list = olEl("ol-devices-list");
  if (!list || !olUser) return;
  const seq = ++olDevicesSeq;
  let devices;
  try {
    devices = await olAuth.devices();
  } catch (e) {
    if (seq === olDevicesSeq) list.innerHTML = `<li class="ol-hint">기기 목록을 읽지 못했습니다: ${olEsc(olErrorText(e))}</li>`;
    return;
  }
  if (seq !== olDevicesSeq) return;
  const fmt = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  olEl("ol-devices-count").textContent = devices.length ? `(${devices.length})` : "";
  list.innerHTML = devices.length
    ? devices.map(d => `<li><b>${olEsc(d.label)}</b>${d.current ? ' <span class="ol-devices-me">이 기기</span>' : ""}
        <small>처음 ${olEsc(fmt.format(new Date(d.firstAt)))} · 마지막 ${olEsc(fmt.format(new Date(d.lastAt)))}</small></li>`).join("")
    : '<li class="ol-hint">아직 기록된 기기가 없습니다.</li>';
}

/** 계정 구분표(가린 이메일) 한 줄. 없으면 "" */
function olTagHtml(tag) {
  return tag ? ` <span class="ol-id-tag" title="계정 (이메일로 구분)">${olEsc(tag)}</span>` : "";
}

function olSeatHtml(side) {
  const seat = olRoom && olRoom.seats[side];
  const me = !!(seat && olUser && !olSpectating && seat.uid === olUser.uid);
  const host = !!(seat && !olSpectating && seat.uid === olRoom.hostUid);
  const turn = olRoom && olRoom.status === "playing" && olSideOfPly(olRoom.ply) === side;
  const setup = olRoom && olRoom.status === "waiting";
  let tag = "";
  if (setup && seat && !host) tag = olRoom.ready ? '<span class="ol-ready on">준비됨</span>' : '<span class="ol-ready">준비 전</span>';
  return `<span class="ol-seat-side">${olSideName(side)}</span>
    <span class="ol-seat-name">${seat ? olEsc(seat.name) : "<em>비어 있음</em>"}${me ? " <small>(나)</small>" : ""}${host ? " <small>방장</small>" : ""}${seat ? olTagHtml(seat.tag) : ""}</span>
    ${seat ? `<span class="ol-seat-charim">${OL_CHARIM_NAMES[olRoom.charim[side] | 0]}</span>` : ""}${tag}
    ${turn ? `<span class="ol-turn-dot" title="둘 차례"></span>` : ""}`;
}

function olRenderRoom() {
  const lobby = olEl("ol-lobby");
  const roomBox = olEl("ol-room");
  if (!lobby || !roomBox) return;
  const inRoom = !!(olRoomId && olRoom);
  lobby.hidden = inRoom || !!olRoomId;
  roomBox.hidden = !inRoom;
  const open = olEl("ol-open");
  if (open) open.hidden = !!olRoomId;
  document.documentElement.classList.toggle("ol-in-room", inRoom);
  olRenderNewGamePanel();
  if (!inRoom) {
    olRenderChatState();
    return;
  }
  olEl("ol-room-code").textContent = olRoomId;
  const st = olEl("ol-room-status");
  const status = olRoom.status;
  let text = "";
  if (status === "waiting") text = !olGuestSeated() ? "상대를 기다리는 중" : olRoom.ready ? "상대 준비됨" : "상대가 설정 중";
  else if (status === "playing") {
    const side = olSideOfPly(olRoom.ply);
    text = olSpectating ? `관전 · ${olSideName(side)} 차례`
      : side === olMySide ? `내 차례 (${olSideName(side)})` : `상대 차례 (${olSideName(side)})`;
  } else if (status === "ended") text = `끝 · ${olResultText(olRoom)}`;
  else if (status === "closed") text = "닫힌 방";
  st.textContent = text;
  st.dataset.status = status;
  olEl("ol-seat-cho").innerHTML = olSeatHtml("cho");
  olEl("ol-seat-han").innerHTML = olSeatHtml("han");
  const tl = olRoom.timeLimitMin ? `제한 시간 한 사람 ${olRoom.timeLimitMin}분` : "제한 시간 없음";
  const pick = olRoom.sidePick === "random" ? " · 진영은 무작위로 정함" : "";
  const vis = olSpectating ? "공개 대국 관전 (채팅 없음)" : olRoom.visibility === "public" ? "공개 방 (열린 대국 목록)" : "비공개 방 (초대 링크로만)";
  olEl("ol-room-meta").textContent = `${vis}
${tl} · ${olRoom.ply}수 둠${pick}`;
  olRenderSetup();
  const invite = olEl("ol-invite");
  invite.hidden = status !== "waiting" || olSpectating || olGuestSeated();
  olEl("ol-invite-link").value = olInviteLink();
  const player = !olSpectating;
  ["ol-ai-head", "ol-ai", "ol-undo-btn", "ol-resign-btn"].forEach(id => {
    const el = olEl(id);
    if (el) el.hidden = !player;
  });
  olEl("ol-leave-btn").textContent = olSpectating ? "관전 끝내기" : "방 나가기";
  if (!player) {
    olRenderChatState();
    return;
  }
  const undoBtn = olEl("ol-undo-btn");
  undoBtn.disabled = !olCanRequestUndo();
  undoBtn.textContent = olRoom.undo ? (olRoom.undo.by === olUser.uid ? "무르기 답을 기다리는 중" : "무르기 요청") : "무르기 요청";
  olEl("ol-resign-btn").disabled = status !== "playing";
  olRenderAi();
  olRenderUndoAsk();
  olRenderChatState();
}

/** 시작 전 방: 준비·시작 단추와 안내 */
function olRenderSetup() {
  const box = olEl("ol-setup");
  if (!box) return;
  const on = olInSetup();
  box.hidden = !on;
  if (!on) return;
  const host = olAmHost();
  const seated = olGuestSeated();
  const ready = !!olRoom.ready;
  const readyBtn = olEl("ol-ready-btn");
  const startBtn = olEl("ol-start-btn");
  readyBtn.hidden = host;
  startBtn.hidden = !host;
  readyBtn.textContent = ready ? "준비 풀기" : "준비";
  readyBtn.classList.toggle("ol-primary", !ready);
  startBtn.disabled = !(seated && ready);
  let text;
  if (host) {
    text = !seated ? "상대를 기다리는 중입니다. 내 상차림·진영·제한 시간은 시작 전까지 바꿀 수 있습니다."
      : ready ? "상대가 준비했습니다. 양쪽 판을 확인하고 대국을 시작하세요."
        : "상대가 상차림을 고르는 중입니다. 설정을 바꾸면 상대의 준비가 풀립니다.";
  } else {
    text = ready ? "준비했습니다. 방장이 시작하기를 기다립니다. 상차림을 바꾸면 준비가 풀립니다."
      : "내 상차림을 고르고 준비를 누르세요. 진영과 제한 시간은 방장이 정합니다.";
  }
  olEl("ol-setup-text").textContent = text;
}

let olNgBtnLabel = null; // '새 대국 시작' 단추의 원래 글자

/** 오른쪽 서랍 '새 대국' 탭: 방에 있으면 위에 안내를 띄우고, 고칠 수 없는 칸을 흐리게, 시작 단추 글자를 바꾼다 */
function olRenderNewGamePanel() {
  const panel = olEl("ol-ng-panel");
  const sec = olEl("rd-sec-newgame");
  if (!panel || !sec) return;
  const btn = sec.querySelector(".restart-btn");
  if (btn && olNgBtnLabel === null) olNgBtnLabel = btn.textContent;
  const inRoom = !!(olRoomId && olRoom);
  const setup = olInSetup();
  const host = olAmHost();
  sec.classList.toggle("ol-ng-room", inRoom);
  sec.classList.toggle("ol-ng-setup", setup);
  sec.classList.toggle("ol-ng-guest", setup && !host);
  panel.hidden = !inRoom;
  if (!inRoom) {
    if (btn && olNgBtnLabel !== null) {
      btn.textContent = olNgBtnLabel;
      btn.disabled = false;
    }
    return;
  }
  const opp = olSpectating ? null : olOther(olMySide);
  const oppSeat = opp && olRoom.seats[opp];
  const tl = olRoom.timeLimitMin ? `${olRoom.timeLimitMin}분` : "없음";
  let html;
  if (olSpectating) {
    html = `<b>공개 대국 관전 중</b> · 방 ${olEsc(olRoomId)}<br>초 ${OL_CHARIM_NAMES[olRoom.charim.cho]} · 한 ${OL_CHARIM_NAMES[olRoom.charim.han]} · 판을 바꿀 수 없습니다.`;
  } else if (setup) {
    const readyTxt = olRoom.ready ? " · 준비됨" : " · 준비 전"; // 준비는 상대(손님) 쪽 상태
    const me = `내 상차림(아래 줄): <b>${OL_CHARIM_NAMES[olRoom.charim[olMySide]]}</b>${host ? "" : readyTxt}`;
    const them = oppSeat
      ? `상대 상차림(위 줄, ${host ? "상대가 고름" : "방장이 고름"}): <b>${OL_CHARIM_NAMES[olRoom.charim[opp]]}</b>${host ? readyTxt : ""}`
      : "상대가 들어오면 상대 상차림이 위 줄에 보입니다.";
    const rule = host
      ? `진영 <b>${olSideName(olMySide)}</b> · 제한 시간 <b>${tl}</b> (방장이 바꿈, 바꾸면 상대 준비가 풀림)`
      : `진영 <b>${olSideName(olMySide)}</b> · 제한 시간 <b>${tl}</b>: 방장이 정함 (읽기 전용)`;
    html = `<b>온라인 방 ${olEsc(olRoomId)}</b> · ${host ? "방장" : "상대로 참가"}<br>${me}<br>${them}<br>${rule}`;
  } else {
    html = `<b>온라인 방 ${olEsc(olRoomId)}</b> · ${olRoom.status === "playing" ? "대국 중이라 설정을 바꿀 수 없습니다." : "대국이 끝났습니다. 방을 나가면 새 대국을 할 수 있습니다."}`;
  }
  panel.innerHTML = html;
  if (btn) {
    if (setup && host) {
      btn.textContent = olGuestSeated() && olRoom.ready ? "대국 시작 (상대 준비됨)" : "상대의 준비를 기다리는 중";
      btn.disabled = !(olGuestSeated() && olRoom.ready);
    } else if (setup) {
      btn.textContent = olRoom.ready ? "준비 풀기" : "준비";
      btn.disabled = false;
    } else {
      btn.textContent = olSpectating ? "관전 중" : olRoom.status === "playing" ? "대국 중" : "온라인 방을 나간 뒤 새 대국";
      btn.disabled = true;
    }
  }
}

// ===== 열린 대국 목록 =====

function olAgo(ms) {
  const min = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

function olPagerHtml(kind, total) {
  const pages = Math.max(1, Math.ceil(total / OL_OPEN_PAGE));
  if (olOpenPageIdx[kind] >= pages) olOpenPageIdx[kind] = pages - 1;
  if (pages <= 1) return "";
  const p = olOpenPageIdx[kind];
  return `<button type="button" class="ol-btn ol-small" data-action="olOpenPage" data-kind="${kind}" data-step="-1"${p === 0 ? " disabled" : ""}>이전</button>
    <span>${p + 1} / ${pages}</span>
    <button type="button" class="ol-btn ol-small" data-action="olOpenPage" data-kind="${kind}" data-step="1"${p >= pages - 1 ? " disabled" : ""}>다음</button>`;
}

function olRenderOpen() {
  const listEl = olEl("ol-open-list");
  const liveEl = olEl("ol-live-list");
  if (!listEl || !liveEl) return;
  const LC = window.LobbyCore;
  const note = olEl("ol-open-note");
  if (!olBackend || !LC) {
    if (note) note.textContent = olBackendError ? "연결하지 못함" : "준비 중…";
    return;
  }
  const now = Date.now();
  // 서버가 정리하기 전이라도 30분 지난 방은 빼고 그린다
  const fresh = olLobby.filter(s => !LC.isStale(s, now) || s.activeAtMs > now);
  const open = fresh.filter(LC.isOpen);
  const live = fresh.filter(LC.isLive);
  if (note) note.textContent = `최근 30분 · ${open.length + live.length}개`;
  olEl("ol-open-count").textContent = open.length ? `(${open.length})` : "";
  olEl("ol-live-count").textContent = live.length ? `(${live.length})` : "";
  const page = (arr, kind) => {
    olEl(`ol-${kind}-pager`).innerHTML = olPagerHtml(kind, arr.length);
    return arr.slice(olOpenPageIdx[kind] * OL_OPEN_PAGE, (olOpenPageIdx[kind] + 1) * OL_OPEN_PAGE);
  };
  const tm = s => (s.timeLimitMin ? `${s.timeLimitMin}분` : "시간 없음");
  listEl.innerHTML = open.length
    ? page(open, "open").map(s => `<li><button type="button" class="ol-open-item" data-ol-join="${olEsc(s.roomId)}"
        title="눌러서 이 방에 들어갑니다 (로그인 필요)">
        <b>${olEsc(s.hostName)}</b>${olTagHtml(s.hostTag)} <span class="ol-open-side ${s.openSide}">빈 자리 ${olSideName(s.openSide)}</span>
        <small>${tm(s)} · 방장 ${OL_CHARIM_NAMES[s.charim[s.hostSide]]} · ${olAgo(s.createdAtMs)} 만듦</small></button></li>`).join("")
    : '<li class="ol-hint">기다리는 공개 방이 없습니다.</li>';
  if (!open.length) olEl("ol-open-pager").innerHTML = "";
  liveEl.innerHTML = live.length
    ? page(live, "live").map(s => `<li><button type="button" class="ol-open-item" data-ol-watch="${olEsc(s.roomId)}"
        title="눌러서 관전합니다 (로그인 없이, 채팅 없음)">
        <b>초 ${olEsc(s.players.cho || "?")}</b>${olTagHtml(s.tags && s.tags.cho)} 대 <b>한 ${olEsc(s.players.han || "?")}</b>${olTagHtml(s.tags && s.tags.han)}
        <small>${s.ply}수 · ${tm(s)} · ${olAgo(s.startedAtMs || s.createdAtMs)} 시작</small></button></li>`).join("")
    : '<li class="ol-hint">진행 중인 공개 대국이 없습니다.</li>';
  if (!live.length) olEl("ol-live-pager").innerHTML = "";
}

/** 목록 영역이 보일 때만 구독한다 (읽기 비용) */
function olLobbySubscribe(visible) {
  if (visible && olBackend && !olLobbyUnsub) {
    olLobbyAt = Date.now();
    olLobbyUnsub = olWatchLobby(list => {
      olLobby = list || [];
      olRenderOpen();
    });
  } else if (!visible && olLobbyUnsub) {
    olLobbyUnsub();
    olLobbyUnsub = null;
  }
}

function olOpenPage(btn) {
  const el = btn instanceof HTMLElement ? btn : null;
  if (!el) return;
  const kind = el.dataset.kind === "live" ? "live" : "open";
  olOpenPageIdx[kind] = Math.max(0, olOpenPageIdx[kind] + (parseInt(el.dataset.step, 10) || 0));
  olRenderOpen();
}

async function olOpenClick(ev) {
  const join = ev.target.closest("[data-ol-join]");
  const watch = ev.target.closest("[data-ol-watch]");
  if (watch) {
    try {
      await olSpectate(watch.dataset.olWatch);
    } catch (e) {
      olToast(`관전하지 못했습니다: ${olErrorText(e)}`, 3500);
    }
    return;
  }
  if (!join) return;
  const id = join.dataset.olJoin;
  if (!olUser) {
    olSetUrlRoom(id); // 로그인하면 바로 들어간다 (olAutoJoinFromUrl)
    olRenderAuth();
    olToast("참가하려면 먼저 로그인하세요. 로그인하면 바로 이 방에 들어갑니다.", 3500);
    const out = olEl("ol-auth-out");
    if (out) out.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  try {
    await olJoinRoom(id);
  } catch (e) {
    olToast(`들어가지 못했습니다: ${olErrorText(e)}`, 3500);
  }
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
  const on = !!(olRoomId && olRoom && olUser && !olSpectating);
  const input = olEl("ol-chat-input");
  const send = olEl("ol-chat-send");
  const hint = olEl("ol-chat-hint");
  if (input) input.disabled = !on;
  if (send) send.disabled = !on;
  if (hint) {
    hint.hidden = on;
    hint.textContent = olSpectating ? "관전 중에는 채팅을 볼 수도 쓸 수도 없습니다." : "온라인 대국 방에 들어가면 상대와 채팅할 수 있습니다.";
  }
}

function olChatVisible() {
  const box = document.getElementById("setting-box");
  return !!(box && !box.hidden && box.dataset.tab === "ol-sec-chat" && document.visibilityState === "visible");
}

function olRenderChat() {
  const logEl = olEl("ol-chat-log");
  if (!logEl) return;
  olRenderOlderButton();
  if (!olRoomId) {
    logEl.innerHTML = "";
    olChatIds = [];
    olChatUnread = 0;
    olRenderBadge();
    return;
  }
  const ids = olChat.map(m => m.id);
  const prev = olChatIds;
  const first = prev.length === 0;
  // 앞부분이 그대로면 뒤에 붙이고, 아니면(이전 채팅을 불러옴·순서가 바뀜·거부된 글이 빠짐) 다시 그린다
  const keepsPrefix = prev.length <= ids.length && prev.every((id, k) => ids[k] === id);
  const fromBottom = logEl.scrollHeight - logEl.scrollTop;
  const atBottom = fromBottom - logEl.clientHeight < 40;
  const startAt = keepsPrefix ? prev.length : 0;
  if (!keepsPrefix) logEl.innerHTML = "";
  const prevSet = new Set(prev);
  const lastPrev = prev.length ? olChatById.get(prev[prev.length - 1]) : null;
  const frag = document.createDocumentFragment();
  for (let k = startAt; k < olChat.length; k++) {
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
    // 남이 새로 쓴 글(처음 불러온 것·이전 채팅은 빼고): 안 읽은 수를 세고, 채팅이 안 보이면 잠깐 띄운다
    const fresh = !first && !mine && !prevSet.has(m.id) && (!lastPrev || (m.atMs || 0) >= (lastPrev.atMs || 0));
    if (fresh) {
      olChatUnread++;
      if (!olChatVisible()) olToast(m.kind === "system" ? m.text : `${m.name}: ${m.text}`, 2600);
    }
  }
  logEl.appendChild(frag);
  olChatIds = ids;
  if (atBottom || first) logEl.scrollTop = logEl.scrollHeight;
  else if (!keepsPrefix) logEl.scrollTop = logEl.scrollHeight - fromBottom; // 위에 이전 채팅이 붙어도 보던 곳 그대로
  if (olChatVisible()) olChatUnread = 0;
  olRenderBadge();
}

/** "이전 채팅 더 보기": 이전 채팅이 더 있을 수 있을 때만 */
function olRenderOlderButton() {
  const btn = olEl("ol-chat-older");
  if (!btn) return;
  btn.hidden = !(olRoomId && !olSpectating && olChatHasOlder);
  btn.disabled = olChatLoadingOlder;
  btn.textContent = olChatLoadingOlder ? "불러오는 중…" : "이전 채팅 더 보기";
}

function olRenderBadge() {
  const badge = olEl("ol-chat-badge");
  if (!badge) return;
  const n = olChatUnread;
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? "9+" : String(n);
}

function olRender(what) {
  if (what === "backend") {
    olRenderBackend();
    olRenderOpen();
    if (olOpenVisible) olLobbySubscribe(true);
    return;
  }
  if (what === "devices") {
    olRenderDevices();
    return;
  }
  if (what === "auth") {
    olRenderAuth();
    olRenderDevices();
    olRenderRoom();
    return;
  }
  if (what === "chat") {
    olRenderChat();
    return;
  }
  if (what === "enter" && !olSpectating && typeof isRightDrawerOpen === "function" && isRightDrawerOpen() && typeof drawerShowTab === "function") {
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

async function olSignOut() {
  try {
    await olAuth.signOut();
  } catch (e) {
    olToast(`로그아웃하지 못했습니다: ${olErrorText(e)}`);
  }
}

/** 이 계정으로 로그인한 모든 기기(이 기기 포함)에서 로그아웃. 다른 기기는 늦어도 1시간 안에 풀리고, 그 사이 데이터 접근은 보안 규칙이 막는다 */
async function olSignOutAll() {
  const ok = await olConfirm("모든 기기에서 로그아웃할까요?", "이 기기를 포함해 이 계정으로 로그인한 곳이 모두 로그아웃됩니다. 다른 기기의 대국 접근도 바로 막힙니다.", "모두 로그아웃", "warn");
  if (!ok) return;
  try {
    await olAuth.signOutAll();
    olToast("모든 기기에서 로그아웃했습니다.", 3000);
  } catch (e) {
    olToast(`로그아웃하지 못했습니다: ${olErrorText(e)}`, 3500);
  }
}

async function olCreateRoomFromForm(btn) {
  const b = btn instanceof HTMLElement ? btn : null;
  if (b) b.disabled = true;
  try {
    const vis = document.querySelector('input[name="ol-vis"]:checked');
    const visibility = vis && vis.value === "public" ? "public" : "private";
    await olCreateRoom({
      side: olEl("ol-side").value,
      timeLimitMin: parseInt(olEl("ol-time").value, 10) || 0,
      charim: parseInt(olEl("ol-charim").value, 10) || 0,
      visibility
    });
    olToast(visibility === "public" ? "공개 방을 만들었습니다. 열린 대국 목록에 올라갑니다." : "방을 만들었습니다. 초대 링크를 상대에게 보내세요.", 3000);
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

function olReadyBtn() {
  if (!olInSetup()) return;
  olSetReady(!olRoom.ready).catch(e => olToast(`준비를 바꾸지 못했습니다: ${olErrorText(e)}`, 3000));
}

function olStartBtn() {
  olStartGame().catch(e => olToast(`시작하지 못했습니다: ${olErrorText(e)}`, 3000));
}

function olOpenSetupTab() {
  if (typeof jumpToDrawerSection === "function") jumpToDrawerSection("rd-sec-newgame");
}

window.olGoogleSignIn = olGoogleSignIn;
window.olSignOut = olSignOut;
window.olSignOutAll = olSignOutAll;
window.olCreateRoomFromForm = olCreateRoomFromForm;
window.olCopyInvite = olCopyInvite;
window.olShareInvite = olShareInvite;
window.olRequestUndoBtn = olRequestUndoBtn;
window.olResignBtn = olResignBtn;
window.olLeaveBtn = olLeaveBtn;
window.olUndoAccept = olUndoAccept;
window.olUndoReject = olUndoReject;
window.olReadyBtn = olReadyBtn;
window.olStartBtn = olStartBtn;
window.olOpenSetupTab = olOpenSetupTab;
window.olOpenPage = olOpenPage;

document.addEventListener("DOMContentLoaded", () => {
  olOnChange(olRender);
  olRenderBackend();
  olRenderOpen();
  olRenderAuth();
  olRenderRoom();

  olEl("ol-join-form").addEventListener("submit", olJoinFromForm);
  olEl("ol-open").addEventListener("click", olOpenClick);
  // 방 만들기 폼은 '새 대국' 탭의 지금 값(내 상차림·제한 시간)으로 채운다
  const charimSel = olEl("ol-charim");
  if (charimSel && typeof newGameState !== "undefined") charimSel.value = String(newGameState[0] | 0);
  const timeSel = olEl("ol-time");
  if (timeSel && typeof timeLimitMinutes === "number" && OL_TIME_CHOICES.includes(timeLimitMinutes)) timeSel.value = String(timeLimitMinutes);
  // 열린 대국 목록: 영역이 보일 때만 구독하고, 1분마다 "몇 분 전"·오래된 방을 다시 그린다. 5분마다 구독을 새로 건다(30분 기준 시각 갱신)
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      olOpenVisible = entries.some(e => e.isIntersecting);
      olLobbySubscribe(olOpenVisible);
    }).observe(olEl("ol-open"));
  } else {
    olOpenVisible = true;
  }
  setInterval(() => {
    if (olLobbyUnsub && Date.now() - olLobbyAt > 5 * 60 * 1000) {
      olLobbySubscribe(false);
      olLobbySubscribe(olOpenVisible);
    }
    if (olOpenVisible) olRenderOpen();
  }, 60 * 1000);
  // 방 만들기 접기: 접은 상태를 이 브라우저에 기억한다
  const createBox = olEl("ol-create");
  if (createBox) {
    try {
      if (localStorage.getItem("olCreateOpen") === "0") createBox.open = false;
    } catch (e) {
      // 저장소를 못 쓰면 펼친 채로 둔다
    }
    createBox.addEventListener("toggle", () => {
      try {
        localStorage.setItem("olCreateOpen", createBox.open ? "1" : "0");
      } catch (e) {
        // 기억하지 못해도 이번 화면에서는 동작
      }
    });
  }
  olEl("ol-devices").addEventListener("toggle", ev => {
    if (ev.target.open) olRenderDevices();
  });
  olEl("ol-chat-form").addEventListener("submit", ev => {
    ev.preventDefault();
    const input = olEl("ol-chat-input");
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    olSendChat(text).then(ok => {
      if (!ok && !input.value) input.value = text; // 못 보냈으면 쓴 글을 돌려 둔다
    });
  });
  olEl("ol-chat-older").addEventListener("click", () => olLoadOlderChat());
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
      olChatUnread = 0;
      olRenderBadge();
    }
  };
  document.addEventListener("click", () => setTimeout(seen, 350));
  document.addEventListener("visibilitychange", seen);

  // 초대·관전 링크로 왔으면 온라인 대국 영역을 연다
  if ((olUrlRoom() || new URLSearchParams(window.location.search).get("watch")) && typeof jumpToDrawerSection === "function") {
    setTimeout(() => jumpToDrawerSection("ol-sec-online"), 0);
  }
});
