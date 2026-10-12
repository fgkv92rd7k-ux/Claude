// Writes dist/page.html: index.html without the document skeleton, which is the shape the claude.ai Artifact tool publishes
// (it wraps the page in its own <!doctype>/<head>/<body>). Usage: node tools/publish-prep.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), out = process.argv[2] || join(root, 'dist');
let html = readFileSync(join(root, 'index.html'), 'utf8');
const a = html.indexOf('<body>'), b = html.lastIndexOf('</body>');
if (a < 0 || b < 0) throw new Error('index.html: no <body>');
html = html.slice(a + 6, b).replace(/^\s*\n/, '');
mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'page.html'), html);
console.log('wrote', join(out, 'page.html'), html.length, 'bytes');
