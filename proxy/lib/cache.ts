import { Redis } from '@upstash/redis';

// 공용 번역 캐시 (Upstash Redis). 사용자 간 공유된다.
//
// 왜 필요한가: Gemini API 키가 하나뿐이라 **하루 쿼터가 전 사용자의 공유 자원**이다
// (flash-lite 무료 = 500 RPD). 이게 없으면 열 명이 같은 문서를 볼 때 같은 문단을 열 번
// 번역해 쿼터가 사용자 수만큼 빨리 마른다. 캐시가 있으면 소모가 "사용자 수 × 페이지"가
// 아니라 "고유 문단 수"에 비례한다 → 인기 문서는 2번째 독자부터 공짜.
//
// 일관성 장치가 아니다. 일관성은 translate의 temperature: 0이 이미 해결했다.
//
// 범위: 번역만. 해설은 캐시하지 않는다(프롬프트를 계속 고치는 중이라 캐시하면 개선이
// 사용자에게 닿지 않고, 후속질문은 사용자별 대화라 공유 자체가 불가능하다). PLAN.md §6.

// 키 버전. **프롬프트(lib/prompts.ts)나 모델(lib/gemini.ts)을 바꾸면 반드시 올린다.**
// 안 올리면 옛 번역이 계속 나온다. flash-lite-latest는 움직이는 별칭이라 구글이 모델을
// 갱신해도 마찬가지지만, 그건 우리가 감지할 수 없어 버전으로 덮는다.
// v2 (2026-07-22): 번역 프롬프트 강화(어투 일관성·다의어 문맥·관용어 의역)로 옛 번역을
// 더 내보내지 않도록 올림. 옛 tr:v1:* 키는 안 읽히고 TTL(90일)로 자동 만료된다.
const KEY_VERSION = 'v3';
const TTL_SECONDS = 60 * 60 * 24 * 90; // 90일 — 문서가 개정되면 원문이 바뀌어 키도 바뀐다

// 환경변수가 없으면 캐시 없이 동작한다(로컬 개발·Upstash 미설정).
//
// ⚠️ `Redis.fromEnv()`를 쓰지 않는다. fromEnv()는 `UPSTASH_REDIS_REST_URL`/`TOKEN`을 읽는데,
// **Vercel Marketplace가 주입하는 이름은 `KV_REST_API_URL`/`KV_REST_API_TOKEN`이다**
// (옛 @vercel/kv 호환 이름). fromEnv()를 쓰면 변수가 있어도 못 찾아 캐시가 영영 꺼진 채로
// 돌고, fail-open이라 에러 하나 없이 조용히 지나간다. 둘 다 받아준다.
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const enabled = !!url && !!token;
const redis = enabled ? new Redis({ url: url!, token: token! }) : undefined;

// 레이트리밋(lib/ratelimit.ts)이 **같은 인스턴스**를 쓴다 — 통합 하나로 캐시와 방어를 함께 얻는다.
export const redisClient = redis;

export function cacheEnabled(): boolean {
  return enabled;
}

// 원문 → 캐시 키. 원문 자체를 키로 쓰지 않는 이유는 길이 제한과 저장 용량 때문이다.
// (해시 충돌은 다른 문장의 번역이 나오는 것이므로, 32비트로는 부족하다 → SHA-256 앞부분)
async function keyOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16) // 128비트면 충돌 걱정이 없다
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `tr:${KEY_VERSION}:${hex}`;
}

// 여러 문장을 한 번에 조회한다. 반환은 입력과 같은 길이의 배열(미적중은 undefined).
//
// **반드시 MGET으로 묶는다.** 문단마다 GET하면 25문단 청크가 25명령이 되고,
// Upstash 무료 티어의 하루 명령 한도가 Gemini 쿼터보다 먼저 마른다.
export async function cacheGetMany(
  texts: string[],
): Promise<(string | undefined)[]> {
  if (!redis || texts.length === 0) return texts.map(() => undefined);
  try {
    const keys = await Promise.all(texts.map(keyOf));
    const hits = await redis.mget<(string | null)[]>(...keys);
    return hits.map((h) => h ?? undefined);
  } catch (err) {
    // 캐시는 최적화지 필수 경로가 아니다. 죽으면 그냥 미적중 취급하고 번역을 계속한다.
    console.error('cache read failed', err);
    return texts.map(() => undefined);
  }
}

// 새로 번역한 것만 저장한다. TTL은 키마다 걸어야 해서 파이프라인으로 묶는다.
export async function cacheSetMany(
  pairs: { text: string; translation: string }[],
): Promise<void> {
  if (!redis || pairs.length === 0) return;
  try {
    const pipe = redis.pipeline();
    for (const p of pairs) {
      pipe.set(await keyOf(p.text), p.translation, { ex: TTL_SECONDS });
    }
    await pipe.exec();
  } catch (err) {
    console.error('cache write failed', err); // 저장 실패해도 번역은 이미 응답한다
  }
}
