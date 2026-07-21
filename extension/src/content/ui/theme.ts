// 주입 UI의 라이트/다크 테마를 정하는 공통 헬퍼.
//
// 왜 필요한가: 예전엔 CSS `@media (prefers-color-scheme: dark)`로, 즉 **OS/브라우저 설정**으로
// 색을 정했다. 그런데 사이트는 OS와 무관하게 자기 테마를 쓴다(다크 사이트 + OS 라이트 →
// 진한 배경에 진한 글자로 안 보임). 우리 블록 배경은 반투명이라 사이트 배경이 그대로 비친다.
// 그래서 "OS 설정"이 아니라 **실제로 블록이 얹히는 페이지 배경의 밝기**로 테마를 정한다.
//
// 세 UI(번역·해설·드래그 팝업)가 공유한다. 각 UI는 shadow host에 applyTheme()로 data-theme을
// 심고, CSS는 :host([data-theme="dark"])로 다크 규칙을 건다(미디어쿼리 대신).
// (observer.ts는 우리 요소의 attribute 변경을 관찰하지 않으므로 data-theme 세팅이 재추출을
//  유발하지 않는다.)

// 배경색 파싱: getComputedStyle은 rgb(...)/rgba(...) 형태로 준다. transparent는 rgba(0,0,0,0).
function parseRgb(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 ? parts[3] : 1 };
}

// 지각 밝기(0~255). WCAG 계수의 근사. 128 미만이면 어두운 배경으로 본다.
function luminance(c: { r: number; g: number; b: number }): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// node에서 조상을 타고 올라가며 첫 '불투명(알파 ≥ 0.5)' 배경을 찾아 어두운지 판정한다.
// 못 찾으면(전부 투명) 라이트로 가정한다 — 대부분의 페이지가 흰 배경이고, 우리 블록도
// 불투명에 가까운 자체 배경을 가져 최소 가독성은 확보된다(하이브리드 안전망).
export function detectDark(node: Element | null): boolean {
  let el: Element | null = node;
  for (let i = 0; el && i < 30; i++) {
    const c = parseRgb(getComputedStyle(el).backgroundColor);
    if (c && c.a >= 0.5) return luminance(c) < 128;
    el = el.parentElement;
  }
  for (const e of [document.body, document.documentElement]) {
    if (!e) continue;
    const c = parseRgb(getComputedStyle(e).backgroundColor);
    if (c && c.a >= 0.5) return luminance(c) < 128;
  }
  return false; // 배경을 못 찾으면 라이트 가정
}

// 감지한 테마를 shadow host에 data-theme으로 심는다. near = 블록이 얹히는 근처 요소.
// 재호출해도 안전(멱등) — SPA가 테마를 토글하면 재주입 시 다시 감지된다.
export function applyTheme(host: HTMLElement, near: Element | null): void {
  host.dataset.theme = detectDark(near) ? 'dark' : 'light';
}
