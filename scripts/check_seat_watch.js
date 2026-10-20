// 취소표 감시(B7) 점검. 실행: node scripts/check_seat_watch.js  (네트워크·비밀값 없음)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./seat_lib');
const { run } = require('./seat_watch');

// ---- 1. 영화관별 파서 5종 (실제 응답 모양을 줄인 샘플) ----
{
  const cgv = L.parseCgv({ statusCode: 0, data: [
    { siteNo: '0013', scnYmd: '20261025', scnsNo: '003', scnSseq: '2', movNm: '트레인스포팅', scnsNm: '3관', scnsrtTm: '1930', frSeatCnt: '0', stcnt: '120' },
    { siteNo: '0013', scnYmd: '20261025', scnsNo: '001', scnSseq: '4', movNm: '인턴', scnsNm: '1관[세포랩관] (Laser)', scnsrtTm: '0905', frSeatCnt: '204', stcnt: '204' },
  ] }, '0013');
  assert.deepStrictEqual([cgv[0].id, cgv[0].date, cgv[0].time, cgv[0].remain, cgv[0].total], ['0013-20261025-003-2', '2026-10-25', '19:30', 0, 120]);
  assert.strictEqual(cgv[1].time, '09:05');
  assert.throws(() => L.parseCgv({ statusCode: 1, data: null }, '0013'), /CGV 응답 형식 이상/);

  const mega = L.parseMegabox({ statCd: 0, megaMap: { movieFormList: [
    { brchNm: '코엑스', playDe: '20261025', playSchdlNo: '2610251001', movieNm: '트레인스포팅', playStartTime: '19:30', theabExpoNm: '4관', restSeatCnt: 3, totSeatCnt: 120 },
    { brchNm: '강동', playDe: '20261025', playSchdlNo: '2610251341', movieNm: '트레인스포팅', playStartTime: '19:30', theabExpoNm: '1관', restSeatCnt: 90, totSeatCnt: 249 },
    { brchNm: '코엑스', playDe: '20261026', playSchdlNo: '2610261001', movieNm: '트레인스포팅', playStartTime: '19:30', theabExpoNm: '4관', restSeatCnt: 3, totSeatCnt: 120 },
  ] } }, '코엑스', '20261025');
  assert.deepStrictEqual(mega.map(x => [x.id, x.remain, x.total, x.time]), [['2610251001', 3, 120, '19:30']], '메가박스: 지점·날짜로 거른다');
  assert.throws(() => L.parseMegabox({ statCd: 1 }, '코엑스', '20261025'), /메가박스 응답 형식 이상/);

  const lotte = L.parseLotte({ PlaySeqs: { Items: [
    { CinemaID: 1016, ScreenID: 1211, PlayDt: '2026-10-25', PlaySequence: 3, MovieNameKR: '트레인스포팅', StartTime: '19:30', TotalSeatCount: 8, BookingSeatCount: 0, ScreenNameKR: '11관' },
    { CinemaID: 1016, ScreenID: 1212, PlayDt: '2026-10-25', PlaySequence: 1, MovieNameKR: '인턴', StartTime: '10:00', TotalSeatCount: 100, BookingSeatCount: 60, ScreenNameKR: '1관' },
  ] } });
  assert.deepStrictEqual([lotte[0].id, lotte[0].remain, lotte[1].remain], ['1016-1211-2026-10-25-3', 0, 60], '롯데: BookingSeatCount가 곧 잔여(매진이면 0) — 실제 응답과 대조해 확정');
  assert.throws(() => L.parseLotte({ PlaySeqsHeader: { Items: [] } }), /롯데 응답 형식 이상/);

  const dt = L.parseDtryx({ Showseqlist: [{ MovieDetail: [
    { CinemaCd: '000067', BrandCd: 'indieart', MovieCd: '029696', PlaySDT: '2026-10-25', ScreenCd: '02', ShowSeq: '1', StartTime: '19:30', MovieNmNat: '눈 둘 데가 없네', ScreenNmNat: '2관', RemainSeatCnt: '112', TotalSeatCnt: '138' },
    { CinemaCd: '000069', BrandCd: 'indieart', MovieCd: '029696', PlaySDT: '2026-10-25', ScreenCd: '01', ShowSeq: '1', StartTime: '19:30', MovieNmNat: '눈 둘 데가 없네', ScreenNmNat: '1관', RemainSeatCnt: '5', TotalSeatCnt: '50' },
  ] }] }, '000067');
  assert.deepStrictEqual(dt.map(x => [x.id, x.remain, x.total]), [['000067-029696-2026-10-25-02-1', 112, 138]], '디트릭스: 영화관 코드로 거른다');
  assert(dt[0].link.includes('BrandCd=indieart&CinemaCd=000067&MovieCd=029696&PlaySDT=2026-10-25'), '딥링크');
  assert.throws(() => L.parseDtryx({}, '000067'), /디트릭스 응답 형식 이상/);

  const html = `<div id="x"><a class="priceTableBtn"></a>
    <div class="each-movie-time"> <div class="title"><span class="rate-x">18</span>트레인스포팅 </div>
      <div class="screen"> <div class="screen-name" style="font-size:15px;"><br />8 관</div> <div class="time-block">
        <div class="time" data-playdate="20261021" data-theatercode="1001" data-moviecode="1997" data-screenplanid="1104303" data-playnumber="5"> <a href="#"> 16:20<span class="to"> ~ 17:59</span> <span class="seats-status">84 / 91</span> </a> </div> </div> </div>
      <div class="screen"> <div class="screen-name"><br />(씨네필)9 관</div> <div class="time-block">
        <div class="time" data-playdate="20261021" data-theatercode="1001" data-moviecode="1997" data-screenplanid="1104287" data-playnumber="6"> <a href="#"> 20:30<span class="to"> ~ 22:09</span> <span class="seats-status">매진</span> </a> </div> </div> </div>
    </div><div class="each-movie-time"> <div class="title"><span class="rate-x">12</span>1987 </div>
      <div class="screen"> <div class="screen-name"><br />1 관</div> <div class="time-block">
        <div class="time" data-playdate="20261021" data-theatercode="1001" data-moviecode="1" data-screenplanid="9" data-playnumber="1"> <a href="#"> 10:00<span class="to"> ~ 12:00</span> <span class="seats-status">10 / 50</span> </a> </div> </div> </div></div>`;
  const cq = L.parseCineq(html, '1001');
  assert.deepStrictEqual(cq.map(x => [x.id, x.title, x.date, x.time, x.screen, x.remain, x.total]), [
    ['1104303-5', '트레인스포팅', '2026-10-21', '16:20', '8 관', 84, 91],
    ['1104287-6', '트레인스포팅', '2026-10-21', '20:30', '(씨네필)9 관', 0, null],
    ['9-1', '1987', '2026-10-21', '10:00', '1 관', 10, 50],
  ], '씨네큐: 제목 앞 등급 표시는 지우고, 매진은 0석');
  assert.throws(() => L.parseCineq('<html>점검 중</html>', '1001'), /씨네Q 응답 형식 이상/);
}

