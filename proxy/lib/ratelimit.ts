import { Ratelimit } from '@upstash/ratelimit';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redisClient } from './cache.js';

// IP 기준 레이트리밋. 공용 캐시와 **같은 Upstash Redis**를 쓴다.
//
// 왜 필수인가: 이 확장은 공개 배포되므로 프록시 URL이 번들 안에 있고 사실상 공개다.
// 인증은 불가능하다(확장에 심는 어떤 비밀도 공개다) → 레이트리밋이 실질적 1차 방어다.
// 게다가 Gemini 무료 티어가 **하루 500요청(flash-lite)**뿐이라 하루치가 몇 분 만에
// 날아갈 수 있고, 그러면 정작 테스터가 종일 못 쓴다. 돈이 아니라 가용성 문제다.
//
// 한도 산정(500 RPD 기준):
//   한 페이지 정독 ≈ 번역 4요청(25문단 청크) + 해설 몇 번 ≈ 5~7요청
//   → 500 RPD ≈ 하루 100페이지, **전 사용자 합계**(API 키가 하나라 공유 자원)
//   BURST 20/10초 : 페이지 하나가 청크 4개를 병렬로 쏘므로 그보다 넉넉해야 한다.
//                   두드리기(hammering)를 막는 용도.
//   DAILY 100/일  : 1인당 하루 ~25페이지. 사람이 문서를 그만큼 읽지 않는다.
//                   테스터 5명이 각자 상한까지 써야 500에 닿는다 → 한 명이 전부
//                   태우는 것만 막는다.
// 공용 캐시가 적중하면 Gemini를 안 부르므로 실질 여유는 이보다 훨씬 크다.
// 숫자는 실제 소모를 보고 조정한다.
const BURST = { limit: 20, window: '10 s' } as const;
const DAILY = { limit: 100, window: '1 d' } as const;

const burst = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(BURST.limit, BURST.window),
      prefix: 'rl:burst',
    })
  : undefined;
const daily = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(DAILY.limit, DAILY.window),
      prefix: 'rl:daily',
    })
  : undefined;

// 클라이언트 IP. Vercel이 x-forwarded-for에 넣어준다(맨 앞이 원 클라이언트).
// 위조 가능하지만 인증이 애초에 불가능한 판이라 "문턱 높이기"다(PLAN §5.5 위협 모델).
function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0];
  return (first ?? (req.headers['x-real-ip'] as string) ?? 'unknown').trim();
}

// 한도를 넘으면 429로 닫고 false. 통과면 true.
//
// **fail-open**: Redis가 죽거나 미설정이면 통과시킨다. 레이트리밋 때문에 서비스가
// 통째로 멎는 게 더 나쁘다. 캐시와 같은 원칙이고, 로컬 개발(Upstash 없음)도 이 경로다.
export async function checkRateLimit(
  req: VercelRequest,
  res: VercelResponse,
): Promise<boolean> {
  if (!burst || !daily) return true; // 미설정 → 통과(로컬 개발)

  const ip = clientIp(req);
  try {
    const [b, d] = await Promise.all([burst.limit(ip), daily.limit(ip)]);
    const hit = !b.success ? b : !d.success ? d : undefined;
    if (!hit) return true;

    const retryAfter = Math.max(1, Math.ceil((hit.reset - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    // 어느 쪽 한도인지는 알려주지 않는다(공격자에게 정보를 주지 않는다).
    console.warn(`rate limited · ${b.success ? 'daily' : 'burst'} · retry ${retryAfter}s`);
    res.status(429).json({ error: 'rate_limited', retryAfter });
    return false;
  } catch (err) {
    // fail-open이되 조용히 넘기지 않는다. 레이트리밋이 이 경로로 상시 새면 방어가
    // 통째로 무력화되므로(과거 @upstash/redis 인스턴스 비호환으로 evalsha undefined가
    // 났었다) 반드시 로그로 드러낸다.
    console.error('ratelimit check failed → 통과(fail-open)', err);
    return true;
  }
}
