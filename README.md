# Harness Forge

나만의 **하네스 설계 스튜디오**. 만들고 싶은 걸 설명하고 파일을 첨부하면, 시각적인 캔버스에서 흐름을 짜고 **Claude Skill(`SKILL.md`)** 과 **시스템 설계 문서**로 내보내는 Windows 데스크톱 앱입니다.

- **AI 백엔드 불필요** — API 키 없이, 입력한 설계를 템플릿 기반으로 결정적으로 생성합니다.
- **Lucidchart 같은 시각 캔버스** — 목적·단계·도구·첨부를 드래그 가능한 카드로 배치하고 화살표로 흐름을 연결합니다.
- **비전공자 친화** — 큰 글씨, 한국어 라벨, 클릭하면 옆에서 바로 편집.
- **GitHub Releases 자동 업데이트** 내장.

---

## 빠른 시작 (개발)

```bash
npm install
npm start          # 앱 실행
npm run dev        # DevTools 포함 실행
```

처음 실행하면 예제 프로젝트("회의록 요약 스킬")가 자동으로 생성됩니다.

## Windows 설치파일 빌드

```bash
npm run dist       # release\Harness Forge-Setup-<버전>.exe 생성
```

---

## 사용 흐름

1. **새 프로젝트** → 오른쪽 패널에 *목적·대상·사용 시점(트리거)·제약*을 적습니다.
2. 왼쪽 **추가하기** 팔레트로 `➕ 단계`, `🔧 도구/MCP`, `📎 파일 첨부`를 캔버스에 올립니다.
3. 카드를 **드래그**해 배치하고, **클릭**하면 오른쪽에서 내용을 편집합니다.
   - 파란 화살표 = 처리 흐름(목적 → 단계 → 산출물)
   - 초록 점선 = 도구 연결 / 노랑 점선 = 첨부 연결
4. **👁 미리보기**로 생성될 `SKILL.md`·설계 문서를 확인합니다.
5. **⬇ 내보내기**로 폴더를 고르면:
   - `<스킬이름>/SKILL.md` (+ 첨부는 `resources/`에 복사)
   - `<스킬이름>-SYSTEM_DESIGN.md` (mermaid 다이어그램 포함)

> **팁**: 스킬 이름(파일명)은 영문 소문자-하이픈으로 적어주세요. 비우면 `my-skill`로 생성됩니다.

---

## 생성되는 산출물

### SKILL.md
YAML 프런트매터(`name`, `description`) + 목적 / 사용 시점 / 절차 / 도구 / 제약 / 참고 리소스 섹션으로 구성된 Claude 스킬 패키지입니다.

### SYSTEM_DESIGN.md
개요·대상·처리 흐름(mermaid `flowchart`)·단계 상세·도구 구성·산출물·제약·첨부를 정리한 사람용 설계 문서입니다. GitHub 등에서 다이어그램이 그림으로 렌더링됩니다.

---

## 자동 업데이트 (GitHub Releases)

`package.json`의 `build.publish`는 `taehyunlee/harnessmith`로 설정되어 있습니다.

```bash
npm version patch        # 0.1.0 -> 0.1.1, 커밋 + 태그
git push --follow-tags   # Actions가 설치파일 빌드 → Releases 업로드
```

사용자가 켜둔 앱은 시작 시 새 릴리스를 감지해 백그라운드로 내려받고, "지금 재시작" 안내 후 적용합니다. (private 레포는 에셋 인증이 필요해 자동 업데이트가 기본 동작하지 않습니다 — public 권장.)

---

## 프로젝트 구조

```
.
├── main.js                  # 메인 프로세스 + 자동 업데이트 + IPC
├── preload.js               # contextBridge (렌더러 ↔ 메인)
├── src/
│   ├── harness/
│   │   ├── generator.js      # SKILL.md / SYSTEM_DESIGN.md 생성기 (AI 불필요)
│   │   ├── store.js          # 프로젝트 JSON 저장 + 첨부 파일 관리
│   │   └── examples.js       # 첫 실행 시 시드되는 예제 프로젝트
│   └── renderer/             # 시각 캔버스 UI (index.html, styles.css, renderer.js)
├── .github/workflows/release.yml
└── package.json
```

## 다음 단계 아이디어

- 앱 아이콘(`build/icon.ico`) 추가
- 나중에 API 키를 넣으면 "AI 초안 자동작성"을 켜는 설정 슬롯
- 캔버스 줌/팬, 단계 분기(조건 흐름)
- 스킬 패키지를 `.skill`(zip)로 바로 내보내기
