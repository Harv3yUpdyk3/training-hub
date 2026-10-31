// The hub's own charts and calculations, ported unchanged from the dashboard.
{
  const ridesLoader = {
    description: 'Strava returns activities a page at a time; this follows the pages and makes one row per activity.',
    fn: async ({ answer, call, args }) => {
      const parse = (a) => (typeof a === 'string' ? JSON.parse(a) : a);
      let page = parse(answer);
      const rows = [];
      let pages = 0;
      for (;;) {
        if (!page || !Array.isArray(page.activities)) {
          throw new Error('Strava answer had no activities list. Keys: ' + Object.keys(page || {}).join(', '));
        }
        for (const a of page.activities) {
          const s = a.summary || {};
          rows.push({
            id: String(a.id),
            date: String(a.start_local || '').slice(0, 10),
            start_time: String(a.start_local || '').slice(11, 16) || null,
            name: a.name,
            sport_type: a.sport_type,
            miles: Number(s.distance) || 0,
            moving_s: Number(s.moving_time) || 0,
            elev_ft: Number(s.elevation_gain) || 0,
            relative_effort: s.relative_effort == null ? null : Number(s.relative_effort),
            weather: a.weather && a.weather.condition ? a.weather.condition : null,
            gear_id: a.gear_id == null ? null : String(typeof a.gear_id === 'object' ? a.gear_id.id : a.gear_id),
          });
        }
        pages += 1;
        if (!page.has_next_page || pages >= 5) break;
        page = parse(await call('list_activities', { ...args, after: page.end_cursor }));
      }
      return {
        columns: ['id', 'date', 'start_time', 'name', 'sport_type', 'miles', 'moving_s', 'elev_ft', 'relative_effort', 'weather', 'gear_id'],
        rows,
        cut: pages >= 5 && !!page.has_next_page,
      };
    },
  };
  dash.loader('rides', ridesLoader);
  dash.loader('rides_2025', ridesLoader);
  dash.loader('rides_all', ridesLoader);

  dash.loader('bests', {
    description: 'Strava returns best efforts as one list; this makes one row per effort with its rank within its type (1 = best), value in meters.',
    fn: ({ answer }) => {
      const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
      if (!a || !Array.isArray(a.efforts)) throw new Error('Strava answer had no efforts list. Keys: ' + Object.keys(a || {}).join(', '));
      const seen = {};
      return {
        columns: ['type', 'rank', 'value_m', 'date', 'activity_id'],
        rows: a.efforts.map((e) => ({ type: e.best_effort_type, rank: (seen[e.best_effort_type] = (seen[e.best_effort_type] || 0) + 1), value_m: Number(e.value), date: e.date, activity_id: String(e.activity_id) })),
      };
    },
  });

  dash.calc('cumulative_2025', {
    inputs: ['rides_2025'],
    title: 'Running total, 2025',
    description: '2025 km per ride day added up through the year (miles × 1.609344), each date moved to the same month and day of 2026 so the two years share an axis.',
    fn: (rides_2025) => {
      const by = d3.rollup(rides_2025.filter((r) => r.date.slice(5) !== '02-29'), (v) => d3.sum(v, (r) => r.miles), (r) => r.date);
      let total = 0;
      return [...by].sort((a, b) => d3.ascending(a[0], b[0])).map(([date, mi]) => {
        total += mi * 1.609344;
        return { date: '2026' + date.slice(4), km_total: Math.round(total) };
      });
    },
  });

  dash.calc('yoy', {
    inputs: ['rides', 'rides_2025'],
    title: '2026 vs 2025 to the same date',
    description: 'Km ridden from Jan 1 to today\'s month and day, this year and last (miles × 1.609344), and the difference.',
    fn: (rides, rides_2025) => {
      const md = d3.timeFormat('%m-%d')(new Date());
      const km = (v) => Math.round(d3.sum(v.filter((r) => r.date.slice(5) <= md), (r) => r.miles) * 1.609344);
      const a = km(rides), b = km(rides_2025);
      return [{ km_2026: a, km_2025: b, diff_km: a - b, diff_mi: Math.round((a - b) / 1.609344) }];
    },
  });

  dash.calc('climbs', {
    inputs: ['bests'],
    title: 'Climbing bests',
    description: 'Your biggest single climb and your most climbing in one ride, all-time, from Strava best efforts (meters).',
    fn: (bests) => {
      const top = (t) => bests.find((b) => b.type === t && b.rank === 1);
      const c = top('BiggestClimb'), d = top('MostElevationGain');
      return [
        c && { what: 'Biggest single climb', m: Math.round(c.value_m), date: c.date, pct_colombier: Math.round(c.value_m / 1250 * 100) },
        d && { what: 'Most climbing in one ride', m: Math.round(d.value_m), date: d.date, pct_colombier: Math.round(d.value_m / 1250 * 100) },
      ].filter(Boolean);
    },
  });

  dash.loader('streak', {
    description: 'Strava returns the streak as one record; this makes it a one-row table.',
    fn: ({ answer }) => {
      const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
      if (!a || a.length == null) throw new Error('Strava answer had no streak length. Keys: ' + Object.keys(a || {}).join(', '));
      return { columns: ['length', 'start_date', 'streak_status'], rows: [{ length: Number(a.length), start_date: a.start_date, streak_status: a.streak_status }] };
    },
  });

  dash.loader('gear', {
    description: 'Strava returns the bikes as a list under "gear"; this makes one row per bike, distance still in meters.',
    fn: ({ answer }) => {
      const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
      if (!a || !Array.isArray(a.gear)) throw new Error('Strava answer had no gear list. Keys: ' + Object.keys(a || {}).join(', '));
      return {
        columns: ['gear_id', 'name', 'frame_type', 'retired', 'distance_m'],
        rows: a.gear.map((g) => ({ gear_id: String(g.gear_id && g.gear_id.id), name: g.name, frame_type: g.frame_type ?? null, retired: !!g.retired, distance_m: Number(g.total_distance) || 0 })),
      };
    },
  });

  dash.calc('garage', {
    inputs: ['gear'],
    title: 'Bikes and their miles',
    description: 'Each bike\'s Strava total (meters ÷ 1609.344 = miles) and its share of all bike miles; active bikes first.',
    fn: (gear) => {
      const all = d3.sum(gear, (g) => g.distance_m) || 1;
      return gear.map((g) => ({
        gear_id: g.gear_id, name: g.name, frame_type: g.frame_type,
        miles: Math.round(g.distance_m / 1609.344),
        km: Math.round(g.distance_m / 1000),
        share_pct: Math.round(g.distance_m / all * 100),
        status: g.retired ? 'Retired' : 'Active',
      })).sort((a, b) => d3.ascending(a.status, b.status) || d3.descending(a.miles, b.miles));
    },
  });

  const effortsLoader = {
    description: 'Takes the activities Strava returned (the most recent 10 or 30), asks Strava for each one\'s performance, and makes one row per segment effort with its PR medal (1 gold, 2 silver, 3 bronze) if it earned one.',
    fn: async ({ answer, call }) => {
      const parse = (a) => (typeof a === 'string' ? JSON.parse(a) : a);
      const page = parse(answer);
      if (!page || !Array.isArray(page.activities)) {
        throw new Error('Strava answer had no activities list. Keys: ' + Object.keys(page || {}).join(', '));
      }
      const MEDAL = { SegmentPersonalRecordGold: 1, SegmentPersonalRecordSilver: 2, SegmentPersonalRecordBronze: 3 };
      const rows = [];
      for (const a of page.activities) {
        const perf = parse(await call('get_activity_performance', { activity_id: String(a.id) }));
        if (!perf || !Array.isArray(perf.segment_efforts)) continue;
        const medals = new Map((perf.pr_achievements || []).map((p) => [String(p.entity_id), MEDAL[p.achievement_type] ?? null]));
        for (const e of perf.segment_efforts) {
          rows.push({
            effort_id: String(e.id),
            activity_id: String(a.id),
            activity: a.name,
            date: String(a.start_local || '').slice(0, 10),
            segment_id: String(e.segment_id),
            segment: String(e.segment_name || '').trim(),
            distance_m: Number(e.distance) || 0,
            elev_m: Number(e.elev_gain) || 0,
            time_s: Number(e.elapsed_time) || 0,
            avg_hr: e.avg_hr == null ? null : Number(e.avg_hr),
            medal: medals.get(String(e.id)) ?? null,
          });
        }
      }
      return { columns: ['effort_id', 'activity_id', 'activity', 'date', 'segment_id', 'segment', 'distance_m', 'elev_m', 'time_s', 'avg_hr', 'medal'], rows };
    },
  };
  dash.loader('efforts', effortsLoader);
  dash.loader('efforts30', effortsLoader);

  dash.calc('ytd', {
    inputs: ['rides'],
    title: '2026 distance vs the season goal',
    description: 'Adds up every 2026 activity (miles × 1.609344 = km), spreads what is left of the goal over the weeks to Dec 31, and compares the total with even pace (goal × share of the year gone).',
    fn: (rides) => {
      const miles = d3.sum(rides, (r) => r.miles);
      const km = miles * 1.609344;
      const kmLeft = Math.max(0, 5000 - km);
      const now = Date.now();
      const y0 = Date.UTC(2026, 0, 1), y1 = Date.UTC(2027, 0, 1);
      const weeksLeft = Math.max(0, (y1 - now) / (7 * 864e5));
      const perWeek = weeksLeft > 0 ? kmLeft / weeksLeft : 0;
      const pace = 5000 * Math.min(1, Math.max(0, (now - y0) / (y1 - y0)));
      return [{
        rides: rides.length,
        miles: Math.round(miles),
        km: Math.round(km),
        pct_goal: Math.round(km / 5000 * 100),
        km_left: Math.round(kmLeft),
        mi_left: Math.round(kmLeft / 1.609344),
        weeks_left: Math.round(weeksLeft * 10) / 10,
        km_per_week: Math.round(perWeek),
        mi_per_week: Math.round(perWeek / 1.609344),
        pace_km: Math.round(pace),
        pace_gap_km: Math.round(km - pace),
        pace_gap_mi: Math.round((km - pace) / 1.609344),
        elev_ft: Math.round(d3.sum(rides, (r) => r.elev_ft)),
        elev_m: Math.round(d3.sum(rides, (r) => r.elev_ft) * 0.3048),
        hours: Math.round(d3.sum(rides, (r) => r.moving_s) / 3600),
        rainy_rides: rides.filter((r) => /rain|drizzle|storm|shower/i.test(r.weather || '')).length,
      }];
    },
  });

  dash.loader('hr_samples', {
    description: 'Takes the 12 most recent activities and asks Strava for each one\'s heart rate and time streams (200 points per ride); one row per sample, with the seconds since the previous sample. Rides without heart rate are skipped.',
    fn: async ({ answer, call }) => {
      const parse = (a) => (typeof a === 'string' ? JSON.parse(a) : a);
      const page = parse(answer);
      if (!page || !Array.isArray(page.activities)) throw new Error('Strava answer had no activities list. Keys: ' + Object.keys(page || {}).join(', '));
      const rows = [];
      for (const a of page.activities) {
        const s = parse(await call('get_activity_streams', { activity_id: String(a.id), streams: ['time', 'heart_rate'], resolution: 200 }));
        if (!s || !Array.isArray(s.heart_rate) || !Array.isArray(s.time)) continue;
        for (let i = 1; i < s.time.length; i++) {
          rows.push({ activity_id: String(a.id), date: String(a.start_local || '').slice(0, 10), name: a.name, dt_s: s.time[i] - s.time[i - 1], hr: s.heart_rate[i] });
        }
      }
      return { columns: ['activity_id', 'date', 'name', 'dt_s', 'hr'], rows };
    },
  });

  dash.calc('zone_time', {
    inputs: ['hr_samples', 'zones'],
    title: 'Minutes per heart rate zone, recent rides',
    description: 'Each sample\'s seconds (gaps over 60 s count as 60, so stops don\'t pile up) go to the zone its heart rate falls in; Z1 + Z2 is easy, Z3 and up is hard.',
    fn: (hr_samples, zones) => {
      const zs = [...zones].sort((a, b) => a.lo - b.lo);
      const zi = (hr) => { let k = 0; zs.forEach((z, i) => { if (hr >= z.lo) k = i; }); return k; };
      return d3.groups(hr_samples, (s) => s.activity_id).map(([activity_id, v]) => {
        const sec = [0, 0, 0, 0, 0];
        for (const s of v) if (s.hr > 0) sec[Math.min(4, zi(s.hr))] += Math.min(60, Math.max(0, s.dt_s));
        const total = d3.sum(sec) || 1;
        return {
          activity_id, date: v[0].date, name: v[0].name,
          z1: Math.round(sec[0] / 60), z2: Math.round(sec[1] / 60), z3: Math.round(sec[2] / 60), z4: Math.round(sec[3] / 60), z5: Math.round(sec[4] / 60),
          easy_pct: Math.round((sec[0] + sec[1]) / total * 100),
        };
      }).sort((a, b) => d3.ascending(a.date, b.date));
    },
  });

  dash.calc('zone_sum', {
    inputs: ['zone_time'],
    title: 'Easy share, recent rides',
    description: 'Share of all zone minutes in Z1 + Z2 across the recent rides with heart rate.',
    fn: (zone_time) => {
      const easy = d3.sum(zone_time, (r) => r.z1 + r.z2), all = d3.sum(zone_time, (r) => r.z1 + r.z2 + r.z3 + r.z4 + r.z5);
      return [{ rides: zone_time.length, easy_pct: all ? Math.round(easy / all * 100) : null, hard_pct: all ? 100 - Math.round(easy / all * 100) : null }];
    },
  });

  dash.calc('month_report', {
    inputs: ['rides'],
    title: 'This month vs last month, to the same day',
    description: 'Rides from the 1st of this month to today, against the 1st of last month to the same day (or its last day); km = miles × 1.609344; change in percent, blank when last month is zero.',
    fn: (rides) => {
      const f = d3.timeFormat('%Y-%m-%d');
      const now = new Date();
      const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
      const p0 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
      const cur = rides.filter((r) => r.date >= f(m0) && r.date <= f(now));
      const prev = rides.filter((r) => r.date >= f(p0) && r.date <= f(pEnd));
      const tot = (v) => ({ km: d3.sum(v, (r) => r.miles) * 1.609344, ft: d3.sum(v, (r) => r.elev_ft), h: d3.sum(v, (r) => r.moving_s) / 3600, n: v.length });
      const c = tot(cur), p = tot(prev);
      const pct = (x, y) => (y > 0 ? Math.round((x / y - 1) * 100) : null);
      return [
        { metric: 'Distance', unit: 'km', now: Math.round(c.km), before: Math.round(p.km), change_pct: pct(c.km, p.km) },
        { metric: 'Climbing', unit: 'ft', now: Math.round(c.ft), before: Math.round(p.ft), change_pct: pct(c.ft, p.ft) },
        { metric: 'Moving time', unit: 'h', now: Math.round(c.h * 10) / 10, before: Math.round(p.h * 10) / 10, change_pct: pct(c.h, p.h) },
        { metric: 'Rides', unit: '', now: c.n, before: p.n, change_pct: pct(c.n, p.n) },
      ].map((r) => ({ ...r, month: d3.timeFormat('%B')(m0), prev_month: d3.timeFormat('%B')(p0), day: now.getDate() }));
    },
  });

  dash.calc('dow', {
    inputs: ['rides'],
    title: 'Rides by day of week, 2026',
    description: 'Each 2026 activity counted by its local weekday (Monday first), with total and average miles.',
    fn: (rides) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => {
      const v = rides.filter((r) => (new Date(r.date + 'T12:00:00').getDay() + 6) % 7 === i);
      const mi = d3.sum(v, (r) => r.miles);
      return { day, rides: v.length, miles: Math.round(mi), avg_mi: v.length ? Math.round(mi / v.length * 10) / 10 : 0 };
    }),
  });

  dash.calc('form', {
    inputs: ['weekly'],
    title: 'Weekly target hit or missed, last 8 weeks',
    description: 'The 8 full Monday-start weeks before this one; a week is a hit at 96 km or more (5,000 km ÷ 52 weeks).',
    fn: (weekly) => weekly.slice(-9, -1).map((w) => ({ week_of: w.week_of, km: w.km, hit: w.km >= 96 })),
  });

  dash.calc('form_sum', {
    inputs: ['form'],
    title: 'Weeks on target',
    description: 'How many of the last 8 full weeks hit the weekly target.',
    fn: (form) => [{ hits: form.filter((w) => w.hit).length, weeks: form.length }],
  });

  dash.calc('week', {
    inputs: ['rides'],
    title: 'This week so far',
    description: 'Activities since the most recent Monday (local date), with their total miles.',
    fn: (rides) => {
      const now = new Date();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
      const iso = d3.timeFormat('%Y-%m-%d')(monday);
      const wk = rides.filter((r) => r.date >= iso);
      return [{ week_of: iso, rides: wk.length, miles: Math.round(d3.sum(wk, (r) => r.miles) * 10) / 10, km: Math.round(d3.sum(wk, (r) => r.miles) * 16.09344) / 10 }];
    },
  });

  dash.calc('period', {
    inputs: ['rides'],
    title: 'Last 4 weeks vs the 4 before',
    description: 'Totals for the last 28 days (today included) and the 28 days before them, with the change in percent (blank when the earlier period is zero).',
    fn: (rides) => {
      const f = d3.timeFormat('%Y-%m-%d');
      const today = d3.timeDay.floor(new Date());
      const a = f(d3.timeDay.offset(today, -27)), b = f(d3.timeDay.offset(today, -55));
      const cur = rides.filter((r) => r.date >= a), prev = rides.filter((r) => r.date >= b && r.date < a);
      const tot = (v) => ({ mi: d3.sum(v, (r) => r.miles), elev: d3.sum(v, (r) => r.elev_ft), hours: d3.sum(v, (r) => r.moving_s) / 3600 });
      const c = tot(cur), p = tot(prev);
      const pct = (x, y) => (y > 0 ? Math.round((x / y - 1) * 100) : null);
      return [{
        rides_4w: cur.length, rides_prev: prev.length, rides_delta_pct: pct(cur.length, prev.length),
        mi_4w: Math.round(c.mi), mi_prev: Math.round(p.mi), mi_delta_pct: pct(c.mi, p.mi),
        km_4w: Math.round(c.mi * 1.609344), km_prev: Math.round(p.mi * 1.609344),
        elev_4w: Math.round(c.elev), elev_prev: Math.round(p.elev), elev_delta_pct: pct(c.elev, p.elev),
        elev_4w_m: Math.round(c.elev * 0.3048), elev_prev_m: Math.round(p.elev * 0.3048),
        hours_4w: Math.round(c.hours * 10) / 10, hours_prev: Math.round(p.hours * 10) / 10, hours_delta_pct: pct(c.hours, p.hours),
      }];
    },
  });

  dash.calc('days', {
    inputs: ['rides'],
    title: 'Km per day, 2026',
    description: 'Miles per calendar day converted to km (× 1.609344), with the number of activities.',
    fn: (rides) => d3.rollups(rides, (v) => ({ km: Math.round(d3.sum(v, (r) => r.miles) * 1.609344 * 10) / 10, rides: v.length, rain: v.some((r) => /rain|drizzle|storm|shower/i.test(r.weather || '')) }), (r) => r.date)
      .sort((a, b) => d3.ascending(a[0], b[0])).map(([date, v]) => ({ date, km: v.km, rides: v.rides, rain: v.rain })),
  });

  dash.calc('weekly', {
    inputs: ['rides'],
    title: 'Weekly totals, last 16 weeks',
    description: 'Activities grouped by Monday-start week for the 16 weeks to this one: km (miles × 1.609344), miles, climbing ft, moving hours, ride count and summed Relative Effort.',
    fn: (rides) => {
      const f = d3.timeFormat('%Y-%m-%d');
      const thisMon = d3.timeMonday.floor(new Date());
      const weeks = d3.range(15, -1, -1).map((i) => f(d3.timeMonday.offset(thisMon, -i)));
      const by = d3.group(rides, (r) => f(d3.timeMonday.floor(new Date(r.date + 'T12:00:00'))));
      return weeks.map((w) => {
        const v = by.get(w) || [];
        const mi = d3.sum(v, (r) => r.miles);
        return {
          week_of: w,
          km: Math.round(mi * 1.609344),
          miles: Math.round(mi),
          elev_ft: Math.round(d3.sum(v, (r) => r.elev_ft)),
          hours: Math.round(d3.sum(v, (r) => r.moving_s) / 360) / 10,
          rides: v.length,
          effort: Math.round(d3.sum(v, (r) => r.relative_effort || 0)),
          mph: d3.sum(v, (r) => r.moving_s) > 0 ? Math.round(mi / (d3.sum(v, (r) => r.moving_s) / 3600) * 10) / 10 : null,
          kmh: d3.sum(v, (r) => r.moving_s) > 0 ? Math.round(mi * 1.609344 / (d3.sum(v, (r) => r.moving_s) / 3600) * 10) / 10 : null,
        };
      });
    },
  });

  dash.calc('monthly', {
    inputs: ['rides'],
    title: 'Km by month, 2026',
    description: 'Miles per calendar month, converted to km (× 1.609344).',
    fn: (rides) => {
      const by = new Map();
      for (let m = 1; m <= 12; m++) by.set('2026-' + String(m).padStart(2, '0'), { miles: 0, rides: 0 });
      for (const r of rides) {
        const v = by.get(r.date.slice(0, 7));
        if (!v) continue;
        v.miles += r.miles;
        v.rides += 1;
      }
      return [...by].map(([month, v]) => ({ month, rides: v.rides, km: Math.round(v.miles * 1.609344) }));
    },
  });

  dash.calc('cumulative', {
    inputs: ['rides'],
    title: 'Running total, 2026',
    description: 'Km per ride day, added up through the year (miles × 1.609344).',
    fn: (rides) => {
      const by = d3.rollup(rides, (v) => d3.sum(v, (r) => r.miles), (r) => r.date);
      let total = 0;
      return [...by].sort((a, b) => d3.ascending(a[0], b[0])).map(([date, mi]) => {
        total += mi * 1.609344;
        return { date, km_total: Math.round(total) };
      });
    },
  });

  dash.calc('records', {
    inputs: ['rides'],
    title: '2026 records',
    description: 'Longest single activity, the one with most climbing, the biggest Monday-start week and the biggest calendar month (miles × 1.609344 for km).',
    fn: (rides) => {
      if (!rides.length) return [];
      const long = d3.greatest(rides, (r) => r.miles);
      const climb = d3.greatest(rides, (r) => r.elev_ft);
      const f = d3.timeFormat('%Y-%m-%d');
      const weeks = d3.rollups(rides, (v) => d3.sum(v, (r) => r.miles), (r) => f(d3.timeMonday.floor(new Date(r.date + 'T12:00:00'))));
      const months = d3.rollups(rides, (v) => d3.sum(v, (r) => r.miles), (r) => r.date.slice(0, 7));
      const wk = d3.greatest(weeks, (d) => d[1]);
      const mo = d3.greatest(months, (d) => d[1]);
      return [{
        long_mi: Math.round(long.miles * 10) / 10, long_km: Math.round(long.miles * 16.09344) / 10, long_name: long.name + ' · ' + long.date,
        climb_ft: Math.round(climb.elev_ft), climb_m: Math.round(climb.elev_ft * 0.3048), climb_name: climb.name + ' · ' + climb.date,
        week_km: Math.round(wk[1] * 1.609344), week_mi: Math.round(wk[1]), week_of: wk[0],
        month_km: Math.round(mo[1] * 1.609344), month_mi: Math.round(mo[1]), month: mo[0],
      }];
    },
  });

  dash.calc('prs', {
    inputs: ['efforts'],
    title: 'Recent PR medals',
    description: 'Segment efforts that earned a PR medal, newest first, then gold before silver before bronze; segment length in miles (m ÷ 1609.344) and km.',
    fn: (efforts) => efforts.filter((e) => e.medal != null)
      .map((e) => ({ ...e, miles: Math.round(e.distance_m / 1609.344 * 100) / 100, km: Math.round(e.distance_m / 10) / 100 }))
      .sort((a, b) => d3.descending(a.date, b.date) || d3.ascending(a.medal, b.medal)),
  });

  dash.loader('ride_detail', {
    description: 'Strava returns one ride\'s performance; this makes one row per segment effort (with its PR medal, 1 gold to 3 bronze), and keeps the ride\'s heart rate, cadence and calories as notes.',
    fn: ({ answer }) => {
      const p = typeof answer === 'string' ? JSON.parse(answer) : answer;
      if (!p || !Array.isArray(p.segment_efforts)) throw new Error('Strava answer had no segment efforts. Keys: ' + Object.keys(p || {}).join(', '));
      const MEDAL = { SegmentPersonalRecordGold: 1, SegmentPersonalRecordSilver: 2, SegmentPersonalRecordBronze: 3 };
      const medals = new Map((p.pr_achievements || []).map((a) => [String(a.entity_id), MEDAL[a.achievement_type] ?? null]));
      const note = (label, v) => (v == null ? null : { label, value: String(v) });
      return {
        columns: ['effort_id', 'segment', 'distance_m', 'elev_m', 'time_s', 'avg_hr', 'medal'],
        rows: p.segment_efforts.map((e) => ({ effort_id: String(e.id), segment: String(e.segment_name || '').trim(), distance_m: Number(e.distance) || 0, elev_m: Number(e.elev_gain) || 0, time_s: Number(e.elapsed_time) || 0, avg_hr: e.avg_hr == null ? null : Number(e.avg_hr), medal: medals.get(String(e.id)) ?? null })),
        meta: [note('Avg HR', p.has_heartrate ? Math.round(p.average_heartrate) : null), note('Max HR', p.has_heartrate ? p.max_heartrate : null), note('Cadence', p.average_cadence == null ? null : Math.round(p.average_cadence)), note('Calories', p.calories)].filter(Boolean),
      };
    },
  });

  dash.calc('ride_segs', {
    inputs: ['ride_detail'],
    title: 'Segments on the picked ride',
    description: 'The picked ride\'s segment efforts, PR medals first, then by distance; length in km (m ÷ 1000) and miles (m ÷ 1609.344).',
    fn: (ride_detail) => ride_detail.map((e) => ({ ...e, km: Math.round(e.distance_m / 10) / 100, miles: Math.round(e.distance_m / 1609.344 * 100) / 100 }))
      .sort((a, b) => (a.medal ?? 9) - (b.medal ?? 9) || b.distance_m - a.distance_m),
  });

  dash.calc('fitness', {
    inputs: ['rides'],
    title: 'Fitness, fatigue and form',
    description: 'Strava Relative Effort per day (rides without heart rate count as 0), smoothed over 42 days for fitness and 7 days for fatigue (exponential averages); form = fitness − fatigue. The last 120 days.',
    fn: (rides) => {
      const f = d3.timeFormat('%Y-%m-%d');
      const by = d3.rollup(rides, (v) => d3.sum(v, (r) => r.relative_effort || 0), (r) => r.date);
      const days = d3.timeDay.range(new Date(2026, 0, 1), d3.timeDay.offset(d3.timeDay.floor(new Date()), 1));
      let ctl = 0, atl = 0;
      const out = days.map((d) => {
        const load = by.get(f(d)) || 0;
        ctl += (load - ctl) / 42;
        atl += (load - atl) / 7;
        return { date: f(d), load, fitness: Math.round(ctl * 10) / 10, fatigue: Math.round(atl * 10) / 10, form: Math.round((ctl - atl) * 10) / 10 };
      });
      return out.slice(-120);
    },
  });

  dash.calc('fitness_now', {
    inputs: ['fitness'],
    title: 'Fitness today vs 4 weeks ago',
    description: 'Today\'s fitness, fatigue and form, and fitness 28 days ago.',
    fn: (fitness) => {
      const t = fitness[fitness.length - 1], a = fitness[Math.max(0, fitness.length - 29)];
      return t ? [{ fitness: t.fitness, fatigue: t.fatigue, form: t.form, fitness_4w_ago: a.fitness, fitness_change: Math.round((t.fitness - a.fitness) * 10) / 10 }] : [];
    },
  });

  dash.loader('bests_yoy', {
    description: 'Strava returns best efforts as one list; this makes one row per effort type and year (value in seconds or meters, as Strava gives it).',
    fn: ({ answer }) => {
      const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
      if (!a || !Array.isArray(a.efforts)) throw new Error('Strava answer had no efforts list. Keys: ' + Object.keys(a || {}).join(', '));
      return { columns: ['type', 'year', 'value', 'unit', 'date', 'activity_id'], rows: a.efforts.map((e) => ({ type: e.best_effort_type, year: Number(e.year), value: Number(e.value), unit: e.unit, date: e.date, activity_id: String(e.activity_id) })) };
    },
  });

  dash.calc('bests_cmp', {
    inputs: ['bests_yoy'],
    title: '2026 bests vs 2025',
    description: 'Each best effort type side by side for 2026 and 2025; for times lower is better, for distance and climbing higher is better; change in percent against 2025.',
    fn: (bests_yoy) => {
      const order = ['Fastest10k', 'Fastest20k', 'Fastest40k', 'Fastest50k', 'Fastest100k', 'LongestActivity', 'MostElevationGain', 'BiggestClimb'];
      const label = { Fastest10k: 'Fastest 10K', Fastest20k: 'Fastest 20K', Fastest40k: 'Fastest 40K', Fastest50k: 'Fastest 50K', Fastest100k: 'Fastest 100K', LongestActivity: 'Longest ride', MostElevationGain: 'Most climbing in a ride', BiggestClimb: 'Biggest single climb' };
      return order.map((t, i) => {
        const a = bests_yoy.find((b) => b.type === t && b.year === 2026), b = bests_yoy.find((x) => x.type === t && x.year === 2025);
        if (!a && !b) return null;
        const time = t.startsWith('Fastest');
        const better = a && b ? (time ? a.value < b.value : a.value > b.value) : null;
        return { order: i + 1, type: t, effort: label[t], kind: time ? 'time' : t === 'LongestActivity' ? 'distance' : 'climb', v2026: a ? a.value : null, d2026: a ? a.date : null, v2025: b ? b.value : null, better, change_pct: a && b ? Math.round((a.value / b.value - 1) * 100) : null };
      }).filter(Boolean);
    },
  });

  dash.calc('by_hour', {
    inputs: ['rides'],
    title: 'Rides by start hour, 2026',
    description: 'Each 2026 activity counted by the local hour it started, with total miles (and km, × 1.609344).',
    fn: (rides) => d3.range(5, 23).map((h) => {
      const v = rides.filter((r) => r.start_time && Number(r.start_time.slice(0, 2)) === h);
      const mi = d3.sum(v, (r) => r.miles);
      return { hour: h, rides: v.length, miles: Math.round(mi), km: Math.round(mi * 1.609344) };
    }),
  });

  dash.calc('climb_weeks', {
    inputs: ['weekly'],
    title: 'Climbing per week, last 16 weeks',
    description: 'Weekly climbing in meters (ft × 0.3048) and feet, for comparing with the 1,250–1,400 m of one Alpine or Pyrenean climb.',
    fn: (weekly) => weekly.map((w) => ({ week_of: w.week_of, elev_ft: w.elev_ft, elev_m: Math.round(w.elev_ft * 0.3048) })),
  });

  dash.calc('eddington', {
    inputs: ['rides_all', 'rides'],
    title: 'Eddington number, all time',
    description: 'Ride distance per day over every Strava ride; Eddington E is the largest number with at least E days of E or more (in miles, and separately in km). For each next level, how many more days of that distance it needs. Also the longest run of consecutive riding days in 2026.',
    fn: (rides_all, rides) => {
      const days = d3.rollups(rides_all.filter((r) => /Ride/.test(r.sport_type || 'Ride')), (v) => d3.sum(v, (r) => r.miles), (r) => r.date).map((d) => d[1]);
      const ed = (vals) => {
        const s = vals.slice().sort((a, b) => b - a);
        let e = 0;
        while (e < s.length && s[e] >= e + 1) e++;
        const have = (n) => s.filter((v) => v >= n).length;
        const levels = [...new Set([...d3.range(e + 1, e + 6), ...d3.range(Math.ceil((e + 6) / 5) * 5, e + 31, 5)])].sort((a, b) => a - b);
        return { e, ladder: levels.map((n) => ({ level: n, have: have(n), need: Math.max(0, n - have(n)) })) };
      };
      const mi = ed(days), km = ed(days.map((v) => v * 1.609344));
      const dates = new Set(rides.map((r) => r.date));
      let best = 0, run = 0, bestEnd = null;
      d3.timeDay.range(new Date(2026, 0, 1), d3.timeDay.offset(d3.timeDay.floor(new Date()), 1)).forEach((d) => {
        const k = d3.timeFormat('%Y-%m-%d')(d);
        run = dates.has(k) ? run + 1 : 0;
        if (run > best) { best = run; bestEnd = k; }
      });
      return [{ e_mi: mi.e, e_km: km.e, next_mi: mi.ladder[0].need, next_km: km.ladder[0].need, ladder_mi: mi.ladder, ladder_km: km.ladder, ride_days: days.length, longest_run: best, longest_run_end: bestEnd }];
    },
  });

  dash.calc('month_goal', {
    inputs: ['rides'],
    title: 'This month against the monthly share of the goal',
    description: 'Km ridden this calendar month (miles × 1.609344) against 5,000 ÷ 12 km, and where even pace through the month would put you today.',
    fn: (rides) => {
      const now = new Date();
      const m0 = d3.timeFormat('%Y-%m')(now);
      const km = d3.sum(rides.filter((r) => r.date.slice(0, 7) === m0), (r) => r.miles) * 1.609344;
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const target = 5000 / 12;
      return [{ month: d3.timeFormat('%B')(now), km: Math.round(km), mi: Math.round(km / 1.609344), target_km: Math.round(target), target_mi: Math.round(target / 1.609344), pace_km: Math.round(target * now.getDate() / days), pct: Math.round(km / target * 100) }];
    },
  });

  dash.calc('plan_actual', {
    inputs: ['plan', 'rides'],
    title: 'This week: planned vs ridden',
    description: 'Each plan day with the miles Strava logged that day (and km, × 1.609344); planned miles are the low and high ends of the target ("12–15"), a single number is both.',
    fn: (plan, rides) => plan.map((p) => {
      const v = rides.filter((r) => r.date === p.date);
      const mi = d3.sum(v, (r) => r.miles);
      const nums = String(p.target_miles ?? '').split('–').map(Number).filter(Number.isFinite);
      return {
        order: p.order, date: p.date,
        plan_lo_mi: nums.length ? nums[0] : 0, plan_hi_mi: nums.length ? nums[nums.length - 1] : 0,
        rides: v.length, ridden_mi: Math.round(mi * 10) / 10, ridden_km: Math.round(mi * 16.09344) / 10,
      };
    }),
  });

  dash.calc('plan_week', {
    inputs: ['plan_actual'],
    title: 'This week: planned vs ridden, totals',
    description: 'Planned miles for the week (low to high end of each day\'s target) and the miles ridden so far, also in km (× 1.609344).',
    fn: (plan_actual) => {
      const lo = d3.sum(plan_actual, (d) => d.plan_lo_mi), hi = d3.sum(plan_actual, (d) => d.plan_hi_mi), mi = d3.sum(plan_actual, (d) => d.ridden_mi);
      return [{ plan_lo_mi: Math.round(lo), plan_hi_mi: Math.round(hi), plan_lo_km: Math.round(lo * 1.609344), plan_hi_km: Math.round(hi * 1.609344), ridden_mi: Math.round(mi * 10) / 10, ridden_km: Math.round(mi * 16.09344) / 10 }];
    },
  });

  dash.calc('ride_log', {
    inputs: ['rides'],
    title: 'Ride log in both units',
    description: 'Every 2026 activity with distance also in km (miles × 1.609344) and climbing also in meters (ft × 0.3048).',
    fn: (rides) => rides.map((r) => ({ ...r, miles: Math.round(r.miles * 10) / 10, km: Math.round(r.miles * 16.09344) / 10, elev_ft: Math.round(r.elev_ft), elev_m: Math.round(r.elev_ft * 0.3048),
      mph: r.moving_s > 0 ? Math.round(r.miles / (r.moving_s / 3600) * 10) / 10 : null, kmh: r.moving_s > 0 ? Math.round(r.miles * 1.609344 / (r.moving_s / 3600) * 10) / 10 : null })),
  });

  dash.calc('crowns', {
    inputs: ['legends'],
    title: 'Crowns in both units',
    description: 'Local Legends and top 10s with segment length also in km (miles × 1.609344) and climbing also in meters (ft × 0.3048).',
    fn: (legends) => legends.map((r) => ({ ...r, km: Math.round(r.miles * 160.9344) / 100, climb_m: Math.round(r.climb_ft * 0.3048) })),
  });

  dash.calc('hascall', {
    inputs: ['efforts30'],
    title: 'Full Hascall Hill efforts',
    description: 'Every effort on Full Hascall Hill (segment 2596552) in the last 30 activities, newest first.',
    fn: (efforts30) => efforts30.filter((e) => e.segment_id === '2596552').sort((a, b) => d3.descending(a.date, b.date) || d3.descending(a.effort_id, b.effort_id)),
  });

  dash.calc('ll_status', {
    inputs: ['legends', 'efforts30'],
    title: 'Local Legend upkeep',
    description: 'For each Local Legend segment: your efforts in the last 90 days among your last 30 activities, the last time you rode it, and when your oldest effort in the window ages out (its date + 90 days).',
    fn: (legends, efforts30) => {
      const f = d3.timeFormat('%Y-%m-%d');
      const today = d3.timeDay.floor(new Date());
      const cut = f(d3.timeDay.offset(today, -90));
      return legends.filter((l) => l.title === 'Local Legend').map((l) => {
        const v = efforts30.filter((e) => e.segment_id === String(l.segment_id) && e.date >= cut).sort((a, b) => d3.ascending(a.date, b.date));
        const last = v.length ? v[v.length - 1].date : null;
        return {
          order: l.order, segment: l.segment, segment_id: String(l.segment_id),
          efforts_90d: v.length,
          last_date: last,
          days_since: last ? d3.timeDay.count(new Date(last + 'T00:00:00'), today) : null,
          next_expiry: v.length ? f(d3.timeDay.offset(new Date(v[0].date + 'T00:00:00'), 90)) : null,
        };
      }).sort((a, b) => d3.ascending(a.efforts_90d, b.efforts_90d) || d3.descending(a.days_since ?? 999, b.days_since ?? 999));
    },
  });

  dash.calc('hascall_sum', {
    inputs: ['hascall'],
    title: 'Hascall summary',
    description: 'Number of Full Hascall Hill efforts in the last 30 activities, the fastest, and the average of the newer half (up to 3 efforts) against the same number before them (seconds); no comparison under 2 efforts.',
    fn: (hascall) => {
      if (!hascall.length) return [];
      const best = d3.least(hascall, (e) => e.time_s);
      const n = Math.min(3, Math.floor(hascall.length / 2));
      const recent = d3.mean(hascall.slice(0, Math.max(1, n)), (e) => e.time_s), before = n ? d3.mean(hascall.slice(n, 2 * n), (e) => e.time_s) : null;
      return [{ efforts: hascall.length, compared: n, best_s: best.time_s, best_date: best.date, recent_avg_s: Math.round(recent), before_avg_s: before == null ? null : Math.round(before), trend_s: before == null ? null : Math.round(recent - before) }];
    },
  });

  dash.calc('seg_counts', {
    inputs: ['efforts'],
    title: 'Most ridden segments',
    description: 'Segment efforts counted per segment, with the fastest elapsed time; the 10 most ridden.',
    fn: (efforts) => d3.rollups(efforts, (v) => ({ segment: v[0].segment, efforts: v.length, best_s: d3.min(v, (e) => e.time_s), distance_m: v[0].distance_m }), (e) => e.segment_id)
      .map(([segment_id, v]) => ({ segment_id, segment: v.segment, efforts: v.efforts, best_s: v.best_s, miles: Math.round(v.distance_m / 1609.344 * 100) / 100, km: Math.round(v.distance_m / 10) / 100 }))
      .sort((a, b) => d3.descending(a.efforts, b.efforts) || d3.ascending(a.segment, b.segment))
      .slice(0, 10),
  });
}

