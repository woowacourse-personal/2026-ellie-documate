import { Readability } from '@mozilla/readability';
import { indexByText, normalize } from './mapper';

// 본문 추출 + 문단 분리. 이 프로젝트 최대 기술 리스크.
//
// 설계(B: 콘텐츠 루트 직접 순회):
//   1. Readability로 "본문 문단 텍스트 집합 S"를 얻는다(정제본 = nav·광고·잡음 제거됨).
//   2. 원본 DOM에서 그 문단들의 최소 공통 조상(LCA) = "콘텐츠 루트"를 찾는다.
//   3. 콘텐츠 루트를 원본 DOM에서 직접 순회하며 leaf 블록을 모으고,
//      "텍스트가 S에 있거나(=본문), 콜아웃이거나, 제목(h1~6)이면" 채택한다.
//      (제목은 Readability가 본문에서 빼는 경우가 있어 별도로 항상 채택)
//
// 왜 이 구조인가:
//   - 원본 노드를 직접 다루므로 "정제본→원본 노드 재탐색"이라는 취약한 단계가 없다.
//   - S를 화이트리스트로 써서 스킵링크·배지·라이선스·푸터 같은 페이지 잡음을 걸러낸다.
//   - 콜아웃은 이 순회에서 자연히 포함된다(내부에 <p>가 없는 android식 aside는 leaf로 잡히고,
//     <p>를 가진 MDN식 notecard는 그 <p>가 S에 있어 잡힌다) → 별도 수집·정렬 경로 불필요.

export type ParagraphKind = 'text' | 'heading' | 'list-item' | 'quote' | 'code';

export interface Paragraph {
  id: string; // 안정적 식별자 (원본 노드에 data-documate-id로도 심는다)
  node: HTMLElement; // 원본 DOM 노드 (인라인 주입 대상)
  text: string; // 정규화된 문단 텍스트
  kind: ParagraphKind;
}

export interface ExtractResult {
  title: string;
  paragraphs: Paragraph[];
  unmappedCount: number; // Readability 본문(S)인데 루트 순회에서 못 잡은 수(진단·폴백 신호)
  readabilityOk: boolean; // false면 이 페이지 전체가 드래그 폴백 후보(F4)
}

// 본문 문단 후보(프로세). S 구성과 원본 색인·leaf 판정에 쓴다.
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote';
// 콜아웃(Note/Warning 박스 등): Readability가 비본문으로 제거하는 경우가 많다.
// 내부에 <p>가 없는 형태(aside 안에 <strong>+<span>만 있는 식)는 여기서 leaf로 직접 잡는다.
//
// **표준 선택자만 쓴다.** 사이트별 class(.notecard, .markdown-alert, [class*=admonition] …)를
// 넣지 않는다 — 특정 사이트에만 맞춘 설정은 나머지 웹을 조용히 차별하고, 사이트가 class를
// 바꾸면 소리 없이 죽는다. class를 가진 콜아웃은 대개 안에 <p>를 갖고 있고 그 <p>가 S에
// 들어오므로 일반 경로로 잡힌다.
const CALLOUT_SELECTOR = 'aside, [role="note"]';
// 루트 순회 대상 = 본문 블록 + 콜아웃.
const WALK_SELECTOR = `${BLOCK_SELECTOR}, ${CALLOUT_SELECTOR}`;
// 코드/표는 번역 대상이 아니다.
const EXCLUDE_CODE = 'pre, code, table';
// 루트 안이라도 네비/푸터/보조영역은 본문이 아니다.
// <header>는 여기 넣지 않는다 — 페이지 배너일 수도, 섹션 제목 묶음일 수도 있어서
// 통째로 빼면 섹션 제목이 사라진다. isPageBanner()가 따로 가른다.
const EXCLUDE_NONCONTENT =
  'pre, code, table, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
const OUR_UI = '#documate-root, [data-documate-ui]';
const MIN_TEXT_LEN = 2;

interface Block {
  node: HTMLElement;
  text: string;
  kind: ParagraphKind;
}

// 루트 아래 leaf 블록 수집(코드/표·우리 UI 제외). selector/exclude를 바꿔 재사용.
function collectBlocks(
  root: ParentNode,
  selector: string,
  exclude: string,
): Block[] {
  const out: Block[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(selector)) {
    if (node.closest(exclude)) continue;
    if (isPageBanner(node)) continue; // 페이지 상단 바(섹션 header는 통과)
    if (node.querySelector(selector)) continue; // 중첩 블록의 상위 → leaf만
    if (node.closest(OUR_UI)) continue; // 우리 주입 UI
    const text = blockText(node);
    if (text.length < MIN_TEXT_LEN) continue;
    out.push({ node, text, kind: kindOf(node.tagName) });
  }
  return out;
}

