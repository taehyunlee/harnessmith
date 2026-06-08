# Harness Forge

나만의 **하네스 엔지니어링** 스튜디오. Electron 기반 Windows 데스크톱 앱으로, 두 종류의 하네스를 만들고 실행합니다.

- **API 테스트 하네스** — HTTP 요청을 보내고 상태코드 · 본문 · JSON 필드 · 응답시간을 검증
- **코드 검증 하네스** — 셸 명령(테스트 · 빌드 · AI가 생성한 코드 실행)을 돌려 종료코드 · 표준출력 · 표준오류를 검증

GitHub Releases를 통한 **자동 업데이트**가 내장되어 있습니다.

---

## 빠른 시작 (개발)

```bash
npm install
npm start          # 앱 실행
npm run dev        # DevTools 포함 실행
```

처음 실행하면 예제 하네스 2개(API 테스트, 코드 검증)가 자동으로 생성됩니다.

## Windows 설치파일 빌드

```bash
npm run dist       # release/ 폴더에 NSIS 설치파일(.exe) 생성
```

산출물: `release/Harness Forge-Setup-<version>.exe`

---

## 하네스 구조

하네스는 JSON으로 저장됩니다 (앱 데이터 폴더 `harnesses/`). 스텝은 위에서 아래로 순차 실행됩니다.

```jsonc
{
  "name": "내 하네스",
  "type": "api",                  // 표시용 분류 (api | code)
  "variables": { "base": "https://api.example.com" },
  "steps": [ /* ... */ ]
}
```

### HTTP 스텝

```jsonc
{
  "name": "헬스 체크",
  "kind": "http",
  "timeoutMs": 30000,
  "request": {
    "method": "GET",
    "url": "{{base}}/health",
    "headers": { "Authorization": "Bearer {{env.API_TOKEN}}" },
    "body": ""
  },
  "assertions": [
    { "type": "status",       "op": "eq",  "value": 200 },
    { "type": "jsonPath",     "path": "data.status", "op": "eq", "value": "ok" },
    { "type": "bodyContains", "value": "healthy" },
    { "type": "responseTime", "op": "lt",  "value": 1000 }
  ],
  "extract": [
    { "name": "token", "from": "jsonPath", "path": "data.token" }
  ]
}
```

### 셸 스텝 (코드 검증 / AI 에이전트 파이프라인)

```jsonc
{
  "name": "유닛 테스트 실행",
  "kind": "shell",
  "timeoutMs": 60000,
  "command": "npm test",
  "cwd": "C:/path/to/project",
  "assertions": [
    { "type": "exitCode",          "op": "eq", "value": 0 },
    { "type": "stdoutContains",    "value": "passing" },
    { "type": "stderrNotContains", "value": "Error" }
  ]
}
```

### 변수 치환

스텝 안의 문자열에서 다음을 사용할 수 있습니다.

- `{{name}}` — 하네스 `variables` 또는 이전 스텝의 `extract` 결과
- `{{env.KEY}}` — 환경변수 (`process.env.KEY`). **API 키 등 비밀값은 파일에 저장하지 말고 환경변수로 주입하세요.**

### 검증 타입 (assertions)

| type | 대상 | 비고 |
|------|------|------|
| `status` | HTTP 상태코드 | op: eq/neq/lt/gt… |
| `responseTime` | 응답시간(ms) | |
| `bodyContains` / `bodyNotContains` | 응답 본문 | |
| `jsonPath` | JSON 필드 (`a.b.0.c`) | path 지정 |
| `exitCode` | 셸 종료코드 | |
| `stdoutContains` / `stdoutNotContains` | 표준출력 | |
| `stderrContains` / `stderrNotContains` | 표준오류 | |

연산자(`op`): `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `contains`, `notContains`, `matches`(정규식)

> **AI 에이전트 + 코드 검증 패턴**: 1번 스텝(HTTP)에서 LLM API를 호출해 코드를 받아 `extract`로 꺼내고, 2번 스텝(셸)에서 그 코드를 실행·테스트해 검증하는 식으로 파이프라인을 구성할 수 있습니다.

---

## 자동 업데이트 설정 (GitHub Releases)

1. **`package.json`의 `build.publish` 값을 본인 레포로 교체**하세요.

   ```jsonc
   "publish": [
     { "provider": "github", "owner": "내-깃헙-계정", "repo": "내-레포명" }
   ]
   ```

2. 코드를 GitHub 레포에 push 합니다.

3. 새 버전을 릴리스하려면 `package.json`의 `version`을 올리고 태그를 push 하세요.

   ```bash
   npm version patch        # 0.1.0 -> 0.1.1, 커밋 + 태그 생성
   git push --follow-tags
   ```

4. `.github/workflows/release.yml`이 자동으로 Windows 설치파일을 빌드해 **GitHub Releases**에 올립니다.

5. 사용자가 켜둔 앱은 시작 시 새 릴리스를 감지해 백그라운드로 내려받고, "지금 재시작" 안내 후 업데이트를 적용합니다.

> 로컬에서 직접 publish 하려면: `set GH_TOKEN=<personal_access_token>` 후 `npm run release`

### 코드 서명 (선택, 권장)
서명되지 않은 설치파일은 Windows SmartScreen 경고가 뜹니다. 배포 규모가 커지면 코드 서명 인증서를 구해 electron-builder의 `win.certificateFile` 등을 설정하세요.

---

## 프로젝트 구조

```
.
├── main.js                  # Electron 메인 프로세스 + 자동 업데이트 + IPC
├── preload.js               # contextBridge (렌더러 ↔ 메인 안전한 통신)
├── src/
│   ├── harness/
│   │   ├── runner.js         # 하네스 실행 엔진 (HTTP/셸, 검증, 변수, 추출)
│   │   ├── store.js          # 하네스 JSON 파일 저장소
│   │   └── examples.js       # 첫 실행 시 시드되는 예제 하네스
│   └── renderer/             # UI (index.html, styles.css, renderer.js)
├── .github/workflows/release.yml   # 태그 push 시 빌드·릴리스 자동화
└── package.json             # electron-builder + publish 설정
```

## 다음 단계 아이디어

- 앱 아이콘 추가: `build/icon.ico` (256×256 이상)
- 하네스 결과 히스토리 저장 / CSV·JSON 내보내기
- 하네스 스케줄 실행(주기적 모니터링)
- 드래그로 스텝 순서 변경, 검증 항목 GUI 폼
