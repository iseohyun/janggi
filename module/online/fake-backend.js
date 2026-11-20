/**
 * @fileoverview 온라인 대국 가짜 백엔드 (개발·검증용).
 *  - 같은 브라우저의 두 탭이 한 판을 둔다. 데이터는 localStorage("janggiOnlineFake")에 두고,
 *    바뀌면 BroadcastChannel("janggi-online-fake")로 다른 탭에 알린다. 새로고침해도 남아 있으므로 복원도 시험할 수 있다.
 *  - 로그인은 탭마다 따로다(sessionStorage). Google 로그인은 가짜 사용자(인증됨)를 만든다. 이메일 계정은 이 브라우저 안에만 있다.
 *  - 이메일 숫자 코드 인증은 Cloud Functions와 같은 규칙(functions/email-code-core.js)을 쓴다. 메일 대신 콘솔에 코드를 찍고,
 *    시험용으로 OnlineFakeBackend.peekCode()가 마지막 코드를 돌려준다. 인증 전 계정은 방을 만들 수 없다(firestore.rules 흉내).
 *  - Firebase 백엔드(firebase-backend.js)와 같은 모양의 함수를 내놓는다. 규칙 검사는 firestore.rules가 하는 것 중
 *    "차례·참가자·수 번호"만 흉내 낸다 (받은 수가 장기 규칙에 맞는지는 받는 쪽 online-core.js가 본다).
 * 공개: window.OnlineFakeBackend (online-core.js가 고른다)
 * @module online/fake-backend
 */

