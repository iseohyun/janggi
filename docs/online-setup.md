# 웹장기 온라인 대국: Firebase 설정 안내

온라인 대국은 Firebase Authentication(로그인), Cloud Firestore(방·수·채팅), Cloud Functions(이메일 승인형 로그인)를 씁니다.
코드는 다 들어가 있고, 지금은 **개발용 가짜 백엔드**(같은 브라우저 탭끼리)로 돌아갑니다.
아래 콘솔 작업을 마친 뒤 설정 한 줄을 바꾸면 실제 서버로 두 기기가 대국합니다.

- Firebase 프로젝트: `any-match-hub` (콘솔: https://console.firebase.google.com/project/any-match-hub)
- 웹 설정값·SDK 버전·백엔드 선택: `module/firebase-config.js` 한 곳
- 보안 규칙 초안: `firestore.rules` (아직 배포하지 않았습니다)
- 데이터 위치: `games/janggi/rooms/{방 코드}` 와 그 아래 `moves`, `chat`, 공개 대국 요약 `games/janggi/lobby/{방 코드}`, 사용자 `games/janggi/users/{uid}`,
  로그인 요청 `games/janggi/loginRequests/{id}`, 남용 방지 기록 `loginEmails`·`loginIps`, 알림 메일 로그아웃 링크 `revokeLinks` (다른 게임과 겹치지 않음)
- Cloud Functions: `functions/` (codebase 이름 `janggi`, 지역 `asia-northeast3` 서울), 배포 설정 `firebase.json`·`.firebaserc`

**처음부터 할 일 순서**: 1 → 2 → 3 → 7(요금제·메일·함수 배포) → 4(규칙 배포) → 5(백엔드 바꾸기) → 6(확인).
이메일 로그인은 함수가 있어야 되므로, 규칙은 함수 뒤에 배포합니다.

> 참고: 2026-11-20 확인 때 이 프로젝트의 Firestore는 이미 만들어져 있었고, **로그인하지 않은 요청의 읽기가 허용**되었습니다
> (없는 방 문서를 읽어 "없음"을 받음). 테스트 모드처럼 규칙이 열려 있다는 뜻일 수 있으니 4단계를 먼저 확인해 주세요.

## 1. 로그인 방식 켜기 (Authentication)

1. 콘솔 → **Build › Authentication** → (처음이면) **시작하기**
2. **Sign-in method** 탭에서
   - **Google**: 사용 설정 → 프로젝트 지원 이메일 고르기 → 저장 (2026-11-20 사용자가 켬)
   - **이메일/비밀번호**: **꺼도 됩니다** (켜져 있다면 꺼 두기를 권합니다). 이메일 로그인은 비밀번호 없이
     메일의 승인 페이지로 하고, 로그인은 Cloud Functions가 내주는 custom token으로 합니다(7장).
     custom token 로그인은 콘솔에서 따로 켤 것이 없습니다. "이메일 링크"도 켜지 않습니다.
   - 메일 문구는 Firebase 템플릿이 아니라 `functions/mailer.js`에 있습니다.

## 2. 승인된 도메인 추가

Authentication → **Settings** → **승인된 도메인(Authorized domains)** 에 다음을 넣습니다.

- `localhost` (보통 기본으로 있음. 개발 서버 `http://localhost:5187` 등에 필요)
- `janggi.iseohyun.com` (배포 주소, 2026-11-20 결정: GitHub Pages + 서브도메인)
- `iseohyun.github.io` (서브도메인 연결 전이나 연결이 풀렸을 때 열리는 주소)

`127.0.0.1`로 열면 Google 로그인이 막힐 수 있으니 개발할 때는 `localhost`로 여세요.

### 배포 주소 연결: janggi.iseohyun.com (GitHub Pages)

1. 도메인 관리 화면(iseohyun.com을 산 곳)에서 DNS 레코드를 추가합니다. 종류는 `CNAME`, 이름은 `janggi`, 값은 `iseohyun.github.io`입니다.
2. GitHub의 janggi 저장소에서 Settings → Pages → Custom domain에 `janggi.iseohyun.com`을 넣고 저장합니다.
   - 저장하면 GitHub가 저장소에 `CNAME` 파일을 만듭니다.
   - 배포 방식에 따라 이 파일이 지워질 수 있으니, 저장소 맨 위에 그대로 남아 있는지 확인합니다.
3. DNS가 반영되면 **Enforce HTTPS**를 켭니다. Stockfish용 서비스 워커와 로그인 모두 https가 필요합니다.
4. 서브도메인을 다른 사람이 가로채지 못하게 하려면 GitHub 계정의 Settings → Pages → Verified domains에서 `iseohyun.com`을 인증해 둡니다. 권장 사항입니다.
5. Google 로그인은 팝업 방식이라 `authDomain`(`any-match-hub.firebaseapp.com`)을 바꾸지 않아도 됩니다.

## 3. Firestore 데이터베이스

이미 있으면 건너뜁니다. 없으면 **Build › Firestore Database** → **데이터베이스 만들기**
→ 위치는 `asia-northeast3 (서울)` 권장(한 번 정하면 못 바꿈) → **프로덕션 모드**로 시작.

## 4. 보안 규칙 배포

`firestore.rules`는 웹장기 부분만 담은 초안입니다.

- **이 프로젝트를 다른 게임과 함께 쓰고 있다면**, 콘솔의 지금 규칙에 `match /games/janggi/rooms/{roomId} { ... }` 부분과
  위쪽 도움 함수들을 **합쳐서** 배포하세요. 파일을 그대로 올리면 다른 게임 규칙이 사라집니다.
- 웹장기만 쓴다면 파일 내용을 그대로 붙여 넣어도 됩니다.

방법 A (콘솔): Firestore Database → **규칙** 탭 → 내용 붙여 넣기 → **게시**
방법 B (CLI, 저장소의 `firebase.json` 사용): 웹장기 폴더에서 `firebase deploy --only firestore:rules`
(CLI 설치·로그인은 7장 ①)

규칙이 지키는 것:

| 대상 | 규칙 |
|---|---|
| 로그인 | Google 또는 이메일 승인형 로그인. 둘 다 이메일이 확인된 사용자라 "인증 전" 구분이 없음. 규칙은 그래도 `email_verified`(또는 Google)를 확인 |
| 모든 기기에서 로그아웃 | `users/{uid}.revokedAt` 이전에 로그인한 토큰(`auth_time`)은 모든 읽기·쓰기에서 막힘 (요청마다 users 문서 읽기 1번 추가) |
| 방 만들기 | 로그인한 사용자. 내가 방장이고 한 자리에만 앉음. 공개(`public`)/비공개(`private`)를 고르고(만든 뒤 못 바꿈), 준비(`ready`)는 false로 |
| 방 문서 | 참가자만 읽기·쓰기. 초대 링크로 들어오는 사람은 **기다리는 방**만 읽고 빈 자리에 자기만 앉을 수 있음(앉기만 하고 시작은 안 함). 방 목록 조회는 막음 |
| 시작 전 설정 | 상대: **자기 상차림과 준비만**(상차림을 바꾸면 같은 쓰기에서 준비가 풀려야 함), 시작 전 자리에서 나가기. 방장: **자기 상차림·진영(자리 맞바꾸기)·제한 시간**과 시작만. 방장이 바꾸면 준비가 풀려야 함. 시작은 상대가 준비한 뒤에만 |
| 시작 뒤 | 상차림·진영·제한 시간·준비·공개 여부는 바꿀 수 없음 |
| 수 (`moves`) | 참가자만 읽기, **공개 방은 누구나(로그인 없이) 읽기**(관전). **자기 차례에 자기 수만**, 방의 수 번호를 정확히 하나 올리면서 추가. 고치기 금지 |
| 공개 대국 요약 (`lobby`) | 누구나 읽기(로그인 없이), 목록은 **한 번에 50개까지**(`limit` 확인). 쓰기는 Cloud Functions(`syncLobby`·`cleanupLobby`)만 |
| 무르기 | 방금 자기가 둔 수만 청할 수 있고, 상대만 받아들여 마지막 수를 지울 수 있음 |
| 대국 끝 | 기권은 자기 패만, 외통은 수를 두면서만, 시간패는 참가자가 기록 |
| 채팅 (`chat`) | 참가자만 읽기·쓰기(공개 방의 관전자도 못 읽음), 자기 이름(uid)으로만, **1~300자**, 고치기·지우기 금지 |
| 사용자 (`users`) | 본인만 읽기(로그인한 기기 목록 포함), 쓰기는 Cloud Functions만 |
| 로그인 요청 (`loginRequests`), 남용 방지 (`loginEmails`, `loginIps`), 로그아웃 링크 (`revokeLinks`), `mail` | 클라이언트는 읽기·쓰기 모두 금지 (Cloud Functions의 Admin SDK만). 요청자도 승인 여부를 직접 못 읽고 함수로만 물음 |

규칙이 못 지키는 것(앱이 막음): 기물이 장기 규칙대로 움직였는지(받는 앱이 거부), 시계 값이 정직한지.

## 5. 실제 Firebase로 바꾸기

따로 바꿀 것이 없습니다. `module/firebase-config.js`가 접속 주소를 보고 백엔드를 고릅니다(2026-11-20부터).

- 기본은 실제 Firebase입니다. `http://localhost:5187`(개발 서버)과 `https://janggi.iseohyun.com` 모두 해당합니다.
  - `localhost`는 Firebase의 기본 승인 도메인이라 Google 로그인이 그대로 됩니다.
  - `127.0.0.1`은 승인 도메인이 아니라서 로그인이 막힙니다. 개발할 때는 `localhost`로 여세요.
- `file://`로 열었을 때만 가짜 백엔드를 씁니다.
- 가짜 백엔드로 시험하려면 주소 뒤에 `?backend=fake`를 붙입니다. 예: `http://localhost:5187/?backend=fake`
  - 같은 브라우저의 탭끼리만 통합니다.
  - 승인 메일은 메일 대신 콘솔에 링크로 찍힙니다(`OnlineFakeBackend.peekLoginMail()`로도 볼 수 있음). 그 링크를 다른 탭에서 열어 승인합니다.

**보안 규칙(4장)과 함수(7장)를 배포하기 전에는** 배포 주소의 온라인 대국이 권한 오류로 동작하지 않습니다. 이메일 로그인도 함수를 배포해야 됩니다.

## 6. 직접 확인할 것 (실제 계정이 필요해 대신 하지 않았습니다)

1. 기기 A에서 왼쪽 레일 사람 아이콘 → **Google로 로그인** → 작은 로그인 창에서 계정 고르기 → 창이 닫히고 이름이 보이는지
   - Google 로그인은 격리되지 않은 도우미 창(`online-auth.html`)에서 합니다. 팝업 차단이 뜨면 허용해 주세요.
2. 기기 B(예: PC)에서 이메일과 대국자 이름만 넣고 **로그인 메일 받기** → 화면에 2자리 숫자가 뜨는지
   → 휴대폰에서 메일의 **로그인 승인 페이지 열기** → 요청 시각·기기가 맞는지 → 같은 숫자를 골라 **승인**
   → 몇 초 안에 기기 B가 로그인되는지
   - 일부러 틀린 숫자를 고르면 기기 B에 "거부되었습니다"가 뜨는지, **내가 요청한 게 아님**도 같은지
   - 메일 링크를 열기만 하고 승인하지 않으면 로그인되지 않는지
   - 로그인한 뒤 **모든 기기에서 로그아웃** → 다른 기기도 (늦어도 1시간 안에) 로그아웃되고, 그 사이 방 읽기·쓰기가 막히는지
   - 다른 브라우저(또는 휴대폰)에서 같은 계정으로 로그인 → **새 기기 로그인 알림 메일**이 오는지, 같은 브라우저 재로그인은 메일이 없는지
     → 알림 메일의 단추를 열기만 하면 아무 일도 없고, 페이지에서 확인을 누르면 모든 기기가 로그아웃되는지 → 같은 링크를 다시 쓰면 거부되는지
   - 서랍의 **로그인한 기기** 목록에 브라우저/OS와 처음·마지막 시각, "이 기기" 표시가 보이는지
3. A에서 방 만들기 → **링크 복사** 또는 **공유**(휴대폰이면 카톡 선택) → B에서 링크 열기 → 로그인하면 바로 입장
4. 수가 양쪽에 바로 보이는지, 채팅·무르기·기권, 한쪽 새로고침 뒤 복원되는지
5. 콘솔 → Firestore → 데이터에 `games/janggi/rooms/...`만 생기는지

## 7. 이메일 승인형 로그인 (Cloud Functions)

비밀번호도, 숫자 코드 입력도 없습니다. **메일의 승인 페이지에서 확인 숫자를 고르면, 처음 로그인을 요청한 브라우저가 로그인됩니다.**
PC에서 요청하고 휴대폰 메일로 승인해도 되고, 같은 기기에서 승인해도 됩니다(승인 페이지는 "원래 화면으로 돌아가세요"만 보여 줌).

흐름:
1. 요청한 화면: 이메일(과 처음이면 대국자 이름)을 넣음 → `startEmailLogin` → 화면에 **확인 숫자 2자리**와 10분 타이머.
   서버는 요청 문서를 만들고 요청한 화면에만 `claimSecret`을 줍니다. 서버에는 해시만 남습니다.
2. 메일: 요청 시각·대략의 기기(예: `Chrome · Windows`)와 승인 페이지 링크 `online-approve.html#req=…&t=…`.
   메일에는 확인 숫자가 없습니다. 승인 토큰 `t`도 해시로만 저장합니다.
3. 승인 페이지: 링크를 **열기만 해서는 바뀌는 것이 없습니다**(메일 보안 검사기가 링크를 미리 열어 보므로).
   숫자 보기 3개 중 요청 화면의 숫자를 골라 **승인**해야 합니다. 틀리면 그 요청은 거부·폐기됩니다. **내가 요청한 게 아님**도 폐기합니다.
4. 요청한 화면은 3초마다 `claimEmailLogin`으로 묻습니다(같은 브라우저에서 승인하면 바로). 승인됐으면 서버가 처음 오는 이메일은 사용자를 만들고
   (이메일 인증됨으로) custom token을 **한 번만** 내준 뒤 요청 문서를 지웁니다. 화면은 `signInWithCustomToken`으로 로그인합니다.

| 항목 | 값 |
|---|---|
| 요청 | **10분** 뒤 만료. `claimSecret`·승인 토큰은 해시로만 저장, 확인 숫자 2자리(보기 3개) |
| 같은 이메일 | **60초에 1번**, **하루(UTC) 10번**, 대기 중인 요청 **3개**까지 |
| 같은 IP | **1시간에 30번** (IP는 해시로만 저장) |
| 계정 있음/없음 | 응답이 같아서 가입 여부를 알 수 없음 |
| 승인 링크 주소 | `functions/.env`의 `APP_ORIGINS`(기본 `https://janggi.iseohyun.com`) 또는 `localhost`·`127.0.0.1`(개발). 다른 주소에서 요청하면 거부 |
| 모든 기기에서 로그아웃 | `revokeAllSessions`: 갱신 토큰 무효 + `users/{uid}.revokedAt`. 규칙·함수가 `auth_time`과 비교 |
| 함수 | `startEmailLogin`, `getEmailLogin`, `approveEmailLogin`, `denyEmailLogin`, `claimEmailLogin`, `revokeAllSessions`, `noteLogin`, `revokeByLink` (2세대 callable, 서울 지역) |
| 시험 | `cd functions` → `npm.cmd test` (Firebase 없이 도는 Node 테스트 24개, 공개 목록 6개 포함) |

### 새 기기 로그인 알림

| 항목 | 값 |
|---|---|
| 언제 | 이메일 승인형 로그인이 끝나 토큰을 받을 때(`claimEmailLogin`), Google 로그인 직후 화면이 부르는 `noteLogin` |
| 새 기기 판단 | 브라우저마다 무작위 기기 ID(localStorage `janggiDeviceId`). 서버 `users/{uid}.devices`에는 **사용자별 해시**와 브라우저/OS 대략, 처음·마지막 로그인 시각만. **IP·위치는 저장하지 않음** |
| 첫 로그인 | 계정에 기록된 기기가 하나도 없을 때(처음 가입, 또는 이 기능 전부터 쓰던 Google 계정의 첫 기록)는 **메일 없음**. 환영 메일도 보내지 않음 |
| 메일 | 제목 `[웹장기] 새 기기에서 로그인했습니다`, 로그인 시각(한국 시간), 브라우저/OS, "본인이 아니면 모든 기기에서 로그아웃" 단추 |
| 단추 링크 | `online-revoke.html#id=…&t=…`. 열기만 해서는 아무 일도 없고, 페이지에서 확인을 눌러야 `revokeByLink`. **7일**, **한 번만**, 서버에는 토큰 해시만 |
| 남용 방지 | 같은 사용자에게 알림 메일 **1시간에 5통**까지. `noteLogin`은 로그인한 지 10분 안의 토큰만 받음. 이메일이 없는 계정은 건너뜀 |
| 실패 | 알림 메일이 실패해도 로그인은 그대로 됩니다(함수 로그에만 남음) |
| 기기 목록 | 서랍 → 로그인 정보 아래 **로그인한 기기** (본인만 읽기, 최근 20대) |

**같은 이메일의 Google 계정이 이미 있으면** 이메일 로그인도 그 계정으로 들어갑니다(Firebase의 "이메일당 계정 하나" 기본 설정).
예전 이메일/비밀번호 계정이 인증되지 않은 채 있으면, 승인 로그인 때 인증됨으로 바꾸고 비밀번호를 무작위로 바꿔 막습니다.

### 메일 발송 수단 비교 (2026-11-20 Resend로 결정)

| 수단 | `MAIL_PROVIDER` | 비용·한도 | 준비 | 장점 | 단점 |
|---|---|---|---|---|---|
| **Gmail SMTP** (앱 비밀번호) | `smtp` | 무료, 하루 약 500통 | Gmail 2단계 인증 → 앱 비밀번호 발급 | 가장 빠르게 시작, 도메인 필요 없음 | 보내는 사람이 개인 Gmail로 보임, 스팸함에 갈 수 있음, 계정 정지 위험·발송 한도 |
| **Resend** | `resend` | 무료 하루 100통·월 3,000통 | 가입 → 보내는 도메인 DNS 인증 → API 키 | 설정 쉬움, 도착률 좋음, 웹장기 이름의 주소로 보냄 | 내 도메인(DNS 수정 권한)이 필요 |
| **SendGrid** | `sendgrid` | 무료 체험 뒤 유료(월 수십 달러부터) | 가입 → 보내는 사람·도메인 인증 → API 키 | 대량·통계·평판 관리 | 무료 상시 요금제가 없어짐, 설정 단계가 많음 |
| **Firebase Trigger Email 확장** | `trigger-email` | 확장 자체 무료 (SMTP 비용은 따로) | 콘솔에서 확장 설치 → SMTP 주소(위 Gmail·Resend 등) 입력 | 콘솔에서 설치, 발송 기록이 Firestore에 남음 | 결국 SMTP가 따로 필요, 확장 함수 하나가 더 돌아감, `mail` 컬렉션 관리 |

비용·한도는 이 문서를 쓸 때 알던 값이라 바뀌었을 수 있습니다. 가입 전에 각 서비스 요금 페이지에서 확인해 주세요.
고른 뒤에는 `functions/.env`의 `MAIL_PROVIDER` 한 줄로 바꿉니다 (코드 수정 없음).

비밀값(SMTP 앱 비밀번호, API 키)은 **Secret Manager의 `MAIL_SECRET`에만** 둡니다. 코드·`.env`·클라이언트에는 넣지 않습니다.
(`trigger-email`은 비밀값을 확장이 가지므로 `MAIL_SECRET`에는 아무 값이나 넣어 둡니다.)

### 사용자가 직접 할 일 (순서대로) — 메일 수단: **Resend** (2026-11-20 결정)

`functions/.env`에는 이미 `MAIL_PROVIDER=resend`와 보내는 주소 `웹장기 <noreply@iseohyun.com>`(2026-11-20 확정)이 들어 있습니다.
그래서 ④에서 인증할 도메인은 `iseohyun.com`입니다.

① **Firebase CLI 준비**: `npm.cmd install -g firebase-tools` → `firebase login`
② ✅ **Blaze 요금제로 바꾸기** — 완료 (2026-11-20 사용자가 전환).
   아직 안 했다면 **예산 알림**(예: 월 1,000원)을 걸어 두세요: 콘솔 → ⚙ 사용량 및 결제 → 세부정보 및 설정 → 예산 및 알림.
③ **Resend 가입**: https://resend.com 에서 가입.
④ **도메인 추가**: Resend → Domains → Add Domain → 보내는 주소의 도메인(예: `iseohyun.com`) 입력.
   지역은 가까운 곳(도쿄 `ap-northeast-1`)을 고르면 됩니다.
⑤ **DNS 레코드 등록**: Resend가 보여 주는 레코드를 **글자 그대로** 도메인 관리 화면(가비아·Cloudflare 등)에 추가합니다.
   보통 다음과 같습니다(이름·값은 Resend 화면 기준):
   - **DKIM**: TXT `resend._domainkey` → 긴 공개 키 값
   - **SPF**: `send` 하위 도메인의 MX 레코드와 TXT(`v=spf1 include:...`) 레코드
   - **DMARC**(권장): TXT `_dmarc` → `v=DMARC1; p=none;`
   이미 쓰는 메일(예: 도메인 메일)이 있으면 루트의 SPF·MX는 건드리지 말고 Resend가 준 `send` 하위 도메인 레코드만 추가합니다.
⑥ **인증 확인**: Resend → Domains에서 **Verify**. 상태가 *Verified*가 될 때까지 기다립니다(DNS 반영에 몇 분~몇 시간).
⑦ **API 키 발급**: Resend → API Keys → Create. 권한은 **Sending access**, 도메인은 ④의 도메인만. 키는 이 단계에서 한 번만 보입니다.
⑧ **비밀값 등록** (웹장기 폴더에서, 프롬프트에 키를 붙여 넣음 — 파일·채팅에 남기지 않음):
   `firebase functions:secrets:set MAIL_SECRET`
⑨ ✅ **보내는 주소 확정**: `웹장기 <noreply@iseohyun.com>` (`functions/.env`의 `MAIL_FROM`, 2026-11-20).
⑨-2 **custom token 권한 확인** (서비스 계정 토큰 생성자):
   2세대 함수는 기본으로 `803268788694-compute@developer.gserviceaccount.com`(기본 컴퓨트 서비스 계정)으로 돕니다.
   이 계정이 custom token에 서명하려면 **서비스 계정 토큰 생성자**(`roles/iam.serviceAccountTokenCreator`) 역할이 필요할 수 있습니다.
   - 확인: Google Cloud 콘솔 → IAM 및 관리자 → **IAM** → 위 계정 줄의 역할에 "서비스 계정 토큰 생성자"가 있는지
     (프로젝트 선택이 `any-match-hub`인지 확인). "편집자"만 있으면 서명 권한이 없을 수 있습니다.
   - 없으면: 그 줄의 연필 단추 → 역할 추가 → "서비스 계정 토큰 생성자" → 저장.
   - **IAM Service Account Credentials API**도 켜져 있어야 합니다: API 및 서비스 → 라이브러리 → 이름 검색 → 사용.
   - 빠뜨렸을 때 증상: 승인까지 되는데 요청 화면이 "서버에서 처리하지 못했습니다"를 보이고,
     `firebase functions:log --only claimEmailLogin`에 `iam.serviceAccounts.signBlob` 권한 오류가 남습니다.
     요청은 "승인됨"으로 남아 있으므로 권한을 고친 뒤 10분 안이면 그대로 이어서 로그인됩니다.
⑩ **함수 배포**: `cd functions` → `npm.cmd install` → `cd ..` → `firebase deploy --only functions:janggi`
   (`codebase` 이름이 `janggi`라서 같은 프로젝트의 다른 게임 함수는 건드리지 않습니다. 처음 배포할 때 필요한 Google Cloud API를 켜도 되는지 물으면 "예".)
⑪ **규칙 배포**: 4장 (다른 게임 규칙과 합쳐서). 함수 배포 **뒤에** 합니다.
⑫ **확인**: 6장의 2번. 메일이 안 오면 `firebase functions:log --only startEmailLogin`과 Resend → Emails(발송 기록)를 봅니다.
⑬ (선택) **지난 기록 자동 삭제**: 콘솔 → Firestore → **TTL** → 정책 만들기 → 컬렉션 그룹 `loginRequests`, 필드 `expireAt`.
   `loginEmails`, `loginIps`, `revokeLinks`도 같은 필드로 하나씩 (`revokeLinks`는 만료 1일 뒤). 함수가 `expireAt`(요청은 만료 1일 뒤, 남용 방지 기록은 2일 뒤)을 넣어 둡니다.
   안 켜도 동작은 같고, 지난 문서가 조금씩 쌓일 뿐입니다.

메일 문구는 `functions/mailer.js`에 있습니다. 승인 요청은 `loginMessage()`(제목 `[웹장기] 로그인 승인 요청`),
새 기기 알림은 `newDeviceMessage()`(제목 `[웹장기] 새 기기에서 로그인했습니다`)입니다.

배포 주소가 바뀌면(예: 다른 도메인 추가) `functions/.env`의 `APP_ORIGINS`에 쉼표로 더하고 함수를 다시 배포합니다.
승인 페이지 `online-approve.html`과 로그아웃 확인 페이지 `online-revoke.html`은 로그인을 하지 않으므로 `coi-sw.js`의 격리 예외가 필요 없습니다(격리돼도 함수 호출은 됩니다).

### 에뮬레이터로 시험하기 (선택)

Java 11 이상이 있으면: `functions/.env.local`에 `MAIL_PROVIDER=log`를 적고 `functions/.secret.local`에 `MAIL_SECRET=unused`를 적은 뒤
`firebase emulators:start --only functions,firestore,auth`. 메일 대신 함수 로그에 승인 링크가 찍힙니다.
(앱을 에뮬레이터에 붙이는 연결 코드는 아직 넣지 않았습니다. 지금은 가짜 백엔드가 같은 규칙으로 화면 흐름을 시험합니다.)

## 8. 방 설정 흐름·공개 대국 목록·관전 (2026-11-21)

### 방 설정 흐름

1. 방장이 왼쪽 서랍 **온라인 대국 → 방 만들기**에서 공개/비공개, 내 진영, 제한 시간, 내 상차림을 고릅니다.
2. 상대가 초대 링크(또는 열린 대국 목록)로 들어오면 **자리에만 앉습니다**. 방장 설정은 상대 화면에 읽기 전용으로 보이고 판에도 바로 차려집니다.
3. 시작 전에는 오른쪽 서랍 **새 대국** 탭이 방 설정과 이어집니다.
   - 아래 줄 상차림은 내 상차림입니다. 위 줄(상대)은 읽기 전용입니다.
   - 진영과 제한 시간은 방장만 바꿉니다. 방장이 바꾸면 상대의 준비가 풀리고, 채팅에 시스템 알림이 갑니다.
   - 방장이 진영을 바꾸면 상대 자리와 상대 상차림이 함께 반대쪽으로 옮겨 갑니다.
   - 상대가 상차림을 바꾸면 자기 준비가 풀립니다.
4. 상대가 **준비** → 방장이 양쪽 판을 확인하고 **대국 시작**(새 대국 탭의 시작 단추, 단축키 N, 왼쪽 서랍 단추 모두 같음).
5. 시작 전에 상대가 방을 나가면 자리가 비고, 방은 다시 상대를 기다립니다. 방장이 나가면 방이 닫힙니다.

### 공개 대국 목록·관전

- **공개 방**만 왼쪽 서랍 온라인 영역의 **열린 대국** 목록(로그인 아래)에 올라갑니다. 비공개 방은 초대 링크로만 들어옵니다.
- 기다리는 방: 방장 이름, 비어 있는 진영, 제한 시간, 방장 상차림, 만든 지 몇 분. 누르면 들어갑니다(로그인 필요. 로그인 전이면 로그인 뒤 바로 들어감).
- 진행 중 공개 대국: 누르면 **관전**합니다. 로그인 없이 판과 수만 읽기 전용으로 봅니다. 채팅은 보지도 쓰지도 못합니다. 관전 링크는 `?watch=방코드`.
- 목록 보기와 관전은 로그인 없이 됩니다. 목록은 영역이 화면에 보일 때만 읽습니다(최근 50개, 한 쪽에 5개씩).

### 요약 쓰기 방식 결정: Cloud Functions 동기화

요약 `games/janggi/lobby/{roomId}`는 **함수 `syncLobby`(Firestore 트리거)**가 방 문서가 바뀔 때마다 다시 씁니다. 클라이언트는 lobby에 쓸 수 없습니다.

- 고른 까닭: 방장이 직접 쓰면 요약과 방 문서가 맞는지 규칙이 매번 `get()`으로 비교해야 하고(규칙 식 개수·읽기 비용), 대국 중에는 두 사람이 번갈아 수를 두므로 상대 수 뒤의 요약을 누가 고칠지 정하기 어렵습니다. 함수는 방 문서에서 바로 만들기 때문에 항상 맞고, 요약을 위조할 수 없습니다.
- 대가: 방 문서 쓰기(수 하나마다)마다 함수가 한 번 돕니다. 목록 반영은 보통 1초 안팎 늦습니다. 관전 화면의 수는 `moves`를 직접 읽으므로 늦지 않습니다.
- 요약에 담는 것(최소): 방 코드, 상태, 방장 이름·진영, 빈 진영, 두 대국자 이름, 상차림, 제한 시간, 수 번호, 시계, 결과, 만든·시작·마지막 활동 시각. **uid·이메일·채팅은 담지 않습니다.** 규칙은 `functions/lobby-core.js`(가짜 백엔드와 같은 코드).
- 정리: 마지막 활동(방 문서가 마지막으로 바뀐 때) 뒤 **30분**이 지난 요약은 목록에서 빼고, 예약 함수 `cleanupLobby`가 **10분마다** 지웁니다(방 문서는 그대로).
  다시 활동이 있으면(예: 방장이 설정을 바꿈) 요약이 다시 생깁니다. 대국 중 한 수에 30분 넘게 생각하면 그동안 목록에서 빠집니다.

### 배포 (사용자가 직접)

웹장기 폴더에서:

```powershell
firebase deploy --only functions,firestore:rules --project any-match-hub
```

- 함수는 codebase `janggi`만 올라갑니다(다른 게임 함수는 그대로). 처음 올릴 때 Eventarc·Cloud Scheduler·Pub/Sub API를 켜도 되는지 물으면 "예".
- **Firestore 트리거는 데이터베이스와 같은 지역이어야 합니다.** 데이터베이스가 서울(`asia-northeast3`)이 아니면 `functions/index.js`의 `LOBBY_REGION`을 데이터베이스 지역으로 바꿔서 올립니다(콘솔 → Firestore → 데이터베이스 위치에서 확인).
- 규칙을 다른 게임 규칙과 합쳐서 쓰는 경우는 4장과 같습니다. 새로 생긴 `match /games/janggi/lobby/{roomId}`도 함께 합칩니다.
- 예전(이 기능 전) 방 문서에는 `visibility`·`ready`가 없어 비공개로 취급되고, 기다리던 예전 방은 새 흐름으로 시작할 수 없습니다(새로 만들면 됨).

### 시험

- 공개 목록 요약·정리: `cd functions` → `npm.cmd test`
- 보안 규칙(에뮬레이터, 허용·거부 13가지): Java 11 이상이 필요합니다(Android Studio의 `jbr` 폴더도 됨). 웹장기 폴더에서

```powershell
npm.cmd --prefix tools/rules-test install
```

```powershell
firebase emulators:exec --only firestore --project demo-janggi "node --test tools/rules-test/rules.test.mjs"
```

- 화면 흐름: `?backend=fake`로 탭 셋(방장·상대·로그인 안 한 관전자)을 열어 시험합니다. 오래된 방 정리는 콘솔에서 `OnlineFakeBackend.advanceClock(31*60*1000)` 뒤 목록을 다시 엽니다.

## 알아 둘 점

- 시계는 두는 사람이 자기 화면에서 잰 생각 시간을 보냅니다. 상대 시간이 제한을 넘기면 내 화면이 5초 더 기다린 뒤 시간패를 기록합니다.
- 연결이 끊긴 것을 서버가 알리지는 않습니다(퇴장 메시지는 "방 나가기"를 눌렀을 때만). 같은 링크로 다시 들어오면 이어 둡니다.
- Analytics는 넣지 않았습니다(`measurementId`를 쓰지 않음).
- 웹 API 키는 공개용입니다. 원하면 Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보에서 키를 **HTTP 리퍼러**(배포 도메인·localhost)로 제한할 수 있습니다.
