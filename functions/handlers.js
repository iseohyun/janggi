/**
 * @fileoverview sendEmailCode·verifyEmailCode 본체. Firebase 패키지에 기대지 않아 Node 테스트로 바로 돌릴 수 있다.
 * index.js가 Firestore·Auth·메일·HttpsError를 넣어 준다.
 *  - 코드 기록: games/janggi/emailCodes/{uid}   (클라이언트는 규칙으로 읽기·쓰기 금지)
 *  - 사용자 등록: games/janggi/users/{uid}      (본인만 읽기, 쓰기는 이 함수만)
 * @module functions/handlers
 */
const crypto = require("node:crypto");
const core = require("./email-code-core");

const ROOT = "games/janggi";

/**
 * @param {Object} deps
 * @param {{runTransaction: Function, set: Function}} deps.store - 경로 문자열로 읽고 쓰는 저장소
 * @param {{updateUser: Function}} deps.auth
 * @param {{send: Function}} deps.mailer
 * @param {(code: string, message: string, details?: Object) => Error} deps.fail - HttpsError 만들기
 * @param {() => number} [deps.now]
 * @param {() => string} [deps.randomCode]
 * @param {{info: Function, error: Function}} [deps.log]
 */
function makeHandlers(deps) {
  const now = deps.now || (() => Date.now());
  const randomCode = deps.randomCode || (() => String(crypto.randomInt(0, 1000000)).padStart(6, "0"));
  const randomSalt = () => crypto.randomBytes(16).toString("hex");
  const hash = async s => crypto.createHash("sha256").update(s).digest("hex");
  const log = deps.log || console;
  const fail = deps.fail;

  function who(request) {
    const a = request && request.auth;
    if (!a || !a.uid) throw fail("unauthenticated", "로그인이 필요합니다.");
    const token = a.token || {};
    if (!token.email) throw fail("failed-precondition", "이메일이 없는 계정입니다.");
    const provider = token.firebase && token.firebase.sign_in_provider;
    return { uid: a.uid, email: String(token.email).toLowerCase(), name: token.name || "", verified: token.email_verified === true, provider };
  }

  const codePath = uid => `${ROOT}/emailCodes/${uid}`;
  const userPath = uid => `${ROOT}/users/${uid}`;

  async function sendEmailCode(request) {
    const u = who(request);
    if (u.verified) return { alreadyVerified: true };
    if (u.provider && u.provider !== "password") throw fail("failed-precondition", "이메일·비밀번호 계정만 코드 인증을 합니다.");
    let issued = null;
    let before = null;
    await deps.store.runTransaction(async tx => {
      before = await tx.get(codePath(u.uid));
      const res = await core.issueCode(before, u, { now: now(), randomCode, randomSalt, hash });
      if (!res.ok) {
        issued = res;
        return;
      }
      tx.set(codePath(u.uid), res.record);
      issued = res;
    });
    if (!issued.ok) {
      throw fail("resource-exhausted", "지금은 코드를 보낼 수 없습니다.", { reason: issued.reason, retryAfterMs: issued.retryAfterMs });
    }
    try {
      await deps.mailer.send({ to: u.email, code: issued.code, ttlMinutes: core.LIMITS.codeTtlMs / 60000 });
    } catch (e) {
      log.error("[sendEmailCode] 메일 발송 실패", e && e.message);
      // 보내지 못했으면 방금 만든 코드를 없던 일로 (다시 보내기 제한도 풀림)
      await deps.store.set(codePath(u.uid), before || { codeHash: null, lastSentAt: 0 });
      throw fail("unavailable", "인증 메일을 보내지 못했습니다. 잠시 뒤 다시 해 주세요.");
    }
    return { expiresAt: issued.expiresAt, resendAt: issued.resendAt, dailyLeft: issued.dailyLeft };
  }

  async function verifyEmailCode(request) {
    const u = who(request);
    if (u.verified) return { ok: true, alreadyVerified: true };
    const input = request.data && request.data.code;
    let result = null;
    await deps.store.runTransaction(async tx => {
      const rec = await tx.get(codePath(u.uid));
      result = await core.checkCode(rec, u, input, { now: now(), hash });
      if (result.record) tx.set(codePath(u.uid), result.record);
    });
    if (!result.ok) {
      return { ok: false, reason: result.reason, attemptsLeft: result.attemptsLeft, retryAfterMs: result.retryAfterMs };
    }
    await deps.auth.updateUser(u.uid, { emailVerified: true });
    await deps.store.set(userPath(u.uid), {
      uid: u.uid,
      email: u.email,
      name: u.name,
      provider: "password",
      verifiedAt: now(),
      app: "janggi"
    });
    log.info("[verifyEmailCode] 인증 완료", u.uid);
    return { ok: true };
  }

  return { sendEmailCode, verifyEmailCode };
}

module.exports = { makeHandlers, ROOT };
