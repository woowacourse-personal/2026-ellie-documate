// 번역/해설 블록을 문단 노드 근처에 '레이아웃을 깨지 않게' 삽입한다.
//
// 기본은 원문 바로 뒤(afterend = 원문 아래 블록 흐름). 그런데 부모가 특수 레이아웃
// 컨테이너면 afterend로 넣은 우리 블록이 그 레이아웃의 '아이템'으로 끼어들어 원문을
// 밀어낸다:
//   - 표: <td> 뒤(=<tr>의 자식)에 넣으면 익명 셀로 감싸져 열이 하나 더 생긴다.
//   - flex/grid: flex 컨테이너의 자식 뒤에 넣으면 우리 블록이 flex 아이템이 되어
//     원문 '옆으로' 끼어든다(kt.academy 실측: div.group.flex > div.flex-1 문단).
// 이런 경우엔 노드 '안쪽'(마지막 자식)에 넣어야 원문 아래에 안전하게 붙는다.
export function insertBlock(node: HTMLElement, host: HTMLElement): void {
  const parent = node.parentElement;
  const parentDisplay = parent ? getComputedStyle(parent).display : '';
  const wouldBecomeLayoutItem =
    node.tagName === 'TD' ||
    node.tagName === 'TH' ||
    /flex|grid/.test(parentDisplay); // inline-flex/inline-grid 포함
  if (wouldBecomeLayoutItem) node.append(host);
  else node.insertAdjacentElement('afterend', host);
}
