import type { Paragraph } from './extract';

// 뷰포트·DOM 변경 감지.
//  - IntersectionObserver: 화면에 보이는 문단만 처리(Phase 2에서 여기서 번역 요청) → 비용 절감
//  - MutationObserver: SPA 리렌더로 문단이 다시 그려지면 재추출 (자기 유발 루프 방지)

// 문단이 뷰포트(약간 앞당겨)에 들어오면 onVisible 호출. 한 번 처리 후 관찰 해제.
export function observeViewport(
  paragraphs: Paragraph[],
  onVisible: (p: Paragraph) => void,
): IntersectionObserver {
  const byNode = new Map<Element, Paragraph>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const p = byNode.get(entry.target);
        if (p) {
          onVisible(p);
          io.unobserve(entry.target); // 문단당 1회
        }
      }
    },
    { rootMargin: '200px' }, // 화면 도달 직전 미리 처리
  );

  for (const p of paragraphs) {
    byNode.set(p.node, p);
    io.observe(p.node);
  }
  return io;
}

// 본문이 크게 바뀌면(SPA 네비게이션 등) onChange 호출. 디바운스.
export function observeMutations(onChange: () => void): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mo = new MutationObserver((mutations) => {
    // 우리 주입 UI(#documate-root) 변경은 무시 → 자기 유발 재추출 루프 방지.
    if (!mutations.some((m) => !isOurs(m.target))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 500);
  });
  // attributes는 관찰하지 않는다(우리가 심는 data-documate-id가 재트리거하지 않도록).
  mo.observe(document.body, { childList: true, subtree: true });
  return mo;
}

function isOurs(node: Node): boolean {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return !!el?.closest('#documate-root');
}
