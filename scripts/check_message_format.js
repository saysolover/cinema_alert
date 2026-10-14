// 디트릭스·씨네Q 알림 메시지 형식이 같은지 확인한다. 실행: node scripts/check_message_format.js
// buildMessage가 두 워크플로에 복제돼 있으므로 (1) 소스가 글자까지 같은지, (2) 같은 입력에 같은 결과를 내는지 본다.
const fs = require('fs');
const assert = require('assert');

const FILES = { dtryx: '.github/workflows/dtryx-booking-watch.yml', cineq: '.github/workflows/cineq-booking-watch.yml' };

function extract(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^ {10}function buildMessage\([\s\S]*?\n {10}\}\n/m);
  assert(m, `${file}: buildMessage를 찾지 못함`);
  return m[0].split('\n').map(l => l.slice(10)).join('\n');
}

const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, extract(f)]));
assert.strictEqual(src.cineq, src.dtryx, 'buildMessage 소스가 두 워크플로에서 다름 — 한쪽만 고치지 말 것');

const build = Object.fromEntries(Object.entries(src).map(([k, s]) => [k, new Function(`${s}\nreturn buildMessage;`)()]));
const links = (events, base) => events.map(e => ({ date: e.date, url: `${base}?d=${e.date}` }));

const cases = {
  new: [{ date: '2026-10-18', count: 1, kind: 'new' }, { date: '2026-10-21', count: 2, kind: 'new' }],
  more: [{ date: '2026-10-18', count: 9, kind: 'more', added: 5 }],
  mixed: [{ date: '2026-10-18', count: 1, kind: 'new' }, { date: '2026-10-19', count: 8, kind: 'more', added: 4 }],
  many: Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(10 + i).padStart(2, '0')}`, count: 3, kind: 'new' })),
};
const sample = {};
for (const [name, events] of Object.entries(cases)) {
  const a = build.dtryx('영화', '디트릭스', '극장', events, links(events, 'https://d.example/x'));
  const b = build.cineq('영화', '씨네Q', '극장', events, links(events, 'https://c.example/x'));
  // 라벨과 주소만 다르고 나머지는 같아야 한다.
  assert.strictEqual(b.replace('씨네Q', '디트릭스').replace(/c\.example/g, 'd.example'), a, `${name}: 형식이 다름`);
  assert(a.length <= 1900, `${name}: 1900자 초과`);
  sample[name] = events.length ? a : '';
}
// 날짜 줄마다 [예매하기] 링크가 있고, 형식은 `YYYY-MM-DD [예매하기](<url>)`이다.
assert.deepStrictEqual(sample.new.split('\n').slice(4), ['2026-10-18 [예매하기](<https://d.example/x?d=2026-10-18>)', '2026-10-21 [예매하기](<https://d.example/x?d=2026-10-21>)']);
assert(sample.more.startsWith('🎟 회차 추가 오픈!'));
assert(sample.mixed.includes('추가 오픈: 2026-10-19 (+4회)'));
assert(sample.many.length <= 1900 && sample.many.includes('상영일: 2026-10-10'));
console.log('OK: 두 워크플로의 buildMessage가 같고, 같은 입력에 같은 형식을 낸다.');
if (process.argv.includes('--show')) {
  const ev = cases.mixed;
  console.log('--- 디트릭스 ---\n' + build.dtryx('트레인스포팅', '디트릭스', '아트하우스모모', ev, ev.map(e => ({ date: e.date, url: `https://www.dtryx.com/reserve/movie.do?BrandCd=indieart&CinemaCd=000067&MovieCd=029763&PlaySDT=${e.date}` }))));
  console.log('--- 씨네Q ---\n' + build.cineq('트레인스포팅', '씨네Q', '신도림', ev, ev.map(e => ({ date: e.date, url: 'https://www.cineq.co.kr/Theater/Movie?TheaterCode=1001' }))));
}
