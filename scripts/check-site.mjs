// Checks site/ before deploy: every local asset an HTML page references exists,
// and nothing would be blocked by the Content-Security-Policy (no inline scripts,
// inline event handlers or style attributes).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const problems = [];

for (const page of readdirSync(root).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(root, page), 'utf8');

  for (const [, attr, value] of html.matchAll(/\s(src|href|srcset|imagesrcset)="([^"]+)"/g)) {
    const urls = attr.endsWith('srcset') ? value.split(',').map((s) => s.trim().split(/\s+/)[0]) : [value];
    for (const url of urls) {
      if (!url.startsWith('/') || url.startsWith('//')) continue;
      const path = url.split(/[?#]/)[0];
      if (path === '/' || path === '/admin') continue;
      if (!existsSync(join(root, path))) problems.push(`${page}: ${attr}="${url}" does not exist`);
    }
  }
  for (const match of html.matchAll(/data-lightbox="([^"]+)"/g)) {
    if (!existsSync(join(root, match[1]))) problems.push(`${page}: lightbox image ${match[1]} does not exist`);
  }
  if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) problems.push(`${page}: inline <script> (blocked by CSP)`);
  if (/\son[a-z]+="/i.test(html)) problems.push(`${page}: inline event handler (blocked by CSP)`);
  if (/<[a-z][^>]*\sstyle="/i.test(html)) problems.push(`${page}: style attribute (blocked by CSP)`);
  if (/<style[\s>]/i.test(html)) problems.push(`${page}: <style> element (blocked by CSP)`);
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${page}: missing <title>`);
}

for (const script of readdirSync(join(root, 'assets/js'))) {
  const js = readFileSync(join(root, 'assets/js', script), 'utf8');
  if (/\.innerHTML\s*=|insertAdjacentHTML|setAttribute\(\s*['"]style['"]/.test(js)) {
    problems.push(`assets/js/${script}: innerHTML / style attribute (unsafe or blocked by CSP)`);
  }
}

if (problems.length) {
  console.error(`Site check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Site check passed.');
