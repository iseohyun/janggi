# 웹장기 온라인 대국: Firebase 설정 안내

온라인 대국은 Firebase Authentication(로그인), Cloud Firestore(방·수·채팅), Cloud Functions(이메일 숫자 코드 인증)를 씁니다.
코드는 다 들어가 있고, 지금은 **개발용 가짜 백엔드**(같은 브라우저 탭끼리)로 돌아갑니다.
아래 콘솔 작업을 마친 뒤 설정 한 줄을 바꾸면 실제 서버로 두 기기가 대국합니다.

- Firebase 프로젝트: `any-match-hub` (콘솔: https://console.firebase.google.com/project/any-match-hub)
- 웹 설정값·SDK 버전·백엔드 선택: `module/firebase-config.js` 한 곳
- 보안 규칙 초안: `firestore.rules` (아직 배포하지 않았습니다)
- 데이터 위치: `games/janggi/rooms/{방 코드}` 와 그 아래 `moves`, `chat`, 사용자 `games/janggi/users/{uid}`,
  인증 코드 기록 `games/janggi/emailCodes/{uid}` (다른 게임과 겹치지 않음)
- Cloud Functions: `functions/` (codebase 이름 `janggi`, 지역 `asia-northeast3` 서울), 배포 설정 `firebase.json`·`.firebaserc`

**처음부터 할 일 순서**: 1 → 2 → 3 → 7(요금제·메일·함수 배포) → 4(규칙 배포) → 5(백엔드 바꾸기) → 6(확인).
함수가 먼저 있어야 인증 전 사용자가 막히지 않고 인증까지 갈 수 있으므로, 규칙은 함수 뒤에 배포합니다.

> 참고: 2026-11-20 확인 때 이 프로젝트의 Firestore는 이미 만들어져 있었고, **로그인하지 않은 요청의 읽기가 허용**되었습니다
> (없는 방 문서를 읽어 "없음"을 받음). 테스트 모드처럼 규칙이 열려 있다는 뜻일 수 있으니 4단계를 먼저 확인해 주세요.

## 1. 로그인 방식 켜기 (Authentication)

1. 콘솔 → **Build › Authentication** → (처음이면) **시작하기**
2. **Sign-in method** 탭에서
   - **Google**: 사용 설정 → 프로젝트 지원 이메일 고르기 → 저장 (2026-11-20 사용자가 켬)
   - **이메일/비밀번호**: 사용 설정 → 저장 (이메일 링크(비밀번호 없는 로그인)는 켜지 않아도 됩니다)
3. 비밀번호 재설정 메일 문구를 한국어로 바꾸려면 **Templates** 탭 → 비밀번호 재설정 → 언어 `한국어`

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
| 방 만들기 | **인증된 사용자만** (Google 로그인, 또는 이메일 숫자 코드 인증을 마쳐 `email_verified`가 참) |
| 방 문서 | 참가자만 읽기·쓰기. 초대 링크로 들어오는 사람은 **기다리는 방**만 읽고 빈 자리에 자기만 앉을 수 있음 (인증 전 계정도 됨). 방 목록 조회는 막음 |
| 수 (`moves`) | 참가자만 읽기. **자기 차례에 자기 수만**, 방의 수 번호를 정확히 하나 올리면서 추가. 고치기 금지 |
| 무르기 | 방금 자기가 둔 수만 청할 수 있고, 상대만 받아들여 마지막 수를 지울 수 있음 |
| 대국 끝 | 기권은 자기 패만, 외통은 수를 두면서만, 시간패는 참가자가 기록 |
| 채팅 (`chat`) | 참가자만 읽기·쓰기, 자기 이름(uid)으로만, **1~300자**, 고치기·지우기 금지 |
| 사용자 (`users`) | 본인만 읽기, 쓰기는 Cloud Functions만 |
| 인증 코드 (`emailCodes`), `mail` | 클라이언트는 읽기·쓰기 모두 금지 (Cloud Functions의 Admin SDK만) |

규칙이 못 지키는 것(앱이 막음): 기물이 장기 규칙대로 움직였는지(받는 앱이 거부), 시계 값이 정직한지.

## 5. 실제 Firebase로 바꾸기

따로 바꿀 것이 없습니다. `module/firebase-config.js`가 접속 주소를 보고 백엔드를 고릅니다(2026-11-20부터).

- 기본은 실제 Firebase입니다. `http://localhost:5187`(개발 서버)과 `https://janggi.iseohyun.com` 모두 해당합니다.
  - `localhost`는 Firebase의 기본 승인 도메인이라 Google 로그인이 그대로 됩니다.
  - `127.0.0.1`은 승인 도메인이 아니라서 로그인이 막힙니다. 개발할 때는 `localhost`로 여세요.
- `file://`로 열었을 때만 가짜 백엔드를 씁니다.
- 가짜 백엔드로 시험하려면 주소 뒤에 `?backend=fake`를 붙입니다. 예: `http://localhost:5187/?backend=fake`
  - 같은 브라우저의 탭끼리만 통합니다.
  - 인증 코드는 메일 대신 콘솔에 찍힙니다.

**보안 규칙(4장)과 함수(7장)를 배포하기 전에는** 배포 주소의 온라인 대국이 권한 오류로 동작하지 않습니다. 이메일 인증 코드도 함수를 배포해야 나갑니다.

## 6. 직접 확인할 것 (실제 계정이 필요해 대신 하지 않았습니다)

1. 기기 A에서 왼쪽 레일 사람 아이콘 → **Google로 로그인** → 작은 로그인 창에서 계정 고르기 → 창이 닫히고 이름이 보이는지
   - Google 로그인은 격리되지 않은 도우미 창(`online-auth.html`)에서 합니다. 팝업 차단이 뜨면 허용해 주세요.
2. 기기 B에서 **회원가입**(이메일·비밀번호·대국자 이름) → 6자리 코드 메일이 오는지 → 코드를 넣어 "실제 사용자"가 되는지
   → 로그아웃 → 다시 로그인 → **비밀번호 찾기** 메일이 오는지
   - 인증 전에는 "방 만들기"가 잠겨 있고, 초대 링크로는 들어갈 수 있는지도 봐 주세요.
3. A에서 방 만들기 → **링크 복사** 또는 **공유**(휴대폰이면 카톡 선택) → B에서 링크 열기 → 로그인하면 바로 입장
4. 수가 양쪽에 바로 보이는지, 채팅·무르기·기권, 한쪽 새로고침 뒤 복원되는지
5. 콘솔 → Firestore → 데이터에 `games/janggi/rooms/...`만 생기는지

## 7. 이메일 숫자 코드 인증 (Cloud Functions)

이메일·비밀번호로 가입하면 6자리 숫자 코드를 메일로 보내고, 맞게 넣으면 그 계정을 "실제 사용자"
(`emailVerified=true`, `games/janggi/users/{uid}` 등록)로 바꿉니다. Firebase의 인증 링크 메일은 쓰지 않습니다.

| 항목 | 값 |
|---|---|
| 코드 | 6자리 숫자, **10분** 뒤 만료. 서버에는 해시만 저장 |
| 보내기 제한 | 한 사람당 **60초에 1번**, **하루(UTC) 10번** |
| 틀림 | **5번** 틀리면 그 코드를 버리고 **15분** 잠금 (그동안 새 코드도 못 받음) |
| 인증 전 계정 | 초대받은 방 입장(그 방 안의 대국·채팅)만. 방 만들기는 인증 뒤 |
| 함수 | `sendEmailCode`, `verifyEmailCode` (2세대 callable, 서울 지역) |
| 시험 | `cd functions` → `npm.cmd test` (Firebase 없이 도는 Node 테스트 6개) |

### 메일 발송 수단 고르기 (아직 정하지 않음)

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
⑩ **함수 배포**: `cd functions` → `npm.cmd install` → `cd ..` → `firebase deploy --only functions:janggi`
   (`codebase` 이름이 `janggi`라서 같은 프로젝트의 다른 게임 함수는 건드리지 않습니다. 처음 배포할 때 필요한 Google Cloud API를 켜도 되는지 물으면 "예".)
⑪ **규칙 배포**: 4장 (다른 게임 규칙과 합쳐서). 함수 배포 **뒤에** 합니다.
⑫ **확인**: 6장의 2번. 메일이 안 오면 `firebase functions:log --only sendEmailCode`와 Resend → Emails(발송 기록)를 봅니다.

메일 문구는 `functions/mailer.js`의 `message()`에 있습니다. 제목에 코드를 넣어 휴대폰 알림에서 바로 보이게 했습니다.

### 에뮬레이터로 시험하기 (선택)

Java 11 이상이 있으면: `functions/.env.local`에 `MAIL_PROVIDER=log`를 적고 `functions/.secret.local`에 `MAIL_SECRET=unused`를 적은 뒤
`firebase emulators:start --only functions,firestore,auth`. 메일 대신 함수 로그에 코드가 찍힙니다.
(앱을 에뮬레이터에 붙이는 연결 코드는 아직 넣지 않았습니다. 지금은 가짜 백엔드가 같은 규칙으로 화면 흐름을 시험합니다.)

## 알아 둘 점

- 시계는 두는 사람이 자기 화면에서 잰 생각 시간을 보냅니다. 상대 시간이 제한을 넘기면 내 화면이 5초 더 기다린 뒤 시간패를 기록합니다.
- 연결이 끊긴 것을 서버가 알리지는 않습니다(퇴장 메시지는 "방 나가기"를 눌렀을 때만). 같은 링크로 다시 들어오면 이어 둡니다.
- Analytics는 넣지 않았습니다(`measurementId`를 쓰지 않음).
- 웹 API 키는 공개용입니다. 원하면 Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보에서 키를 **HTTP 리퍼러**(배포 도메인·localhost)로 제한할 수 있습니다.
