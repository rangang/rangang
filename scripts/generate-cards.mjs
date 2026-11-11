// 生成 GitHub 个人主页自托管卡片 SVG（统计 / 常用语言 / 精选项目）
// 用法: GITHUB_TOKEN=xxx node scripts/generate-cards.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = 'rangang';
const FEATURED = ['zhujiao', 'screenshot-translator', 'PDF-DataMaskingTool', 'mixia'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'cards');
mkdirSync(outDir, { recursive: true });

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function api(path) {
  const args = ['-s', '--fail', '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: rangang-profile-cards'];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  args.push(`https://api.github.com${path}`);
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

// tokyonight 风格配色
const C = {
  bg: '#1a1b26', border: '#2f334d', title: '#8b7cff', text: '#a9b1d6',
  sub: '#565f89', cyan: '#00e5ff', magenta: '#ff2e88', green: '#9ece6a',
};
const LANG_COLORS = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Java: '#b07219', Python: '#3572A5',
  Dart: '#00B4AB', HTML: '#e34c26', CSS: '#563d7c', 'Objective-C': '#438eff',
  Vue: '#41b883', Shell: '#89e051', C: '#555555', 'C++': '#f34b7d', Go: '#00ADD8',
  Rust: '#dea584', Swift: '#F05138', Kotlin: '#A97BFF', Ruby: '#701516',
  PHP: '#4F5D95', SCSS: '#c6538c', Makefile: '#427819', Dockerfile: '#384d54',
  PowerShell: '#012456',
};
const langColor = (l) => LANG_COLORS[l] || C.title;

const FONT = `'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif`;
function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
${body}
</svg>\n`;
}

// ---------- 数据抓取 ----------
const user = await api(`/users/${USER}`);
const repos = await api(`/users/${USER}/repos?per_page=100&type=owner`);
const own = repos.filter((r) => !r.fork);
const stars = own.reduce((s, r) => s + r.stargazers_count, 0);
const forks = own.reduce((s, r) => s + r.forks_count, 0);

const [commits, prs, issues] = await Promise.all([
  api(`/search/commits?q=author:${USER}&per_page=1`),
  api(`/search/issues?q=author:${USER}+type:pr&per_page=1`),
  api(`/search/issues?q=author:${USER}+type:issue&per_page=1`),
]);

// 语言统计（按字节聚合，仅自有仓库）
const langBytes = {};
for (let i = 0; i < own.length; i += 6) {
  const batch = await Promise.all(own.slice(i, i + 6).map((r) => api(`/repos/${USER}/${r.name}/languages`)));
  for (const langs of batch) for (const [l, b] of Object.entries(langs)) langBytes[l] = (langBytes[l] || 0) + b;
}
const totalBytes = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
const topLangs = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).slice(0, 6);

// ---------- 统计卡片 ----------
const statRows = [
  ['★ 总星标', fmt(stars), C.cyan],
  ['⌥ 总提交', fmt(commits.total_count), C.green],
  ['⇪ 总 PR', fmt(prs.total_count), C.title],
  ['◉ 总 Issue', fmt(issues.total_count), C.magenta],
  ['♥ 关注者', fmt(user.followers), C.cyan],
  ['▤ 公开仓库', fmt(user.public_repos), C.green],
];
let statsBody = `  <text x="25" y="36" font-size="16" font-weight="700" fill="${C.title}">GitHub 统计</text>
  <text x="470" y="36" text-anchor="end" font-size="11" fill="${C.sub}">@${USER}</text>`;
statRows.forEach(([label, value, color], i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = 25 + col * 235, y = 72 + row * 36;
  statsBody += `
  <text x="${x}" y="${y}" font-size="13" fill="${C.text}">${esc(label)}</text>
  <text x="${x + 190}" y="${y}" text-anchor="end" font-size="14" font-weight="700" fill="${color}">${esc(value)}</text>`;
});
statsBody += `
  <text x="25" y="178" font-size="10" fill="${C.sub}">数据由 GitHub Actions 每日自动更新</text>`;
writeFileSync(join(outDir, 'stats.svg'), svg(495, 195, statsBody));

// ---------- 常用语言卡片 ----------
let langsBody = `  <text x="25" y="36" font-size="16" font-weight="700" fill="${C.title}">常用语言</text>
  <text x="395" y="36" text-anchor="end" font-size="11" fill="${C.sub}">按代码量占比</text>`;
topLangs.forEach(([lang, bytes], i) => {
  const pct = (bytes / totalBytes) * 100;
  const y = 66 + i * 20;
  langsBody += `
  <text x="25" y="${y}" font-size="12" fill="${C.text}">${esc(lang)}</text>
  <rect x="130" y="${y - 9}" width="200" height="8" rx="4" fill="${C.border}"/>
  <rect x="130" y="${y - 9}" width="${Math.max(4, pct * 2)}" height="8" rx="4" fill="${langColor(lang)}"/>
  <text x="395" y="${y}" text-anchor="end" font-size="11" fill="${C.sub}">${pct.toFixed(1)}%</text>`;
});
writeFileSync(join(outDir, 'langs.svg'), svg(420, 195, langsBody));

// ---------- 精选项目卡片 ----------
for (const name of FEATURED) {
  const r = await api(`/repos/${USER}/${name}`);
  const desc = clip(r.description || '暂无描述', 34);
  const lang = r.language || '';
  const body = `  <text x="25" y="38" font-size="15" font-weight="700" fill="${C.cyan}">▣ ${esc(clip(r.name, 30))}</text>
  <text x="25" y="64" font-size="12" fill="${C.text}">${esc(desc)}</text>
  ${lang ? `<circle cx="30" cy="98" r="5" fill="${langColor(lang)}"/><text x="42" y="102" font-size="12" fill="${C.sub}">${esc(lang)}</text>` : ''}
  <text x="230" y="102" font-size="12" fill="${C.sub}">★ ${fmt(r.stargazers_count)}</text>
  <text x="300" y="102" font-size="12" fill="${C.sub}">⑂ ${fmt(r.forks_count)}</text>`;
  writeFileSync(join(outDir, `pin-${name}.svg`), svg(400, 120, body));
}

console.log('cards generated:', outDir);