// ---- 2. 영화관 키, 회차 찾기 ----
{
  const th = L.parseTheaters('CGV,용산,0013\nLOTTE,월드타워,1|0001|1016\nMEGABOX,코엑스,10\nCINEQ,신도림,1001\nLOTTE,신도림,1|0001|1015\n');
  for (const k of ['CGV:용산', 'CGV,용산', 'CGV,용산,0013', '용산']) assert.strictEqual(L.findTheater(th, k).code, '0013', k);
  const mb = L.parseTheaters('MEGABOX,코엑스,10\nMEGABOX,홍대,10\n');
  assert.strictEqual(L.findTheater(mb, 'MEGABOX,홍대,10').name, '홍대', '코드가 겹쳐도 한 줄 전체로 찾는다');
  assert.strictEqual(L.findTheater(th, 'LOTTE,월드타워,1|0001|1016').name, '월드타워');
  assert.strictEqual(L.findTheater(th, '신도림'), null, '이름만 쓰면 둘 이상일 때 찾지 않는다');
  assert.strictEqual(L.findTheater(th, 'LOTTE:신도림').code, '1|0001|1015');
  assert.strictEqual(L.findTheater(th, 'CGV:없음'), null);
  const ss = [
    { id: 'a', title: '트레인스포팅', date: '2026-10-25', time: '19:30', screen: '3관' },
    { id: 'b', title: '트레인스포팅', date: '2026-10-25', time: '21:30', screen: '3관' },
    { id: 'c', title: '다른 영화', date: '2026-10-25', time: '19:30', screen: '1관' },
    { id: 'd', title: '트레인스포팅', date: '2026-10-26', time: '19:30', screen: '3관' },
  ];
  const e = { movie: '트레인 스포팅', date: '2026-10-25', time: '19:30' };
  assert.strictEqual(L.findSession(ss, e).session.id, 'a', '제목 공백·날짜·시각으로 하나를 고른다');
  const nf = L.findSession(ss, { ...e, time: '20:00' });
  assert.deepStrictEqual([nf.status, nf.times], ['not_found', ['19:30 3관', '21:30 3관']]);
  assert.strictEqual(L.findSession([...ss, { ...ss[0], id: 'a2', screen: '4관' }], e).status, 'ambiguous');
}

