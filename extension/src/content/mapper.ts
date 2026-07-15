// 정제본(Readability) ↔ 원본 DOM 매핑.
//
// 인라인 주입(B안)의 핵심 난제: Readability는 문서 "복제본"을 정제하므로 원본 노드 참조를 잃는다.
// 전략: Readability가 "골라낸 본문 HTML"을 문단 소스로 쓰고(= nav/광고 이미 제거됨),
// 각 정제 문단을 원본 DOM 노드에 "정확 텍스트 매칭"으로 연결한다.
//  - 정제본을 소스로 쓰므로 nav 노이즈가 안 섞인다.
//  - 매칭된 원본 노드가 인라인 주입 대상. 매칭 실패 문단은 드래그 폴백(F4)으로 넘긴다.

// 공백 정규화 — 정제본/원본 텍스트를 같은 기준으로 비교.
export function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// 원본 블록들을 "정규화 텍스트 → 노드"로 색인. 중복 텍스트는 첫 노드 유지.
export function indexByText(
  blocks: { node: HTMLElement; text: string }[],
): Map<string, HTMLElement> {
  const index = new Map<string, HTMLElement>();
  for (const b of blocks) {
    if (!index.has(b.text)) index.set(b.text, b.node);
  }
  return index;
}
