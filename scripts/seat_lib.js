// 취소표 감시(B7)의 순수 로직: 영화관별 잔여석 파서 5종, 회차 찾기, 0→N 판정, 주기·만료, 연속 실패 규칙.
// 입출력(요청·파일·디스코드)은 scripts/seat_watch.js. 테스트: node scripts/check_seat_watch.js
'use strict';

const KST_OFFSET = 9 * 60 * 60 * 1000;
const DEDUP_MS = 30 * 60 * 1000; // 같은 회차 알림은 30분 안에 다시 보내지 않는다
const NEAR_MS = 24 * 60 * 60 * 1000; // 상영 24시간 전부터 촘촘히 본다
const EVERY_FAR_MS = 5 * 60 * 1000;
const EVERY_NEAR_MS = 3 * 60 * 1000;
const SLACK_MS = 30 * 1000; // 호출 시각 지터 여유

const bodyHead = t => { const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(t) || [])[1]; return (title ? `[title: ${title.replace(/\s+/g, ' ').trim().slice(0, 80)}] ` : '') + t.slice(0, 300).replace(/\s+/g, ' '); };

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\-_:·.,!?'"“”‘’()\[\]{}~]/g, '');
const hhmm = s => { const m = /^(\d{1,2}):?(\d{2})/.exec(String(s || '')); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
const isoDate = ymd => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const compactDate = d => d.replace(/-/g, '');
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---- 영화관별 파서: 응답 → [{ id, title, date, time, screen, remain, total, link }] ----
// remain은 "지금 남은 좌석 수". 형식이 다르면 예외를 던져 호출한 쪽이 실패로 센다.

function parseCgv(j, siteNo) {
  if (!j || j.statusCode !== 0 || !Array.isArray(j.data)) throw new Error(`CGV 응답 형식 이상: statusCode=${j && j.statusCode}`);
  return j.data.map(x => ({
    id: `${x.siteNo || siteNo}-${x.scnYmd}-${x.scnsNo}-${x.scnSseq}`,
    title: x.movNm || x.prodNm || '', date: isoDate(String(x.scnYmd)), time: hhmm(x.scnsrtTm),
    screen: x.scnsNm || '', remain: num(x.frSeatCnt), total: num(x.stcnt),
    link: 'https://cgv.co.kr/cnm/movieBook',
  }));
}

function parseMegabox(j, theaterName, ymd) {
  if (!j || j.statCd !== 0 || !j.megaMap || !Array.isArray(j.megaMap.movieFormList)) throw new Error(`메가박스 응답 형식 이상: statCd=${j && j.statCd}`);
  return j.megaMap.movieFormList
    .filter(x => (x.brchNm || '').includes(theaterName) && x.playDe === ymd)
    .map(x => ({
      id: String(x.playSchdlNo), title: x.movieNm || x.rpstMovieNm || '', date: isoDate(x.playDe), time: hhmm(x.playStartTime),
      screen: x.theabExpoNm || '', remain: num(x.restSeatCnt), total: num(x.totSeatCnt),
      link: 'https://www.megabox.co.kr/booking/timetable',
    }));
}

function parseLotte(j) {
  if (!j || !j.PlaySeqs || !Array.isArray(j.PlaySeqs.Items)) throw new Error(`롯데 응답 형식 이상: ${(j && j.ResultMessage) || ''}`);
  return j.PlaySeqs.Items.map(x => {
    const total = num(x.TotalSeatCount), booked = num(x.BookingSeatCount);
    return {
      id: `${x.CinemaID}-${x.ScreenID}-${x.PlayDt}-${x.PlaySequence}`, title: x.MovieNameKR || '', date: x.PlayDt || '', time: hhmm(x.StartTime),
      screen: x.ScreenNameKR || '', remain: total === null || booked === null ? null : total - booked, total,
      link: 'https://www.lottecinema.co.kr/NLCHS/Ticketing',
    };
  });
}

function parseDtryx(res, cinemaCd, publicBase = 'https://www.dtryx.com') {
  if (!res || !Array.isArray(res.Showseqlist)) throw new Error('디트릭스 응답 형식 이상: Showseqlist 없음');
  return res.Showseqlist.flatMap(g => g.MovieDetail || []).filter(x => x.CinemaCd === cinemaCd).map(x => ({
    id: `${x.CinemaCd}-${x.MovieCd}-${x.PlaySDT}-${x.ScreenCd}-${x.ShowSeq}`, title: x.MovieNmNat || '', date: x.PlaySDT, time: hhmm(x.StartTime),
    screen: x.ScreenNmNat || '', remain: num(x.RemainSeatCnt), total: num(x.TotalSeatCnt),
    link: `${publicBase}/reserve/movie.do?BrandCd=${x.BrandCd}&CinemaCd=${x.CinemaCd}&MovieCd=${x.MovieCd}&PlaySDT=${x.PlaySDT}`,
  }));
}

// 씨네큐: HTML. 회차마다 data-screenplanid가 있고 좌석은 "잔여 / 전체", 매진이면 "매진".
function parseCineq(html, theaterCode) {
  if (typeof html !== 'string' || !html.includes('priceTableBtn')) throw new Error('씨네Q 응답 형식 이상: 정상 페이지 표지 없음');
  const out = [];
  for (const chunk of html.split('class="each-movie-time"').slice(1)) {
    const title = ((/<div class="title">([\s\S]*?)<\/div>/.exec(chunk) || [])[1] || '').replace(/<span class="rate-x">[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    // 회차 앞의 가장 가까운 상영관 이름을 짝지운다.
    const marks = [];
    for (const m of chunk.matchAll(/class="screen-name"[^>]*>([\s\S]*?)<\/div>/g)) marks.push({ at: m.index, name: m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() });
    for (const m of chunk.matchAll(/<div class="time"([^>]*)>([\s\S]*?)<\/div>/g)) {
      const attr = k => (new RegExp(`${k}="([^"]*)"`).exec(m[1]) || [])[1];
      const inner = m[2];
      const seats = (/class="seats-status">([^<]*)</.exec(inner) || [])[1] || '';
      const sm = /(\d+)\s*\/\s*(\d+)/.exec(seats);
      const screen = ([...marks].reverse().find(x => x.at < m.index) || {}).name || '';
      out.push({
        id: `${attr('data-screenplanid')}-${attr('data-playnumber')}`, title, date: isoDate(attr('data-playdate') || ''), time: hhmm((/>\s*(\d{1,2}:\d{2})/.exec(inner) || [])[1]),
        screen, remain: sm ? Number(sm[1]) : (/매진/.test(seats) ? 0 : null), total: sm ? Number(sm[2]) : null,
        link: `https://www.cineq.co.kr/Theater/Movie?TheaterCode=${encodeURIComponent(theaterCode)}`,
      });
    }
  }
  return out;
}

// ---- 감시 대상 영화관(theaters.txt) 찾기 ----
// theater_key는 theaters.txt 한 줄 전체("CGV,용산,0013", 봇이 보내는 형식)가 기본이고, "CGV:용산" / "CGV,용산" / "용산"(이름만, 하나뿐일 때)도 받는다.
function parseTheaters(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    const [chain, name, ...rest] = line.split(',');
    return chain && name ? { chain: chain.trim().toUpperCase(), name: name.trim(), code: rest.join(',').trim() } : null;
  }).filter(Boolean);
}

function findTheater(theaters, key) {
  const line = String(key || '').split(',').map(s => s.trim()).join(',');
  const exact = theaters.filter(t => `${t.chain},${t.name},${t.code}` === line); // 봇이 보내는 형식: theaters.txt 한 줄 전체
  if (exact.length === 1) return exact[0];
  const parts = String(key || '').split(/[:,]/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const hits = parts.length === 1
    ? theaters.filter(t => t.name === parts[0])
    : theaters.filter(t => t.chain === parts[0].toUpperCase() && t.name === parts[1]);
  return hits.length === 1 ? hits[0] : null;
}

// ---- 회차 찾기 ----
function movieMatches(sessionTitle, movie) {
  const a = norm(sessionTitle), b = norm(movie);
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

// 반환: { session } | { status: 'not_found' | 'ambiguous', times: [...] }. times는 그날 그 영화의 회차 안내용.
function findSession(sessions, entry) {
  const sameMovie = sessions.filter(s => s.date === entry.date && movieMatches(s.title, entry.movie));
  const times = sameMovie.map(s => `${s.time}${s.screen ? ` ${s.screen}` : ''}`).sort();
  const atTime = sameMovie.filter(s => s.time === hhmm(entry.time));
  if (atTime.length === 1) return { session: atTime[0] };
  return { status: atTime.length > 1 ? 'ambiguous' : 'not_found', times };
}

// ---- 시각·주기·만료 ----
const startMs = entry => Date.parse(`${entry.date}T${hhmm(entry.time)}:00+09:00`);
const isExpired = (entry, nowMs) => (entry.expires_at && Date.parse(entry.expires_at) < nowMs) || startMs(entry) < nowMs;
const everyMs = (entry, nowMs) => (startMs(entry) - nowMs <= NEAR_MS ? EVERY_NEAR_MS : EVERY_FAR_MS);
const isDue = (st, entry, nowMs) => !st || typeof st.checked_at !== 'number' || nowMs - st.checked_at >= everyMs(entry, nowMs) - SLACK_MS;

// ---- 0→N 판정 ----
// 첫 관측은 기준선만 잡고 알리지 않는다. 기준 미만 → 이상이 된 순간 한 번, 30분 안 중복 없음.
function step(st, remain, min, nowMs) {
  const prev = st && typeof st.last === 'number' ? st.last : null;
  const next = { ...(st || {}), last: remain, checked_at: nowMs };
  let alert = false;
  if (prev !== null && prev < min && remain >= min && !(st.alerted_at && nowMs - st.alerted_at < DEDUP_MS)) {
    alert = true;
    next.alerted_at = nowMs;
  }
  return { next, alert, prev };
}

// ---- 연속 실패 규칙 (예매 감시 5종과 같다: 새벽 00~07시 KST에는 첫 경고를 4시간 늦춘다) ----
const CRON_MIN = 3; // cron-job.org 호출 주기(분)
const ALERT_AT = [6, 24];
const QUIET_END_HOUR = 7;
const QUIET_ALERT_MIN = 240;
const kstStr = ms => new Date(ms + KST_OFFSET).toISOString().replace('T', ' ').slice(0, 16) + ' KST';
const kstHour = ms => new Date(ms + KST_OFFSET).getUTCHours();

function nextHealth(prev, failed, errText, nowMs) {
  const p = prev || { consecutive_failures: 0 };
  const messages = [];
  if (!failed) {
    if (p.consecutive_failures > 0 && p.alerted) {
      const minutes = Math.round((nowMs - Date.parse(p.first_failure_at)) / 60000);
      messages.push(`✅ 취소표 감시 복구됨 (연속 실패 ${p.consecutive_failures}회, 약 ${minutes}분)`);
    }
    return { health: { consecutive_failures: 0 }, messages };
  }
  const n = p.consecutive_failures + 1;
  const first = p.first_failure_at || new Date(nowMs).toISOString();
  let alerted = !!p.alerted;
  const quiet = kstHour(nowMs) < QUIET_END_HOUR;
  const due = ALERT_AT.filter(t => n >= t && (!quiet || n * CRON_MIN >= QUIET_ALERT_MIN)).length;
  const stage = p.alert_stage ?? (p.alerted ? 1 : 0);
  let newStage = stage;
  if (due > stage) {
    messages.push(`⚠️ 취소표 감시 연속 실패 ${n}회 (약 ${n * CRON_MIN}분)\n첫 실패: ${kstStr(Date.parse(first))}\n마지막 오류: ${errText.slice(0, 200)}` + (due === 1 ? `\n(계속되면 ${ALERT_AT[1]}회째에 한 번 더 알립니다)` : ''));
    alerted = true;
  }
  if (due > stage) newStage = due;
  return { health: { consecutive_failures: n, first_failure_at: first, last_error: errText.slice(0, 200), alerted, alert_stage: newStage }, messages };
}

module.exports = {
  DEDUP_MS, bodyHead, norm, hhmm, isoDate, compactDate,
  parseCgv, parseMegabox, parseLotte, parseDtryx, parseCineq,
  parseTheaters, findTheater, movieMatches, findSession,
  startMs, isExpired, everyMs, isDue, step, nextHealth, kstStr,
};
