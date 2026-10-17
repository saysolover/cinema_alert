# CGV 중계(Cloudflare Worker) 설정 안내

cgv.co.kr은 GitHub 러너(미국/Azure IP)와 AWS(서울 포함) IP를 Cloudflare 차단 페이지(403)로 막습니다.
Cloudflare Workers에서 나가는 요청은 통과하는 것을 확인해, Worker를 중계로 씁니다(무료 한도 안).

1. https://dash.cloudflare.com → Workers & Pages → Create → Worker. 이름 예: `cgv-probe`.
2. Edit code에 `cgv_worker.js` 내용을 붙여 넣고 Deploy.
3. Settings → Variables and Secrets → Add: 이름 `RELAY_TOKEN`, 종류 **Secret**, 값은 임의의 긴 문자열. Deploy.
4. GitHub 저장소 Secrets에 `CGV_RELAY_URL`(Worker 주소, 예 `https://cgv-probe.<계정>.workers.dev`)과
   `CGV_RELAY_TOKEN`(3번과 같은 값)을 넣습니다.

확인: 토큰 없이 호출하면 401, 허용 경로 밖이면 403, GET 외에는 405, 정상이면 CGV의 JSON(`statusCode: 0`)이 옵니다.
Cloudflare가 Worker 트래픽도 막기 시작하면 워크플로가 연속 실패 알림(6회째)을 보냅니다.
