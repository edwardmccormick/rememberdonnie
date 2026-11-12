// Renders words/words.json into site/index.html between the words:start and words:end
// markers. The entries are quotations: this script never rewrites their text.
//
//   node scripts/build-words.mjs
//
// Each entry: { date: "YYYY-MM-DD", by: "donnie" | "<full name>", where: "#channel", text }.
// "kind": "code" sets a commit message or code comment in monospace. Entries render in date order;
// entries that share a date keep their order in the file.
// "image": { src, width, height, alt } shows a photo; such an entry may leave text empty.
// An entry with "hold": true stays out of the page. "review" is a note for people, not rendered.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const LAST_DAY = '2026-10-13';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const longDate = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const formatDate = (iso) => longDate.format(new Date(`${iso}T12:00:00Z`));

function body(text) {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function entry(item) {
  const his = item.by === 'donnie';
  const meta = [his ? '' : `<span class="entry__by">${escape(item.by)}</span>`, item.where ? `<span>${escape(item.where)}</span>` : '',
    `<time datetime="${item.date}">${formatDate(item.date)}</time>`].filter(Boolean).join('');
  return `          <article class="entry ${his ? 'entry--his' : 'entry--theirs'}${item.kind === 'code' ? ' entry--code' : ''}">
${item.image ? `            <img class="entry__image" src="${escape(item.image.src)}" width="${item.image.width}" height="${item.image.height}" alt="${escape(item.image.alt)}" loading="lazy">\n` : ''}${item.text ? `            <blockquote>${body(item.text)}</blockquote>\n` : ''}
            <footer class="entry__meta">${meta}</footer>
          </article>`;
}

const items = JSON.parse(readFileSync(path('../words/words.json'), 'utf8')).filter((item) => !item.hold);
items.sort((a, b) => a.date.localeCompare(b.date));
for (const item of items) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.by || !(item.text || item.image)) throw new Error(`Bad entry: ${JSON.stringify(item)}`);
}

const groups = new Map();
for (const item of items) {
  const key = item.date > LAST_DAY ? 'after' : item.date.slice(0, 4);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(item);
}

const html = [...groups].map(([key, list]) => {
  const head = key === 'after'
    ? `<h3 class="year year--after"><time datetime="${LAST_DAY}">${formatDate(LAST_DAY)}</time></h3>`
    : `<h3 class="year">${key}</h3>`;
  return `        <section class="words__group${key === 'after' ? ' words__group--after' : ''}">
          ${head}
          <div class="words__entries">
${list.map(entry).join('\n')}
          </div>
        </section>`;
}).join('\n');

const page = path('../site/index.html');
const source = readFileSync(page, 'utf8');
const pattern = /(<!-- words:start -->)[\s\S]*?(<!-- words:end -->)/;
if (!pattern.test(source)) throw new Error('site/index.html has no words:start / words:end markers');
writeFileSync(page, source.replace(pattern, (_, start, end) => `${start}\n${html}\n        ${end}`));
console.log(`Rendered ${items.length} entries.`);
