/**
 * Link the wealth UI from the repo root into public/wealth so there is only ONE place to edit.
 * Edit index.html, app.js, and import-template.csv in the project root only.
 * Run once after clone (or "npm run link-wealth"). No copy step needed.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const destDir = path.join(__dirname, '..', 'public', 'wealth');
const files = ['index.html', 'app.js', 'import-template.csv'];

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Relative from public/wealth/ to repo root = ../../
const relativeToRoot = path.relative(destDir, repoRoot).replace(/\\/g, '/');

for (const name of files) {
  const src = path.join(repoRoot, name);
  const dest = path.join(destDir, name);
  if (!fs.existsSync(src)) {
    console.warn('link-wealth: skipping ' + name + ' (not found at root)');
    continue;
  }
  const target = path.join(relativeToRoot, name).replace(/\\/g, '/');
  try {
    if (fs.existsSync(dest)) {
      const stat = fs.lstatSync(dest);
      if (stat.isSymbolicLink()) {
        const current = fs.readlinkSync(dest);
        if (path.resolve(destDir, current) === path.resolve(src)) {
          console.log('link-wealth: ' + name + ' already linked');
          continue;
        }
      }
      fs.unlinkSync(dest);
    }
    fs.symlinkSync(target, dest);
    console.log('link-wealth: ' + name + ' -> link to root');
  } catch (err) {
    console.error('link-wealth: failed for ' + name + ':', err.message);
  }
}

console.log('Wealth UI linked to root (single source of truth).');
