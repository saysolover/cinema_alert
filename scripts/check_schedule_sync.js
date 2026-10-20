// 시간표 동기화(B7) 점검. 실행: node scripts/check_schedule_sync.js  (네트워크 없음)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./schedule_sync');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
  const paths = { out: path.join(dir, 'schedules.json'), theaters: path.join(dir, 'theaters.txt'), keywords: path.join(dir, 'keywords.txt'), seats: path.join(dir, 'seats.json') };
  fs.writeFileSync(paths.theaters, 'CGV,용산,0013\nDTRYX,아트하우스모모,indieart|000067\n');
  fs.writeFileSync(paths.keywords, '트레인스포팅\n');
  fs.writeFileSync(paths.seats, JSON.stringify([{ id: 'x', theater_key: 'DTRYX,아트하우스모모,indieart|000067', movie: '눈 둘 데가 없네' }]));
  const T0 = Date.UTC(2026, 9, 24, 3, 0); // 10/24 12:00 KST
  let remain = 10, cgvFail = false, extra = false;
  const dtryxAsked = new Set();
  const fetchers = {
    async CGV(t, date) {
      if (cgvFail) throw new Error('HTTP 403: <html>');
      const ss = [{ id: `0013-${date}-001-1`, title: '트레인스포팅', date, time: '19:30', screen: '3관', remain, total: 120 }];
      if (extra && date === '2026-10-25') ss.push({ id: `0013-${date}-002-1`, title: '인턴', date, time: '10:00', screen: '1관', remain: 200, total: 204 });
      return ss;
    },
    async DTRYX(t, date, movie) { dtryxAsked.add(movie); return [{ id: `000067-${movie}-${date}-02-1`, title: movie, date, time: '11:30', screen: '2관', remain: 112, total: 138 }]; },
  };
  const go = (min, over = {}) => run({ now: T0 + min * 60000, paths, fetchers, log: () => {}, ...over });
  const read = () => JSON.parse(fs.readFileSync(paths.out, 'utf8'));

  // 첫 실행: 두 영화관 × 7일, 디트릭스는 키워드 + 감시 중인 영화만 조회
  let r = await go(0);
  let f = read();
  assert.strictEqual(f.generated_at, new Date(T0).toISOString());
  assert.strictEqual(f.items.length, 7 + 7 * 2, 'CGV 7일 + 디트릭스(영화 2편) 7일');
  assert.deepStrictEqual([...dtryxAsked].sort(), ['눈 둘 데가 없네', '트레인스포팅']);
  assert.deepStrictEqual(Object.keys(f.items[0]), ['theater_key', 'date', 'movie', 'time', 'screen', 'remain', 'total', 'show_id']);
  assert.strictEqual(f.items[0].theater_key, 'CGV,용산,0013', 'theater_key는 theaters.txt 한 줄 전체');
  assert.deepStrictEqual([f.items[0].date, f.items[f.items.length - 1].date], ['2026-10-24', '2026-10-30']);
  assert(fs.readFileSync(paths.out, 'utf8').split('\n').filter(l => l.startsWith('{"theater_key"')).length === f.items.length, '한 줄에 회차 하나');

  // 잔여석만 바뀌면 쓰지 않는다(커밋 폭주 방지) — 6시간 안
  const snap = fs.readFileSync(paths.out, 'utf8');
  remain = 3;
  r = await go(60);
  assert.deepStrictEqual([r.structural, r.write, fs.readFileSync(paths.out, 'utf8')], [false, false, snap]);
  // 6시간이 지나면 잔여석 갱신을 위해 다시 쓴다
  r = await go(6 * 60 + 1);
  assert.deepStrictEqual([r.write, read().items.find(i => i.movie === '트레인스포팅' && i.theater_key.startsWith('CGV')).remain], [true, 3]);
  // 회차가 늘면(구조 변경) 바로 쓴다
  extra = true;
  r = await go(6 * 60 + 61);
  assert.deepStrictEqual([r.structural, r.write, read().items.length], [true, true, 7 + 14 + 1]);

  // 한 영화관이 실패하면 그 영화관의 지난 내용은 그대로 두고, 나머지만 갱신한다
  cgvFail = true; remain = 99;
  r = await go(6 * 60 + 70);
  f = read();
  assert.strictEqual(r.failed, 1);
  assert.strictEqual(f.items.filter(i => i.theater_key.startsWith('CGV')).length, 8, '실패한 영화관 지난 회차 유지');
  // 처음부터 전부 실패하면 파일을 만들지 않고 비정상 종료 신호(empty)
  const fresh = path.join(dir, 'fresh.json');
  r = await run({ now: T0, paths: { ...paths, out: fresh }, fetchers: { CGV: async () => { throw new Error('x'); }, DTRYX: async () => { throw new Error('x'); } }, log: () => {} });
  assert.deepStrictEqual([r.empty, fs.existsSync(fresh)], [true, false]);

  // 시험 모드: 쓰지 않는다
  cgvFail = false;
  const dry = path.join(dir, 'dry.json');
  r = await run({ now: T0, paths: { ...paths, out: dry }, fetchers, log: () => {}, dry: true });
  assert.deepStrictEqual([r.write, fs.existsSync(dry)], [true, false]);

  console.log('OK: 시간표 동기화(구조 서명, 6시간 갱신, 실패 영화관 유지, 디트릭스 영화 범위, 시험 모드)가 맞다.');
})().catch(e => { console.error(e); process.exit(1); });
