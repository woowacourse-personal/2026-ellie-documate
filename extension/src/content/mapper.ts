// 텍스트 정규화 + 원본 블록 색인 유틸.
//
// extract.ts(B: 콘텐츠 루트 직접 순회)에서 사용한다: Readability 본문 문단 텍스트로
// 원본 노드를 찾아 "콘텐츠 루트(LCA)"를 식별하는 데 쓰인다. 문단 주입 노드 자체는
// 루트 순회에서 원본 DOM으로 직접 얻으므로, 여기 색인은 루트 탐지 보조용이다.

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
