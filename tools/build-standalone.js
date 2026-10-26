// Builds dist/duplo-track-planner.html: one self-contained file that runs without the server
// (layouts are then kept in the browser). Usage: node tools/build-standalone.js
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}\n</style>`);
html = html.replace('<script src="geometry.js"></script>', () => `<script>\n${read('geometry.js')}\n</script>`);
html = html.replace('<script src="sets.js"></script>', () => `<script>\n${read('sets.js')}\n</script>`);
html = html.replace('<script src="app.js"></script>', () => `<script>\n${read('app.js')}\n</script>`);
const out = path.join(__dirname, '..', 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'duplo-track-planner.html'), html);
console.log('wrote dist/duplo-track-planner.html', (html.length / 1024).toFixed(0) + ' KB');
