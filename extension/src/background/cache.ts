// 번역 결과 로컬 캐시 (chrome.storage.local). 같은 문단 재번역 비용을 없앤다.
// 키는 원문 텍스트 해시 → 사이트·페이지 무관하게 동일 문장은 캐시 적중.

function hashKey(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  // 길이도 섞어 충돌 여지 축소
  return `tr:${(h >>> 0).toString(36)}:${text.length}`;
}

export async function cacheGet(text: string): Promise<string | undefined> {
  const key = hashKey(text);
  const obj = await chrome.storage.local.get(key);
  return obj[key] as string | undefined;
}

export async function cacheSetMany(
  pairs: { text: string; translation: string }[],
): Promise<void> {
  if (pairs.length === 0) return;
  const entries: Record<string, string> = {};
  for (const p of pairs) entries[hashKey(p.text)] = p.translation;
  await chrome.storage.local.set(entries);
}
