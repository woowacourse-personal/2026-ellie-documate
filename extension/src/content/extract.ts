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

// 문단 후보 블록. 콜아웃(Note/Warning)은 내부 <p>가 잡히므로 일반 문단처럼 포함된다.
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote';
// 코드/표 안 텍스트는 번역·해설 대상이 아니다 → 조상에 있으면 제외.
const EXCLUDE_ANCESTOR = 'pre, code, table';
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

export function extractParagraphs(): ExtractResult {
  const article = runReadability();

  // Readability 실패: 원본 블록을 그대로 쓰되 폴백으로 표시(nav 필터 불가).
  if (!article) {
    const live = collectBlocks(document.body);
    const paragraphs = live.map((b, i) => tag(b, i));
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

  const paragraphs: Paragraph[] = [];
  let unmappedCount = 0;
  let i = 0;
  for (const cb of cleanBlocks) {
    const liveNode = liveIndex.get(cb.text);
    if (!liveNode) {
      unmappedCount++; // 원본에서 못 찾음 → 드래그 폴백 대상
      continue;
    }
    paragraphs.push(tag({ ...cb, node: liveNode }, i++));
  }

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
