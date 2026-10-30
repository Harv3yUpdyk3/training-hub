// Where each of the hub's numbers comes from.
// "query" asks Strava live from the phone; "file" reads a JSON file in this repo
// that Claude keeps up to date (the weekly plan, zones, Local Legends, best efforts).
window.HUB_CONFIG = {
  params: { units: 'metric', ride: null },
  colors: ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'],
  datasets: {
    rides: { kind: 'query', tool: 'list_activities', args: { first: 100, range_start: '2026-01-01T00:00:00', range_end: '2026-12-31T23:59:59', use_preferred_units: true } },
    rides_2025: { kind: 'query', tool: 'list_activities', args: { first: 100, range_start: '2025-01-01T00:00:00', range_end: '2025-12-31T23:59:59', use_preferred_units: true } },
    efforts: { kind: 'query', tool: 'list_activities', args: { first: 10 } },
    efforts30: { kind: 'query', tool: 'list_activities', args: { first: 30 } },
    hr_samples: { kind: 'query', tool: 'list_activities', args: { first: 12 } },
    ride_detail: { kind: 'query', tool: 'get_activity_performance', args: { activity_id: '{{ride}}' } },
    gear: { kind: 'query', tool: 'get_gear', args: { gear_types: ['Bike'] } },
    streak: { kind: 'query', tool: 'get_active_streak', args: {} },
    bests: { kind: 'file', url: 'data/bests.json' },
    bests_yoy: { kind: 'file', url: 'data/bests_yoy.json' },
    plan: { kind: 'file', url: 'data/plan.json' },
    roadmap: { kind: 'file', url: 'data/roadmap.json' },
    todo: { kind: 'file', url: 'data/todo.json' },
    zones: { kind: 'file', url: 'data/zones.json' },
    legends: { kind: 'file', url: 'data/legends.json' },
  },
};