// ---- 3. 0→N 판정, 주기, 만료 ----
{
  const T = Date.UTC(2026, 9, 24, 3, 0);
  let r = L.step(undefined, 0, 2, T);
  assert.deepStrictEqual([r.alert, r.next.last], [false, 0], '첫 관측은 기준선만');
  r = L.step({ last: 0, checked_at: T }, 1, 2, T + 1);
  assert.strictEqual(r.alert, false, '기준(2석) 미만으로 늘면 알리지 않는다');
  r = L.step({ last: 1, checked_at: T }, 2, 2, T + 1);
  assert.deepStrictEqual([r.alert, r.prev], [true, 1], '기준 이상이 되는 순간');
  assert.strictEqual(L.step({ last: 5, checked_at: T }, 7, 2, T + 1).alert, false, '이미 기준 이상이면 알리지 않는다');
  assert.strictEqual(L.step({ last: 2, checked_at: T }, 3, 2, T + 1).alert, false, '기준과 같은 석수에서 늘어난 것도 이미 기준 이상');
  assert.strictEqual(L.step({ last: 0, alerted_at: T }, 4, 2, T + 29 * 60000).alert, false, '30분 안 중복 없음');
  assert.strictEqual(L.step({ last: 0, alerted_at: T }, 4, 2, T + 31 * 60000).alert, true, '30분 뒤 다시 올라오면 재알림');

  const far = { date: '2026-10-26', time: '19:30' }, near = { date: '2026-10-24', time: '20:00' };
  assert.strictEqual(L.everyMs(far, T), 5 * 60000);
  assert.strictEqual(L.everyMs(near, T), 3 * 60000, '상영 24시간 전부터 3분');
  assert.strictEqual(L.isDue({ checked_at: T }, far, T + 3 * 60000), false, '먼 회차는 3분 뒤엔 아직');
  assert.strictEqual(L.isDue({ checked_at: T }, far, T + 5 * 60000 - 20000), true, '5분 주기(지터 여유)');
  assert.strictEqual(L.isDue({ checked_at: T }, near, T + 3 * 60000 - 20000), true);
  assert.strictEqual(L.isDue(undefined, far, T), true);

  assert.strictEqual(L.isExpired({ date: '2026-10-24', time: '10:00' }, T), true, '상영 시작이 지나면 삭제');
  assert.strictEqual(L.isExpired({ date: '2026-10-26', time: '10:00', expires_at: '2026-10-24T00:00:00Z' }, T), true, 'expires_at이 지나면 삭제');
  assert.strictEqual(L.isExpired({ date: '2026-10-26', time: '10:00', expires_at: '2026-10-27T00:00:00Z' }, T), false);
}

// ---- 4. 연속 실패 규칙: 예매 감시 5종과 같다(낮 6·24회, 새벽 4시간) ----
{
  const kst = (day, h) => Date.UTC(2026, 9, day, h - 9, 0);
  const go = (startMs, count) => {
    let h, sent = [];
    for (let i = 0; i < count; i++) { const r = L.nextHealth(h, true, 'HTTP 200: <html>', startMs + i * 3 * 60000); h = r.health; if (r.messages.length) sent.push(h.consecutive_failures); }
    return { sent, h };
  };
  assert.deepStrictEqual(go(kst(20, 12), 30).sent, [6, 24]);
  assert.deepStrictEqual(go(kst(21, 0), 79).sent, [], '새벽 4시간(80회) 전엔 조용');
  assert.deepStrictEqual(go(kst(21, 0), 80).sent, [80], '새벽 4시간째에 한 통');
  const night = go(kst(21, 5), 20);
  assert.strictEqual(L.nextHealth(night.h, true, 'x', kst(21, 7)).messages.length, 1, '07시에도 실패 중이면 바로');
  assert.strictEqual(L.nextHealth(go(kst(20, 12), 6).h, false, '', kst(20, 13)).messages.length, 1, '복구 알림');
}

