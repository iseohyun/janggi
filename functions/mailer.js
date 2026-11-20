/**
 * @fileoverview 로그인 승인 메일·새 기기 알림 메일 보내기. 수단은 배포 설정 MAIL_PROVIDER 하나로 고른다 (docs/online-setup.md 비교표).
 *  - "smtp"          : Gmail 등 SMTP (nodemailer). 비밀번호(앱 비밀번호)는 Secret Manager의 MAIL_SECRET
 *  - "resend"        : Resend HTTP API. API 키는 MAIL_SECRET
 *  - "sendgrid"      : SendGrid HTTP API. API 키는 MAIL_SECRET
 *  - "trigger-email" : Firebase "Trigger Email from Firestore" 확장이 읽는 mail 컬렉션에 쓴다 (비밀값은 확장이 가짐)
 *  - "log"           : 에뮬레이터 전용. 메일 대신 함수 로그에 승인 링크를 남긴다 (실제 배포에서는 거부)
 * 비밀값은 코드·클라이언트에 넣지 않는다.
 * @module functions/mailer
 */

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function kstTime(ms) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(ms));
}

/**
 * 로그인 승인 메일. 확인 숫자는 넣지 않는다 (요청한 화면에만 보인다).
 * @param {{link: string, device: string, requestedAt: number, ttlMinutes: number}} m
 */
function loginMessage(m) {
  const when = kstTime(m.requestedAt);
  const subject = "[웹장기] 로그인 승인 요청";
  const text = [
    "웹장기 온라인 대국에 이 이메일로 로그인하려는 요청이 있습니다.",
    "",
    `요청 시각: ${when} (한국 시간)`,
    `요청한 기기: ${m.device}`,
    "",
    "직접 요청했다면 아래 링크를 열고, 로그인하려는 화면에 보이는 숫자를 골라 [승인]을 누르세요.",
    m.link,
    "",
    `${m.ttlMinutes}분이 지나면 이 링크는 쓸 수 없습니다.`,
    "직접 요청하지 않았다면 링크를 열지 않거나, 열어서 [내가 요청한 게 아님]을 누르세요. 아무 일도 일어나지 않습니다."
  ].join("\n");
  const html = `<div style="font-family:system-ui,'Malgun Gothic',sans-serif;line-height:1.6;color:#111">
<p>웹장기 온라인 대국에 이 이메일로 로그인하려는 요청이 있습니다.</p>
<p style="margin:0">요청 시각: ${esc(when)} (한국 시간)<br>요청한 기기: ${esc(m.device)}</p>
<p>직접 요청했다면 아래 단추를 누르고, 로그인하려는 화면에 보이는 <b>숫자</b>를 골라 승인하세요.</p>
<p><a href="${esc(m.link)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;text-decoration:none">로그인 승인 페이지 열기</a></p>
<p style="color:#555;font-size:13px">${m.ttlMinutes}분이 지나면 이 링크는 쓸 수 없습니다.<br>직접 요청하지 않았다면 무시하거나, 페이지에서 [내가 요청한 게 아님]을 누르세요.</p></div>`;
  return { subject, text, html };
}

/**
 * 새 기기 로그인 알림 메일.
 * @param {{link: string, device: string, loginAt: number, linkDays: number}} m
 */
function newDeviceMessage(m) {
  const when = kstTime(m.loginAt);
  const subject = "[웹장기] 새 기기에서 로그인했습니다";
  const text = [
    "웹장기 온라인 대국 계정에 새 기기에서 로그인했습니다.",
    "",
    `로그인 시각: ${when} (한국 시간)`,
    `기기: ${m.device}`,
    "",
    "본인이라면 아무것도 하지 않아도 됩니다.",
    "본인이 아니면 아래 링크를 열어 [모든 기기에서 로그아웃]을 누르세요. 링크를 열기만 해서는 아무 일도 일어나지 않습니다.",
    m.link,
    "",
    `이 링크는 ${m.linkDays}일 동안 한 번만 쓸 수 있습니다.`
  ].join("\n");
  const html = `<div style="font-family:system-ui,'Malgun Gothic',sans-serif;line-height:1.6;color:#111">
<p>웹장기 온라인 대국 계정에 <b>새 기기</b>에서 로그인했습니다.</p>
<p style="margin:0">로그인 시각: ${esc(when)} (한국 시간)<br>기기: ${esc(m.device)}</p>
<p>본인이라면 아무것도 하지 않아도 됩니다. <b>본인이 아니면</b> 아래 단추를 누른 뒤 페이지에서 한 번 더 확인하세요.</p>
<p><a href="${esc(m.link)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#b91c1c;color:#fff;font-weight:700;text-decoration:none">모든 기기에서 로그아웃</a></p>
<p style="color:#555;font-size:13px">링크를 열기만 해서는 아무 일도 일어나지 않습니다. 이 링크는 ${m.linkDays}일 동안 한 번만 쓸 수 있습니다.</p></div>`;
  return { subject, text, html };
}

/** 메일 종류별 제목·본문 ("login" 승인 요청, "new-device" 새 기기 알림) */
function message(m) {
  return m.kind === "new-device" ? newDeviceMessage(m) : loginMessage(m);
}

/**
 * @param {Object} o
 * @param {string} o.provider
 * @param {string} o.from - 보내는 사람 (예: "웹장기 <no-reply@example.com>")
 * @param {() => string} o.secret - MAIL_SECRET 값 (부를 때 읽음)
 * @param {{host: string, port: number, user: string}} [o.smtp]
 * @param {{collection: Function}} [o.db] - trigger-email용 Firestore
 * @param {boolean} [o.emulator]
 * @param {{info: Function}} [o.log]
 */
function makeMailer(o) {
  const log = o.log || console;
  return {
    async send(mail) {
      const to = mail.to;
      const m = message(mail);
      switch (o.provider) {
        case "log":
          if (!o.emulator) throw new Error("MAIL_PROVIDER=log는 에뮬레이터에서만 쓸 수 있습니다");
          log.info(`[메일 대신 로그] ${to} ${mail.kind} 링크 ${mail.link}`);
          return;
        case "smtp": {
          const nodemailer = require("nodemailer");
          const port = Number(o.smtp.port) || 465;
          const transport = nodemailer.createTransport({
            host: o.smtp.host,
            port,
            secure: port === 465,
            auth: { user: o.smtp.user, pass: o.secret() }
          });
          await transport.sendMail({ from: o.from || o.smtp.user, to, subject: m.subject, text: m.text, html: m.html });
          return;
        }
        case "resend": {
          if (!o.from) throw new Error("MAIL_FROM이 비어 있습니다 (Resend에서 인증한 도메인의 주소)");
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${o.secret()}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: o.from, to: [to], subject: m.subject, text: m.text, html: m.html })
          });
          if (!res.ok) throw new Error(`Resend ${res.status}`);
          return;
        }
        case "sendgrid": {
          const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: { Authorization: `Bearer ${o.secret()}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: to }] }],
              from: { email: o.from },
              subject: m.subject,
              content: [{ type: "text/plain", value: m.text }, { type: "text/html", value: m.html }]
            })
          });
          if (!res.ok) throw new Error(`SendGrid ${res.status}`);
          return;
        }
        case "trigger-email":
          await o.db.collection("mail").add({ to, message: { subject: m.subject, text: m.text, html: m.html } });
          return;
        default:
          throw new Error(`알 수 없는 MAIL_PROVIDER: ${o.provider}`);
      }
    }
  };
}

module.exports = { makeMailer, message };
