// Builds assets/year-in-review.svg, top-languages.svg, rank.svg and activity-overview.svg from the GitHub API.
// Run by .github/workflows/profile-cards.yml; locally: GH_TOKEN=$(gh auth token) node .github/scripts/profile-cards.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.PROFILE_USER || 'Minifigures';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('Set GITHUB_TOKEN or GH_TOKEN');
  process.exit(1);
}

const BG = '#0D1117';
const ACCENT = '#58A6FF';
const TEXT = '#FEFEFE';
const MUTED = '#9E9E9E';
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${USER}-profile-cards`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors || body));
  return body.data;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => n.toLocaleString('en-US');

async function yearInReview() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const data = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!, $prevFrom: DateTime!, $prevTo: DateTime!) {
      user(login: $login) {
        current: contributionsCollection(from: $from, to: $to) {
          contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
        }
        previous: contributionsCollection(from: $prevFrom, to: $prevTo) {
          contributionCalendar { totalContributions }
        }
      }
    }`,
    {
      login: USER,
      from: `${year}-01-01T00:00:00Z`,
      to: now.toISOString(),
      prevFrom: `${year - 1}-01-01T00:00:00Z`,
      prevTo: `${year - 1}-12-31T23:59:59Z`,
    },
  );
  const cal = data.user.current.contributionCalendar;
  const prevTotal = data.user.previous.contributionCalendar.totalContributions;
  const days = cal.weeks.flatMap((w) => w.contributionDays).filter((d) => d.date.startsWith(`${year}-`));

  let activeDays = 0, longest = 0, run = 0, best = { contributionCount: 0, date: '' };
  const byMonth = new Array(12).fill(0);
  for (const d of days) {
    const c = d.contributionCount;
    if (c > 0) { activeDays += 1; run += 1; longest = Math.max(longest, run); } else run = 0;
    if (c > best.contributionCount) best = d;
    byMonth[Number(d.date.slice(5, 7)) - 1] += c;
  }
  const busiest = byMonth.indexOf(Math.max(...byMonth));
  const weekly = cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));
  const growth = prevTotal > 0 ? cal.totalContributions / prevTotal : 0;
  const bestDay = best.date ? `${MONTHS[Number(best.date.slice(5, 7)) - 1]} ${Number(best.date.slice(8, 10))}` : '';

  const stats = [
    ['Active days', fmt(activeDays)],
    ['Longest streak', `${longest} days`],
    ['Best day', `${best.contributionCount} on ${bestDay}`],
    ['Busiest month', `${MONTHS[busiest]} (${fmt(byMonth[busiest])})`],
  ];
  const statRows = stats.map(([label, value], i) => {
    const x = 250 + (i % 2) * 125;
    const y = 72 + Math.floor(i / 2) * 44;
    return `<text x="${x}" y="${y}" fill="${TEXT}" font-size="16" font-weight="700">${esc(value)}</text>
    <text x="${x}" y="${y + 16}" fill="${MUTED}" font-size="11">${esc(label)}</text>`;
  }).join('\n    ');

  const maxWeek = Math.max(1, ...weekly);
  const barW = 445 / weekly.length;
  const bars = weekly.map((v, i) => {
    const h = Math.max(1.5, (v / maxWeek) * 30);
    return `<rect x="${(25 + i * barW).toFixed(2)}" y="${(180 - h).toFixed(2)}" width="${Math.max(1, barW - 2).toFixed(2)}" height="${h.toFixed(2)}" rx="1" fill="${ACCENT}" fill-opacity="${(0.35 + 0.65 * v / maxWeek).toFixed(2)}"/>`;
  }).join('');

  const growthPill = growth >= 1.1
    ? `<rect x="25" y="112" width="112" height="22" rx="11" fill="${ACCENT}" fill-opacity="0.15"/>
    <text x="81" y="127" fill="${ACCENT}" font-size="12" font-weight="700" text-anchor="middle">${growth.toFixed(1)}× vs ${year - 1}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="${esc(`${fmt(cal.totalContributions)} contributions on GitHub in ${year}`)}">
  <rect x="0.5" y="0.5" width="494" height="194" rx="4.5" fill="${BG}"/>
  <g font-family="${FONT}">
    <text x="25" y="34" fill="${ACCENT}" font-size="18" font-weight="700">${year} on GitHub</text>
    <text x="25" y="84" fill="${TEXT}" font-size="36" font-weight="700">${fmt(cal.totalContributions)}</text>
    <text x="25" y="102" fill="${MUTED}" font-size="12">contributions this year</text>
    ${growthPill}
    ${statRows}
  </g>
  ${bars}
</svg>
`;
}