// 블록의 번역 텍스트. 제목에 박힌 인터랙티브 위젯(북마크·앵커·복사 버튼, 커스텀 엘리먼트)은
// 텍스트에서 제외한다. 예: developer.android.com H1 안의 <devsite-actions> 북마크 위젯.
function blockText(node: HTMLElement): string {
  if (!isHeading(node)) return normalize(node.textContent ?? '');
  const clone = node.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('button, [role="button"], [aria-hidden="true"]')) {
    el.remove();
  }
  for (const el of clone.querySelectorAll('*')) {
    if (el.tagName.includes('-')) el.remove(); // 커스텀 엘리먼트(위젯)
  }
  return normalize(clone.textContent ?? '');
}

function isHeading(node: HTMLElement): boolean {
  return /^H[1-6]$/.test(node.tagName);
}

// 이 노드가 "페이지 배너" <header> 안인가.
//
// <header>는 두 가지로 쓰인다:
//   (a) 페이지 상단 바 — 로고·검색·계정 메뉴. 본문이 아니다. (github.com의 <header>)
//   (b) 섹션의 제목 묶음 — <section><header><h2>제목</h2></header>…</section>. 본문이다.
// HTML 명세상 <header>의 암묵 role=banner는 article/aside/main/nav/section 안에
// **있지 않을 때만**이다. 그 기준을 그대로 쓴다.
//
// 왜 중요한가: <header>를 통째로 제외하면 (b)가 같이 죽는다. 랜딩 페이지의 섹션 제목
// ("Featured resources", "Join the Compose community" 등 5개)이 전부 여기 들어있어
// 번역에서 빠지고 있었다.
function isPageBanner(node: HTMLElement): boolean {
  const header = node.closest('header');
  if (!header) return false;
  return !header.parentElement?.closest('article, aside, main, nav, section');
}

// 제목은 문서 전체에서 수집한다(콘텐츠 루트 안이 아니어도).
//
// 왜 루트에 가두지 않나: 제목은 본문 컨테이너 밖에 놓이는 경우가 흔하다. 페이지 제목(H1)은
// 헤더 영역이나 article 바깥에 있고, Readability도 H1을 본문에서 빼 title로 승격시킨다
// (실측: 정제본에 H1이 아예 없다). 루트 순회에만 의존하면 페이지에 따라 제목이 통째로 빠진다.
// 또 제목은 S(화이트리스트) 검사도 하지 않는다 — Readability가 H1을 본문에서 제거하므로
// S에 있을 수가 없다.
//
// 대신 nav/헤더/푸터/보조영역은 제외한다(목차·사이드바 제목 중복 방지).
const HEADING_SELECTOR = 'h1, h2, h3, h4';
function collectHeadings(): Block[] {
  const out: Block[] = [];
  for (const node of document.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    if (node.closest(EXCLUDE_NONCONTENT)) continue;
    if (isPageBanner(node)) continue; // 페이지 상단 바(섹션 header는 통과)
    if (node.closest(OUR_UI)) continue;
    const text = blockText(node);
    if (text.length < MIN_TEXT_LEN) continue;
    out.push({ node, text, kind: 'heading' });
  }
  return out;
}

// 콜아웃 판정: 콜아웃 셀렉터에 맞고 네비/헤더/푸터 밖.
function isCallout(node: HTMLElement): boolean {
  return node.matches(CALLOUT_SELECTOR) && !node.closest('nav, header, footer');
}

// 코드 블록(<pre>): 번역하지 않고 "코드 해설" 대상으로만 수집. 개행을 보존한다.
const CODE_SELECTOR = 'pre';
const EXCLUDE_CHROME =
  'nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
function collectCode(root: ParentNode): Block[] {
  const out: Block[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(CODE_SELECTOR)) {
    if (node.closest(EXCLUDE_CHROME)) continue; // 네비/푸터 안 코드 제외
    if (node.closest(OUR_UI)) continue;
    if (node.parentElement?.closest(CODE_SELECTOR)) continue; // 중첩 pre → 바깥만
    // 코드는 정규화하지 않는다(개행·들여쓰기 유지). 양끝 공백만 정리.
    const text = (node.textContent ?? '').replace(/\r/g, '').trim();
    if (text.length < MIN_TEXT_LEN) continue;
    out.push({ node, text, kind: 'code' });
  }
  return out;
}

// 문서(DOM) 등장 순서 비교자 — 본문·콜아웃·코드를 제자리로 섞어 정렬.
function inDomOrder(a: Block, b: Block): number {
  if (a.node === b.node) return 0;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}

