// 취소표 감시(B7): watch/seats.json에 등록된 회차의 잔여석이 기준 미만 → 이상으로 늘면 디스코드로 알린다.
// 실행: node scripts/seat_watch.js   (워크플로 seat-watch가 cron-job.org의 workflow_dispatch로 3분마다 호출)
// 규칙은 scripts/seat_lib.js, 테스트는 scripts/check_seat_watch.js.
'use strict';
const fs = require('fs');
const L = require('./seat_lib');

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = date => `${date.slice(5, 7)}/${date.slice(8, 10)}(${DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]})`;
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 영화관별 조회: (영화관 행, 날짜, 영화) → 회차 목록. 형식이 다르면 예외 ----
function makeFetchers(env, fetchFn, deadline) {
  const relay = (name, tokenName) => {
    const url = (env[name] || '').trim().replace(/\/+$/, '');
    return { url, headers: url ? { 'X-Relay-Token': (env[tokenName] || '').trim() } : {} };
  };
  // 중계(Worker)가 없을 때(로컬 시험)는 브라우저처럼 보이는 헤더를 직접 붙인다. 중계는 같은 헤더를 스스로 붙인다.
  const CGV_BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'ko-KR,ko;q=0.9', 'Referer': 'https://cgv.co.kr/cnm/movieBook', 'Origin': 'https://cgv.co.kr',
    'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
  };
  const cgvRelay = relay('CGV_RELAY_URL', 'CGV_RELAY_TOKEN');
  const dtryxRelay = relay('DTRYX_RELAY_URL', 'DTRYX_RELAY_TOKEN');

  async function http(url, options = {}) {
    if (Date.now() > deadline) throw new Error('실행 시간 상한(4분) 초과 — 응답 지연으로 중단');
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetchFn(url, { ...options, signal: AbortSignal.timeout(15000) });
        const text = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${L.bodyHead(text)}`);
        return text;
      } catch (e) {
        lastErr = e;
        if (i < 2) await sleep(env.SEAT_TEST ? 0 : 2000);
      }
    }
    throw lastErr;
  }
  async function json(url, options) {
    const t = await http(url, options);
    try { return JSON.parse(t); } catch { throw new Error(`비JSON 응답: ${L.bodyHead(t)}`); }
  }

  const dtryxCache = {};
  async function dtryxContext() {
    if (dtryxCache.ctx) return dtryxCache.ctx;
    const base = dtryxRelay.url || 'https://www.dtryx.com';
    const html = await http(`${base}/reserve/movie.do`, { headers: { 'User-Agent': 'Mozilla/5.0', ...dtryxRelay.headers } });
    const cgid = (html.match(/id="cgid"[^>]*value="([^"]+)"/) || html.match(/name="cgid"[^>]*value="([^"]+)"/) || [])[1];
    if (!cgid) throw new Error('디트릭스 movie.do에서 cgid를 찾지 못함 (페이지 구조 변경 가능성)');
    const headers = { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.dtryx.com/reserve/movie.do', ...dtryxRelay.headers };
    return (dtryxCache.ctx = { base, cgid, headers });
  }
  const dtryxQs = (cgid, brand, cinema, movie, date) =>
    `cgid=${cgid}&ssid=&tokn=&hold=&BrandCd=${brand}&CinemaCd=${cinema}&MovieCd=${movie}&PlaySDT=${date}&Sort=boxoffice&ScreenCd=&ShowSeq=&TabBrandCd=dtryx`;

  return {
    async CGV(t, date) {
      const base = cgvRelay.url || 'https://cgv.co.kr';
      const j = await json(`${base}/api/v1/booking/searchMovScnInfo?coCd=A420&siteNo=${t.code}&scnYmd=${L.compactDate(date)}&movNo=&rtctlScopCd=08`, { headers: cgvRelay.url ? cgvRelay.headers : CGV_BROWSER_HEADERS });
      return L.parseCgv(j, t.code);
    },
    async MEGABOX(t, date) {
      const fd = new URLSearchParams({ masterType: 'movie', movieNo: '', movieNo1: '', firstAt: 'N', playDe: L.compactDate(date), areaCd: t.code });
      const j = await json('https://www.megabox.co.kr/on/oh/ohc/Brch/schedulePage.do', { method: 'POST', body: fd });
      return L.parseMegabox(j, t.name, L.compactDate(date));
    },
    async LOTTE(t, date) {
      const fd = new URLSearchParams({ paramList: JSON.stringify({ MethodName: 'GetPlaySequence', channelType: 'HO', osType: 'W', osVersion: 'bot', playDate: date, cinemaID: t.code, representationMovieCode: '' }) });
      const j = await json('https://www.lottecinema.co.kr/LCWS/Ticketing/TicketingData.aspx', { method: 'POST', body: fd });
      return L.parseLotte(j);
    },
    async DTRYX(t, date, movie) {
      const [brand, cinema] = t.code.split('|');
      const { base, cgid, headers } = await dtryxContext();
      const list = await json(`${base}/reserve/main_list.do?${dtryxQs(cgid, brand, cinema, 'all', 'all')}`, { headers });
      if (!Array.isArray(list.MovieList)) throw new Error('디트릭스 응답 형식 이상: MovieList 없음');
      const hit = list.MovieList.find(m => L.movieMatches(m.MovieNmNat, movie));
      if (!hit) return [];
      const res = await json(`${base}/reserve/showseq_list.do?${dtryxQs(cgid, brand, cinema, hit.MovieCd, date)}`, { headers });
      return L.parseDtryx(res, cinema);
    },
    async CINEQ(t, date) {
      const html = await http('https://www.cineq.co.kr/Theater/MovieTable2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0', 'Referer': `https://www.cineq.co.kr/Theater/Movie?TheaterCode=${encodeURIComponent(t.code)}` },
        body: `TheaterCode=${encodeURIComponent(t.code)}&PlayDate=${L.compactDate(date)}`,
      });
      return L.parseCineq(html, t.code);
    },
  };
}