// ---- 5. 실행 전체 (가짜 응답) ----
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-'));
  const paths = { seats: path.join(dir, 'seats.json'), theaters: path.join(dir, 'theaters.txt'), state: path.join(dir, 'state.json') };
  fs.writeFileSync(paths.theaters, 'CGV,용산,0013\nCINEQ,신도림,1001\n');
  const T0 = Date.UTC(2026, 9, 24, 3, 0); // 10/24 12:00 KST
  const entry = (over = {}) => ({ id: 'a1', theater: 'CGV 용산', theater_key: 'CGV:용산', movie: '트레인스포팅', date: '2026-10-25', time: '19:30', min_seats: 2, show_id: null, created_at: '2026-10-24T02:00:00Z', expires_at: '2026-10-26T00:00:00Z', note: '', ...over });
  const write = v => fs.writeFileSync(paths.seats, JSON.stringify(v));
  const read = () => JSON.parse(fs.readFileSync(paths.seats, 'utf8'));
  let remain = 0, mode = 'ok', calls = 0;
  const fetchFn = async url => {
    calls++;
    if (mode === 'blocked') return { ok: false, status: 403, text: async () => '<html><head><title>접속 불가</title></head></html>' };
    assert(String(url).includes('searchMovScnInfo') && String(url).includes('siteNo=0013') && String(url).includes('scnYmd=20261025'), `예상 밖 요청: ${url}`);
    const data = [{ siteNo: '0013', scnYmd: '20261025', scnsNo: '003', scnSseq: '2', movNm: '트레인스포팅', scnsNm: '3관', scnsrtTm: '1930', frSeatCnt: String(remain), stcnt: '120' }];
    return { ok: true, status: 200, text: async () => JSON.stringify({ statusCode: 0, data }) };
  };
  const sent = [];
  const go = (min, over = {}) => run({ env: { SEAT_TEST: '1' }, now: T0 + min * 60000, paths, fetchFn, send: async t => sent.push(t), ...over });

  // 목록이 비면 요청 없이 끝난다
  write([]);
  let r = await go(0);
  assert.deepStrictEqual([r.idle, calls], [true, 0]);

  // 등록(show_id=null) → 첫 실행이 회차를 확정하고 확인 메시지, 파일에 show_id 기록
  write([entry()]);
  remain = 0;
  r = await go(0);
  assert.strictEqual(read()[0].show_id, '0013-20261025-003-2');
  assert(sent[0].startsWith('✅ CGV 용산 · 트레인스포팅 · 10/25(일) 19:30 3관 · 지금 잔여 0석 · 2석 이상 풀리면 알림'), sent[0]);
  assert.strictEqual(r.confirmations, 1);

  // 5분 안에는 다시 조회하지 않는다(먼 회차는 5분 주기)
  const before = calls;
  await go(2);
  assert.strictEqual(calls, before, '주기 전에는 요청 없음');

  // 0 → 1 (기준 2 미만): 알림 없음, 1 → 3: 알림 1회
  remain = 1; await go(5);
  assert.strictEqual(sent.length, 1);
  remain = 3; await go(10);
  assert.strictEqual(sent.length, 2);
  assert(sent[1].includes('🎟 취소표 알림!') && sent[1].includes('잔여 1석 → 3석') && sent[1].includes('결제 대기') && sent[1].includes('[예매하기](<'), sent[1]);
  // 계속 높으면 재알림 없음, 내려갔다가 30분 안에 올라오면 없음, 30분 뒤엔 있음
  remain = 3; await go(15);
  remain = 0; await go(20);
  remain = 4; await go(25);
  assert.strictEqual(sent.length, 2, '30분 안 중복 없음');
  remain = 0; await go(35);
  remain = 4; await go(45);
  assert.strictEqual(sent.length, 3, '내려갔다 올라오면 30분 뒤 재알림');

  // 회차를 못 찾으면 그날 회차 목록을 한 번만 알리고 status를 남긴다
  write([entry({ id: 'n1', time: '20:00' })]);
  sent.length = 0;
  await go(100);
  assert.strictEqual(read()[0].status, 'not_found');
  assert(sent[0].includes('그날 이 영화 회차: 19:30 3관'), sent[0]);
  await go(103);
  assert.strictEqual(sent.length, 1, '같은 안내를 반복하지 않는다');

  // 만료된 항목은 삭제되고 파일이 갱신된다
  write([entry({ id: 'x1', show_id: 'z', expires_at: '2026-10-20T00:00:00Z' })]);
  const c2 = calls;
  r = await go(200);
  assert.deepStrictEqual([read().length, r.removed, calls], [0, 1, c2]);

  // 차단 응답은 실패로 세고 _health에 쌓인다(알림은 임계에서만)
  write([entry({ id: 'f1', show_id: '0013-20261025-003-2' })]);
  fs.writeFileSync(paths.state, '{}');
  mode = 'blocked'; sent.length = 0;
  r = await go(300);
  const st = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
  assert.strictEqual(st._health.consecutive_failures, 1);
  assert(st._health.last_error.includes('[title: 접속 불가]'), st._health.last_error);
  assert.strictEqual(sent.length, 0);

  // 시험 모드: 아무것도 쓰지 않고 보내지 않는다
  mode = 'ok'; remain = 0;
  write([entry({ id: 'd1' })]);
  const snap = fs.readFileSync(paths.seats, 'utf8');
  sent.length = 0;
  await go(400, { dry: true });
  assert.deepStrictEqual([fs.readFileSync(paths.seats, 'utf8'), sent.length], [snap, 0]);

  console.log('OK: 영화관별 잔여석 파서 5종, 회차 찾기, 0→N·중복 방지·주기·만료, 연속 실패 규칙, 전체 실행(가짜 응답)이 맞다.');
})().catch(e => { console.error(e); process.exit(1); });
