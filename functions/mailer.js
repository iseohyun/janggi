/**
 * @fileoverview 인증 코드 메일 보내기. 수단은 배포 설정 MAIL_PROVIDER 하나로 고른다 (docs/online-setup.md 비교표).
 *  - "smtp"          : Gmail 등 SMTP (nodemailer). 비밀번호(앱 비밀번호)는 Secret Manager의 MAIL_SECRET
 *  - "resend"        : Resend HTTP API. API 키는 MAIL_SECRET
 *  - "sendgrid"      : SendGrid HTTP API. API 키는 MAIL_SECRET
 *  - "trigger-email" : Firebase "Trigger Email from Firestore" 확장이 읽는 mail 컬렉션에 쓴다 (비밀값은 확장이 가짐)
 *  - "log"           : 에뮬레이터 전용. 메일 대신 함수 로그에 코드를 남긴다 (실제 배포에서는 거부)
 * 비밀값은 코드·클라이언트에 넣지 않는다.
 * @module functions/mailer
 */

function message(code, ttlMinutes) {
  const subject = `[웹장기] 이메일 인증 코드 ${code}`;
  const text = [
    "웹장기 온라인 대국 이메일 인증 코드입니다.",
    "",
    `    ${code}`,
    "",
    `${ttlMinutes}분 안에 웹장기 화면에 넣어 주세요.`,
    "직접 요청하지 않았다면 이 메일은 무시해도 됩니다."
  ].join("\n");
  const html = `<div style="font-family:system-ui,'Malgun Gothic',sans-serif;line-height:1.6">
<p>웹장기 온라인 대국 이메일 인증 코드입니다.</p>
<p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p>
<p>${ttlMinutes}분 안에 웹장기 화면에 넣어 주세요.<br>직접 요청하지 않았다면 이 메일은 무시해도 됩니다.</p></div>`;
  return { subject, text, html };
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
    async send({ to, code, ttlMinutes }) {
      const m = message(code, ttlMinutes);
      switch (o.provider) {
        case "log":
          if (!o.emulator) throw new Error("MAIL_PROVIDER=log는 에뮬레이터에서만 쓸 수 있습니다");
          log.info(`[메일 대신 로그] ${to} 인증 코드 ${code}`);
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
