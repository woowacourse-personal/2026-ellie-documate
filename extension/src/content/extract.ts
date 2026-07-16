import { Readability } from '@mozilla/readability';
import { indexByText, normalize } from './mapper';

// 본문 추출 + 문단 분리 + 원본 DOM 매핑. 이 프로젝트 최대 기술 리스크.
//
// 흐름: Readability로 정제 본문 HTML 확보 → 거기서 문단 수집(nav 없음) →
//       각 문단을 원본 DOM 노드에 정확 텍스트 매칭(주입 대상 확보).

export type ParagraphKind = 'text' | 'heading' | 'list-item' | 'quote';

export interface Paragraph {
  id: string; // 안정적 식별자 (원본 노드에 data-documate-id로도 심는다)
  node: HTMLElement; // 원본 DOM 노드 (인라인 주입 대상)
  text: string; // 정규화된 문단 텍스트
  kind: ParagraphKind;
}

export interface ExtractResult {
  title: string;
  paragraphs: Paragraph[]; // 원본 노드 매핑에 성공한 문단
  unmappedCount: number; // 정제본엔 있으나 원본 매핑 실패 → 드래그 폴백 대상
  readabilityOk: boolean; // false면 이 페이지 전체가 드래그 폴백 후보(F4)
}

// 문단 후보 블록.
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote';
// 코드/표 안 텍스트는 번역·해설 대상이 아니다 → 조상에 있으면 제외.
const EXCLUDE_ANCESTOR = 'pre, code, table';
// 콜아웃(Note 박스 등): Readability가 <aside>를 비본문으로 보고 제거하므로 정제본엔 없다.
// 중요한 정보라 버리면 안 됨 → 원본에서 직접 수집해 문단에 합친다(사이트별로 넓힐 수 있음).
const CALLOUT_SELECTOR = 'aside.note';
const MIN_TEXT_LEN = 2;

interface Block {
  node: HTMLElement;
  text: string;
  kind: ParagraphKind;
}

// 루트 아래에서 문단 블록만 수집(코드/표 제외, leaf 블록만).
function collectBlocks(root: ParentNode): Block[] {
  const out: Block[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    if (node.closest(EXCLUDE_ANCESTOR)) continue; // 코드/표 안
    if (node.querySelector(BLOCK_SELECTOR)) continue; // 중첩 블록의 상위 → leaf만
    if (node.closest('#documate-root')) continue; // 우리 주입 UI
    const text = normalize(node.textContent ?? '');
    if (text.length < MIN_TEXT_LEN) continue;
    out.push({ node, text, kind: kindOf(node.tagName) });
  }
  return out;
}

// 원본 문서의 콜아웃(aside.note 등)을 문단으로 수집. Readability가 버리므로 원본에서 직접 잡는다.
// 이미 다른 경로로 잡힌 노드(used)는 건너뛴다.
function collectCallouts(used: Set<HTMLElement>): Block[] {
  const out: Block[] = [];
  for (const node of document.querySelectorAll<HTMLElement>(CALLOUT_SELECTOR)) {
    if (used.has(node)) continue;
    if (node.closest(EXCLUDE_ANCESTOR)) continue;
    if (node.closest('#documate-root')) continue;
    const text = normalize(node.textContent ?? '');
    if (text.length < MIN_TEXT_LEN) continue;
    out.push({ node, text, kind: 'text' });
  }
  return out;
}

// 문서(DOM) 등장 순서 비교자. 합쳐진 문단·note를 제자리로 정렬해 위→아래 순 번역이 되게 한다.
function inDomOrder(a: Block, b: Block): number {
  if (a.node === b.node) return 0;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}

export function extractParagraphs(): ExtractResult {
  const article = runReadability();

  // Readability 실패: 원본 블록을 그대로 쓰되 폴백으로 표시(nav 필터 불가).
  if (!article) {
    const live = collectBlocks(document.body);
    // 콜아웃 합치기(BLOCK_SELECTOR엔 안 잡힘) 후 문서 순서로 정렬.
    const used = new Set(live.map((b) => b.node));
    const blocks = [...live, ...collectCallouts(used)].sort(inDomOrder);
    const paragraphs = blocks.map((b, i) => tag(b, i));
    return {
      title: document.title,
      paragraphs,
      unmappedCount: 0,
      readabilityOk: false,
    };
  }

  // 정제 본문 HTML을 파싱해 문단 수집(nav 없음).
  const cleanDoc = new DOMParser().parseFromString(article.content, 'text/html');
  const cleanBlocks = collectBlocks(cleanDoc.body);

  // 원본 DOM 블록을 텍스트로 색인 → 정제 문단을 원본 노드에 매핑.
  const liveIndex = indexByText(collectBlocks(document.body));

  const mapped: Block[] = [];
  let unmappedCount = 0;
  for (const cb of cleanBlocks) {
    const liveNode = liveIndex.get(cb.text);
    if (!liveNode) {
      unmappedCount++; // 원본에서 못 찾음 → 드래그 폴백 대상
      continue;
    }
    mapped.push({ ...cb, node: liveNode });
  }

  // 콜아웃 합치기(Readability가 aside를 제거하므로 정제본엔 없음 → 원본에서 직접) 후
  // 문서(DOM) 순서로 정렬 → note가 제자리에 들어가 화면 위→아래 순으로 번역된다.
  const used = new Set(mapped.map((b) => b.node));
  const blocks = [...mapped, ...collectCallouts(used)].sort(inDomOrder);
  const paragraphs = blocks.map((b, idx) => tag(b, idx));

  return {
    title: article.title || document.title,
    paragraphs,
    unmappedCount,
    readabilityOk: true,
  };
}

// 문단에 id 부여 + 원본 노드에 표식(재탐색·중복주입 방지).
function tag(block: Block, index: number): Paragraph {
  const id = `dm-${index}`;
  block.node.dataset.documateId = id;
  return { id, node: block.node, text: block.text, kind: block.kind };
}

// Readability는 원본을 변형하므로 반드시 복제본에 돌린다(원본 비파괴).
function runReadability(): { title: string; content: string } | null {
  try {
    const clone = document.cloneNode(true) as Document;
    const article = new Readability(clone).parse();
    if (article?.content) {
      return { title: article.title || document.title, content: article.content };
    }
  } catch (err) {
    console.warn('[Documate] Readability 실패 → 폴백', err);
  }
  return null;
}

function kindOf(tagName: string): ParagraphKind {
  const t = tagName.toLowerCase();
  if (/^h[1-6]$/.test(t)) return 'heading';
  if (t === 'li') return 'list-item';
  if (t === 'blockquote') return 'quote';
  return 'text';
}
