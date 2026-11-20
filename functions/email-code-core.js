/**
 * @fileoverview 이메일 인증 숫자 코드의 규칙 (서버·가짜 백엔드가 함께 쓰는 순수 함수).
 *  - 6자리 숫자 코드, 10분 뒤 만료.
 *  - 보내기 제한: 60초에 1번, 하루(UTC 날짜) 10번.
 *  - 5번 틀리면 그 코드를 버리고 15분 동안 잠근다 (그동안 새 코드도 못 받음).
 *  - 코드는 저장하지 않고 "소금 + 사용자 id + 코드"의 해시만 저장한다. 비교는 시간이 일정하게.
 *  - 저장소·시계·난수·해시는 밖에서 넣는다 (functions/handlers.js는 Node crypto, module/online/fake-backend.js는 Web Crypto).
 * 브라우저에서는 window.EmailCodeCore, Node에서는 module.exports.
 * @module functions/email-code-core
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EmailCodeCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const LIMITS = Object.freeze({
    codeLength: 6,
    codeTtlMs: 10 * 60 * 1000,
    resendMs: 60 * 1000,
    dailyMax: 10,
    maxAttempts: 5,
    lockMs: 15 * 60 * 1000
  });

  /** 실패 이유 (클라이언트 문구는 module/online/online-core.js olErrorText) */
  const REASONS = Object.freeze({
    TOO_SOON: "too-soon",
    DAILY_LIMIT: "daily-limit",
    LOCKED: "locked",
    NO_CODE: "no-code",
    EXPIRED: "expired",
    BAD_FORMAT: "bad-format",
    MISMATCH: "mismatch"
  });

  function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function sameText(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let k = 0; k < a.length; k++) diff |= a.charCodeAt(k) ^ b.charCodeAt(k);
    return diff === 0;
  }

  function codeHashInput(uid, salt, code) {
    return `janggi-email-code:${uid}:${salt}:${code}`;
  }

  /**
   * 새 코드를 만든다. 막혀 있으면 { ok: false, reason, retryAfterMs }.
   * @param {Object|null} rec - 저장된 기록
   * @param {{uid: string, email: string}} who
   * @param {{now: number, randomCode: () => string, randomSalt: () => string, hash: (s: string) => Promise<string>}} deps
   * @returns {Promise<{ok: true, code: string, record: Object, expiresAt: number, resendAt: number, dailyLeft: number}
   *                   | {ok: false, reason: string, retryAfterMs: number}>}
   */
  async function issueCode(rec, who, deps) {
    const now = deps.now;
    const r = rec || {};
    if (r.lockedUntil && r.lockedUntil > now) {
      return { ok: false, reason: REASONS.LOCKED, retryAfterMs: r.lockedUntil - now };
    }
    if (r.lastSentAt && now - r.lastSentAt < LIMITS.resendMs) {
      return { ok: false, reason: REASONS.TOO_SOON, retryAfterMs: LIMITS.resendMs - (now - r.lastSentAt) };
    }
    const today = dayKey(now);
    const sentToday = r.day === today ? (r.dayCount || 0) : 0;
    if (sentToday >= LIMITS.dailyMax) {
      const tomorrow = Date.parse(`${today}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
      return { ok: false, reason: REASONS.DAILY_LIMIT, retryAfterMs: tomorrow - now };
    }
    const code = String(deps.randomCode());
    if (!/^\d{6}$/.test(code)) throw new Error("randomCode는 6자리 숫자여야 합니다");
    const salt = String(deps.randomSalt());
    const record = {
      email: who.email,
      codeHash: await deps.hash(codeHashInput(who.uid, salt, code)),
      salt,
      expiresAt: now + LIMITS.codeTtlMs,
      attempts: 0,
      lastSentAt: now,
      day: today,
      dayCount: sentToday + 1,
      lockedUntil: 0,
      verifiedAt: r.verifiedAt || 0
    };
    return {
      ok: true,
      code,
      record,
      expiresAt: record.expiresAt,
      resendAt: now + LIMITS.resendMs,
      dailyLeft: LIMITS.dailyMax - record.dayCount
    };
  }

  /**
   * 받은 코드를 확인한다. record는 항상 저장할 새 기록 (바뀌지 않았으면 null).
   * @returns {Promise<{ok: boolean, reason?: string, attemptsLeft?: number, retryAfterMs?: number, record: Object|null}>}
   */
  async function checkCode(rec, who, input, deps) {
    const now = deps.now;
    if (rec && rec.lockedUntil && rec.lockedUntil > now) {
      return { ok: false, reason: REASONS.LOCKED, retryAfterMs: rec.lockedUntil - now, record: null };
    }
    if (!rec || !rec.codeHash) return { ok: false, reason: REASONS.NO_CODE, record: null };
    if (rec.expiresAt <= now) {
      return { ok: false, reason: REASONS.EXPIRED, record: Object.assign({}, rec, { codeHash: null }) };
    }
    const code = String(input == null ? "" : input).trim();
    if (!/^\d{6}$/.test(code)) {
      return { ok: false, reason: REASONS.BAD_FORMAT, attemptsLeft: LIMITS.maxAttempts - (rec.attempts || 0), record: null };
    }
    const hash = await deps.hash(codeHashInput(who.uid, rec.salt, code));
    if (sameText(hash, rec.codeHash)) {
      return { ok: true, record: Object.assign({}, rec, { codeHash: null, attempts: 0, verifiedAt: now }) };
    }
    const attempts = (rec.attempts || 0) + 1;
    if (attempts >= LIMITS.maxAttempts) {
      return {
        ok: false,
        reason: REASONS.LOCKED,
        retryAfterMs: LIMITS.lockMs,
        attemptsLeft: 0,
        record: Object.assign({}, rec, { codeHash: null, attempts, lockedUntil: now + LIMITS.lockMs })
      };
    }
    return {
      ok: false,
      reason: REASONS.MISMATCH,
      attemptsLeft: LIMITS.maxAttempts - attempts,
      record: Object.assign({}, rec, { attempts })
    };
  }

  return { LIMITS, REASONS, issueCode, checkCode, dayKey };
});
