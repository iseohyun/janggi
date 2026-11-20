/**
 * sendEmailCode·verifyEmailCode 본체(handlers.js)를 메모리 저장소·가짜 시계·가짜 메일로 시험한다.
 * 실행: functions 폴더에서 `node --test test/` (Firebase 패키지 없이 돈다)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeHandlers } = require("../handlers");
const { LIMITS } = require("../email-code-core");

function setup(opts = {}) {
  const docs = new Map();
  const clock = { t: Date.parse("2026-11-20T03:00:00Z") };
  const sent = [];
  const users = new Map();
  const store = {
    async runTransaction(fn) {
      const writes = [];
      await fn({
        get: async p => (docs.has(p) ? JSON.parse(JSON.stringify(docs.get(p))) : null),
        set: (p, d) => writes.push([p, d])
      });
      writes.forEach(([p, d]) => docs.set(p, JSON.parse(JSON.stringify(d))));
    },
    async set(p, d) {
      docs.set(p, Object.assign({}, docs.get(p) || {}, JSON.parse(JSON.stringify(d))));
    }
  };
  const mailer = {
    async send(m) {
      if (opts.mailFails) throw new Error("smtp down");
      sent.push(m);
    }
  };
  const auth = { async updateUser(uid, patch) { users.set(uid, Object.assign({}, users.get(uid), patch)); } };
  const fail = (code, message, details) => Object.assign(new Error(message), { code, details });
  const h = makeHandlers({ store, auth, mailer, fail, now: () => clock.t, log: { info() {}, error() {} } });
  const req = (data, token) => ({
    auth: { uid: "u1", token: Object.assign({ email: "Player@Test.local", email_verified: false, firebase: { sign_in_provider: "password" } }, token) },
    data
  });
  return { h, docs, clock, sent, users, req };
}

const lastCode = sent => sent[sent.length - 1].code;

test("맞는 코드 → 인증, emailVerified=true, users 문서 등록, 코드 해시만 저장", async () => {
  const { h, docs, sent, users, req } = setup();
  const r = await h.sendEmailCode(req());
  assert.equal(sent.length, 1);
  assert.match(sent[0].code, /^\d{6}$/);
  assert.equal(sent[0].to, "player@test.local");
  const rec = docs.get("games/janggi/emailCodes/u1");
  assert.ok(rec.codeHash && !JSON.stringify(rec).includes(sent[0].code), "코드 원문을 저장하지 않음");
  assert.equal(r.expiresAt - r.resendAt, LIMITS.codeTtlMs - LIMITS.resendMs);
  const v = await h.verifyEmailCode(req({ code: lastCode(sent) }));
  assert.deepEqual(v, { ok: true });
  assert.equal(users.get("u1").emailVerified, true);
  assert.equal(docs.get("games/janggi/users/u1").email, "player@test.local");
  // 같은 코드를 다시 쓸 수 없음
  const again = await h.verifyEmailCode(req({ code: lastCode(sent) }));
  assert.equal(again.reason, "no-code");
});

test("틀린 코드 → mismatch, 남은 횟수 줄어듦", async () => {
  const { h, sent, req, users } = setup();
  await h.sendEmailCode(req());
  const wrong = lastCode(sent) === "000000" ? "111111" : "000000";
  const v = await h.verifyEmailCode(req({ code: wrong }));
  assert.equal(v.ok, false);
  assert.equal(v.reason, "mismatch");
  assert.equal(v.attemptsLeft, LIMITS.maxAttempts - 1);
  assert.equal(users.has("u1"), false);
  // 형식이 틀린 입력은 횟수를 깎지 않음
  const bad = await h.verifyEmailCode(req({ code: "12ab" }));
  assert.equal(bad.reason, "bad-format");
  assert.equal(bad.attemptsLeft, LIMITS.maxAttempts - 1);
});

test("10분 지나면 만료 → 맞는 코드도 거부", async () => {
  const { h, sent, req, clock } = setup();
  await h.sendEmailCode(req());
  clock.t += LIMITS.codeTtlMs + 1;
  const v = await h.verifyEmailCode(req({ code: lastCode(sent) }));
  assert.equal(v.reason, "expired");
  const v2 = await h.verifyEmailCode(req({ code: lastCode(sent) }));
  assert.equal(v2.reason, "no-code");
});

test("너무 자주 보내기 → 60초 안 거부, 하루 10번 넘으면 거부", async () => {
  const { h, req, clock, sent } = setup();
  await h.sendEmailCode(req());
  await assert.rejects(h.sendEmailCode(req()), e => e.code === "resource-exhausted" && e.details.reason === "too-soon" && e.details.retryAfterMs > 0);
  clock.t += LIMITS.resendMs;
  await h.sendEmailCode(req()); // 2번째
  for (let k = 3; k <= LIMITS.dailyMax; k++) {
    clock.t += LIMITS.resendMs;
    await h.sendEmailCode(req());
  }
  assert.equal(sent.length, LIMITS.dailyMax);
  clock.t += LIMITS.resendMs;
  await assert.rejects(h.sendEmailCode(req()), e => e.details.reason === "daily-limit");
  // 다음 날(UTC)에는 다시 됨
  clock.t = Date.parse("2026-11-21T00:00:01Z");
  await h.sendEmailCode(req());
  assert.equal(sent.length, LIMITS.dailyMax + 1);
});

test("5번 틀리면 잠금 → 맞는 코드·새 코드 모두 15분 거부, 그 뒤 풀림", async () => {
  const { h, sent, req, clock } = setup();
  await h.sendEmailCode(req());
  const good = lastCode(sent);
  const wrong = good === "000000" ? "111111" : "000000";
  let v;
  for (let k = 0; k < LIMITS.maxAttempts; k++) v = await h.verifyEmailCode(req({ code: wrong }));
  assert.equal(v.reason, "locked");
  assert.equal(v.attemptsLeft, 0);
  const afterLock = await h.verifyEmailCode(req({ code: good }));
  assert.equal(afterLock.reason, "locked");
  clock.t += LIMITS.resendMs;
  await assert.rejects(h.sendEmailCode(req()), e => e.details.reason === "locked");
  clock.t += LIMITS.lockMs;
  await h.sendEmailCode(req());
  const ok = await h.verifyEmailCode(req({ code: lastCode(sent) }));
  assert.equal(ok.ok, true);
});

test("로그인 안 함·이미 인증·Google 계정·메일 실패 처리", async () => {
  const { h, req, docs } = setup();
  await assert.rejects(h.sendEmailCode({ data: {} }), e => e.code === "unauthenticated");
  assert.deepEqual(await h.sendEmailCode(req({}, { email_verified: true })), { alreadyVerified: true });
  await assert.rejects(h.sendEmailCode(req({}, { firebase: { sign_in_provider: "google.com" } })), e => e.code === "failed-precondition");
  const f = setup({ mailFails: true });
  await assert.rejects(f.h.sendEmailCode(f.req()), e => e.code === "unavailable");
  // 메일을 못 보냈으면 다시 보내기 제한에 걸리지 않음
  const rec = f.docs.get("games/janggi/emailCodes/u1");
  assert.ok(!rec.codeHash && !rec.lastSentAt);
  assert.equal(docs.size, 0);
});
