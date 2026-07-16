import { PROXY_BASE_URL } from '../shared/config';
import type { ExplainRequest } from '../shared/messages';

// 프록시(/api/explain) 스트리밍 호출. 키는 프록시에만 있으므로 확장은 프록시만 부른다.
// content script의 fetch는 페이지 origin이라 프록시가 거부하므로, 반드시 SW에서 호출한다.
// 도착하는 텍스트 델타를 onDelta로 흘려보낸다(해설은 첫 글자 체감 속도가 중요).
export async function streamExplain(
  req: ExplainRequest,
  onDelta: (delta: string) => void,
): Promise<void> {
  const res = await fetch(`${PROXY_BASE_URL}/api/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) throw new Error(`proxy ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const delta = decoder.decode(value, { stream: true });
    if (delta) onDelta(delta);
  }
}
