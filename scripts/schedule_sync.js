// 시간표 파일(B7 자동완성용): theaters.txt 영화관별 오늘부터 7일치 상영 시간표를 watch/schedules.json에 저장한다.
// 실행: node scripts/schedule_sync.js   (워크플로 schedule-sync가 1시간마다 호출). 규칙은 scripts/seat_lib.js, 점검은 scripts/check_schedule_sync.js.
'use strict';
const fs = require('fs');
const L = require('./seat_lib');
const { makeFetchers } = require('./seat_watch');

const DAYS = 7;
const REFRESH_MS = 6 * 60 * 60 * 1000; // 구조가 안 바뀌어도 잔여석 갱신을 위해 이 간격으로는 다시 쓴다(하루 최대 4번)
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const readLines = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : []);

const keyOf = t => `${t.chain},${t.name},${t.code}`; // seats.json의 theater_key와 같은 형식(theaters.txt 한 줄)
const kstDate = (ms, plus) => new Date(ms + 9 * 3600000 + plus * 86400000).toISOString().slice(0, 10);
const sortKey = i => `${i.theater_key}|${i.date}|${i.time}|${i.movie}|${i.show_id}`;

// 구조 서명: 잔여석을 뺀 나머지. 이게 같으면 파일을 다시 쓰지 않는다(커밋 폭주 방지).
const signature = items => JSON.stringify(items.map(i => [i.theater_key, i.date, i.movie, i.time, i.screen, i.show_id]));

async function run(ctx) {
  const env = ctx.env || process.env;
  const now = ctx.now || Date.now();
  const log = ctx.log || console.log;
  const paths = { out: 'watch/schedules.json', theaters: 'theaters.txt', keywords: 'keywords.txt', seats: 'watch/seats.json', ...(ctx.paths || {}) };
  const theaters = L.parseTheaters(fs.existsSync(paths.theaters) ? fs.readFileSync(paths.theaters, 'utf8') : '');
  const fetchers = ctx.fetchers || makeFetchers(env, ctx.fetchFn || fetch, now + 8 * 60 * 1000);
  const prev = readJson(paths.out, { generated_at: null, items: [] });
  const seats = readJson(paths.seats, []);
  const dates = Array.from({ length: DAYS }, (_, i) => kstDate(now, i));

  // 디트릭스는 영화마다 따로 조회해야 해서(극장별 상영작 목록이 없음) 키워드 영화와 감시 중인 회차의 영화만 담는다.
  const dtryxMovies = t => [...new Set([...readLines(paths.keywords), ...seats.filter(e => L.findTheater(theaters, e.theater_key) === t).map(e => e.movie)])];

  const items = [];
  const failedKeys = new Set();
  const byChain = {};
  for (const t of theaters) (byChain[t.chain] = byChain[t.chain] || []).push(t);

  // 영화사끼리는 동시에, 한 영화사 안에서는 차례로(차단 방지).
  await Promise.all(Object.entries(byChain).map(async ([chain, list]) => {
    if (!fetchers[chain]) return;
    for (const t of list) {
      let ok = 0, fail = 0;
      for (const date of dates) {
        for (const movie of chain === 'DTRYX' ? dtryxMovies(t) : [undefined]) {
          try {
            const sessions = await fetchers[chain](t, date, movie);
            ok++;
            for (const s of sessions) {
              if (s.date !== date || !s.time) continue;
              items.push({ theater_key: keyOf(t), date, movie: s.title, time: s.time, screen: s.screen, remain: s.remain, total: s.total, show_id: s.id });
            }
          } catch (e) { fail++; log(`  (조회 실패: ${t.chain} ${t.name} ${date}${movie ? ` ${movie}` : ''}: ${e.message.slice(0, 160)})`); }
          if (!ctx.fetchers) await new Promise(r => setTimeout(r, 150));
        }
      }
      if (fail > 0) failedKeys.add(keyOf(t));
      log(`${t.chain} ${t.name}: 조회 성공 ${ok}건, 실패 ${fail}건`);
    }
  }));

  // 실패한 영화관은 지난번 내용을 그대로 두고(비우지 않는다), 같은 날짜 범위 안의 것만 남긴다.
  for (const old of prev.items || []) if (failedKeys.has(old.theater_key) && old.date >= dates[0] && old.date <= dates[DAYS - 1]) items.push(old);
  // 같은 회차가 겹치면 하나만(영화사별 응답이 겹쳐 올 때)
  const uniq = new Map();
  for (const i of items) uniq.set(`${i.theater_key}|${i.show_id}`, i);
  const out = [...uniq.values()].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));

  const age = prev.generated_at ? now - Date.parse(prev.generated_at) : Infinity;
  const structural = signature(out) !== signature(prev.items || []);
  const write = out.length > 0 && (structural || age >= REFRESH_MS);
  const result = { items: out.length, structural, write, failed: failedKeys.size, theaters: theaters.length };
  if (out.length === 0) { log('받은 시간표가 하나도 없어 파일을 건드리지 않음'); result.empty = true; return result; }
  if (write && !ctx.dry) {
    // 한 줄에 회차 하나: 커밋 diff가 바뀐 회차만 보인다.
    const body = `{\n"generated_at": ${JSON.stringify(new Date(now).toISOString())},\n"items": [\n${out.map(i => JSON.stringify(i)).join(',\n')}\n]\n}\n`;
    fs.writeFileSync(paths.out, body, 'utf8');
  }
  log(`시간표 ${out.length}회차 (영화관 ${theaters.length}곳, 조회 실패 영화관 ${failedKeys.size}곳)${write ? ctx.dry ? ' — 시험 모드라 쓰지 않음' : ' — 파일 갱신' : ' — 변경 없음, 쓰지 않음'}`);
  return result;
}

if (require.main === module) {
  run({ dry: process.env.DRY_RUN === 'true' })
    .then(r => { if (r.empty) process.exit(1); })
    .catch(e => { console.error(e.stack || e.message); process.exit(1); });
}

module.exports = { run, signature };
