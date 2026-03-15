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

for (const pkg of packages) {
  const pkgJsonPath = path.join(packagesDir, pkg, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    let pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const original = JSON.stringify(pkgJson);

    // 1. Handle Main field
    if (mode === 'src') {
      if (pkgJson.main?.includes('dist/')) {
        const tsMatch = pkgJson.main.replace('dist/', 'src/').replace('.js', '.ts');
        const jsMatch = pkgJson.main.replace('dist/', 'src/').replace('.js', '.js');
        if (fs.existsSync(path.join(packagesDir, pkg, tsMatch))) {
          pkgJson.main = tsMatch;
        } else if (fs.existsSync(path.join(packagesDir, pkg, jsMatch))) {
          pkgJson.main = jsMatch;
        }
      }
    } else {
      if (pkgJson.main?.includes('src/')) {
        pkgJson.main = pkgJson.main.replace('src/', 'dist/').replace('.ts', '.js');
      }
    }

    // 2. Handle Types field
    if (mode === 'src') {
      if (pkgJson.types?.includes('dist/')) {
          const tsMatch = pkgJson.types.replace('dist/', 'src/').replace('.d.ts', '.ts');
          if (fs.existsSync(path.join(packagesDir, pkg, tsMatch))) {
            pkgJson.types = tsMatch;
          }
      }
    } else {
      if (pkgJson.types?.includes('src/')) {
        pkgJson.types = pkgJson.types.replace('src/', 'dist/').replace('.ts', '.d.ts');
      }
    }

    // 3. Handle Exports field recursively
    if (pkgJson.exports) {
      const processExports = (obj) => {
        for (const key in obj) {
          if (typeof obj[key] === 'string') {
            if (mode === 'src' && obj[key].includes('dist/')) {
              const tsMatch = obj[key].replace('dist/', 'src/').replace('.js', '.ts');
              const jsMatch = obj[key].replace('dist/', 'src/').replace('.js', '.js');
              if (fs.existsSync(path.join(packagesDir, pkg, tsMatch))) {
                obj[key] = tsMatch;
              } else if (fs.existsSync(path.join(packagesDir, pkg, jsMatch))) {
                obj[key] = jsMatch;
              }
            } else if (mode === 'dist' && obj[key].includes('src/')) {
              obj[key] = obj[key].replace('src/', 'dist/').replace('.ts', '.js');
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
