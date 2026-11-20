# 웹장기 MCP 도우미 (janggi-mcp-bridge)

이미 구독 중인 AI(Claude Desktop, Claude Code 등 MCP를 지원하는 앱)가 웹장기의 해설을 대신 써 주게 하는 작은 프로그램입니다.
API 키나 추가 요금 없이, 구독 중인 AI의 사용량 안에서 해설을 받습니다.

```
웹장기 페이지 ──(127.0.0.1:17861 의뢰함)── 도우미 ──(MCP, stdio)── 구독 중인 AI 앱
```

1. 웹장기에서 **AI 해설** 창을 열고 공급자를 "구독 중인 AI (MCP 도우미)"로 고른 뒤 해설을 요청하면, 의뢰함에 들어갑니다.
2. AI 앱에서 **"장기 해설 의뢰 처리해줘"** 라고 말하면 AI가 의뢰를 가져가 해설을 써서 제출합니다.
3. 제출된 해설은 웹장기 화면에 바로 나타납니다.

## 준비물

- Node.js 18 이상 (설치할 패키지는 없습니다)

## 등록 방법

### Claude Code

```bash
claude mcp add janggi -- node C:/git/janggi/tools/janggi-mcp-bridge/server.mjs
```

### Claude Desktop

설정 → 개발자 → 구성 편집(`claude_desktop_config.json`)에 추가한 뒤 앱을 다시 시작합니다.

```json
{
  "mcpServers": {
    "janggi": {
      "command": "node",
      "args": ["C:/git/janggi/tools/janggi-mcp-bridge/server.mjs"]
    }
  }
}
```

AI 앱이 켜져 있는 동안 도우미도 함께 켜져 있습니다. 웹장기의 공급자 설정에서 "연결됨"이 보이면 준비가 끝난 것입니다.

## MCP 도구

| 도구 | 하는 일 |
|---|---|
| `list_janggi_requests` | 대기 중인 해설 의뢰 목록 |
| `get_janggi_request` | 의뢰 하나 가져가기 (id 생략 시 가장 오래된 것) |
| `submit_janggi_commentary` | 작성한 해설 제출 |

## 보안

- HTTP 의뢰함은 `127.0.0.1`에서만 열립니다. 같은 PC 밖에서는 접근할 수 없습니다.
- 의뢰를 넣을 수 있는 웹 주소는 정해져 있습니다: `localhost`·`127.0.0.1`(개발용), `https://iseohyun.github.io`, `https://iseohyun.com`.
  다른 주소의 웹사이트는 의뢰를 넣거나 결과를 읽을 수 없습니다.
- Chrome은 공개 웹사이트가 내 PC(127.0.0.1)에 접속할 때 **"로컬 네트워크 접근" 허용 여부**를 물을 수 있습니다. 웹장기 주소에 한해 허용해 주세요.
- 의뢰와 해설은 메모리에만 있고, 1시간이 지나거나 도우미가 꺼지면 사라집니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `JANGGI_BRIDGE_PORT` | `17861` | 의뢰함 포트. 바꾸면 웹장기 공급자 설정의 포트도 같게 맞춥니다. |
| `JANGGI_ALLOWED_ORIGINS` | (없음) | 의뢰를 허용할 웹 주소 추가, 쉼표 구분 |
| `JANGGI_ALLOW_FILE_ORIGIN` | (없음) | `1`이면 `index.html`을 파일로 직접 연 경우도 허용 |

## 여러 AI 앱에서 같이 쓰기

AI 앱 여러 개가 도우미를 동시에 띄우면, 첫 번째가 포트를 열고 나머지는 그 의뢰함을 같이 씁니다(임시 폴더의 토큰 파일로 인증).
첫 번째가 꺼지면 다음 도구 호출 때 다른 인스턴스가 포트를 넘겨받습니다.