(function () {
  const DB_KEY = "janggiOnlineFake";
  const USER_KEY = "janggiFakeUser";
  const LATENCY_MS = 40; // 네트워크 흉내

  const chan = ("BroadcastChannel" in window) ? new BroadcastChannel("janggi-online-fake") : null;
  const listeners = new Set(); // {roomId, what, fire}
  const authListeners = new Set();

  function readDb() {
    try {
      const db = JSON.parse(localStorage.getItem(DB_KEY) || "null");
      if (db && db.rooms) return db;
    } catch (e) {
      console.warn("[fake-backend] 저장소를 읽지 못해 새로 시작합니다:", e);
    }
    return { rooms: {}, moves: {}, chat: {}, users: {}, emailCodes: {}, devMail: {} };
  }

  function writeDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function later(fn) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(fn());
        } catch (e) {
          reject(e);
        }
      }, LATENCY_MS);
    });
  }

  function fail(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }

  function notify(roomId, what) {
    listeners.forEach(l => {
      if (l.roomId === roomId && l.what === what) l.fire();
    });
    if (chan) chan.postMessage({ roomId, what });
  }

  if (chan) {
    chan.onmessage = ev => {
      const { roomId, what } = ev.data || {};
      listeners.forEach(l => {
        if (l.roomId === roomId && l.what === what) l.fire();
      });
    };
  }

  function watch(roomId, what, read, cb) {
    const l = { roomId, what, fire: () => cb(read()) };
    listeners.add(l);
    setTimeout(l.fire, 0); // Firestore onSnapshot처럼 처음 한 번 바로 준다
    return () => listeners.delete(l);
  }

  const clone = v => JSON.parse(JSON.stringify(v));

  // ===== 로그인 =====

  function currentUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function setUser(user) {
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(USER_KEY);
    authListeners.forEach(cb => cb(user));
    return user;
  }

  function newUid() {
    return "fake-" + Math.random().toString(36).slice(2, 10);
  }

  // 비밀번호는 이 브라우저 안 시험용이지만 평문으로 두지 않는다
  function pwHash(pw) {
    let h = 2166136261;
    for (let k = 0; k < pw.length; k++) {
      h ^= pw.charCodeAt(k);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  const auth = {
    onChange(cb) {
      authListeners.add(cb);
      setTimeout(() => cb(currentUser()), 0);
      return () => authListeners.delete(cb);
    },
    signInGoogle() {
      return later(() => {
        const n = Math.floor(Math.random() * 900 + 100);
        return setUser({ uid: newUid(), name: `구글사용자${n}`, email: `google${n}@example.test`, provider: "google", verified: true });
      });
    },
    signInEmail(email, pw) {
      return later(() => {
        const db = readDb();
        const acc = db.users[String(email).toLowerCase()];
        if (!acc) throw fail("auth/user-not-found");
        if (acc.pw !== pwHash(pw)) throw fail("auth/wrong-password");
        return setUser({ uid: acc.uid, name: acc.name, email: acc.email, provider: "password", verified: !!acc.verified });
      });
    },
    signUpEmail(email, pw, name) {
      return later(() => {
        const db = readDb();
        const key = String(email).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) throw fail("auth/invalid-email");
        if (String(pw).length < 6) throw fail("auth/weak-password");
        if (db.users[key]) throw fail("auth/email-already-in-use");
        const acc = { uid: newUid(), name: name || key.split("@")[0], email: key, pw: pwHash(pw), verified: false };
        db.users[key] = acc;
        writeDb(db);
        return setUser({ uid: acc.uid, name: acc.name, email: acc.email, provider: "password", verified: false });
      });
    },
    resetPassword(email) {
      return later(() => {
        const db = readDb();
        if (!db.users[String(email).toLowerCase()]) throw fail("auth/user-not-found");
        console.info("[fake-backend] 가짜 백엔드라 메일을 보내지 않습니다:", email);
        return true;
      });
    },
    signOut() {
      return later(() => setUser(null));
    },
    sendEmailCode() {
      return later(() => null).then(async () => {
        const user = currentUser();
        if (!user) throw fail("unauthenticated");
        if (user.verified) return { alreadyVerified: true };
        const db = readDb();
        const res = await window.EmailCodeCore.issueCode(db.emailCodes[user.uid] || null, user, codeDeps());
        if (!res.ok) throw Object.assign(fail("resource-exhausted"), { details: { reason: res.reason, retryAfterMs: res.retryAfterMs } });
        db.emailCodes[user.uid] = res.record;
        db.devMail[user.uid] = res.code;
        writeDb(db);
        console.info(`[fake-backend] 메일 대신: ${user.email} 인증 코드 ${res.code}`);
        return { expiresAt: res.expiresAt, resendAt: res.resendAt, dailyLeft: res.dailyLeft };
      });
    },
    verifyEmailCode(code) {
      return later(() => null).then(async () => {
        const user = currentUser();
        if (!user) throw fail("unauthenticated");
        if (user.verified) return { ok: true, alreadyVerified: true };
        const db = readDb();
        const r = await window.EmailCodeCore.checkCode(db.emailCodes[user.uid] || null, user, code, codeDeps());
        if (r.record) db.emailCodes[user.uid] = r.record;
        if (r.ok) {
          const acc = db.users[user.email];
          if (acc) acc.verified = true;
          delete db.devMail[user.uid];
        }
        writeDb(db);
        if (!r.ok) return { ok: false, reason: r.reason, attemptsLeft: r.attemptsLeft, retryAfterMs: r.retryAfterMs };
        setUser(Object.assign({}, user, { verified: true }));
        return { ok: true };
      });
    }
  };

  // 시험용 시계 (OnlineFakeBackend.advanceClock(ms)로 만료·잠금을 미리 볼 수 있다)
  let clockOffset = 0;

  function codeDeps() {
    return {
      now: Date.now() + clockOffset,
      randomCode: () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"),
      randomSalt: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""),
      hash: async text => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
      }
    };
  }

  // ===== 방 =====

  function isMember(room, uid) {
    return !!room && room.members.includes(uid);
  }

  const api = {
    kind: "fake",
    label: "가짜 백엔드 (이 브라우저의 탭끼리)",
    auth,

    createRoom(id, room) {
      return later(() => {
        const db = readDb();
        const user = currentUser();
        // firestore.rules: 방 만들기는 Google 로그인 또는 이메일 인증을 마친 사용자만
        if (!user || user.uid !== room.hostUid || !user.verified) throw fail("permission-denied", "인증된 사용자만 방을 만들 수 있습니다");
        if (db.rooms[id]) throw fail("already-exists");
        db.rooms[id] = clone(room);
        db.moves[id] = {};
        db.chat[id] = [];
        writeDb(db);
        notify(id, "room");
        return id;
      });
    },

    getRoom(id) {
      return later(() => {
        const room = readDb().rooms[id];
        return room ? clone(room) : null;
      });
    },

    /** 빈 자리에 앉는다 (이미 참가자면 그대로). change(room)이 고친 방을 돌려주면 저장한다. */
    joinRoom(id, user, change) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!room) throw fail("not-found");
        const next = change(clone(room), user);
        if (next) {
          db.rooms[id] = next;
          writeDb(db);
          notify(id, "room");
        }
        return clone(db.rooms[id]);
      });
    },

    updateRoom(id, uid, patch) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!isMember(room, uid)) throw fail("permission-denied");
        Object.assign(room, clone(patch));
        writeDb(db);
        notify(id, "room");
      });
    },

    /** 수 하나 추가: 방의 수 번호가 move.ply와 같고 그 차례의 자리 주인일 때만 */
    addMove(id, uid, move, roomPatch) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!isMember(room, uid)) throw fail("permission-denied");
        if (room.status !== "playing") throw fail("failed-precondition", "대국 중이 아닙니다");
        if (room.ply !== move.ply) throw fail("aborted", "수 번호가 맞지 않습니다");
        const side = move.ply % 2 === 0 ? "cho" : "han";
        if (!room.seats[side] || room.seats[side].uid !== uid) throw fail("permission-denied", "차례가 아닙니다");
        db.moves[id][String(move.ply)] = clone(move);
        Object.assign(room, clone(roomPatch || {}), { ply: move.ply + 1 });
        writeDb(db);
        notify(id, "moves");
        notify(id, "room");
      });
    },

    /** 무르기 받아들이기: 마지막 수(번호 expectedPly - 1)를 지운다 */
    undoLast(id, uid, expectedPly, roomPatch) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!isMember(room, uid)) throw fail("permission-denied");
        if (room.ply !== expectedPly || expectedPly < 1) throw fail("aborted");
        if (!room.undo || room.undo.by === uid) throw fail("permission-denied");
        delete db.moves[id][String(expectedPly - 1)];
        Object.assign(room, clone(roomPatch || {}), { ply: expectedPly - 1, undo: null });
        writeDb(db);
        notify(id, "moves");
        notify(id, "room");
      });
    },

    sendChat(id, uid, msg) {
      return later(() => {
        const db = readDb();
        if (!isMember(db.rooms[id], uid)) throw fail("permission-denied");
        const list = db.chat[id] || (db.chat[id] = []);
        list.push(Object.assign({ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }, clone(msg)));
        if (list.length > 500) list.splice(0, list.length - 500);
        writeDb(db);
        notify(id, "chat");
      });
    },

    watchRoom(id, cb) {
      return watch(id, "room", () => {
        const room = readDb().rooms[id];
        return room ? clone(room) : null;
      }, cb);
    },

    watchMoves(id, cb) {
      return watch(id, "moves", () => {
        const moves = readDb().moves[id] || {};
        return Object.values(moves).map(clone).sort((a, b) => a.ply - b.ply);
      }, cb);
    },

    watchChat(id, cb) {
      return watch(id, "chat", () => clone(readDb().chat[id] || []), cb);
    },

    /** 개발용: 저장소 비우기 (콘솔에서 OnlineFakeBackend.reset()) */
    reset() {
      localStorage.removeItem(DB_KEY);
    },

    /** 시험용: 이 탭 사용자에게 "보낸" 마지막 인증 코드 */
    peekCode() {
      const user = currentUser();
      return user ? (readDb().devMail[user.uid] || null) : null;
    },

    /** 시험용: 인증 코드 시계를 앞으로 돌린다 (만료·잠금 확인) */
    advanceClock(ms) {
      clockOffset += ms;
      return clockOffset;
    }
  };

  window.OnlineFakeBackend = api;
})();
