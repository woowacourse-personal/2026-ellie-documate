# Documate

> 영어 개발 문서를 읽다 막힌 순간, 페이지를 떠나지 않고 그 자리에서 이해하도록 돕는 크롬 확장 프로그램

**번역기는 영어를 한글로 바꿔주고, Documate는 문서를 "이해"로 바꿔준다.**

영어로 된 개발 문서/아티클을 읽을 때 문단마다 자연스러운 한국어 번역을 기본으로 제공하고, 개념 해설은 원할 때 버튼 한 번으로 그 자리에서 펼쳐 볼 수 있다.

---

## 왜 만드나

주니어 개발자가 영어 문서에서 막히는 진짜 이유는 "단어를 몰라서"가 아니라 **"이 개념이 뭔지, 왜 이렇게 쓰는지"를 몰라서**다. 지금은 문서와 AI 도구 탭을 오가며 복붙하는데, 이 맥락 전환이 번거로워 문서 읽기 자체를 미루게 된다.

Documate는 **페인이 발생하는 자리(브라우저에서 문서 읽는 중)에** 있으면서 그 마찰을 없앤다.

- **번역은 기본기** — 항상 보인다
- **개념 해설은 차별점** — 원할 때 꺼내 본다. 이게 이 제품의 심장이다.

## 핵심 기능 (MVP)

| | 기능 | 동작 |
|---|---|---|
| F1 | **문단 번역** | 각 영어 문단 아래 한국어 번역을 항상 표시 |
| F2 | **개념 해설** | 문단마다 해설 버튼 → 클릭 시 인라인 펼침 (무엇/왜/언제) |
| F3 | **후속 질문** | 해설을 봐도 모르면 그 자리에서 이어서 질문 (탭 이동 없음) |
| F4 | **드래그 선택** | 문단 인식 실패 페이지용 폴백 — 드래그하면 번역+해설 |

## 어떻게 동작하나

확장 아이콘을 클릭한 **그 탭에서만** 켜진다. 누르기 전엔 어떤 페이지에서도 아무 동작을 하지 않는다.

```
아이콘 클릭 → 본문 추출(Readability) → 문단 분리 → 보이는 문단만 번역 → 해설은 버튼 클릭 시
```

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 확장 | Chrome Extension Manifest V3, `activeTab` |
| 빌드 | Vite + @crxjs/vite-plugin, TypeScript |
| UI | Preact (Shadow DOM 안에 마운트) |
| 본문 추출 | @mozilla/readability |
| 백엔드 | Vercel Functions (해설은 스트리밍) |
| LLM | Claude |

키를 확장에 넣으면 노출되므로, LLM 호출은 항상 **백엔드 프록시(Vercel Functions)를 경유**한다. 확장은 프록시만 호출한다.

```
확장 (content + service worker)  →  Vercel 프록시 (키 보관·캐싱)  →  Claude
```

## 프로젝트 구조

```
documate/
├─ extension/     크롬 확장 (Vite + CRXJS)
│  └─ src/
│     ├─ content/     본문 추출, 문단 매핑, UI 주입, 드래그 감지
│     ├─ background/  service worker: 프록시 중계 + 캐싱
│     └─ shared/      content ↔ SW 메시지 타입
└─ proxy/         Vercel Functions (키 보관 + Claude 호출)
   └─ api/            translate.ts, explain.ts
```

## 초기 범위

"모든 문서 완벽"을 노리지 않는다. 구조가 깔끔하고 많이 보는 문서부터 시작한다.

- **1차 타깃:** [developer.android.com](https://developer.android.com/develop/ui/compose) (Jetpack Compose 문서)
- 이후 MDN, React·Vue 공식문서, GitHub README로 확대
- 안 되는 사이트는 드래그 폴백(F4)으로 커버 → **"안 되는 페이지는 없다"**

## 현재 상태

🚧 **기획 단계 (구현 이전).** 코드는 아직 없다.

- [documate.md](./documate.md) — 서비스 기획 및 UI/UX 스펙
- [PLAN.md](./PLAN.md) — 기술 스펙 · 구현 순서 · 스캐폴딩
- [CLAUDE.md](./CLAUDE.md) — Claude Code 작업 가이드

구현은 리스크 우선 순서로 진행한다: 스캐폴딩 → 문단 추출·매핑 → 번역 → 해설 → 드래그 폴백. 자세한 순서는 [PLAN.md](./PLAN.md) 참고.