// ---- 메시지 ----
const where = (e, s) => `${e.theater} · ${s ? s.title || e.movie : e.movie} · ${dayLabel(e.date)} ${e.time}${s && s.screen ? ` ${s.screen}` : ''}`;
const msgConfirm = (e, s) => `✅ ${where(e, s)} · 지금 잔여 ${s.remain}석 · ${e.min_seats}석 이상 풀리면 알림\n[예매 페이지](<${s.link}>)`;
const msgAlert = (e, s, prev) => `🎟 취소표 알림! ${where(e, s)}\n잔여 ${prev}석 → ${s.remain}석 (기준 ${e.min_seats}석 이상)\n[예매하기](<${s.link}>)\n※ 결제 대기 좌석이 풀린 것일 수 있어 바로 예매가 안 될 수 있습니다.${e.note ? `\n메모: ${e.note}` : ''}`;
const msgNotFound = (e, r, kind) =>
  `⚠️ ${where(e)} 회차를 ${kind === 'ambiguous' ? '하나로 정하지 못했습니다(같은 시각 회차가 여럿)' : '찾지 못했습니다'}.\n` +
  (r.times.length ? `그날 이 영화 회차: ${r.times.slice(0, 15).join(' · ')}\n시각을 맞춰 다시 등록해 주세요.` : '그날 이 영화 상영 회차가 없습니다(예매 오픈 전이거나 날짜·영화 이름 확인이 필요합니다). 열리면 자동으로 다시 찾습니다.');

