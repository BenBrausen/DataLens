// Builds a single self-contained page (dist/plainsight.html) with the app, map
// geometry and the latest data snapshots inlined, for hosting as one file
// (claude.ai artifact, GitHub Pages, any static host).
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const safe = s => s.replace(/<\/(script)/gi, '<\\/$1');
let html = read('public/index.html');
const catalog = JSON.parse(read('public/data/catalog.json'));
const datasets = Object.fromEntries(catalog.map(c => [c.id, JSON.parse(read(`public/data/${c.id}.json`))]));
const js = f => `<script>${safe(read(f))}</script>`;
html = html
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>/i, '')
  .replace('<link rel="stylesheet" href="css/app.css">', `<style>${read('public/css/app.css')}</style>`)
  .replace('<script src="vendor/d3.min.js"></script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>')
  .replace('<script src="vendor/topojson-client.min.js"></script>', js('public/vendor/topojson-client.min.js'))
  .replace('<script src="js/geo-data.js"></script>', js('public/js/geo-data.js'))
  .replace('<!--INLINE_DATA-->', `<script>window.PS_EMBED=${safe(JSON.stringify({ catalog, datasets }))};</script>`)
  .replace(/<script src="(js\/[a-z]+\.js)"><\/script>/g, (_, f) => js('public/' + f))
  .replace('<!--INLINE_HEAD-->', '')
  .replace(/<\/head>\s*<body>/, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/plainsight.html', html);
// Full standalone document for any static host (GitHub Pages, S3, Netlify).
fs.writeFileSync('dist/index.html', '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + html.replace(/(<\/style>)/, '$1\n</head>\n<body>') + '\n</body>\n</html>\n');
console.log('dist/plainsight.html', (html.length / 1e6).toFixed(2) + ' MB');