async function topLanguages() {
  const data = await gql(
    `query($login: String!) {
      user(login: $login) {
        repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
          nodes { languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
        }
      }
    }`,
    { login: USER },
  );
  const totals = new Map();
  for (const repo of data.user.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const cur = totals.get(node.name) || { size: 0, color: node.color || MUTED };
      cur.size += size;
      totals.set(node.name, cur);
    }
  }
  const sum = [...totals.values()].reduce((s, l) => s + l.size, 0) || 1;
  const top = [...totals.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8);
  const topSum = top.reduce((s, [, l]) => s + l.size, 0) || 1;

  let x = 25;
  const bar = top.map(([, l]) => {
    const w = (l.size / topSum) * 445;
    const r = `<rect x="${x.toFixed(2)}" y="52" width="${w.toFixed(2)}" height="10" fill="${l.color}"/>`;
    x += w;
    return r;
  }).join('');
  const legend = top.map(([name, l], i) => {
    const lx = 25 + (i % 2) * 225;
    const ly = 92 + Math.floor(i / 2) * 24;
    return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color}"/>
    <text x="${lx + 16}" y="${ly}" fill="${TEXT}" font-size="12">${esc(name)} <tspan fill="${MUTED}">${(100 * l.size / sum).toFixed(1)}%</tspan></text>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="Most used languages">
  <rect x="0.5" y="0.5" width="494" height="194" rx="4.5" fill="${BG}"/>
  <clipPath id="bar"><rect x="25" y="52" width="445" height="10" rx="5"/></clipPath>
  <g font-family="${FONT}">
    <text x="25" y="34" fill="${ACCENT}" font-size="18" font-weight="700">Most Used Languages</text>
    <g clip-path="url(#bar)">${bar}</g>
    ${legend}
  </g>
</svg>
`;
}

// ---- Shared all-time stats (rank card + activity overview) ----

async function allTimeStats() {
  const base = await gql(
    `query($login: String!) {
      user(login: $login) {
        followers { totalCount }
        pullRequests { totalCount }
        openIssues: issues(states: OPEN) { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }
        lastYear: contributionsCollection {
          contributionYears
          totalCommitContributions totalPullRequestContributions
          totalIssueContributions totalPullRequestReviewContributions
        }
      }
    }`,
    { login: USER },
  );
  const u = base.user;
  const years = [...u.lastYear.contributionYears].sort((a, b) => a - b);
  const perYear = [];
  for (const y of years) {
    const d = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions totalPullRequestContributions
            totalIssueContributions totalPullRequestReviewContributions
            contributionCalendar { totalContributions }
          }
        }
      }`,
      { login: USER, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` },
    );
    perYear.push(d.user.contributionsCollection);
  }
  const sum = (k) => perYear.reduce((s, c) => s + c[k], 0);

  // Stars on owned public repositories, via REST (the Actions token cannot read GraphQL stargazers).
  const rest = async (path) => {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': `${USER}-profile-cards` },
    });
    if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
    return r.json();
  };
  let stars = 0;
  for (let page = 1; ; page += 1) {
    const repos = await rest(`/users/${USER}/repos?type=owner&per_page=100&page=${page}`);
    stars += repos.reduce((s, r) => s + r.stargazers_count, 0);
    if (repos.length < 100) break;
  }

  // All-time commit count, same source as github-readme-stats' include_all_commits.
  const allCommits = (await rest(`/search/commits?q=author:${USER}`)).total_count;

  return {
    years,
    allCommits,
    prs: u.pullRequests.totalCount,
    issues: u.openIssues.totalCount + u.closedIssues.totalCount,
    reviews: sum('totalPullRequestReviewContributions'),
    stars,
    followers: u.followers.totalCount,
    contributions: perYear.reduce((s, c) => s + c.contributionCalendar.totalContributions, 0),
    overview: {
      lastYear: {
        label: 'Last 12 months',
        commits: u.lastYear.totalCommitContributions,
        prs: u.lastYear.totalPullRequestContributions,
        issues: u.lastYear.totalIssueContributions,
        reviews: u.lastYear.totalPullRequestReviewContributions,
      },
      allTime: {
        label: `All-time (${years[0]}–${years[years.length - 1]})`,
        commits: sum('totalCommitContributions'),
        prs: sum('totalPullRequestContributions'),
        issues: sum('totalIssueContributions'),
        reviews: sum('totalPullRequestReviewContributions'),
      },
    },
  };
}

// ---- Rank card: github-readme-stats rank formula (src/calculateRank.js) ----

const expCdf = (x) => 1 - 2 ** -x;
const logNormalCdf = (x) => x / (1 + x);
const THRESHOLDS = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
const LEVELS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'];
const levelFor = (pct) => LEVELS[THRESHOLDS.findIndex((t) => pct <= t)];
// Same medians and weights as github-readme-stats with include_all_commits=true.
const RANK_CATEGORIES = [
  { key: 'allCommits', label: 'Commits (all-time)', median: 1000, weight: 2, cdf: expCdf, activity: true },
  { key: 'prs', label: 'Pull requests', median: 50, weight: 3, cdf: expCdf, activity: true },
  { key: 'issues', label: 'Issues', median: 25, weight: 1, cdf: expCdf, activity: true },
  { key: 'reviews', label: 'Code reviews', median: 2, weight: 1, cdf: expCdf, activity: true },
  { key: 'stars', label: 'Stars earned', median: 50, weight: 4, cdf: logNormalCdf, activity: false },
  { key: 'followers', label: 'Followers', median: 10, weight: 1, cdf: logNormalCdf, activity: false },
];

function computeRank(stats) {
  const cats = RANK_CATEGORIES.map((c) => {
    const score = c.cdf(stats[c.key] / c.median);
    const top = 100 * (1 - score);
    return { ...c, value: stats[c.key], score, top, level: levelFor(top) };
  });
  const pct = (list) => 100 * (1 - list.reduce((s, c) => s + c.weight * c.score, 0) / list.reduce((s, c) => s + c.weight, 0));
  const overall = pct(cats);
  const activity = pct(cats.filter((c) => c.activity));
  return { cats, overall, overallLevel: levelFor(overall), activity, activityLevel: levelFor(activity) };
}

const topLabel = (p) => `Top ${p < 10 ? p.toFixed(1) : Math.round(p)}%`;

function rankCard(stats, rank) {
  const R = 46, cx = 100, cy = 112, circ = 2 * Math.PI * R;
  const filled = circ * (1 - rank.activity / 100);
  const best = [...rank.cats].sort((a, b) => a.top - b.top).slice(0, 3);
  const rows = [
    ...best.map((c) => ({ label: c.label, value: fmt(c.value), pill: `${c.level} · ${topLabel(c.top)}` })),
    { label: 'Total contributions', value: fmt(stats.contributions), pill: '' },
  ];
  const rowSvg = rows.map((r, i) => {
    const y = 66 + i * 30;
    const pill = r.pill
      ? `<rect x="378" y="${y - 14}" width="92" height="20" rx="10" fill="${ACCENT}" fill-opacity="0.15"/>
    <text x="424" y="${y}" fill="${ACCENT}" font-size="11" font-weight="700" text-anchor="middle">${esc(r.pill)}</text>`
      : '';
    return `<text x="190" y="${y}" fill="${MUTED}" font-size="12">${esc(r.label)}</text>
    <text x="366" y="${y}" fill="${TEXT}" font-size="14" font-weight="700" text-anchor="end">${esc(r.value)}</text>
    ${pill}`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="${esc(`GitHub activity rank ${rank.activityLevel}, ${topLabel(rank.activity)}`)}">
  <defs>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="#A371F7"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="494" height="194" rx="4.5" fill="${BG}"/>
  <g font-family="${FONT}">
    <text x="25" y="34" fill="${ACCENT}" font-size="18" font-weight="700">GitHub Rank</text>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ACCENT}" stroke-opacity="0.18" stroke-width="7"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="url(#ring)" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${filled.toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 6}" fill="${TEXT}" font-size="34" font-weight="700" text-anchor="middle">${esc(rank.activityLevel)}</text>
    <text x="${cx}" y="${cy + 24}" fill="${MUTED}" font-size="11" text-anchor="middle">${esc(topLabel(rank.activity))}</text>
    ${rowSvg}
    <text x="25" y="183" fill="${MUTED}" font-size="10">Activity rank · github-readme-stats formula on all-time commits, PRs, issues, reviews</text>
  </g>
</svg>
`;
}

// ---- Activity overview: GitHub's 4-axis contribution chart ----

const OVERVIEW_KEYS = [
  { key: 'reviews', label: 'Code review' }, // top
  { key: 'issues', label: 'Issues' },       // right
  { key: 'prs', label: 'Pull requests' },   // bottom
  { key: 'commits', label: 'Commits' },     // left
];

function balance(w) {
  const vals = OVERVIEW_KEYS.map((k) => w[k.key]);
  const total = vals.reduce((s, v) => s + v, 0);
  if (!total) return 0;
  return -vals.reduce((s, v) => (v ? s + (v / total) * Math.log(v / total) : s), 0) / Math.log(vals.length);
}

function pickOverviewWindow(stats) {
  const { lastYear, allTime } = stats.overview;
  // Show whichever window has the more even spread; ties go to all-time.
  return balance(lastYear) > balance(allTime) ? lastYear : allTime;
}

function activityChart(w) {
  const cx = 150, cy = 110, R = 50, MIN = 10;
  const total = OVERVIEW_KEYS.reduce((s, k) => s + w[k.key], 0) || 1;
  const maxLog = Math.log1p(Math.max(1, ...OVERVIEW_KEYS.map((k) => w[k.key])));
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const pts = OVERVIEW_KEYS.map((k, i) => {
    const r = MIN + (R - MIN) * (Math.log1p(w[k.key]) / maxLog);
    return [cx + dirs[i][0] * r, cy + dirs[i][1] * r];
  });
  const pctOf = (v) => {
    const p = (100 * v) / total;
    return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };
  const labels = OVERVIEW_KEYS.map((k, i) => {
    const p = pctOf(w[k.key]);
    const [dx, dy] = dirs[i];
    const x = cx + dx * (R + 8);
    const y = dy < 0 ? cy - R - 9 : dy > 0 ? cy + R + 19 : cy + 4;
    const anchor = dx > 0 ? 'start' : dx < 0 ? 'end' : 'middle';
    return `<text x="${x}" y="${y}" fill="${TEXT}" font-size="12" text-anchor="${anchor}"><tspan font-weight="700">${esc(p)}</tspan> <tspan fill="${MUTED}">${k.label}</tspan></text>`;
  }).join('\n    ');
  const legend = [...OVERVIEW_KEYS].sort((a, b) => w[b.key] - w[a.key]).map((k, i) => {
    const y = 72 + i * 24;
    return `<text x="330" y="${y}" fill="${MUTED}" font-size="12">${k.label}</text>
    <text x="470" y="${y}" fill="${TEXT}" font-size="14" font-weight="700" text-anchor="end">${fmt(w[k.key])}</text>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="${esc(`Activity overview: ${OVERVIEW_KEYS.map((k) => `${pctOf(w[k.key])} ${k.label}`).join(', ')}`)}">
  <defs>
    <linearGradient id="shape" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#A371F7" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="494" height="194" rx="4.5" fill="${BG}"/>
  <g font-family="${FONT}">
    <text x="25" y="34" fill="${ACCENT}" font-size="18" font-weight="700">Activity Overview</text>
    <text x="470" y="34" fill="${MUTED}" font-size="11" text-anchor="end">${esc(w.label)}</text>
    <line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="${MUTED}" stroke-opacity="0.35"/>
    <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="${MUTED}" stroke-opacity="0.35"/>
    <polygon points="${pts.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ')}" fill="url(#shape)" stroke="${ACCENT}" stroke-width="1.5" stroke-linejoin="round"/>
    ${pts.map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3" fill="${BG}" stroke="${ACCENT}" stroke-width="1.5"/>`).join('')}
    ${labels}
    ${legend}
    <text x="330" y="176" fill="${MUTED}" font-size="10">Shape log-scaled; % of these four</text>
  </g>
</svg>
`;
}

await mkdir('assets', { recursive: true });
await writeFile('assets/year-in-review.svg', await yearInReview());
await writeFile('assets/top-languages.svg', await topLanguages());
const stats = await allTimeStats();
const rank = computeRank(stats);
await writeFile('assets/rank.svg', rankCard(stats, rank));
const overviewWindow = pickOverviewWindow(stats);
await writeFile('assets/activity-overview.svg', activityChart(overviewWindow));
console.log(JSON.stringify({
  rank: {
    activity: { level: rank.activityLevel, topPercent: +rank.activity.toFixed(2) },
    overall: { level: rank.overallLevel, topPercent: +rank.overall.toFixed(2) },
    categories: rank.cats.map((c) => ({ [c.key]: c.value, level: c.level, topPercent: +c.top.toFixed(2) })),
  },
  contributions: stats.contributions,
  overview: { chosen: overviewWindow.label, lastYear: stats.overview.lastYear, allTime: stats.overview.allTime,
    balance: { lastYear: +balance(stats.overview.lastYear).toFixed(3), allTime: +balance(stats.overview.allTime).toFixed(3) } },
}));
console.log('wrote assets/year-in-review.svg, top-languages.svg, rank.svg and activity-overview.svg');