// ---- 실행 ----
async function run(ctx) {
  const env = ctx.env || process.env;
  const now = ctx.now || Date.now();
  const log = ctx.log || console.log;
  const paths = { seats: 'watch/seats.json', theaters: 'theaters.txt', state: 'seat_state.json', ...(ctx.paths || {}) };
  const DRY = !!ctx.dry;
  const send = ctx.send;
  const result = { alerts: 0, confirmations: 0, removed: 0, fetched: 0, changed: false, idle: false };

  let seats = readJson(paths.seats, []);
  if (!Array.isArray(seats)) throw new Error('watch/seats.json이 배열이 아님');
  const before = JSON.stringify(seats);
  const alive = seats.filter(e => !L.isExpired(e, now));
  result.removed = seats.length - alive.length;
  seats = alive;
  if (seats.length === 0) {
    log('감시 목록이 비어 있어 종료');
    if (!DRY && result.removed) writeJson(paths.seats, seats);
    result.changed = result.removed > 0;
    result.idle = true;
    return result;
  }

  const theaters = L.parseTheaters(fs.existsSync(paths.theaters) ? fs.readFileSync(paths.theaters, 'utf8') : '');
  const state = readJson(paths.state, {});
  const items = state.items || {};
  const failures = [];
  let okCalls = 0;
  const fetchers = makeFetchers(env, ctx.fetchFn || fetch, now + 4 * 60 * 1000 + (ctx.deadlineExtra || 0));
  const cache = {};

  async function sessionsFor(t, date, movie) {
    const key = `${t.chain}|${t.name}|${date}|${t.chain === 'DTRYX' ? L.norm(movie) : ''}`;
    if (!(key in cache)) {
      try { cache[key] = await fetchers[t.chain](t, date, movie); okCalls++; result.fetched++; }
      catch (e) { cache[key] = null; failures.push(`${t.chain} ${t.name} ${date}: ${e.message}`); log(`  (조회 실패, 이번엔 스킵: ${t.chain} ${t.name} ${date}: ${e.message})`); }
    }
    return cache[key];
  }
  async function notify(text) {
    log(`[디스코드] ${text.split('\n')[0]}`);
    if (DRY) return true;
    try { await send(text); return true; } catch (e) { log(`  (디스코드 전송 실패: ${e.message})`); return false; }
  }

  for (const e of seats) {
    const t = L.findTheater(theaters, e.theater_key);
    if (!t || !fetchers[t.chain]) {
      if (e.status !== 'theater_unknown') { e.status = 'theater_unknown'; await notify(`⚠️ ${where(e)}: 영화관 키 "${e.theater_key}"를 감시 대상(theaters.txt)에서 찾지 못했습니다.`); }
      continue;
    }
    const st = items[e.id];
    // 회차 확정이 안 된 항목은 매 실행 다시 찾고, 확정된 항목은 주기(상영 24시간 전부터 3분, 그전엔 5분)에 맞을 때만 조회한다.
    if (e.show_id && !L.isDue(st, e, now)) continue;

    const sessions = await sessionsFor(t, e.date, e.movie);
    if (sessions === null) continue;

    let s;
    if (!e.show_id) {
      const r = L.findSession(sessions, e);
      if (!r.session) {
        const sig = `${r.status}|${r.times.join(',')}`;
        if ((items[e.id] || {}).notified !== sig) {
          if (await notify(msgNotFound(e, r, r.status))) items[e.id] = { ...(items[e.id] || {}), notified: sig };
        }
        e.status = r.status;
        continue;
      }
      s = r.session;
      e.show_id = s.id;
      delete e.status;
      if (s.remain !== null) {
        items[e.id] = { last: s.remain, checked_at: now };
        await notify(msgConfirm(e, s));
        result.confirmations++;
      }
      continue;
    }

    s = sessions.find(x => x.id === e.show_id);
    if (!s || s.remain === null) { log(`  (${where(e)}: 회차 ${e.show_id}를 이번 응답에서 찾지 못함 — 예매 종료일 수 있음)`); items[e.id] = { ...(st || {}), checked_at: now }; continue; }
    const { next, alert, prev } = L.step(st, s.remain, e.min_seats, now);
    log(`  ${where(e, s)}: 잔여 ${s.remain}석 (기준 ${e.min_seats}석 이상${prev === null ? ', 첫 관측' : `, 직전 ${prev}석`})`);
    if (alert) {
      if (!(await notify(msgAlert(e, s, prev)))) { items[e.id] = { ...(st || {}), checked_at: now }; continue; } // 전송 실패: 다음 실행에서 다시 판정
      result.alerts++;
    }
    items[e.id] = next;
  }

  // ---- 실행 결과(연속 실패) 관리: 정상 응답이 하나도 없고 실패만 있었으면 실패 ----
  const attempted = okCalls > 0 || failures.length > 0;
  const failed = failures.length > 0 && okCalls === 0;
  if (failed) log(`이번 실행은 실패로 집계: ${failures[failures.length - 1]} (조회 실패 ${failures.length}건)`);
  else if (failures.length) log(`조회 실패 ${failures.length}건이 있었지만 정상 응답도 ${okCalls}건 받아 실패로 세지 않음`);
  if (attempted) {
    const { health, messages } = L.nextHealth(state._health, failed, failures[failures.length - 1] || '', now);
    state._health = health;
    for (const m of messages) await notify(m);
  }

  // 목록에서 사라진 항목의 상태는 버린다.
  const ids = new Set(seats.map(x => x.id));
  for (const k of Object.keys(items)) if (!ids.has(k)) delete items[k];
  state.items = items;
  result.changed = JSON.stringify(seats) !== before;
  if (!DRY) {
    if (result.changed) writeJson(paths.seats, seats);
    writeJson(paths.state, state);
  }
  result.failed = failed;
  return result;
}

if (require.main === module) {
  const webhook = (process.env.DISCORD_WEBHOOK || '').trim();
  const send = async content => {
    const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900) }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Discord HTTP ${r.status}`);
  };
  run({ send, dry: process.env.DRY_RUN === 'true' })
    .then(r => console.log(`완료: 알림 ${r.alerts}건, 회차 확정 ${r.confirmations}건, 만료 삭제 ${r.removed}건, 조회 ${r.fetched}건${r.changed ? ', 목록 변경됨' : ''}`))
    .catch(e => { console.error(e.stack || e.message); process.exit(1); });
}

module.exports = { run, makeFetchers };
