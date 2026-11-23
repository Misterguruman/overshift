/*
 * Build helper (no dependencies): `node tools/build.js`
 *  1. dist/overshift.html: one self-contained page with every script inlined (the shareable browser build)
 *  2. android/app/src/main/assets/web/: a copy of web/ for the Android shell
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const web = path.join(root, 'web');

let html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const js = fs.readFileSync(path.join(web, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>\n/* ' + src + ' */\n' + js + '\n</script>';
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'overshift.html'), html);
console.log('wrote dist/overshift.html', (html.length / 1024).toFixed(1) + ' KB');

// the claude.ai Artifact host adds its own doctype/html/head/body skeleton
const body = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
const titled = body.replace(/<title>[^<]*<\/title>\s*/, '');
fs.writeFileSync(path.join(root, 'dist', 'overshift-artifact.html'), '<title>Overshift</title>\n' + titled);
console.log('wrote dist/overshift-artifact.html');

const dest = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'web');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(web, dest, { recursive: true });
console.log('copied web/ to android/app/src/main/assets/web');
