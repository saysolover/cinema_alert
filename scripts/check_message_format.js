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
// 특별 상영 표기(tags): 상영일 줄 바로 다음 줄에 `표기: ...`로 보이고, 두 워크플로가 같다. 5개까지만, 없으면 줄이 없다.
{
  const ev = cases.new;
  const withTags = k => build[k]('영화', k === 'dtryx' ? '디트릭스' : '씨네Q', '극장', ev, links(ev, k === 'dtryx' ? 'https://d.example/x' : 'https://c.example/x'), ['[프리미어] 영화', 'GV', 'a', 'b', 'c', 'd-six']);
  const a = withTags('dtryx'), b = withTags('cineq');
  assert.strictEqual(b.replace('씨네Q', '디트릭스').replace(/c\.example/g, 'd.example'), a, '표기: 형식이 다름');
  assert.strictEqual(a.split('\n')[4], '표기: [프리미어] 영화 · GV · a · b · c');
  assert.strictEqual(build.dtryx('영화', '디트릭스', '극장', ev, [], []).includes('표기:'), false);
}
// ---- specialMarks: 5개 영화사 워크플로에 복제된 같은 함수 ----
const CHAINS = ['cgv', 'lotte', 'megabox', 'dtryx', 'cineq'];
const marksSrc = chain => {
  const text = fs.readFileSync(`.github/workflows/${chain}-booking-watch.yml`, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^ {10}function specialMarks\([\s\S]*?\n {10}\}\n/m);
  assert(m, `${chain}: specialMarks를 찾지 못함`);
  return m[0].split('\n').map(l => l.slice(10)).join('\n');
};
const srcs = CHAINS.map(marksSrc);
srcs.forEach((x, i) => assert.strictEqual(x, srcs[0], `specialMarks 소스가 ${CHAINS[i]}에서 다름 — 한쪽만 고치지 말 것`));
const specialMarks = new Function(`${srcs[0]}\nreturn specialMarks;`)();
const T = ['트레인스포팅'];
const markCases = [
  [['[F] 트레인스포팅'], ''],                                   // 메가박스 자체 접두 코드 [F]는 특별 상영이 아니다
  [['[메가토크] 트레인스포팅'], '메가토크'],
  [['[F] 트레인스포팅', '일반콘텐트'], ''],
  [['[프리미어] 트레인스포팅', '프리미어'], '프리미어'],        // 메가박스 코엑스 실제 사례(이름 + 구분 필드)
  [['트레인스포팅(프리미어DAY)'], '프리미어DAY'],               // CGV 오리 실제 사례
  [['트레인스포팅 (GV)'], 'GV'],
  [['GV 상영'], 'GV'],
  [['트레인스포팅 아트그라피'], '아트그라피'],
  [['[GV] 트레인스포팅 (시네마톡)', '무대인사'], 'GV·시네마톡·무대인사'],
  [['트레인스포팅(4DX 2D)', '트레인스포팅(IMAX LASER 2D)', '트레인스포팅 [4DX]', '트레인스포팅(자막)'], ''], // 포맷은 특별 상영이 아니다
  [['호프(SCREENX DOLBY ATMOS mix 2D, 해술이 아저씨가 말한 특가)'], ''],
  [['트레인스포팅', ''], ''],
  [['Ｔｒａｉｎｓｐｏｔｔｉｎｇ ［ＧＶ］'], 'GV'],                // NFKC
];
for (const [names, want] of markCases) assert.strictEqual(specialMarks(names, T).join('·'), want, JSON.stringify(names));
assert.strictEqual(specialMarks(['[GV] x', '[시사회]', '[무대인사]', '[라이브]', '[커튼콜]', '[상영회]', '[팬미팅]'], ['x']).length, 5, '최대 5개');
// 표기는 알림 날짜(events)에서 센 회차 이름만 쓴다: 5개 워크플로 모두 날짜별로 모으고 events 날짜만 꺼낸다.
for (const chain of CHAINS) {
  const text = fs.readFileSync(`.github/workflows/${chain}-booking-watch.yml`, 'utf8');
  assert(/events\.flatMap\(e => \[\.\.\.\(.*\[e\.date\]/.test(text), `${chain}: specialMarks 입력이 알림 날짜(events)로 한정되지 않음`);
  assert(!/specialMarks\(\[\.\.\./.test(text), `${chain}: 전체 날짜의 이름을 specialMarks에 넘김`);
}
console.log('OK: 두 워크플로의 buildMessage가 같고, 5개 워크플로의 specialMarks도 같으며, 같은 입력에 같은 형식을 낸다.');
// ---- 연속 실패 경고: 낮에는 기존 임계, 새벽(00~07 KST)에는 늦추고 07시에 바로 알림 ----
const CRON = { cgv: 10, lotte: 3, megabox: 3, dtryx: 5, cineq: 5 };
const healthSrc = chain => {
  const text = fs.readFileSync(`.github/workflows/${chain}-booking-watch.yml`, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^ {10}const (?:HEALTH_FILE|ALERT_AT)[\s\S]*?\n {10}function nextHealth[\s\S]*?\n {10}\}\n/m);
  assert(m, `${chain}: nextHealth를 찾지 못함`);
  return m[0].split('\n').map(l => l.slice(10)).join('\n');
};
const kstMs = (day, h, min = 0) => Date.UTC(2026, 9, day, h - 9, min); // KST day일 h시 min분
for (const chain of CHAINS) {
  const s = healthSrc(chain);
  const prelude = (chain === 'cgv' || chain === 'lotte' || chain === 'megabox' ? '' : "const HEALTH_LABEL = 'x';\n") + 'const KST_OFFSET = 9 * 60 * 60 * 1000;\n';
  const api = new Function(`${prelude}${s}\nreturn { nextHealth, ALERT_AT, CRON_MIN, QUIET_ALERT_MIN };`)();
  const failArg = chain === 'dtryx' || chain === 'cineq' ? 'transient' : true;
  const okArg = chain === 'dtryx' || chain === 'cineq' ? null : false;
  const cron = api.CRON_MIN, [a1, a2] = api.ALERT_AT;
  assert.strictEqual(cron, CRON[chain], `${chain}: CRON_MIN`);
  assert.strictEqual(api.QUIET_ALERT_MIN, 240, `${chain}: QUIET_ALERT_MIN`);
  // 한 시각 t에 실패가 N회 이어질 때 알림이 나간 n 목록 (분 단위로 시각을 진행)
  const run = (startMs, count) => {
    let h, sent = [];
    for (let i = 0; i < count; i++) {
      const r = api.nextHealth(h, failArg, 'HTTP 200: <html>', startMs + i * cron * 60000);
      h = r.health;
      if (r.messages.length) sent.push([h.consecutive_failures, r.messages.length]);
    }
    return { sent, health: h };
  };
  // 낮(12시): 기존대로 a1회와 a2회째
  const day = run(kstMs(19, 12), a2 + 3);
  assert.deepStrictEqual(day.sent.map(x => x[0]), [a1, a2], `${chain}: 낮 경고 시점`);
  // 새벽(00:00 시작, 240분 안에 끝나는 구간): 7시 전에는 4시간이 차기 전까지 조용
  const need = Math.ceil(240 / cron);
  const night = run(kstMs(20, 0), need - 1);
  assert.deepStrictEqual(night.sent, [], `${chain}: 새벽 ${need - 1}회까지는 경고 없음`);
  const night2 = run(kstMs(20, 0), need);
  assert.deepStrictEqual(night2.sent.map(x => x[0]), [need], `${chain}: 새벽 4시간째에 한 번만(두 단계가 겹쳐도 한 통)`);
  // 새벽 중 시작해 07시에도 실패 중이면 그때 바로(첫 정시 이후 첫 실행)
  const before7 = run(kstMs(20, 5), Math.floor(120 / cron)); // 05:00~07:00 직전, 4시간 미만
  assert.deepStrictEqual(before7.sent, [], `${chain}: 07시 전엔 조용`);
  const r7 = api.nextHealth(before7.health, failArg, 'x', kstMs(20, 7, 0));
  assert.strictEqual(r7.messages.length, 1, `${chain}: 07시에 바로 경고`);
  // 복구: 경고가 나갔던 경우에만 복구 알림
  const rec = api.nextHealth(r7.health, okArg, '', kstMs(20, 7, 30));
  assert.strictEqual(rec.messages.length, 1, `${chain}: 복구 알림`);
  const quietRec = api.nextHealth(run(kstMs(20, 0), 2).health, okArg, '', kstMs(20, 1));
  assert.strictEqual(quietRec.messages.length, 0, `${chain}: 경고 없이 끝난 새벽 장애는 복구 알림도 없음`);
}
// 비JSON 응답 로그: <title>과 앞 300자
{
  const t = fs.readFileSync('.github/workflows/cgv-booking-watch.yml', 'utf8').replace(/\r\n/g, '\n');
  const m = t.match(/^ {10}const bodyHead = .*$/m);
  assert(m, 'bodyHead를 찾지 못함');
  const heads = CHAINS.map(c => fs.readFileSync(`.github/workflows/${c}-booking-watch.yml`, 'utf8').replace(/\r\n/g, '\n').match(/^ {10}const bodyHead = .*$/m)[0]);
  heads.forEach((x, i) => assert.strictEqual(x, heads[0], `bodyHead가 ${CHAINS[i]}에서 다름`));
  const bodyHead = new Function(`${m[0].trim()}\nreturn bodyHead;`)();
  const out = bodyHead('<!DOCTYPE html><html><head><title> 시스템  점검 중 </title></head><body>' + 'x'.repeat(500));
  assert(out.startsWith('[title: 시스템 점검 중] <!DOCTYPE html>'), out.slice(0, 60));
  assert(out.length <= 80 + 20 + 300);
  assert.strictEqual(bodyHead('plain\ntext'), 'plain text');
}
console.log('OK: 연속 실패 경고(낮/새벽/07시/복구)와 bodyHead가 5개 워크플로에서 같다.');
if (process.argv.includes('--show')) {
  const ev = cases.mixed;
  console.log('--- 디트릭스 ---\n' + build.dtryx('트레인스포팅', '디트릭스', '아트하우스모모', ev, ev.map(e => ({ date: e.date, url: `https://www.dtryx.com/reserve/movie.do?BrandCd=indieart&CinemaCd=000067&MovieCd=029763&PlaySDT=${e.date}` }))));
  console.log('--- 씨네Q ---\n' + build.cineq('트레인스포팅', '씨네Q', '신도림', ev, ev.map(e => ({ date: e.date, url: 'https://www.cineq.co.kr/Theater/Movie?TheaterCode=1001' }))));
}
