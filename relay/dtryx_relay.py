"""dtryx.com 중계용 AWS Lambda (서울 리전, Function URL).

디트릭스는 해외 IP(GitHub 러너 포함)를 차단하므로, 한국 리전의 Lambda가 요청만 대신 전달한다.
상태가 없는 중계이고, 열린 프록시가 되지 않도록 다음을 강제한다.
  - 공유 토큰(헤더 X-Relay-Token)이 환경변수 RELAY_TOKEN과 같아야 함 (틀리면 403)
  - 메서드는 GET만, 대상 호스트는 www.dtryx.com 고정, 경로는 아래 3개만 허용 (그 외 400/405)
  - 리다이렉트는 따라가지 않음 (다른 호스트로 새는 것을 막음)

사용법: GitHub 워크플로우가 https://www.dtryx.com 대신 <Function URL> 을 베이스로 쓴다.
  예) <Function URL>/reserve/main_list.do?cgid=...  →  https://www.dtryx.com/reserve/main_list.do?cgid=...

Lambda 설정: 런타임 Python 3.12 이상, 메모리 128MB, 타임아웃 15초, 핸들러 lambda_function.lambda_handler
(콘솔의 lambda_function.py 에 이 파일 내용을 붙여 넣는다).
"""
import hmac
import os
import urllib.error
import urllib.request

TARGET_HOST = "https://www.dtryx.com"
ALLOWED_PATHS = {"/reserve/movie.do", "/reserve/main_list.do", "/reserve/showseq_list.do"}
UPSTREAM_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": TARGET_HOST + "/reserve/movie.do",
}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _resp(status, body, content_type="text/plain; charset=utf-8"):
    return {"statusCode": status, "headers": {"Content-Type": content_type}, "body": body}


def lambda_handler(event, context):
    http = (event.get("requestContext") or {}).get("http") or {}
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}

    expected = os.environ.get("RELAY_TOKEN", "")
    given = headers.get("x-relay-token", "")
    # 토큰이 설정되지 않았거나(빈 값) 틀리면 거부. 상수 시간 비교.
    if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
        return _resp(403, "forbidden")

    if http.get("method") != "GET":
        return _resp(405, "method not allowed")

    path = event.get("rawPath") or ""
    if path not in ALLOWED_PATHS:
        return _resp(400, "path not allowed")

    query = event.get("rawQueryString") or ""
    url = TARGET_HOST + path + (("?" + query) if query else "")

    req = urllib.request.Request(url, headers=UPSTREAM_HEADERS, method="GET")
    try:
        with _opener.open(req, timeout=12) as r:
            status, body, ctype = r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:  # 4xx/5xx/3xx 도 상태 코드와 본문을 그대로 전달
        status, body, ctype = e.code, e.read(), e.headers.get("Content-Type", "")
    except Exception as e:  # 연결 실패 등
        return _resp(502, "upstream error: " + type(e).__name__)

    return _resp(status, body.decode("utf-8", errors="replace"), ctype or "text/plain; charset=utf-8")
