# 취소표 감시 (B7)

`seats.json`에 회차를 등록하면 워크플로 `seat-watch`가 그 회차의 잔여석을 보고, 기준 석수 미만 → 이상으로 늘어난 순간 디스코드로 알립니다.
설계: lager `ideas/B7-CANCEL-SEAT-SPEC.md`. 등록·해제는 디스코드 봇(`/취소표`, `/감시해제`)이 이 파일을 GitHub API로 갱신합니다.

## `seats.json` (봇과 공유하는 형식, 배열)
```jsonc
[{
  "id": "a1b2",                     // 항목 번호(유일)
  "theater": "CGV 용산",             // 표시명
  "theater_key": "CGV,용산,0013",    // theaters.txt 한 줄 전체. "CGV:용산", "CGV,용산"도 받음
  "movie": "트레인스포팅",             // 영화 제목(공백·기호 무시, 부분 일치)
  "date": "2026-10-25",
  "time": "19:30",                   // 상영 시작 시각(KST)
  "min_seats": 2,                    // 이 석수 이상으로 늘면 알림
  "show_id": null,                   // 봇은 null로 등록 → 첫 실행이 회차를 찾아 영화관별 회차 ID를 채움
  "created_at": "2026-10-24T02:00:00Z",
  "expires_at": "2026-10-25T19:30:00+09:00",
  "note": ""
}]
```
스크립트가 덧붙이는 칸: `status` — `not_found`(그 시각 회차 없음) · `ambiguous`(같은 시각 회차가 여럿) · `theater_unknown`(영화관 키를 theaters.txt에서 못 찾음). 회차가 확정되면 사라집니다.

## 동작
- 첫 실행: `show_id`가 비어 있으면 영화관·날짜·영화·시각으로 회차를 찾아 `show_id`를 기록하고 디스코드에 `✅ … 지금 잔여 N석 · M석 이상 풀리면 알림`을 보냅니다. 못 찾으면 그날 그 영화 회차 목록을 한 번 알리고, 회차가 열릴 때까지 매 실행 다시 찾습니다.
- 이후: 상영 24시간 전부터 3분, 그전엔 5분 간격으로 조회(호출은 3분마다, 회차별로 주기를 맞춤). 첫 관측은 기준선만 잡습니다.
- 알림: 잔여석이 `min_seats` 미만 → 이상이 된 순간 1회 + 예매 링크. 같은 회차는 30분 안에 다시 알리지 않고, 내려갔다 올라오면 30분 뒤부터 재알림. 결제 대기 좌석이 풀린 것일 수 있어 바로 예매가 안 될 수 있다는 문구가 붙습니다.
- 정리: `expires_at`이 지났거나 상영 시작 시각이 지난 항목은 지우고 목록을 커밋합니다.
- 실패: 예매 감시와 같은 `_health` 규칙(연속 6·24회째 경고, 새벽 00~07시 KST는 4시간 뒤, 로그에 응답 `<title>`+앞 300자). 상태(마지막 잔여석·알림 시각·실패 횟수)는 actions cache의 `seat_state.json`.
- 영화관별 잔여석: CGV `frSeatCnt`, 메가박스 `restSeatCnt`, 롯데 `TotalSeatCount - BookingSeatCount`, 디트릭스 `RemainSeatCnt`, 씨네Q 페이지의 `잔여 / 전체`(앞 숫자를 잔여로 읽음).

## 호출 (cron-job.org)
기존 예매 감시 잡을 복제해 URL만 바꿉니다: `POST https://api.github.com/repos/saysolover/cinema_alert/actions/workflows/seat-watch.yml/dispatches`, 본문 `{"ref":"main"}`, 주기 3분(CGV 하한).
목록이 비면 요청 없이 몇 초 만에 끝나므로 항상 켜 둬도 됩니다.

## 점검
`node scripts/check_seat_watch.js` — 파서 5종, 회차 찾기, 0→N·중복 방지·주기·만료, 연속 실패 규칙, 가짜 응답 전체 실행. PR에서는 `message-format-check` 워크플로가 돌립니다.
