// Cloudflare Worker: CGV 예매 조회 API 중계. GitHub 러너(해외·데이터센터 IP)는 cgv.co.kr에서 403으로 막히는데,
// Cloudflare 안에서 나가는 요청은 통과한다(AWS Lambda 서울도 403이라 쓸 수 없었음).
// 토큰이 맞는 GET만 받고, 접속 대상은 cgv.co.kr 한 곳, 경로는 아래 3개만 허용한다.
// 비밀값: Worker 설정의 Secret `RELAY_TOKEN`. 코드에 넣지 않는다.
const ALLOWED = new Set([
  '/api/v1/booking/searchAtktTopPostrList',
  '/api/v1/booking/searchSiteScnscYmdListByMov',
  '/api/v1/booking/searchMovScnInfo',
]);

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
    if (!env.RELAY_TOKEN || request.headers.get('X-Relay-Token') !== env.RELAY_TOKEN) return new Response('unauthorized', { status: 401 });
    const url = new URL(request.url);
    if (!ALLOWED.has(url.pathname)) return new Response('forbidden path', { status: 403 });
    try {
      // 상영일·상영표 조회는 브라우저처럼 Referer/Origin/Sec-Fetch 헤더가 있어야 통과한다(차트 조회는 없어도 됨).
      const r = await fetch(`https://cgv.co.kr${url.pathname}${url.search}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Referer': 'https://cgv.co.kr/cnm/movieBook',
          'Origin': 'https://cgv.co.kr',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
    } catch (e) {
      return new Response(`upstream error: ${e.name}`, { status: 502 });
    }
  },
};
