// DOM 변경 감지(MutationObserver): SPA 리렌더로 문단이 다시 그려지면 재추출.
//  - 자기 유발 루프 방지: 우리 주입 UI·본문 무관 노이즈 변경은 무시.

// 본문이 크게 바뀌면(SPA 네비게이션 등) onChange 호출. 디바운스.
export function observeMutations(onChange: () => void): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mo = new MutationObserver((mutations) => {
    // 우리 주입 UI(#documate-root, 번역 블록)로 인한 변경은 무시 → 자기 유발 재추출 루프 방지.
    // 번역 블록은 "원본 문단의 부모" 안에 삽입되므로 m.target은 페이지 노드다.
    // 따라서 target이 아니라 실제로 추가/삭제된 노드가 우리 것인지로 판별한다.
    if (!mutations.some(isRelevant)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 500);
  });
  // attributes는 관찰하지 않는다(우리가 심는 data-documate-id가 재트리거하지 않도록).
  mo.observe(document.body, { childList: true, subtree: true });
  return mo;
}

const OURS = '#documate-root, [data-documate-ui]';

// 이 변경이 재추출을 유발해야 하는(=페이지 본문이 실제로 바뀐) 변경인가.
function isRelevant(m: MutationRecord): boolean {
  // 변경이 우리 UI 컨테이너 안에서 일어난 경우 무시.
  if (isOurs(m.target)) return false;
  // childList: 추가/삭제된 노드가 전부 우리 것이거나 본문과 무관한 노이즈
  // (스크립트·스타일·광고 iframe 등)뿐이면 무시. 실제 본문 변경만 재추출한다.
  if (m.type === 'childList') {
    const nodes = [...m.addedNodes, ...m.removedNodes];
    if (nodes.length === 0) return false;
    if (nodes.every((n) => isOursNode(n) || isNoise(n))) return false;
  }
  return true;
}

// 본문과 무관해 재추출이 필요 없는 노드(사이트 스크립트/분석/광고가 흔히 심는 것들).
const NOISE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'IFRAME', 'INS', 'TEMPLATE', 'svg',
]);
function isNoise(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return !node.textContent?.trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return true; // 주석 등
  return NOISE_TAGS.has((node as Element).tagName);
}

function isOurs(node: Node): boolean {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  // 배너(#documate-root)와 인라인 주입 블록([data-documate-ui]) 모두 우리 것 → 무시.
  return !!el?.closest(OURS);
}

// 노드 자체가 우리가 주입한 요소인가(번역 블록 host 등).
function isOursNode(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(OURS);
}
