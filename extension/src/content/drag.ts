import {
  isInsideDragPopup,
  removeDragPopup,
  showDragPopup,
} from './ui/drag-popup';

// 드래그 선택 감지(F4 폴백).
//
// 문단 추출·매핑은 페이지마다 깨질 수 있다. 그때도 드래그만 하면 동작하게 해
// "안 되는 페이지는 없다"를 보장한다 → 그래서 추출 성공 여부와 무관하게 항상 켠다.
//
// 아이콘을 누른 탭에서만 켜진다(activeTab). 끄면 리스너·팝업 모두 정리한다.

// 짧은 용어일수록 오히려 막히는 자리다(API, UI, js, DOM…) → 2자까지 받는다.
// 1자를 막는 이유는 오조작 때문만이 아니다: 팝업이 뜨는 즉시 번역을 요청하므로
// 헛 팝업 하나 = 헛 LLM 호출 하나다. 1자짜리 선택은 사실상 전부 실수다.
const MIN_LEN = 2;
const MAX_LEN = 6_000; // 프록시 LIMITS.MAX_TEXT_CHARS와 맞춘다
const CONTEXT_MAX = 2_000; // 프록시 LIMITS.MAX_CONTEXT_CHARS와 맞춘다

export interface Drag {
  destroy(): void;
}

export function enableDrag(): Drag {
  const onMouseUp = (e: MouseEvent) => {
    if (isInsideDragPopup(e)) return; // 팝업 안에서 드래그·클릭한 것
    // mouseup 시점엔 선택이 아직 확정 전일 수 있어 한 틱 미룬다.
    setTimeout(handleSelection, 0);
  };

  const onMouseDown = (e: MouseEvent) => {
    // 팝업 바깥을 누르면 닫는다(팝업 안 클릭·입력은 유지).
    if (!isInsideDragPopup(e)) removeDragPopup();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') removeDragPopup();
  };

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown);

  return {
    destroy() {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown);
      removeDragPopup();
    },
  };
}

function handleSelection(): void {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

  const text = sel.toString().trim();
  if (text.length < MIN_LEN) return;
  if (text.length > MAX_LEN) {
    console.warn(`[Documate] 선택이 너무 김(${text.length}자) → 무시`);
    return;
  }
  // 우리 UI(번역·해설 블록) 안에서의 선택이면 팝업을 띄우지 않는다.
  if (isOurs(sel.anchorNode) || isOurs(sel.focusNode)) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return; // 보이지 않는 선택

  showDragPopup({
    text,
    docTitle: document.title,
    precedingText: contextOf(range, text),
    rect,
  });
}

// 선택 텍스트가 놓인 블록의 글(=문서 맥락). 해설이 "이 문서 안에서 왜/언제"를
// 말하려면 선택 조각만으론 부족하다 (documate.md §8).
function contextOf(range: Range, selected: string): string | undefined {
  const el =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  const block = el?.closest('p, li, td, blockquote, section, article, div');
  const text = block?.textContent?.replace(/\s+/g, ' ').trim();
  if (!text || text === selected) return undefined;
  return text.slice(0, CONTEXT_MAX);
}

// 우리가 주입한 UI 안의 노드인가. 주입 UI는 shadow root 안에 있으므로
// 노드의 root가 ShadowRoot면 그 host를 기준으로 본다(closest는 자기 자신도 포함).
function isOurs(node: Node | null): boolean {
  if (!node) return false;
  const root = node.getRootNode();
  const start =
    root instanceof ShadowRoot
      ? root.host
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
  return !!start?.closest('[data-documate-ui]');
}
