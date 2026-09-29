// Builds assets/year-in-review.svg and assets/top-languages.svg from the GitHub GraphQL API.
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

await mkdir('assets', { recursive: true });
await writeFile('assets/year-in-review.svg', await yearInReview());
await writeFile('assets/top-languages.svg', await topLanguages());
console.log('wrote assets/year-in-review.svg and assets/top-languages.svg');
