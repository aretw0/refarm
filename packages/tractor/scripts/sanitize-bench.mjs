import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
    console.error('Usage: node sanitize-bench.mjs <file>');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(target, 'utf8'));
const root = process.cwd();

data.files.forEach(f => {
    // Make path relative to the package root
    if (path.isAbsolute(f.filepath)) {
        f.filepath = path.relative(root, f.filepath);
    }
});

fs.writeFileSync(target, JSON.stringify(data, null, 2));
console.log(`✅ Sanitized paths in ${target}`);
