import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

/**
 * Resolution Switcher — Toggles between Local (src) and Published (dist) resolution.
 * Usage: node scripts/reso.mjs <src|dist|status>
 */

const mode = process.argv[2];
if (mode !== 'src' && mode !== 'dist' && mode !== 'status') {
  console.error(chalk.red('Usage: node scripts/reso.mjs <src|dist|status>'));
  process.exit(1);
}

const packagesDir = 'packages';
const packages = fs.readdirSync(packagesDir);

if (mode === 'status') {
  console.log(chalk.blue('📊 Monorepo Resolution Status:'));
  for (const pkg of packages) {
    const pkgJsonPath = path.join(packagesDir, pkg, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const isSrc = pkgJson.main?.includes('src/') || JSON.stringify(pkgJson.exports)?.includes('src/');
      const status = isSrc ? chalk.yellow('LOCAL (src)') : chalk.green('PUBLISHED (dist)');
      console.log(`  - ${chalk.bold(pkg.padEnd(25))} : ${status}`);
    }
  }
  process.exit(0);
}

console.log(chalk.blue(`🔄 Switching workspace resolution to: ${chalk.bold(mode)}`));

const resolveToSrc = (pkgPath, distPath) => {
  const base = distPath.replace(/^\.\//, '').replace(/^dist\//, '').replace(/\.(mjs|js|d\.mts|d\.ts)$/, '');
  const extensions = ['.ts', '.mjs', '.js'];
  const dirs = ['src/', ''];
  
  for (const dir of dirs) {
    for (const ext of extensions) {
      const cand = `${dir}${base}${ext}`;
      if (fs.existsSync(path.join(pkgPath, cand))) {
        return `./${cand}`;
      }
    }
  }
  return null;
};

const resolveToDist = (srcPath) => {
  return srcPath
    .replace(/^\.\//, '')
    .replace(/^src\//, 'dist/')
    .replace(/\.ts$/, '.js')
    .replace(/\.mjs$/, '.mjs') // Keep .mjs if it was .mjs
    // If it was in root, move to dist
    .replace(/^([^d][^i][^s][^t])/, 'dist/$1'); 
};

// Refined resolveToDist that's safer
const safeResolveToDist = (srcPath) => {
  if (!srcPath) return srcPath;
  let p = srcPath.replace(/^\.\//, '');
  if (p.startsWith('src/')) {
    p = p.replace('src/', 'dist/');
  } else if (p.startsWith('pkg/')) {
    // Keep as is, pkg is distribution-ready for WASM
  } else if (!p.startsWith('dist/')) {
    p = 'dist/' + p;
  }
  
  if (p.endsWith('.d.ts') || p.endsWith('.d.mts')) return './' + p;
  return './' + p.replace(/\.ts$/, '.js').replace(/\.mts$/, '.mjs');
};

for (const pkg of packages) {
  const pkgPath = path.join(packagesDir, pkg);
  const pkgJsonPath = path.join(pkgPath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    let pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const original = JSON.stringify(pkgJson);

    // 1. Handle Main field
    if (mode === 'src') {
      if (pkgJson.main?.includes('dist/')) {
        const srcMatch = resolveToSrc(pkgPath, pkgJson.main);
        if (srcMatch) pkgJson.main = srcMatch;
      }
    } else {
      if (!pkgJson.main?.includes('dist/') && pkgJson.name !== 'refarm') {
        pkgJson.main = safeResolveToDist(pkgJson.main);
      }
    }

    // 2. Handle Types field
    if (mode === 'src') {
      if (pkgJson.types?.includes('dist/')) {
        const srcMatch = resolveToSrc(pkgPath, pkgJson.types);
        if (srcMatch) pkgJson.types = srcMatch;
      }
    } else {
      if (pkgJson.types && !pkgJson.types.includes('dist/') && !pkgJson.types.startsWith('pkg/')) {
        let t = safeResolveToDist(pkgJson.types);
        if (!t.endsWith('.d.ts') && !t.endsWith('.d.mts')) {
            t = t.replace(/\.js$/, '.d.ts').replace(/\.mjs$/, '.d.mts');
        }
        pkgJson.types = t;
      }
    }

    // 3. Handle Exports field recursively
    if (pkgJson.exports) {
      const processExports = (obj) => {
        for (const key in obj) {
          if (typeof obj[key] === 'string') {
            if (mode === 'src' && obj[key].includes('dist/')) {
              const srcMatch = resolveToSrc(pkgPath, obj[key]);
              if (srcMatch) obj[key] = srcMatch;
            } else if (mode === 'dist' && !obj[key].includes('dist/') && !obj[key].startsWith('node_modules/')) {
              obj[key] = safeResolveToDist(obj[key]);
            }
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            processExports(obj[key]);
          }
        }
      };
      processExports(pkgJson.exports);
    }

    if (JSON.stringify(pkgJson) !== original) {
      console.log(chalk.gray(`  - Updated ${pkg}`));
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    }
  }
}

console.log(chalk.green('\n✨ Resolution updated. Soil is synchronized.'));