// 노드들의 최소 공통 조상. Readability 본문 노드들의 LCA = 콘텐츠 컨테이너.
function lca(nodes: HTMLElement[]): HTMLElement | null {
  if (nodes.length === 0) return null;
  let common: HTMLElement | null = nodes[0];
  let anc = ancestorSet(common);
  for (let i = 1; i < nodes.length; i++) {
    let n: HTMLElement | null = nodes[i];
    while (n && !anc.has(n)) n = n.parentElement;
    if (!n) return null;
    common = n;
    anc = ancestorSet(common);
  }
  return common;
}
function ancestorSet(el: HTMLElement): Set<HTMLElement> {
  const s = new Set<HTMLElement>();
  for (let x: HTMLElement | null = el; x; x = x.parentElement) s.add(x);
  return s;
}

// 콘텐츠 루트: 본문 노드들의 LCA. 너무 넓으면(body/html) main/article로 보정.
function findContentRoot(matched: HTMLElement[]): HTMLElement {
  const root = lca(matched);
  if (!root || root === document.body || root === document.documentElement) {
    return document.querySelector<HTMLElement>('main, article') ?? document.body;
  }
  return root;
}

export function extractParagraphs(): ExtractResult {
  const article = runReadability();

  // Readability 실패: 화이트리스트(S)가 없으므로 잡음을 못 거른다.
  // main/article(없으면 body)를 순회해 leaf 블록을 그대로 쓰되 폴백으로 표시(F4가 흡수).
  if (!article) {
    const root =
      document.querySelector<HTMLElement>('main, article') ?? document.body;
    const blocks = [
      // 제목(h1~h4)은 collectHeadings가 문서 전체에서 담당하므로 여기선 뺀다(중복 방지).
      ...collectBlocks(root, WALK_SELECTOR, EXCLUDE_NONCONTENT).filter(
        (b) => !b.node.matches(HEADING_SELECTOR),
      ),
      ...collectHeadings(),
      ...collectCode(root),
    ].sort(inDomOrder);
    const paragraphs = blocks.map((b, i) => tag(b, i));
    return { title: document.title, paragraphs, unmappedCount: 0, readabilityOk: false };
  }

  // 1) Readability 정제본에서 본문 문단 텍스트 집합 S.
  const cleanDoc = new DOMParser().parseFromString(article.content, 'text/html');
  const proseSet = new Set(
    collectBlocks(cleanDoc.body, BLOCK_SELECTOR, EXCLUDE_CODE).map((b) => b.text),
  );

  // 2) 원본에서 S 문단들의 노드 → LCA로 콘텐츠 루트 찾기.
  const origIndex = indexByText(
    collectBlocks(document.body, BLOCK_SELECTOR, EXCLUDE_CODE),
  );
  const matched: HTMLElement[] = [];
  for (const text of proseSet) {
    const node = origIndex.get(text);
    if (node) matched.push(node);
  }
  const root = findContentRoot(matched);

  // 3) 콘텐츠 루트를 원본에서 직접 순회 → 본문(∈S)·콜아웃·제목 채택.
  //    제목은 Readability가 본문에서 빼는 경우가 있어(페이지 제목·일부 소제목) 별도로 항상 채택
  //    (nav/헤더/푸터는 EXCLUDE_NONCONTENT가 이미 제외 → TOC 중복 없음).
  //    코드 블록은 번역하지 않되 "코드 해설" 대상으로 함께 넣고, DOM 순서로 정렬한다.
  const accepted: Block[] = [];
  for (const b of collectBlocks(root, WALK_SELECTOR, EXCLUDE_NONCONTENT)) {
    // h1~h4는 collectHeadings가 문서 전체에서 담당한다(루트 밖 제목도 잡기 위해) → 여기선 건너뛴다.
    if (b.node.matches(HEADING_SELECTOR)) continue;
    // isHeading은 이제 h5/h6에만 걸린다 — 기존처럼 S 검사 없이 채택한다.
    if (proseSet.has(b.text) || isCallout(b.node) || isHeading(b.node)) {
      accepted.push(b);
    }
  }
  for (const b of collectHeadings()) accepted.push(b);
  for (const b of collectCode(root)) accepted.push(b);
  accepted.sort(inDomOrder);
  const paragraphs = accepted.map((b, idx) => tag(b, idx));

  // Readability 본문인데 루트 순회에서 못 잡은 수(텍스트 불일치·루트 밖 등) → 진단/폴백 신호.
  const keptTexts = new Set(accepted.map((b) => b.text));
  let unmappedCount = 0;
  for (const text of proseSet) if (!keptTexts.has(text)) unmappedCount++;

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