{
  // Tabs: sections are pages; only the open one is shown.
  const pages = () => document.querySelectorAll('.hub-page');
  const show = (id) => {
    let found = false;
    pages().forEach((p) => { if (p.id === id) found = true; });
    if (!found) return false;
    pages().forEach((p) => { p.hidden = p.id !== id; });
    document.querySelectorAll('.hub-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    dash.setLink(id);
    return true;
  };
  document.querySelectorAll('.hub-tab').forEach((t) => t.addEventListener('click', () => { if (show(t.dataset.tab)) window.scrollTo({ top: 0 }); }));
  const named = location.hash.slice(1);
  if (named) show(named);

  // Ticker arrows scroll the ride strip; a click on a ride opens it in the ride log.
  document.querySelectorAll('.tk-arrow').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.rstrip').forEach((s) => s.scrollBy({ left: (b.classList.contains('next') ? 1 : -1) * s.clientWidth * 0.8 }));
  }));
  // Picking a ride (ticker card or log row) loads its detail at the top of the Rides tab.
  let autoRide = false;
  const pickRide = (id) => {
    if (!id || !show('rides')) return;
    autoRide = true;
    dash.setParams({ ride: id });
    document.querySelectorAll('#ride-detail-card').forEach((c) => c.scrollIntoView({ block: 'start' }));
  };
  document.querySelectorAll('.rstrip').forEach((s) => s.addEventListener('click', (ev) => {
    const card = ev.target.closest('.rcard');
    if (card) pickRide(card.dataset.key);
  }));
  document.querySelectorAll('.rstrip').forEach((s) => s.addEventListener('keydown', (ev) => {
    const card = ev.target.closest('.rcard');
    if (card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); pickRide(card.dataset.key); }
  }));
  document.querySelectorAll('tbody[data-draw="ride-rows"]').forEach((tb) => tb.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-key]');
    if (tr) pickRide(tr.dataset.key);
  }));
  // The stored default ride is a fixed id; once rides load, start on the newest one instead.
  dash.onData(() => {
    if (autoRide) return;
    const g = dash.data('rides');
    if (g.status !== 'ok' || !g.data.length) return;
    autoRide = true;
    const newest = d3.greatest(g.data, (r) => r.date + 'T' + r.id);
    if (newest && newest.id !== dash.params().ride) dash.setParams({ ride: newest.id });
  });

  // Keyboard: 1–5 switch tabs, / jumps to ride search.
  document.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || '')) return;
    const tabs = [...document.querySelectorAll('.hub-tab')];
    const n = Number(ev.key);
    if (n >= 1 && n <= tabs.length) { show(tabs[n - 1].dataset.tab); window.scrollTo({ top: 0 }); }
    if (ev.key === '/') {
      ev.preventDefault();
      if (show('rides')) document.querySelectorAll('.search').forEach((inp) => inp.focus());
    }
  });

  const GOAL_KM = 5000;
  const WEEK_KM = 96;
  const fmt = d3.format(',');
  const f1 = d3.format('.1f');
  const css = (v) => `var(${v})`;
  const INT = { Rest: '--cds-chart-muted', Endurance: '--cds-chart-categorical-1', Tempo: '--cds-chart-categorical-3', Threshold: '--cds-chart-status-warning', VO2: '--cds-chart-status-critical' };
  const ZONE = ['--cds-chart-muted', '--cds-chart-categorical-1', '--cds-chart-categorical-3', '--cds-chart-status-warning', '--cds-chart-status-critical'];
  const TRIP = new Date(2027, 6, 1);
  const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace';
  const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const hm = (s) => { const m = Math.round(s / 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
  const dayFmt = d3.timeFormat('%b %-d');
  const asDate = (s) => new Date(s + 'T12:00:00');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Units: metric (km, m) by default, imperial (mi, ft) on request. A page setting, not a query filter.
  const KM_MI = 1.609344, M_FT = 0.3048;
  const isImp = () => dash.params().units === 'imperial';
  const dist = (km) => (isImp() ? km / KM_MI : km);
  const fromMi = (mi) => (isImp() ? mi : mi * KM_MI);
  const distU = () => (isImp() ? 'mi' : 'km');
  const elevFt = (ft) => (isImp() ? ft : ft * M_FT);
  const elevM = (m) => (isImp() ? m / M_FT : m);
  const elevU = () => (isImp() ? 'ft' : 'm');
  // Plan targets are text in miles, sometimes a range ("12–15"): convert each number, keep the rest.
  const rangeU = (s) => String(s ?? '').split('–').map((p) => { const n = Number(p); return p.trim() !== '' && Number.isFinite(n) ? String(Math.round(fromMi(n))) : p; }).join('–');
  // Table headers carry both fields (data-mf / data-if); a drawing points each at the unit shown.
  const headersU = () => document.querySelectorAll('th[data-mf]').forEach((th) => { th.dataset.field = isImp() ? th.dataset.if : th.dataset.mf; });
  const showUnits = () => {
    const imp = isImp();
    document.querySelectorAll('.hub').forEach((h) => h.classList.toggle('imp', imp));
    document.querySelectorAll('[data-units]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.units === 'imperial') === imp)));
  };
  document.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => { dash.setParams({ units: b.dataset.units }); showUnits(); }));
  dash.onData(showUnits);

  const failed = (box, id) => {
    const st = dash.data(id).status;
    if (st === 'error' || st === 'connect' || st === 'declined') {
      // Say why, so a screenshot tells Claude what went wrong.
      const msg = dash.data(id).message;
      const f = el('div', 'fail');
      f.append(el('span', null, 'Failed to load' + (msg ? ': ' + msg : '')));
      box.replaceChildren(f);
      return true;
    }
    return false;
  };
  const one = (id, field, f) => (e) => {
    const g = dash.data(id);
    if (g.status !== 'ok' || !g.data.length || g.data[0][field] == null) { e.textContent = '—'; return; }
    e.textContent = f ? f(g.data[0][field]) : fmt(g.data[0][field]);
  };
  // A mark with a field per unit: the drawing points it at the field it shows.
  const oneU = (id, mField, iField, f) => (e) => {
    e.dataset.field = isImp() ? iField : mField;
    one(id, e.dataset.field, f)(e);
  };
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
  const delta = (field) => (e) => {
    const g = dash.data('period');
    const v = g.status === 'ok' && g.data.length ? g.data[0][field] : null;
    e.classList.remove('up', 'down');
    if (v == null) { e.textContent = '—'; return; }
    e.textContent = (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v)) + '%';
    if (v > 0) e.classList.add('up');
    if (v < 0) e.classList.add('down');
  };

  const goalText = (e) => { e.textContent = fmt(Math.round(dist(GOAL_KM))); };
  dash.draw('goal', goalText);
  dash.draw('goal-2', goalText);
  dash.draw('km-done', oneU('ytd', 'km', 'miles'));
  dash.draw('km-done-2', oneU('ytd', 'km', 'miles'));
  dash.draw('pct-goal', one('ytd', 'pct_goal', (v) => v + '%'));
  dash.draw('mi-done', oneU('ytd', 'km', 'miles'));
  dash.draw('ride-count', one('ytd', 'rides'));
  dash.draw('km-left', oneU('ytd', 'km_left', 'mi_left'));
  dash.draw('per-week', oneU('ytd', 'km_per_week', 'mi_per_week'));
  dash.draw('per-week-mi', oneU('ytd', 'mi_per_week', 'km_per_week'));
  dash.draw('ft-done', oneU('ytd', 'elev_m', 'elev_ft'));
  dash.draw('rainy', one('ytd', 'rainy_rides'));
  dash.draw('yoy', oneU('yoy', 'diff_km', 'diff_mi', signed));
  dash.draw('hours-done', one('ytd', 'hours'));
  dash.draw('pace-gap', oneU('ytd', 'pace_gap_km', 'pace_gap_mi', (v) => fmt(Math.abs(v))));
  dash.draw('pace-gap-b', oneU('ytd', 'pace_gap_km', 'pace_gap_mi', (v) => fmt(Math.abs(v))));
  // Ahead/behind tag: onData shows one, since a drawing can't unhide what holds it.
  dash.onData(() => {
    const g = dash.data('ytd');
    const gap = g.status === 'ok' && g.data.length ? g.data[0].pace_gap_km : null;
    document.querySelectorAll('[data-pace]').forEach((c) => {
      c.hidden = gap == null || (c.dataset.pace === 'ahead' ? gap < 0 : gap >= 0);
    });
  });
  dash.draw('p-mi', oneU('period', 'km_4w', 'mi_4w'));
  dash.draw('p-mi-prev', oneU('period', 'km_prev', 'mi_prev'));
  dash.draw('p-elev', oneU('period', 'elev_4w_m', 'elev_4w'));
  dash.draw('p-elev-prev', oneU('period', 'elev_prev_m', 'elev_prev'));
  dash.draw('p-hours', one('period', 'hours_4w', f1));
  dash.draw('p-hours-prev', one('period', 'hours_prev', f1));
  dash.draw('d-mi', delta('mi_delta_pct'));
  dash.draw('d-elev', delta('elev_delta_pct'));
  dash.draw('d-hours', delta('hours_delta_pct'));
  dash.draw('wk-mi', oneU('week', 'km', 'miles', f1));
  dash.draw('wk-rides', one('week', 'rides'));
  dash.draw('pw-lo', oneU('plan_week', 'plan_lo_km', 'plan_lo_mi'));
  dash.draw('pw-hi', oneU('plan_week', 'plan_hi_km', 'plan_hi_mi'));
  dash.draw('pw-done', oneU('plan_week', 'ridden_km', 'ridden_mi', f1));
  dash.draw('streak', one('streak', 'length'));
  dash.draw('streak-start', one('streak', 'start_date', (v) => d3.timeFormat('%b %-d, %Y')(new Date(v + 'T12:00:00'))));
  const daysTo = (e) => { e.textContent = fmt(Math.max(0, Math.ceil((TRIP - new Date()) / 864e5))); };
  dash.draw('days-france', daysTo);
  dash.draw('days-france-2', daysTo);

  dash.draw('rec-long', oneU('records', 'long_km', 'long_mi', f1));
  dash.draw('rec-long-name', one('records', 'long_name', String));
  dash.draw('rec-climb', oneU('records', 'climb_m', 'climb_ft'));
  dash.draw('rec-climb-name', one('records', 'climb_name', String));
  dash.draw('rec-week', oneU('records', 'week_km', 'week_mi'));
  dash.draw('rec-week-of', one('records', 'week_of', (v) => 'Week of ' + dayFmt(asDate(v))));
  dash.draw('rec-month', oneU('records', 'month_km', 'month_mi'));
  dash.draw('rec-month-name', one('records', 'month', (v) => d3.timeFormat('%B %Y')(asDate(v + '-15'))));

  // Tooltip + axis helpers
  const tipShow = (box, tip, x, y, lines) => {
    tip.replaceChildren(...lines);
    tip.hidden = false;
    const bw = box.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(0, x + 12), Math.max(0, bw - tw)) + 'px';
    tip.style.top = Math.max(0, y - 44) + 'px';
  };
  const axisStyle = (sel, domain) => sel.attr('font-size', null).attr('font-family', null)
    .call((a) => (domain ? a.select('.domain').attr('stroke', css('--cds-chart-axis')) : a.select('.domain').remove()))
    .call((a) => a.selectAll('text').attr('fill', css('--color-fg-muted')).style('font-size', '11px').style('font-family', MONO));

  // Goal progress: a bullet bar with an even-pace marker
  const bullet = (box, full) => {
    const g = dash.data('ytd');
    box.replaceChildren();
    if (failed(box, 'ytd') || g.status !== 'ok' || !g.data.length) return;
    const d = g.data[0];
    const w = box.clientWidth || 300, h = full ? 34 : 8, bh = full ? 12 : 6, by = full ? 4 : 1;
    const x = d3.scaleLinear([0, GOAL_KM], [0, w]).clamp(true);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Km ridden against the season goal, with the even-pace mark');
    svg.append('rect').attr('x', 0).attr('y', by).attr('width', w).attr('height', bh).attr('rx', bh / 2).attr('fill', css('--cds-chart-grid'));
    svg.append('rect').attr('x', 0).attr('y', by).attr('width', x(d.km)).attr('height', bh).attr('rx', bh / 2).attr('fill', css('--acc'));
    if (!full) return;
    const px = x(d.pace_km);
    svg.append('line').attr('x1', px).attr('x2', px).attr('y1', by - 3).attr('y2', by + bh + 3).attr('stroke', css('--color-fg')).attr('stroke-width', 2);
    const t = svg.append('text').attr('y', h - 2).attr('fill', css('--color-fg-muted')).style('font-size', '11px').text('Even pace ' + fmt(Math.round(dist(d.pace_km))) + ' ' + distU());
    const tw = t.node().getComputedTextLength();
    t.attr('x', Math.min(Math.max(0, px - tw / 2), w - tw));
  };
  dash.draw('goal-bar', (box) => bullet(box, true));
  dash.draw('mini-goal', (box) => bullet(box, false));

  // Sparklines: last 8 weeks of a weekly field
  const spark = (field) => (box) => {
    const g = dash.data('weekly');
    box.replaceChildren();
    if (g.status !== 'ok' || !g.data.length) return;
    const rows = g.data.slice(-8);
    const w = box.clientWidth || 160, h = 34;
    const x = d3.scaleLinear([0, rows.length - 1], [3, w - 3]);
    const y = d3.scaleLinear([0, d3.max(rows, (d) => d[field]) || 1], [h - 3, 4]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Last 8 weeks');
    const id = 'sp-' + field;
    const grad = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    [[0, .22], [1, 0]].forEach(([o, a]) => grad.append('stop').attr('offset', o).attr('stop-opacity', a).style('stop-color', dash.colors[0]));
    svg.append('path').datum(rows).attr('fill', `url(#${id})`).attr('d', d3.area().x((d, i) => x(i)).y0(h).y1((d) => y(d[field])));
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', dash.colors[0]).attr('stroke-width', 1.5).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', d3.line().x((d, i) => x(i)).y((d) => y(d[field])));
    const l = rows.length - 1;
    svg.append('circle').attr('cx', x(l)).attr('cy', y(rows[l][field])).attr('r', 2.5).attr('fill', dash.colors[0]);
  };
  // Last 4 weeks: a pair of bars per metric, now (accent) over the 4 weeks before (gray), on one scale per row.
  const pairBars = (nowF, prevF) => (box) => {
    const g = dash.data('period');
    box.replaceChildren();
    if (g.status !== 'ok' || !g.data.length) return;
    const r = g.data[0], mx = Math.max(r[nowF], r[prevF]) || 1;
    const a = el('i', 'now'); a.style.width = (r[nowF] / mx * 100) + '%';
    const b = el('i', 'prev'); b.style.width = (r[prevF] / mx * 100) + '%';
    box.append(a, b);
  };
  dash.draw('bar-dist', pairBars('mi_4w', 'mi_prev'));
  dash.draw('bar-elev', pairBars('elev_4w', 'elev_prev'));
  dash.draw('bar-hours', pairBars('hours_4w', 'hours_prev'));
  dash.draw('bar-rides', pairBars('rides_4w', 'rides_prev'));
  dash.draw('p-rides', one('period', 'rides_4w'));
  dash.draw('p-rides-prev', one('period', 'rides_prev'));
  dash.draw('d-rides', delta('rides_delta_pct'));

  // Week plan: strip and session rows
  const planRows = () => { const g = dash.data('plan'); return g.status === 'ok' ? [...g.data].sort((a, b) => a.order - b.order) : null; };
  // Next up: today's planned session if not ridden yet, else the next one this week
  dash.draw('next-up', (box) => {
    const rows = planRows();
    box.replaceChildren();
    if (failed(box, 'plan') || !rows) return;
    const today = d3.timeFormat('%Y-%m-%d')(new Date());
    const r = rows.find((p) => p.date >= today && String(p.status).toLowerCase() !== 'done' && p.intensity !== 'Rest') || rows.find((p) => p.date >= today && String(p.status).toLowerCase() !== 'done');
    if (!r) { box.append(el('span', 'nu-d', 'Nothing left in this week\'s plan. Ask Claude to plan next week.')); return; }
    box.dataset.key = String(r.order);
    box.style.setProperty('--int', css(INT[r.intensity] || '--cds-chart-muted'));
    const when = r.date === today ? 'Today' : d3.timeFormat('%A')(asDate(r.date));
    const left = el('div', 'nu-l');
    left.append(el('span', 'nu-k', 'Next up · ' + when), el('b', 'nu-s', r.session), el('span', 'nu-d', r.details));
    const right = el('div', 'nu-r');
    right.append(el('span', 'nu-i', r.intensity), el('b', null, rangeU(r.target_miles) + ' ' + distU()), el('span', null, 'HR ' + r.target_hr));
    box.append(left, right);
  });

  // Today's recap: once a ride is logged on a plan day, compare it with what was planned.
  const todayStr = () => d3.timeFormat('%Y-%m-%d')(new Date());
  const recapDay = () => {
    const rows = planRows(), g = dash.data('rides');
    if (!rows || g.status !== 'ok') return null;
    const today = todayStr();
    const plan = rows.find((p) => p.date === today);
    const rides = g.data.filter((r) => r.date === today && /Ride/.test(r.sport_type || 'Ride'));
    return plan && rides.length ? { plan, rides, main: d3.greatest(rides, (r) => r.miles) } : null;
  };
  dash.onData(() => {
    const d = recapDay();
    document.querySelectorAll('#recap-card').forEach((c) => { c.hidden = !d; });
    if (d && dash.params().recap_ride !== d.main.id) dash.setParams({ recap_ride: d.main.id });
  });
  // "130–150, cap 153" → {lo:130, hi:150, cap:153}; "under 125" → {hi:125}; "175–183 by end…" → {lo:175, hi:183}
  const hrTarget = (t) => {
    const s = String(t || '');
    const r = s.match(/(\d+)\s*[–-]\s*(\d+)/), u = s.match(/under\s*(\d+)/i), c = s.match(/cap\s*(\d+)/i);
    if (r) return { lo: +r[1], hi: +r[2], cap: c ? +c[1] : null };
    if (u) return { lo: null, hi: +u[1], cap: null };
    return null;
  };
  const verdictOf = (v, lo, hi) => (v == null || (lo == null && hi == null) ? null : lo != null && v < lo ? 'under' : hi != null && v > hi ? 'over' : 'on');
  const VERDICT = { under: ['Under', 'warn'], on: ['On target', 'ok'], over: ['Over', 'bad'] };
  dash.draw('recap-when', (e) => {
    const d = recapDay();
    e.textContent = d ? d.plan.day + ' · ' + d.plan.session + ' · ' + d.plan.intensity : '—';
  });
  dash.draw('recap', (box) => {
    box.replaceChildren();
    const d = recapDay();
    if (!d) return;
    const { plan, rides } = d;
    const hard = /VO2|Threshold/i.test(plan.intensity);
    const det = dash.data('recap_detail');
    const p = det.status === 'ok' ? det.data : null;
    const mi = d3.sum(rides, (r) => r.miles), secs = d3.sum(rides, (r) => r.moving_s), ft = d3.sum(rides, (r) => r.elev_ft);
    const nums = String(plan.target_miles ?? '').split('–').map(Number).filter(Number.isFinite);
    const distV = nums.length ? verdictOf(mi, nums[0] * 0.9, nums[nums.length - 1] * 1.1) : null;
    const hrT = hrTarget(plan.target_hr);
    const hrVal = p && p.has_heartrate ? Math.round(hard ? p.max_heartrate : p.average_heartrate) : null;
    const hrV = hrT ? verdictOf(hrVal, hrT.lo, hrT.cap || hrT.hi) : null;

    const rowsEl = el('div', 'rc-rows');
    const line = (label, planned, actual, v) => {
      const r = el('div', 'rc-row');
      const tag = v ? el('span', 'tag ' + VERDICT[v][1], VERDICT[v][0]) : el('span');
      r.append(el('span', 'rc-l', label), el('span', 'rc-p', planned), el('b', 'rc-a', actual), tag);
      return r;
    };
    rowsEl.append(
      line('Distance', 'Plan ' + rangeU(plan.target_miles) + ' ' + distU(), f1(fromMi(mi)) + ' ' + distU(), distV),
      line(hard ? 'Max HR' : 'Avg HR', 'Plan ' + plan.target_hr, hrVal == null ? (p ? 'No HR' : '…') : hrVal + ' bpm', hrV),
      line('Moving time', '', hm(secs), null),
      line('Climbing', '', fmt(Math.round(elevFt(ft))) + ' ' + elevU(), null),
    );
    box.append(rowsEl);

    // Repeats: any segment ridden more than once today, rep by rep.
    if (p && Array.isArray(p.segment_efforts)) {
      const by = d3.group(p.segment_efforts, (e) => e.segment_id);
      const reps = [...by.values()].filter((v) => v.length > 1).sort((a, b) => b.length - a.length || b[0].distance - a[0].distance)[0];
      if (reps) {
        const times = reps.map((e) => e.elapsed_time), best = d3.min(times), first = times[0];
        const w = el('div', 'rc-reps');
        const planned = String(plan.details || '').match(/(\d+)\s*×/);
        w.append(el('span', 'rc-l', reps.length + ' × ' + String(reps[0].segment_name).trim() + (planned ? ' · plan ' + planned[1] : '')));
        const list = el('div', 'rc-replist');
        reps.forEach((e, i) => {
          const c = el('span', 'rc-rep' + (e.elapsed_time === best ? ' best' : ''));
          c.append(el('b', null, mmss(e.elapsed_time)), el('small', null, e.avg_hr ? Math.round(e.avg_hr) + ' bpm' : 'rep ' + (i + 1)));
          list.append(c);
        });
        w.append(list);
        const fade = times.filter((t) => t - first >= 15).length;
        if (/stop if a rep is 15\+ s slower/i.test(plan.details || '')) w.append(el('span', 'rc-note', fade ? fade + ' rep' + (fade > 1 ? 's were' : ' was') + ' 15+ s slower than the first.' : 'No rep faded 15+ s from the first.'));
        box.append(w);
      }
    }

    // One-line summary
    const bits = [];
    if (distV === 'under') bits.push('shorter than planned'); else if (distV === 'over') bits.push('longer than planned'); else if (distV === 'on') bits.push('distance on plan');
    if (hrV === 'under') bits.push(hard ? 'heart rate didn\'t reach the target zone, so push harder next time' : 'easier than planned');
    else if (hrV === 'over') bits.push(hard ? 'heart rate above the target' : 'heart rate above the cap, so ease off next time');
    else if (hrV === 'on') bits.push('heart rate on target');
    if (bits.length) { const s = bits.join(', '); box.append(el('p', 'rc-sum', s[0].toUpperCase() + s.slice(1) + '.')); }
  });

  dash.draw('plan-strip', (box) => {
    const rows = planRows();
    const pa = dash.data('plan_actual');
    const act = new Map(pa.status === 'ok' ? pa.data.map((d) => [d.order, d]) : []);
    const today = d3.timeFormat('%Y-%m-%d')(new Date());
    box.replaceChildren();
    if (failed(box, 'plan') || !rows) return;
    box.append(...rows.map((r) => {
      const a = act.get(r.order);
      const actual = el('span', 'day-a');
      if (a && a.rides) { actual.classList.add('rode'); actual.textContent = 'Rode ' + f1(isImp() ? a.ridden_mi : a.ridden_km) + ' ' + distU(); }
      else if (r.date < today) actual.textContent = r.intensity === 'Rest' ? 'Rested' : 'No ride';
      else if (r.date === today) actual.textContent = 'Today';
      const done = String(r.status).toLowerCase() === 'done';
      const c = el('div', 'day' + (done ? ' done' : ''));
      c.dataset.key = String(r.order);
      c.style.setProperty('--int', css(INT[r.intensity] || '--cds-chart-muted'));
      const top = el('div', 'day-top');
      top.append(el('span', 'day-d', r.day + ' · ' + dayFmt(asDate(r.date))));
      if (done) top.append(el('span', 'tick', '✓'));
      c.append(top, el('span', 'day-s', r.session), el('span', 'day-i', r.intensity));
      if (done && r.actual_short) c.append(el('span', 'day-did', 'Did: ' + r.actual_short));
      c.append(el('span', 'day-m', 'Plan ' + rangeU(r.target_miles) + ' ' + distU() + ' · ' + r.target_hr), actual);
      return c;
    }));
  });
  dash.draw('plan-sessions', (box) => {
    const rows = planRows();
    box.replaceChildren();
    if (failed(box, 'plan') || !rows) return;
    box.append(...rows.map((r) => {
      const done = String(r.status).toLowerCase() === 'done';
      const c = el('div', 'session');
      c.dataset.key = String(r.order);
      c.style.setProperty('--int', css(INT[r.intensity] || '--cds-chart-muted'));
      const mid = el('div');
      mid.append(el('span', 'day-d', r.day + ' · ' + dayFmt(asDate(r.date)) + ' · ' + r.intensity), el('h3', null, r.session));
      if (done && r.actual) mid.append(el('p', 'did', 'Did: ' + r.actual), el('p', 'was', 'Planned: ' + r.details));
      else mid.append(el('p', null, r.details));
      const right = el('div', 'session-r');
      right.append(el('b', null, rangeU(r.target_miles) + ' ' + distU()), el('span', null, 'HR ' + r.target_hr), el('span', 'tag ' + (done ? 'ok' : ''), r.status));
      c.append(el('div', 'session-bar'), mid, right);
      return c;
    }));
  });

  // Table helper
  const rowsDraw = (id, spec) => (tbody) => {
    const g = dash.data(id);
    headersU();
    if (g.status !== 'ok') { tbody.replaceChildren(); return; }
    const cols = typeof spec.cols === 'function' ? spec.cols() : spec.cols;
    tbody.replaceChildren(...spec.list(g.data).map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = String(r[spec.key]);
      for (const c of cols) {
        const td = el('td', c.cls);
        if (c.node) td.append(c.node(r[c.f], r));
        else td.textContent = c.fmt ? c.fmt(r[c.f], r) : (r[c.f] ?? '');
        tr.append(td);
      }
      return tr;
    }));
  };
  const medalNode = (m) => (m == null ? document.createTextNode('') : el('span', 'medal m' + m, String(m)));

  dash.draw('zone-rows', rowsDraw('zones', { key: 'zone', list: (d) => d, cols: [{ f: 'zone', cls: 'strong' }, { f: 'name' }, { f: 'bpm', cls: 'num' }, { f: 'use', cls: 'wide-only muted' }] }));
  dash.draw('roadmap-rows', rowsDraw('roadmap', { key: 'order', list: (d) => [...d].sort((a, b) => a.order - b.order), cols: [{ f: 'phase', cls: 'strong' }, { f: 'months' }, { f: 'focus' }, { f: 'milestone', cls: 'muted' }] }));

  // Ride log: sort and search
  const rideState = { key: 'date', dir: -1, q: '' };
  dash.draw('ride-rows', rowsDraw('ride_log', {
    key: 'id',
    list: (d) => {
      const q = rideState.q.trim().toLowerCase();
      const k = rideState.key;
      return d.filter((r) => !q || (String(r.name) + ' ' + (r.weather || '') + ' ' + r.date).toLowerCase().includes(q))
        .sort((a, b) => {
          const x = a[k], y = b[k];
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * rideState.dir;
        });
    },
    cols: () => [
      { f: 'date', cls: 'muted', fmt: (v) => dayFmt(asDate(v)) },
      { f: 'name', cls: 'strong' },
      { f: isImp() ? 'miles' : 'km', cls: 'num', fmt: f1 },
      { f: 'moving_s', cls: 'num', fmt: hm },
      { f: isImp() ? 'elev_ft' : 'elev_m', cls: 'num wide-only', fmt: (v) => fmt(Math.round(v)) },
      { f: isImp() ? 'mph' : 'kmh', cls: 'num wide-only', fmt: (v) => (v == null ? '' : f1(v)) },
      { f: 'relative_effort', cls: 'num', fmt: (v) => (v == null ? '' : fmt(v)) },
      { f: 'weather', cls: 'wide-only muted', fmt: (v) => v ?? '' },
    ],
  }));
  document.querySelectorAll('.search').forEach((inp) => inp.addEventListener('input', () => { rideState.q = inp.value; dash.draw('ride-rows'); }));
  document.querySelectorAll('.sort').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sort;
    rideState.dir = rideState.key === k ? -rideState.dir : (k === 'name' || k === 'weather' ? 1 : -1);
    rideState.key = k;
    document.querySelectorAll('.sort').forEach((o) => {
      const th = o.closest('th');
      if (!th) return;
      if (o.dataset.sort === k) th.setAttribute('aria-sort', rideState.dir > 0 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    dash.draw('ride-rows');
  }));

  dash.draw('pr-rows', rowsDraw('prs', {
    key: 'effort_id',
    list: (d) => d.slice(0, 30),
    cols: () => [
      { f: 'medal', node: medalNode },
      { f: 'segment', cls: 'strong' },
      { f: 'date', cls: 'muted', fmt: (v) => dayFmt(asDate(v)) },
      { f: 'time_s', cls: 'num', fmt: mmss },
      { f: isImp() ? 'miles' : 'km', cls: 'num wide-only', fmt: d3.format('.2f') },
      { f: 'avg_hr', cls: 'num wide-only', fmt: (v) => (v == null ? '' : fmt(Math.round(v))) },
    ],
  }));
  dash.draw('hascall-rows', rowsDraw('hascall', {
    key: 'effort_id',
    list: (d) => d,
    cols: [
      { f: 'date', cls: 'muted', fmt: (v) => dayFmt(asDate(v)) },
      { f: 'time_s', cls: 'num strong', fmt: mmss },
      { f: 'avg_hr', cls: 'num', fmt: (v) => (v == null ? '' : fmt(Math.round(v))) },
      { f: 'medal', node: medalNode },
    ],
  }));
  dash.draw('most-rows', rowsDraw('seg_counts', {
    key: 'segment_id',
    list: (d) => d,
    cols: () => [{ f: 'segment', cls: 'strong' }, { f: 'efforts', cls: 'num' }, { f: 'best_s', cls: 'num', fmt: mmss }, { f: isImp() ? 'miles' : 'km', cls: 'num wide-only', fmt: d3.format('.2f') }],
  }));

  // Crowns table with an in-cell bar for 90-day efforts
  dash.draw('legend-rows', (tbody) => {
    const g = dash.data('crowns');
    headersU();
    if (g.status !== 'ok') { tbody.replaceChildren(); return; }
    const max = d3.max(g.data, (r) => r.ll_efforts_90d) || 1;
    tbody.replaceChildren(...[...g.data].sort((a, b) => a.order - b.order).map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = String(r.order);
      const t = el('td'); t.append(el('span', 'badge' + (r.title === 'Top 10' ? ' t10' : ''), r.title));
      const e = el('td', 'num');
      if (r.ll_efforts_90d != null) {
        const wrap = el('div', 'inbar');
        const bar = el('i', r.ll_efforts_90d <= 1 ? 'risk' : '');
        bar.style.width = Math.round(48 * r.ll_efforts_90d / max) + 'px';
        wrap.append(bar, el('span', null, fmt(r.ll_efforts_90d)));
        e.append(wrap);
      }
      tr.append(t, el('td', 'strong', r.segment), e, el('td', 'num', r.pr ?? ''), el('td', 'num wide-only', d3.format('.2f')(isImp() ? r.miles : r.km)), el('td', 'num wide-only', fmt(isImp() ? r.climb_ft : r.climb_m)));
      return tr;
    }));
  });

  // Crowns at risk: horizontal bars of 90-day efforts per Local Legend
  dash.draw('legend-chart', (box) => {
    const g = dash.data('legends');
    box.replaceChildren();
    if (failed(box, 'legends') || g.status !== 'ok') return;
    const rows = g.data.filter((r) => r.ll_efforts_90d != null).sort((a, b) => d3.descending(a.ll_efforts_90d, b.ll_efforts_90d));
    if (!rows.length) return;
    const w = box.clientWidth || 360, bh = 16, gap = 10, h = rows.length * (bh + gap) + 4;
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', '90-day efforts on each Local Legend segment');
    const short = (s) => (s.length > 22 ? s.slice(0, 21) + '…' : s);
    const probe = svg.append('g').selectAll('text').data(rows).join('text').style('font-size', '12px').text((d) => short(d.segment));
    const lw = Math.min(w * 0.5, (d3.max(probe.nodes(), (n) => n.getComputedTextLength()) || 80) + 10);
    probe.remove();
    const x = d3.scaleLinear([0, d3.max(rows, (d) => d.ll_efforts_90d)], [0, w - lw - 30]);
    const row = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * (bh + gap) + 2})`);
    row.append('text').attr('x', lw - 10).attr('y', bh / 2 + 4).attr('text-anchor', 'end').attr('fill', css('--color-fg')).style('font-size', '12px').text((d) => short(d.segment));
    row.append('rect').attr('x', lw).attr('y', 0).attr('height', bh).attr('rx', 3).attr('width', (d) => Math.max(2, x(d.ll_efforts_90d)))
      .attr('fill', (d) => (d.ll_efforts_90d <= 1 ? css('--cds-chart-status-critical') : dash.colors[0]));
    row.append('text').attr('x', (d) => lw + Math.max(2, x(d.ll_efforts_90d)) + 6).attr('y', bh / 2 + 4).attr('fill', css('--color-fg-muted'))
      .style('font-size', '11px').style('font-family', MONO).text((d) => d.ll_efforts_90d);
  });

  // Hascall trend: time per effort, oldest to newest
  // Hascall summary and scatter
  dash.draw('hc-n', one('hascall_sum', 'efforts'));
  dash.draw('hc-best', one('hascall_sum', 'best_s', mmss));
  dash.draw('hc-recent', one('hascall_sum', 'recent_avg_s', mmss));
  dash.draw('hc-trend', (e) => {
    one('hascall_sum', 'trend_s', (v) => (v < 0 ? '−' : v > 0 ? '+' : '±') + Math.abs(v) + ' s')(e);
    const g = dash.data('hascall_sum');
    const v = g.status === 'ok' && g.data.length ? g.data[0].trend_s : null;
    e.classList.toggle('good', v != null && v < 0);
    e.classList.toggle('worse', v != null && v > 0);
  });
  dash.draw('hascall-scatter', (box) => {
    const g = dash.data('hascall');
    box.replaceChildren();
    if (failed(box, 'hascall') || g.status !== 'ok') return;
    const pts = g.data.filter((d) => d.avg_hr != null);
    if (pts.length < 2) return;
    const w = box.clientWidth || 400, h = 124, m = { t: 10, r: 12, b: 24, l: 44 };
    const x = d3.scaleLinear(d3.extent(pts, (d) => d.avg_hr), [m.l, w - m.r]).nice();
    const ext = d3.extent(pts, (d) => d.time_s), pad = Math.max(5, (ext[1] - ext[0]) * 0.15);
    const y = d3.scaleLinear([ext[0] - pad, ext[1] + pad], [h - m.b, m.t]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Full Hascall Hill time against average heart rate');
    svg.append('g').selectAll('line').data(y.ticks(3)).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y).attr('y2', y).attr('stroke', css('--cds-chart-grid'));
    svg.append('g').attr('transform', `translate(${m.l - 6},0)`).call(d3.axisLeft(y).ticks(3).tickSize(0).tickFormat(mmss)).call((a) => axisStyle(a, false));
    svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(8).tickFormat((v) => v + ' bpm')).call((a) => axisStyle(a, true));
    const newest = pts[0].effort_id;
    const age = d3.scaleLinear([pts.length - 1, 0], [0.25, 1]);
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    svg.append('g').selectAll('circle').data([...pts].reverse()).join('circle').attr('cx', (d) => x(d.avg_hr)).attr('cy', (d) => y(d.time_s))
      .attr('r', (d) => (d.effort_id === newest ? 6 : 4.5)).attr('fill', css('--acc')).attr('fill-opacity', (d) => age(pts.indexOf(d)))
      .attr('stroke', (d) => (d.effort_id === newest ? css('--color-fg') : 'none')).attr('stroke-width', 1.5)
      .on('pointermove', (ev, d) => { const [px, py] = d3.pointer(ev, box); tipShow(box, tip, px, py, [el('div', 'k', dayFmt(asDate(d.date)) + (d.effort_id === newest ? ' · newest' : '')), el('div', null, mmss(d.time_s) + ' at ' + Math.round(d.avg_hr) + ' bpm')]); })
      .on('pointerleave', () => { tip.hidden = true; });
  });

  // Local Legend upkeep
  dash.draw('ll-rows', rowsDraw('ll_status', {
    key: 'order',
    list: (d) => d,
    cols: [
      { f: 'segment', cls: 'strong' },
      { f: 'efforts_90d', cls: 'num', node: (v) => el('span', 'badge ' + (v <= 1 ? 'risk' : 't10'), String(v)) },
      { f: 'last_date', cls: 'muted', fmt: (v) => (v ? dayFmt(asDate(v)) : 'Not in last 30 rides') },
      { f: 'days_since', cls: 'num', fmt: (v) => (v == null ? '' : fmt(v)) },
      { f: 'next_expiry', fmt: (v) => (v ? d3.timeFormat('%a %b %-d')(asDate(v)) : '') },
    ],
  }));

  dash.draw('hascall-chart', (box) => {
    const g = dash.data('hascall');
    box.replaceChildren();
    if (failed(box, 'hascall') || g.status !== 'ok' || g.data.length < 2) return;
    const pts = [...g.data].reverse();
    const w = box.clientWidth || 400, h = 124, m = { t: 12, r: 12, b: 22, l: 44 };
    const x = d3.scalePoint(pts.map((d) => d.effort_id), [m.l, w - m.r]).padding(0.3);
    const ext = d3.extent(pts, (d) => d.time_s);
    const pad = Math.max(5, (ext[1] - ext[0]) * 0.2);
    const y = d3.scaleLinear([ext[0] - pad, ext[1] + pad], [h - m.b, m.t]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Full Hascall Hill time per effort');
    svg.append('g').selectAll('line').data(y.ticks(3)).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y).attr('y2', y).attr('stroke', css('--cds-chart-grid'));
    svg.append('g').attr('transform', `translate(${m.l - 6},0)`).call(d3.axisLeft(y).ticks(3).tickSize(0).tickFormat(mmss)).call((a) => axisStyle(a, false));
    const every = Math.ceil(pts.length / Math.max(1, Math.floor((w - m.l) / 52)));
    svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8)
      .tickValues(pts.filter((_, i) => i % every === 0).map((d) => d.effort_id)).tickFormat((id) => dayFmt(asDate(pts.find((p) => p.effort_id === id).date)))).call((a) => axisStyle(a, true));
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', dash.colors[0]).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', d3.line().x((d) => x(d.effort_id)).y((d) => y(d.time_s)));
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', (d) => x(d.effort_id)).attr('cy', (d) => y(d.time_s)).attr('r', 4)
      .attr('fill', (d) => (d.medal === 1 ? css('--cds-chart-status-warning') : css('--color-panel'))).attr('stroke', dash.colors[0]).attr('stroke-width', 2)
      .on('pointermove', (ev, d) => {
        const [px, py] = d3.pointer(ev, box);
        tipShow(box, tip, px, py, [el('div', 'k', dayFmt(asDate(d.date))), el('div', null, mmss(d.time_s) + (d.avg_hr ? ' · ' + Math.round(d.avg_hr) + ' bpm' : ''))]);
      })
      .on('pointerleave', () => { tip.hidden = true; });
  });

  dash.draw('todo-list', (ul) => {
    const g = dash.data('todo');
    if (g.status !== 'ok') { ul.replaceChildren(); return; }
    ul.replaceChildren(...[...g.data].sort((a, b) => a.order - b.order).map((r) => {
      const li = el('li');
      li.dataset.key = String(r.order);
      const t = el('div');
      t.append(el('b', null, r.item), el('span', null, r.detail));
      li.append(t, el('em', null, r.cost));
      return li;
    }));
  });

  // Recent rides strip
  const isRain = (w) => /rain|drizzle|storm|shower/i.test(w || '');
  dash.draw('ride-strip', (box) => {
    const g = dash.data('rides');
    box.replaceChildren();
    if (failed(box, 'rides') || g.status !== 'ok') return;
    box.append(...[...g.data].sort((a, b) => d3.descending(a.date, b.date)).slice(0, 14).map((r) => {
      const c = el('div', 'rcard');
      c.dataset.key = r.id;
      c.dataset.q = r.date;
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.setAttribute('aria-label', r.name + ', ' + r.date + ': show ride detail');
      const top = el('div', 'rc-top');
      top.append(el('span', null, d3.timeFormat('%a %b %-d')(asDate(r.date))), el('span', 'rc-w' + (isRain(r.weather) ? ' rain' : ''), r.weather || ''));
      const st = el('div', 'rc-st');
      st.append(el('span', null, f1(fromMi(r.miles)) + ' ' + distU()), el('span', null, hm(r.moving_s)), el('span', null, fmt(Math.round(elevFt(r.elev_ft))) + ' ' + elevU()));
      c.append(top, el('b', 'rc-n', r.name), st);
      if (r.relative_effort != null) {
        const e = el('div', 'rc-e');
        const bar = el('i');
        bar.style.width = Math.min(100, r.relative_effort / 2) + '%';
        e.append(bar, el('span', null, 'Effort ' + r.relative_effort));
        c.append(e);
      }
      return c;
    }));
  });

  // Form chips: hit or miss the weekly target, last 8 full weeks
  dash.draw('form-chips', (box) => {
    const g = dash.data('form');
    box.replaceChildren();
    if (failed(box, 'form') || g.status !== 'ok') return;
    box.append(...g.data.map((r) => {
      const c = el('div', 'fchip ' + (r.hit ? 'hit' : 'miss'));
      c.dataset.key = r.week_of;
      c.append(el('b', null, r.hit ? 'H' : 'M'), el('span', null, dayFmt(asDate(r.week_of))), el('em', null, fmt(Math.round(dist(r.km))) + ' ' + distU()));
      return c;
    }));
  });
  dash.draw('form-hits', one('form_sum', 'hits'));
  dash.draw('week-target', (e) => { e.textContent = fmt(Math.round(dist(WEEK_KM))); });

  // Garage
  dash.draw('garage-rows', rowsDraw('garage', {
    key: 'gear_id',
    list: (d) => d,
    cols: () => [
      { f: 'name', cls: 'strong' },
      { f: 'frame_type', cls: 'muted' },
      { f: isImp() ? 'miles' : 'km', cls: 'num', fmt: (v) => fmt(v) },
      { f: 'share_pct', cls: 'num', node: (v) => { const w = el('div', 'inbar'); const b = el('i'); b.style.width = Math.round(0.6 * v) + 'px'; w.append(b, el('span', null, v + '%')); return w; } },
      { f: 'status', node: (v) => el('span', 'tag ' + (v === 'Active' ? 'ok' : ''), v) },
    ],
  }));

  // Charts
  dash.draw('cum-chart', (box) => {
    const g = dash.data('cumulative');
    box.replaceChildren();
    if (failed(box, 'cumulative') || g.status !== 'ok' || !g.data.length) return;
    const w = box.clientWidth || 600, h = 240, m = { t: 12, r: 64, b: 24, l: 40 };
    const GOAL = dist(GOAL_KM), U = distU();
    const pts = g.data.map((d) => ({ date: asDate(d.date), km: Math.round(dist(d.km_total)) }));
    const x = d3.scaleTime([new Date(2026, 0, 1), new Date(2026, 11, 31)], [m.l, w - m.r]);
    const y = d3.scaleLinear([0, Math.max(GOAL, d3.max(pts, (d) => d.km))], [h - m.b, m.t]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Running total of distance in 2026 against even pace to the goal');
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y).attr('y2', y).attr('stroke', css('--cds-chart-grid'));
    svg.append('g').attr('transform', `translate(${m.l - 6},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickFormat(d3.format('~s'))).call((a) => axisStyle(a, false));
    svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(w < 500 ? 4 : 6).tickSize(0).tickPadding(8).tickFormat(d3.timeFormat('%b'))).call((a) => axisStyle(a, true));
    svg.append('line').attr('x1', x(new Date(2026, 0, 1))).attr('y1', y(0)).attr('x2', x(new Date(2026, 11, 31))).attr('y2', y(GOAL))
      .attr('stroke', css('--cds-chart-reference')).attr('stroke-dasharray', '4 4');
    svg.append('text').attr('x', w - m.r + 6).attr('y', y(GOAL) + 4).attr('fill', css('--color-fg-muted')).style('font-size', '11px').style('font-family', MONO).text(fmt(Math.round(GOAL)));
    const prev = dash.data('cumulative_2025');
    if (prev.status === 'ok' && prev.data.length) {
      const pp = prev.data.map((d) => ({ date: asDate(d.date), km: Math.round(dist(d.km_total)) }));
      svg.append('path').datum(pp).attr('fill', 'none').attr('stroke', css('--cds-chart-muted')).attr('stroke-width', 1.5).attr('stroke-linejoin', 'round')
        .attr('d', d3.line().x((d) => x(d.date)).y((d) => y(d.km)));
      const pl = pp[pp.length - 1];
      svg.append('text').attr('x', x(pl.date)).attr('y', y(pl.km) + 16).attr('text-anchor', 'end').attr('fill', css('--color-fg-muted')).style('font-size', '11px').style('font-family', MONO).text('2025 ' + fmt(pl.km));
    }
    const grad = svg.append('defs').append('linearGradient').attr('id', 'cum-g').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    [[0, .26], [.25, .16], [.5, .08], [.75, .03], [1, 0]].forEach(([o, a]) => grad.append('stop').attr('offset', o).attr('stop-opacity', a).style('stop-color', dash.colors[0]));
    svg.append('path').datum(pts).attr('fill', 'url(#cum-g)').attr('d', d3.area().x((d) => x(d.date)).y0(y(0)).y1((d) => y(d.km)));
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', dash.colors[0]).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', d3.line().x((d) => x(d.date)).y((d) => y(d.km)));
    const last = pts[pts.length - 1];
    svg.append('circle').attr('cx', x(last.date)).attr('cy', y(last.km)).attr('r', 4).attr('fill', dash.colors[0]);
    const lbl = svg.append('text').attr('x', x(last.date) + 8).attr('y', y(last.km) + 4).attr('fill', css('--color-fg')).style('font-size', '12px').style('font-family', MONO).text(fmt(last.km) + ' ' + U);
    if (Math.abs(y(last.km) - y(GOAL)) < 14) lbl.attr('y', y(last.km) + 18);
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    const dot = svg.append('circle').attr('r', 4).attr('fill', dash.colors[0]).attr('visibility', 'hidden');
    const rule = svg.append('line').attr('y1', m.t).attr('y2', h - m.b).attr('stroke', css('--cds-chart-axis')).attr('visibility', 'hidden');
    const bis = d3.bisector((d) => d.date).center;
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [px, py] = d3.pointer(ev);
        const d = pts[bis(pts, x.invert(px))];
        dot.attr('cx', x(d.date)).attr('cy', y(d.km)).attr('visibility', 'visible');
        rule.attr('x1', x(d.date)).attr('x2', x(d.date)).attr('visibility', 'visible');
        const k = box.clientWidth / w;
        tipShow(box, tip, x(d.date) * k, py * k, [el('div', 'k', dayFmt(d.date)), el('div', null, fmt(d.km) + ' ' + U + ' so far')]);
      })
      .on('pointerleave', () => { tip.hidden = true; dot.attr('visibility', 'hidden'); rule.attr('visibility', 'hidden'); });
  });

  const barChart = (box, data, opt) => {
    const w = box.clientWidth || 600, h = opt.h || 240, m = { t: 16, r: 8, b: 24, l: 40 };
    const x = d3.scaleBand(data.map(opt.key), [m.l, w - m.r]).padding(0.3);
    const y = d3.scaleLinear([0, Math.max(d3.max(data, opt.val) || 1, opt.ref || 0)], [h - m.b, m.t]).nice();
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', opt.label);
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y).attr('y2', y).attr('stroke', css('--cds-chart-grid'));
    svg.append('g').attr('transform', `translate(${m.l - 6},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickFormat(d3.format('~s'))).call((a) => axisStyle(a, false));
    const every = Math.ceil(data.length / Math.max(1, Math.floor((w - m.l) / 48)));
    svg.append('g').attr('transform', `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickValues(data.map(opt.key).filter((_, i) => i % every === 0)).tickFormat(opt.tick)).call((a) => axisStyle(a, true));
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    const base = (d, i) => (opt.hi && opt.hi(d, i) ? 1 : 0.55);
    svg.append('g').selectAll('rect').data(data).join('rect')
      .attr('x', (d) => x(opt.key(d)) + Math.max(0, (x.bandwidth() - 28) / 2)).attr('width', Math.min(28, x.bandwidth()))
      .attr('y', (d) => y(opt.val(d))).attr('height', (d) => y(0) - y(opt.val(d))).attr('rx', 3)
      .attr('fill', opt.color || dash.colors[0]).attr('fill-opacity', base)
      .on('pointermove', (ev, d) => {
        const [, py] = d3.pointer(ev, box);
        d3.select(ev.currentTarget).attr('fill-opacity', 1);
        tipShow(box, tip, (x(opt.key(d)) + x.bandwidth()) * box.clientWidth / w, py, opt.tipLines(d));
      })
      .on('pointerleave', (ev, d) => { d3.select(ev.currentTarget).attr('fill-opacity', base(d)); tip.hidden = true; });
    if (opt.ref) {
      svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(opt.ref)).attr('y2', y(opt.ref)).attr('stroke', css('--cds-chart-reference')).attr('stroke-dasharray', '4 4').attr('pointer-events', 'none');
      svg.append('text').attr('x', w - m.r).attr('y', y(opt.ref) - 5).attr('text-anchor', 'end').attr('fill', css('--color-fg-muted')).attr('stroke', css('--color-panel')).attr('stroke-width', 4).attr('paint-order', 'stroke').attr('pointer-events', 'none').style('font-size', '11px').text(opt.refLabel);
    }
  };

  dash.draw('weekly-chart', (box) => {
    const g = dash.data('weekly'), t = dash.data('ytd');
    box.replaceChildren();
    if (failed(box, 'weekly') || g.status !== 'ok' || !g.data.length) return;
    const need = Math.round(dist(t.status === 'ok' && t.data.length ? t.data[0].km_per_week : 0));
    const last = g.data[g.data.length - 1].week_of;
    const U = distU();
    barChart(box, g.data, {
      key: (d) => d.week_of, val: (d) => dist(d.km), label: 'Distance per week, last 16 weeks',
      tick: (v) => dayFmt(asDate(v)), hi: (d) => d.week_of === last,
      ref: need, refLabel: 'Need ' + fmt(need) + ' ' + U + '/wk',
      tipLines: (d) => [el('div', 'k', 'Week of ' + dayFmt(asDate(d.week_of))), el('div', null, fmt(Math.round(dist(d.km))) + ' ' + U + ' · ' + d.rides + (d.rides === 1 ? ' ride' : ' rides'))],
    });
  });

  dash.draw('effort-chart', (box) => {
    const g = dash.data('weekly');
    box.replaceChildren();
    if (failed(box, 'weekly') || g.status !== 'ok' || !g.data.length) return;
    const last = g.data[g.data.length - 1].week_of;
    const avg = Math.round(d3.mean(g.data.slice(-5, -1), (d) => d.effort) || 0);
    barChart(box, g.data, {
      h: 180, key: (d) => d.week_of, val: (d) => d.effort, label: 'Relative Effort per week, last 16 weeks',
      tick: (v) => dayFmt(asDate(v)), hi: (d) => d.week_of === last, color: dash.colors[1],
      ref: avg, refLabel: '4-wk avg ' + fmt(avg),
      tipLines: (d) => [el('div', 'k', 'Week of ' + dayFmt(asDate(d.week_of))), el('div', null, fmt(d.effort) + ' effort · ' + f1(d.hours) + ' h')],
    });
  });

  // Eddington
  dash.draw('ed-e', oneU('eddington', 'e_km', 'e_mi'));
  dash.draw('ed-next', oneU('eddington', 'next_km', 'next_mi'));
  dash.draw('ed-days', one('eddington', 'ride_days'));
  dash.draw('ed-run', one('eddington', 'longest_run'));
  // The ladder: how many more days of each distance the next levels need.
  dash.draw('ed-ladder', (box) => {
    const g = dash.data('eddington');
    box.replaceChildren();
    if (failed(box, 'eddington') || g.status !== 'ok' || !g.data.length) return;
    const rows = isImp() ? g.data[0].ladder_mi : g.data[0].ladder_km;
    box.append(...rows.map((r) => {
      const row = el('div', 'ed-step');
      const bar = el('i');
      bar.style.width = Math.min(100, (r.have / r.level) * 100) + '%';
      const track = el('span', 'ed-track');
      track.append(bar);
      row.append(el('b', 'ed-lvl', String(r.level)), el('span', 'ed-need', fmt(r.need) + ' more ' + (r.need === 1 ? 'day' : 'days') + ' of ' + r.level + '+ ' + distU()), track, el('span', 'ed-have', r.have + ' / ' + r.level));
      return row;
    }));
  });

  // Month goal
  dash.draw('mg-month', one('month_goal', 'month', String));
  dash.draw('mg-done', oneU('month_goal', 'km', 'mi'));
  dash.draw('mg-target', oneU('month_goal', 'target_km', 'target_mi'));
  dash.draw('mg-pct', (e) => {
    one('month_goal', 'pct', (v) => v + '%')(e);
    const g = dash.data('month_goal');
    const r = g.status === 'ok' && g.data.length ? g.data[0] : null;
    e.classList.toggle('up', !!r && r.km >= r.pace_km);
    e.classList.toggle('down', !!r && r.km < r.pace_km);
  });
  dash.draw('mg-bar', (box) => {
    const g = dash.data('month_goal');
    box.replaceChildren();
    if (failed(box, 'month_goal') || g.status !== 'ok' || !g.data.length) return;
    const d = g.data[0];
    const w = box.clientWidth || 300, h = 30, bh = 10, by = 4;
    const x = d3.scaleLinear([0, Math.max(d.target_km, d.km)], [0, w]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'This month against the monthly share of the goal');
    svg.append('rect').attr('y', by).attr('width', x(d.target_km)).attr('height', bh).attr('rx', bh / 2).attr('fill', css('--cds-chart-grid'));
    svg.append('rect').attr('y', by).attr('width', x(d.km)).attr('height', bh).attr('rx', bh / 2).attr('fill', css('--acc'));
    const px = x(d.pace_km);
    svg.append('line').attr('x1', px).attr('x2', px).attr('y1', by - 3).attr('y2', by + bh + 3).attr('stroke', css('--color-fg')).attr('stroke-width', 2);
    const t = svg.append('text').attr('y', h - 1).attr('fill', css('--color-fg-muted')).style('font-size', '11px').text('Even pace today ' + fmt(Math.round(dist(d.pace_km))) + ' ' + distU());
    const tw = t.node().getComputedTextLength();
    t.attr('x', Math.min(Math.max(0, px - tw / 2), w - tw));
  });

  // 2026 bests vs 2025
  const bestFmt = (kind, v) => (v == null ? '—' : kind === 'time' ? (v >= 3600 ? Math.floor(v / 3600) + ':' + String(Math.floor(v % 3600 / 60)).padStart(2, '0') + ':' + String(Math.round(v % 60)).padStart(2, '0') : mmss(v))
    : kind === 'distance' ? f1(dist(v / 1000)) + ' ' + distU() : fmt(Math.round(elevM(v))) + ' ' + elevU());
  dash.draw('bests-rows', rowsDraw('bests_cmp', {
    key: 'order',
    list: (d) => d,
    cols: () => [
      { f: 'effort', cls: 'strong' },
      { f: 'v2026', cls: 'num', node: (v, r) => el('span', r.better ? 'good' : '', bestFmt(r.kind, v)) },
      { f: 'd2026', cls: 'wide-only muted', fmt: (v) => (v ? d3.timeFormat('%b %-d')(asDate(v)) : '') },
      { f: 'v2025', cls: 'num muted', fmt: (v, r) => bestFmt(r.kind, v) },
      { f: 'change_pct', cls: 'num', node: (v, r) => el('span', 'delta' + (r.better === true ? ' up' : r.better === false ? ' down' : ''), v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%') },
    ],
  }));

  // Month report
  dash.draw('mr-month', one('month_report', 'month', String));
  dash.draw('mr-prev', one('month_report', 'prev_month', String));
  dash.draw('mr-day', one('month_report', 'day'));
  dash.draw('mr-tiles', (box) => {
    const g = dash.data('month_report');
    box.replaceChildren();
    if (failed(box, 'month_report') || g.status !== 'ok') return;
    const nf = (v, u) => (u === 'h' ? f1(v) : fmt(Math.round(v)));
    const conv = (r) => (r.unit === 'km' ? { ...r, now: dist(r.now), before: dist(r.before), unit: distU() } : r.unit === 'ft' ? { ...r, now: elevFt(r.now), before: elevFt(r.before), unit: elevU() } : r);
    box.append(...g.data.map(conv).map((r) => {
      const t = el('div', 'mr');
      t.dataset.key = r.metric;
      const head = el('div', 'kpi-h');
      const d = el('span', 'delta' + (r.change_pct > 0 ? ' up' : r.change_pct < 0 ? ' down' : ''), r.change_pct == null ? '—' : (r.change_pct > 0 ? '+' : r.change_pct < 0 ? '−' : '') + Math.abs(r.change_pct) + '%');
      head.append(el('span', null, r.metric), d);
      const v = el('div', 'kpi-v', nf(r.now, r.unit));
      if (r.unit) v.append(el('small', null, r.unit));
      const bar = el('div', 'mr-bar');
      const mx = Math.max(r.now, r.before) || 1;
      const a = el('i'); a.style.width = (r.now / mx * 100) + '%';
      const b = el('i', 'prev'); b.style.width = (r.before / mx * 100) + '%';
      bar.append(a, b);
      t.append(head, v, bar, el('div', 'kpi-s', 'Last month ' + nf(r.before, r.unit) + (r.unit ? ' ' + r.unit : '')));
      return t;
    }));
  });

  // Ride detail
  dash.draw('rd-head', (box) => {
    const g = dash.data('ride_log');
    box.replaceChildren();
    if (failed(box, 'ride_log') || g.status !== 'ok') return;
    const id = dash.params().ride;
    const r = g.data.find((x) => x.id === id) || d3.greatest(g.data, (x) => x.date);
    if (!r) return;
    box.dataset.key = r.id;
    const t = el('div', 'rd-title');
    t.append(el('b', null, r.name), el('span', null, d3.timeFormat('%A, %B %-d')(asDate(r.date)) + (r.weather ? ' · ' + r.weather : '')));
    const stats = el('div', 'rd-stats');
    const stat = (label, v, u) => { const s = el('div'); s.append(el('span', null, label), el('b', null, v + (u ? ' ' + u : ''))); return s; };
    stats.append(
      stat('Distance', f1(isImp() ? r.miles : r.km), distU()),
      stat('Moving', hm(r.moving_s)),
      stat('Climbing', fmt(isImp() ? r.elev_ft : r.elev_m), elevU()),
      stat('Speed', f1((isImp() ? r.miles : r.km) / (r.moving_s / 3600 || 1)), isImp() ? 'mph' : 'km/h'),
      stat('Effort', r.relative_effort == null ? '—' : fmt(r.relative_effort)),
    );
    box.append(t, stats);
  });
  dash.draw('rd-notes', (box) => {
    const g = dash.data('ride_detail');
    box.replaceChildren();
    if (failed(box, 'ride_detail') || g.status !== 'ok') return;
    const prs = g.data.filter((e) => e.medal != null).length;
    box.append(...(g.meta || []).map((m) => { const c = el('span', 'pill'); c.append(document.createTextNode(m.label + ' '), el('b', null, m.value)); return c; }));
    const s = el('span', 'pill'); s.append(document.createTextNode('Segments '), el('b', null, String(g.data.length)), document.createTextNode(' · PRs '), el('b', null, String(prs)));
    box.append(s);
  });
  dash.draw('rd-segs', rowsDraw('ride_segs', {
    key: 'effort_id',
    list: (d) => d,
    cols: () => [
      { f: 'medal', node: medalNode },
      { f: 'segment', cls: 'strong' },
      { f: isImp() ? 'miles' : 'km', cls: 'num', fmt: d3.format('.2f') },
      { f: 'time_s', cls: 'num', fmt: mmss },
      { f: 'avg_hr', cls: 'num wide-only', fmt: (v) => (v == null ? '' : fmt(Math.round(v))) },
    ],
  }));

  // Fitness and fatigue
  dash.draw('fit-now', one('fitness_now', 'fitness', f1));
  dash.draw('fat-now', one('fitness_now', 'fatigue', f1));
  dash.draw('form-now', one('fitness_now', 'form', (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + f1(Math.abs(v))));
  dash.draw('fit-chg', one('fitness_now', 'fitness_change', (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + f1(Math.abs(v))));
  dash.draw('fitness-chart', (box) => {
    const g = dash.data('fitness');
    box.replaceChildren();
    if (failed(box, 'fitness') || g.status !== 'ok' || !g.data.length) return;
    const pts = g.data.map((d) => ({ ...d, dt: asDate(d.date) }));
    const w = box.clientWidth || 600, h = 240, m = { t: 14, r: 92, b: 24, l: 36 };
    const x = d3.scaleTime(d3.extent(pts, (d) => d.dt), [m.l, w - m.r]);
    const y = d3.scaleLinear([Math.min(0, d3.min(pts, (d) => d.form)), d3.max(pts, (d) => Math.max(d.fitness, d.fatigue)) || 1], [h - m.b, m.t]).nice();
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Fitness, fatigue and form over the last 120 days');
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y).attr('y2', y).attr('stroke', (v) => (v === 0 ? css('--cds-chart-axis') : css('--cds-chart-grid')));
    svg.append('g').attr('transform', `translate(${m.l - 6},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0)).call((a) => axisStyle(a, false));
    svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(w < 500 ? 3 : 5).tickSize(0).tickPadding(8).tickFormat(d3.timeFormat('%b %-d'))).call((a) => axisStyle(a, false));
    const bw = Math.max(1, (w - m.l - m.r) / pts.length - 1);
    svg.append('g').selectAll('rect').data(pts).join('rect').attr('x', (d) => x(d.dt) - bw / 2).attr('width', bw)
      .attr('y', (d) => y(Math.max(0, d.form))).attr('height', (d) => Math.abs(y(d.form) - y(0)))
      .attr('fill', (d) => (d.form < 0 ? css('--cds-chart-status-critical') : css('--color-ok'))).attr('fill-opacity', 0.35);
    const line = (k) => d3.line().x((d) => x(d.dt)).y((d) => y(d[k]));
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', css('--cds-chart-muted')).attr('stroke-width', 1.5).attr('stroke-dasharray', '3 3').attr('d', line('fatigue'));
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', dash.colors[0]).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('d', line('fitness'));
    const last = pts[pts.length - 1];
    const labels = [['Fitness', last.fitness, dash.colors[0]], ['Fatigue', last.fatigue, css('--color-fg-muted')]].sort((a, b) => b[1] - a[1]);
    let prevY = -99;
    labels.forEach(([name, v, c]) => {
      const ly = Math.max(y(v) + 4, prevY + 14);
      prevY = ly;
      svg.append('text').attr('x', w - m.r + 6).attr('y', ly).attr('fill', c).style('font-size', '11px').style('font-weight', 600).text(name + ' ' + f1(v));
    });
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    const rule = svg.append('line').attr('y1', m.t).attr('y2', h - m.b).attr('stroke', css('--cds-chart-axis')).attr('visibility', 'hidden');
    const bis = d3.bisector((d) => d.dt).center;
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [px, py] = d3.pointer(ev);
        const d = pts[bis(pts, x.invert(px))];
        rule.attr('x1', x(d.dt)).attr('x2', x(d.dt)).attr('visibility', 'visible');
        const k = box.clientWidth / w;
        tipShow(box, tip, x(d.dt) * k, py * k, [el('div', 'k', dayFmt(d.dt) + (d.load ? ' · effort ' + d.load : '')), el('div', null, 'Fitness ' + f1(d.fitness) + ' · fatigue ' + f1(d.fatigue) + ' · form ' + f1(d.form))]);
      })
      .on('pointerleave', () => { tip.hidden = true; rule.attr('visibility', 'hidden'); });
  });

  // Time in zone: one stacked bar per ride, share of minutes per zone
  const EASY_TARGET = 80;
  dash.draw('easy-pct', one('zone_sum', 'easy_pct'));
  dash.draw('hard-pct', one('zone_sum', 'hard_pct'));
  dash.draw('zone-rides', one('zone_sum', 'rides'));
  dash.draw('easy-target', (e) => { e.textContent = String(EASY_TARGET); });
  dash.draw('zone-chart', (box) => {
    const g = dash.data('zone_time');
    box.replaceChildren();
    if (failed(box, 'zone_time') || g.status !== 'ok' || !g.data.length) return;
    const rows = g.data;
    const keys = ['z1', 'z2', 'z3', 'z4', 'z5'];
    const w = box.clientWidth || 600, h = 240, m = { t: 12, r: 8, b: 24, l: 40 };
    const x = d3.scaleBand(rows.map((d) => d.activity_id), [m.l, w - m.r]).padding(0.3);
    const y = d3.scaleLinear([0, 100], [h - m.b, m.t]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Share of each recent ride in each heart rate zone');
    svg.append('g').selectAll('line').data([0, 25, 50, 75, 100]).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y).attr('y2', y).attr('stroke', css('--cds-chart-grid'));
    svg.append('g').attr('transform', `translate(${m.l - 6},0)`).call(d3.axisLeft(y).tickValues([0, 50, 100]).tickSize(0).tickFormat((v) => v + '%')).call((a) => axisStyle(a, false));
    const every = Math.ceil(rows.length / Math.max(1, Math.floor((w - m.l) / 48)));
    svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8)
      .tickValues(rows.filter((_, i) => i % every === 0).map((d) => d.activity_id)).tickFormat((id) => dayFmt(asDate(rows.find((r) => r.activity_id === id).date)))).call((a) => axisStyle(a, true));
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    const bw = Math.min(28, x.bandwidth());
    const col = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d) => `translate(${x(d.activity_id) + (x.bandwidth() - bw) / 2},0)`);
    col.each(function (d) {
      const tot = keys.reduce((s, k) => s + d[k], 0) || 1;
      let acc = 0;
      keys.forEach((k, i) => {
        const v = d[k] / tot * 100;
        d3.select(this).append('rect').attr('x', 0).attr('width', bw).attr('y', y(acc + v)).attr('height', Math.max(0, y(acc) - y(acc + v))).attr('fill', css(ZONE[i]));
        acc += v;
      });
    });
    col.append('rect').attr('width', bw).attr('y', m.t).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (ev, d) => {
        const [px, py] = d3.pointer(ev, box);
        tipShow(box, tip, px, py, [el('div', 'k', d.name + ' · ' + dayFmt(asDate(d.date))), el('div', null, keys.map((k, i) => 'Z' + (i + 1) + ' ' + d[k]).join(' · ') + ' min'), el('div', null, d.easy_pct + '% easy')]);
      })
      .on('pointerleave', () => { tip.hidden = true; });
    svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(EASY_TARGET)).attr('y2', y(EASY_TARGET)).attr('stroke', css('--color-fg')).attr('stroke-dasharray', '4 4').attr('pointer-events', 'none');
  });

  dash.draw('hour-chart', (box) => {
    const g = dash.data('by_hour');
    box.replaceChildren();
    if (failed(box, 'by_hour') || g.status !== 'ok' || !g.data.length) return;
    const top = d3.greatest(g.data, (d) => d.rides);
    const lbl = (hr) => (hr % 12 || 12) + (hr < 12 ? 'a' : 'p');
    barChart(box, g.data, {
      h: 180, key: (d) => d.hour, val: (d) => d.rides, label: '2026 rides by start hour',
      tick: lbl, hi: (d) => d === top, color: dash.colors[2],
      tipLines: (d) => [el('div', 'k', lbl(d.hour) + 'm start'), el('div', null, d.rides + ' rides · ' + fmt(isImp() ? d.miles : d.km) + ' ' + distU())],
    });
  });

  dash.draw('climb-weeks-chart', (box) => {
    const g = dash.data('climb_weeks');
    box.replaceChildren();
    if (failed(box, 'climb_weeks') || g.status !== 'ok' || !g.data.length) return;
    const ref = Math.round(elevM(1400));
    barChart(box, g.data, {
      h: 180, key: (d) => d.week_of, val: (d) => (isImp() ? d.elev_ft : d.elev_m), label: 'Climbing per week, last 16 weeks',
      tick: (v) => dayFmt(asDate(v)), hi: (d) => (isImp() ? d.elev_ft : d.elev_m) >= ref, color: css('--cds-chart-status-warning'),
      ref, refLabel: 'Tourmalet ' + fmt(ref) + ' ' + elevU(),
      tipLines: (d) => [el('div', 'k', 'Week of ' + dayFmt(asDate(d.week_of))), el('div', null, fmt(isImp() ? d.elev_ft : d.elev_m) + ' ' + elevU() + ' climbed')],
    });
  });

  dash.draw('speed-chart', (box) => {
    const g = dash.data('weekly');
    box.replaceChildren();
    if (failed(box, 'weekly') || g.status !== 'ok') return;
    const k = isImp() ? 'mph' : 'kmh', U = isImp() ? 'mph' : 'km/h';
    const pts = g.data.filter((d) => d[k] != null).map((d) => ({ ...d, dt: asDate(d.week_of) }));
    if (pts.length < 2) return;
    const w = box.clientWidth || 600, h = 180, m = { t: 14, r: 16, b: 24, l: 40 };
    const x = d3.scaleTime(d3.extent(pts, (d) => d.dt), [m.l, w - m.r]);
    const ext = d3.extent(pts, (d) => d[k]);
    const y = d3.scaleLinear([Math.floor(ext[0] - 1), Math.ceil(ext[1] + 1)], [h - m.b, m.t]).nice();
    const avg = d3.mean(pts, (d) => d[k]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Average moving speed per week');
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y).attr('y2', y).attr('stroke', css('--cds-chart-grid'));
    svg.append('g').attr('transform', `translate(${m.l - 6},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0)).call((a) => axisStyle(a, false));
    svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(w < 500 ? 4 : 8).tickSize(0).tickPadding(8).tickFormat(d3.timeFormat('%b %-d'))).call((a) => axisStyle(a, true));
    svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(avg)).attr('y2', y(avg)).attr('stroke', css('--cds-chart-reference')).attr('stroke-dasharray', '4 4');
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', css('--acc')).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('d', d3.line().x((d) => x(d.dt)).y((d) => y(d[k])));
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', (d) => x(d.dt)).attr('cy', (d) => y(d[k])).attr('r', 3.5).attr('fill', css('--acc'))
      .on('pointermove', (ev, d) => { const [px, py] = d3.pointer(ev, box); tipShow(box, tip, px, py, [el('div', 'k', 'Week of ' + dayFmt(d.dt)), el('div', null, f1(d[k]) + ' ' + U + ' · ' + d.rides + (d.rides === 1 ? ' ride' : ' rides'))]); })
      .on('pointerleave', () => { tip.hidden = true; });
  });

  dash.draw('dow-chart', (box) => {
    const g = dash.data('dow');
    box.replaceChildren();
    if (failed(box, 'dow') || g.status !== 'ok' || !g.data.length) return;
    const most = d3.greatest(g.data, (d) => d.rides);
    barChart(box, g.data, {
      h: 180, key: (d) => d.day, val: (d) => d.rides, label: '2026 rides by day of week',
      tick: (v) => v, hi: (d) => d === most, color: dash.colors[2],
      tipLines: (d) => [el('div', 'k', d.day), el('div', null, d.rides + ' rides · ' + fmt(Math.round(fromMi(d.miles))) + ' ' + distU() + ' · avg ' + f1(fromMi(d.avg_mi)))],
    });
    const svg = d3.select(box).select('svg');
    const w = box.clientWidth || 600, h = 180, m = { t: 16, r: 8, b: 24, l: 40 };
    const x = d3.scaleBand(g.data.map((d) => d.day), [m.l, w - m.r]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(g.data, (d) => d.rides) || 1], [h - m.b, m.t]).nice();
    svg.append('g').attr('pointer-events', 'none').selectAll('text').data(g.data.filter((d) => d.rides)).join('text')
      .attr('x', (d) => x(d.day) + x.bandwidth() / 2).attr('y', (d) => y(d.rides) - 5).attr('text-anchor', 'middle')
      .attr('fill', css('--color-fg-muted')).style('font-size', '11px').style('font-family', MONO).text((d) => f1(fromMi(d.avg_mi)));
  });

  dash.draw('month-chart', (box) => {
    const g = dash.data('monthly');
    box.replaceChildren();
    if (failed(box, 'monthly') || g.status !== 'ok' || !g.data.length) return;
    const narrow = (box.clientWidth || 600) < 420;
    const best = d3.greatest(g.data, (d) => d.km);
    barChart(box, g.data, {
      h: 180, key: (d) => d.month, val: (d) => dist(d.km), label: 'Distance ridden per month in 2026',
      tick: (v) => d3.timeFormat('%b')(asDate(v + '-15')).slice(0, narrow ? 1 : 3), hi: (d) => d === best,
      tipLines: (d) => [el('div', 'k', d3.timeFormat('%B')(asDate(d.month + '-15'))), el('div', null, fmt(Math.round(dist(d.km))) + ' ' + distU() + ' · ' + d.rides + ' rides')],
    });
  });

  dash.draw('heatmap', (box) => {
    const g = dash.data('days');
    box.replaceChildren();
    if (failed(box, 'days') || g.status !== 'ok') return;
    const by = new Map(g.data.map((d) => [d.date, d]));
    const f = d3.timeFormat('%Y-%m-%d');
    const start = d3.timeMonday.floor(new Date(2026, 0, 1));
    const days = d3.timeDay.range(new Date(2026, 0, 1), new Date(2027, 0, 1));
    const cell = 12, gap = 3, step = cell + gap, l = 30, t = 18;
    const cols = d3.timeMonday.count(start, new Date(2026, 11, 31)) + 1;
    const w = l + cols * step, h = t + 7 * step + 4;
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Calendar of 2026 ride days, shaded by km');
    const today = f(new Date());
    const shade = (km) => (km <= 0 ? 0 : km < 20 ? 0.3 : km < 40 ? 0.5 : km < 80 ? 0.75 : 1);
    const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
    svg.append('g').selectAll('rect').data(days).join('rect')
      .attr('x', (d) => l + d3.timeMonday.count(start, d) * step)
      .attr('y', (d) => t + ((d.getDay() + 6) % 7) * step)
      .attr('width', cell).attr('height', cell).attr('rx', 2)
      .attr('fill', (d) => (by.get(f(d)) ? dash.colors[0] : css('--cds-chart-grid')))
      .attr('fill-opacity', (d) => { const v = by.get(f(d)); return v ? shade(v.km) : 1; })
      .attr('stroke', (d) => (f(d) === today ? css('--color-fg') : 'none')).attr('stroke-width', 1.5)
      .on('pointermove', (ev, d) => {
        const v = by.get(f(d));
        const [px, py] = d3.pointer(ev, box);
        tipShow(box, tip, px, py, [el('div', 'k', d3.timeFormat('%a %b %-d')(d)), el('div', null, v ? f1(dist(v.km)) + ' ' + distU() + ' · ' + v.rides + (v.rides === 1 ? ' ride' : ' rides') + (v.rain ? ' · rain' : '') : 'No ride')]);
      })
      .on('pointerleave', () => { tip.hidden = true; });
    svg.append('g').attr('pointer-events', 'none').selectAll('circle').data(g.data.filter((d) => d.rain)).join('circle')
      .attr('cx', (d) => l + d3.timeMonday.count(start, asDate(d.date)) * step + cell / 2)
      .attr('cy', (d) => t + ((asDate(d.date).getDay() + 6) % 7) * step + cell / 2)
      .attr('r', 2.2).attr('fill', css('--color-bg'));
    const months = d3.timeMonth.range(new Date(2026, 0, 1), new Date(2027, 0, 1));
    svg.append('g').selectAll('text').data(months).join('text')
      .attr('x', (d) => l + d3.timeMonday.count(start, d3.timeMonday.ceil(d)) * step).attr('y', 11)
      .attr('fill', css('--color-fg-muted')).style('font-size', '10px').text(d3.timeFormat('%b'));
    svg.append('g').selectAll('text').data([['Mon', 0], ['Wed', 2], ['Fri', 4]]).join('text')
      .attr('x', 0).attr('y', (d) => t + d[1] * step + cell - 2).attr('fill', css('--color-fg-muted')).style('font-size', '10px').text((d) => d[0]);
  });

  dash.draw('zone-bar', (box) => {
    const g = dash.data('zones');
    box.replaceChildren();
    if (failed(box, 'zones') || g.status !== 'ok' || !g.data.length) return;
    const w = box.clientWidth || 500, h = 64, bh = 28;
    const lo = d3.min(g.data, (d) => d.lo), hi = d3.max(g.data, (d) => d.hi);
    const x = d3.scaleLinear([lo, hi + 1], [0, w]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Heart rate zones from Z1 to Z5 in bpm');
    const seg = svg.append('g').selectAll('g').data(g.data).join('g');
    seg.append('rect').attr('x', (d) => x(d.lo) + 1).attr('width', (d) => Math.max(0, x(d.hi + 1) - x(d.lo) - 2)).attr('y', 4).attr('height', bh).attr('rx', 4)
      .attr('fill', (d, i) => css(ZONE[i] || '--cds-chart-muted'));
    seg.append('text').attr('x', (d) => (x(d.lo) + x(d.hi + 1)) / 2).attr('y', 4 + bh / 2 + 4).attr('text-anchor', 'middle')
      .attr('fill', css('--color-panel')).style('font-size', '12px').style('font-weight', 700).text((d) => d.zone);
    svg.append('g').selectAll('text').data(g.data.slice(1)).join('text')
      .attr('x', (d) => x(d.lo)).attr('y', h - 6).attr('text-anchor', 'middle').attr('fill', css('--color-fg-muted'))
      .style('font-size', '11px').style('font-family', MONO).text((d) => d.lo);
  });

  // Climb readiness: bests against the two climbs
  const CLIMBS = [{ name: 'Colombier', m: 1250 }, { name: 'Tourmalet', m: 1400 }];
  dash.draw('climb-pct', (e) => {
    const g = dash.data('climbs');
    const r = g.status === 'ok' ? g.data.find((d) => d.what === 'Biggest single climb') : null;
    e.textContent = r ? fmt(r.pct_colombier) : '—';
  });
  dash.draw('climb-chart', (box) => {
    const g = dash.data('climbs');
    box.replaceChildren();
    if (failed(box, 'climbs') || g.status !== 'ok' || !g.data.length) return;
    const rows = g.data;
    const w = box.clientWidth || 500, bh = 20, gap = 16, top = 22, h = top + rows.length * (bh + gap) + 4;
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Your climbing bests against the Grand Colombier and Tourmalet');
    const probe = svg.append('g').selectAll('text').data(rows).join('text').style('font-size', '12px').text((d) => d.what);
    const lw = (d3.max(probe.nodes(), (n) => n.getComputedTextLength()) || 120) + 12;
    probe.remove();
    const x = d3.scaleLinear([0, Math.max(d3.max(CLIMBS, (c) => c.m), d3.max(rows, (d) => d.m))], [lw, w - 44]);
    CLIMBS.forEach((c, i) => {
      svg.append('line').attr('x1', x(c.m)).attr('x2', x(c.m)).attr('y1', top - 4).attr('y2', h).attr('stroke', css('--cds-chart-reference')).attr('stroke-dasharray', '4 4');
      svg.append('text').attr('x', x(c.m)).attr('y', 11).attr('text-anchor', i ? 'start' : 'end').attr('dx', i ? 4 : -4).attr('fill', css('--color-fg-muted')).style('font-size', '11px').text(c.name + ' ' + fmt(Math.round(elevM(c.m))) + ' ' + elevU());
    });
    const row = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${top + i * (bh + gap)})`);
    row.append('text').attr('x', lw - 12).attr('y', bh / 2 + 4).attr('text-anchor', 'end').attr('fill', css('--color-fg')).style('font-size', '12px').text((d) => d.what);
    row.append('rect').attr('x', lw).attr('height', bh).attr('rx', 3).attr('width', (d) => Math.max(2, x(d.m) - lw)).attr('fill', (d, i) => (i ? dash.colors[0] : css('--cds-chart-status-warning')));
    row.append('text').attr('x', (d) => x(d.m) + 6).attr('y', bh / 2 + 4).attr('fill', css('--color-fg')).style('font-size', '12px').style('font-family', MONO).text((d) => fmt(Math.round(elevM(d.m))) + ' ' + elevU());
  });

  dash.draw('timeline', (box) => {
    const g = dash.data('roadmap');
    box.replaceChildren();
    if (failed(box, 'roadmap') || g.status !== 'ok' || !g.data.length) return;
    const rows = [...g.data].sort((a, b) => a.order - b.order);
    const w = box.clientWidth || 600, h = 120, m = { l: 4, r: 4 }, by = 40, bh = 30;
    const now = new Date();
    const x0 = d3.min([now, asDate(rows[0].start)]), x1 = asDate(rows[rows.length - 1].end);
    const x = d3.scaleTime([d3.timeMonth.floor(x0), d3.timeDay.offset(x1, 1)], [m.l, w - m.r]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Training phases from now to July 2027');
    const colors = [dash.colors[0], dash.colors[1], dash.colors[2], css('--cds-chart-status-warning')];
    const seg = svg.append('g').selectAll('g').data(rows).join('g');
    seg.append('rect').attr('x', (d) => x(asDate(d.start)) + 1).attr('width', (d) => Math.max(0, x(d3.timeDay.offset(asDate(d.end), 1)) - x(asDate(d.start)) - 2))
      .attr('y', by).attr('height', bh).attr('rx', 5).attr('fill', (d, i) => colors[i % colors.length]);
    seg.append('text').attr('x', (d) => x(asDate(d.start)) + 8).attr('y', by + bh / 2 + 4).attr('fill', css('--color-panel'))
      .style('font-size', '12px').style('font-weight', 600).text((d) => d.phase)
      .each(function (d) {
        const room = x(d3.timeDay.offset(asDate(d.end), 1)) - x(asDate(d.start)) - 14;
        if (this.getComputedTextLength() > room) d3.select(this).text(d.phase[0]);
        if (this.getComputedTextLength() > room) this.remove();
      });
    const ticks = x.ticks(d3.timeMonth.every(w < 500 ? 2 : 1));
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', (d) => x(d)).attr('y', by + bh + 18).attr('text-anchor', 'start')
      .attr('fill', css('--color-fg-muted')).style('font-size', '11px').style('font-family', MONO).text((d) => d3.timeFormat(d.getMonth() === 0 ? '%b %Y' : '%b')(d))
      .each(function (d) { if (x(d) + this.getComputedTextLength() > w) this.remove(); });
    const tx = x(now);
    svg.append('line').attr('x1', tx).attr('x2', tx).attr('y1', 18).attr('y2', by + bh + 4).attr('stroke', css('--color-fg')).attr('stroke-width', 2);
    svg.append('circle').attr('cx', tx).attr('cy', 18).attr('r', 4).attr('fill', css('--color-fg'));
    svg.append('text').attr('x', tx + 8).attr('y', 22).attr('fill', css('--color-fg')).style('font-size', '12px').style('font-weight', 600).text('Today');
    const fx = x(asDate(rows[rows.length - 1].start));
    svg.append('text').attr('x', Math.min(fx, w - 60)).attr('y', 22).attr('fill', css('--color-fg-muted')).style('font-size', '12px').text('France ✈');
  });
}
