const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'web');

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function cp(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
function cpDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) cpDir(s, d);
    else cp(s, d);
  }
}

rmrf(web);
fs.mkdirSync(web, { recursive: true });
cp(path.join(root, 'index.html'), path.join(web, 'index.html'));
cpDir(path.join(root, 'css'), path.join(web, 'css'));
cpDir(path.join(root, 'js'), path.join(web, 'js'));
console.log('synced web assets ->', web);
