import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

/**
 * Resolution Switcher — Toggles between Local (src) and Published (dist) resolution.
 * This is an internal utility of @refarm.dev/toolbox.
 */

export async function switchResolution(mode, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const searchDirs = ['packages', 'apps'];
  
  const allPackages = [];
  for (const dir of searchDirs) {
    const fullPath = path.join(rootDir, dir);
    if (fs.existsSync(fullPath)) {
      const items = fs.readdirSync(fullPath);
      for (const item of items) {
        const pkgPath = path.join(fullPath, item);
        const pkgJsonPath = path.join(pkgPath, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          allPackages.push({ name: item, path: pkgPath, jsonPath: pkgJsonPath, type: dir });
        }
      }
    }
  }

  if (mode === 'status') {
    console.log(chalk.blue('📊 Monorepo Resolution Status:'));
    for (const pkg of allPackages) {
      const pkgJson = JSON.parse(fs.readFileSync(pkg.jsonPath, 'utf8'));
      
      const isSrcPath = (str) => {
        if (typeof str !== 'string') return false;
        const p = str.replace(/^\.\//, '');
        // Status is LOCAL only if it points to src/ or test/ or ends in .ts/.mts
        // AND it does NOT point to dist/ or pkg/ (for WASM)
        if (p.includes('dist/') || p.includes('pkg/')) return false;
        return p.startsWith('src/') || p.startsWith('test/') || p.endsWith('.ts') || p.endsWith('.mts');
      };
      
      const checkEntryPoints = (obj) => {
        if (typeof obj === 'string') return isSrcPath(obj);
        if (typeof obj === 'object' && obj !== null) {
          // For exports, we care primarily about the root "." entry
          if (obj['.']) return checkEntryPoints(obj['.']);
          
          // If no root entry, check standard keys
          const entryKeys = ['import', 'require', 'types', 'default'];
          for (const key of entryKeys) {
            if (obj[key] && checkEntryPoints(obj[key])) return true;
          }
        }
        return false;
      };
      
      let isSrc = false;
      if (pkg.type === 'apps') {
        isSrc = fs.existsSync(path.join(pkg.path, 'src'));
      } else {
        // Status is strictly based on main, types and the root of exports
        isSrc = isSrcPath(pkgJson.main) || isSrcPath(pkgJson.types) || checkEntryPoints(pkgJson.exports);
      }
      
      const status = isSrc ? chalk.yellow('LOCAL (src)') : chalk.green('PUBLISHED (dist)');
      const label = `[${pkg.type}] ${pkg.name}`;
      console.log(`  - ${chalk.bold(label.padEnd(35))} : ${status}`);
    }
    return;
  }

  if (mode === 'sync-tsconfig') {
    console.log(chalk.blue('🔧 Syncing root tsconfig.json paths...'));
    const tsconfigPath = path.join(rootDir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      console.error(chalk.red('❌ Root tsconfig.json not found.'));
      return;
    }

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    const paths = {
      "@refarm.dev/locales/*": ["./locales/*"],
      "@refarm.dev/*": ["./packages/*/src"]
    };

    for (const pkg of allPackages) {
      if (pkg.type !== 'packages') continue;
      const pkgJson = JSON.parse(fs.readFileSync(pkg.jsonPath, 'utf8'));
      const pkgName = pkgJson.name;
      if (!pkgName || !pkgName.startsWith('@refarm.dev/')) continue;

      // Special cases for complex mappings
      if (pkgName === '@refarm.dev/tractor') {
        paths["@refarm.dev/tractor"] = ["./packages/tractor-ts/src/index.ts"];
        paths["@refarm.dev/tractor/test/test-utils"] = ["./packages/tractor-ts/test/test-utils.ts"];
        continue;
      }
      if (pkgName === '@refarm.dev/homestead') {
        paths["@refarm.dev/homestead/sdk"] = ["./packages/homestead/src/sdk/index.ts"];
        paths["@refarm.dev/homestead/ui"] = ["./packages/homestead/src/ui/index.ts"];
        continue;
      }

      // Default mapping to src/index.ts if it exists
      const srcIndex = path.join(pkg.path, 'src', 'index.ts');
      const srcIndexMts = path.join(pkg.path, 'src', 'index.mts');
      const srcIndexTsx = path.join(pkg.path, 'src', 'index.tsx');
      
      let target = null;
      if (fs.existsSync(srcIndex)) target = `./packages/${pkg.name}/src/index.ts`;
      else if (fs.existsSync(srcIndexMts)) target = `./packages/${pkg.name}/src/index.mts`;
      else if (fs.existsSync(srcIndexTsx)) target = `./packages/${pkg.name}/src/index.tsx`;
      
      if (target) {
        paths[pkgName] = [target];
      }
    }

    tsconfig.compilerOptions.paths = paths;
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
    console.log(chalk.green('✨ tsconfig.json paths synchronized.'));
    return;
  }

  console.log(chalk.blue(`🔄 Switching workspace resolution to: ${chalk.bold(mode)}`));

  const resolveToSrc = (pkgPath, distPath) => {
    if (!distPath || typeof distPath !== 'string') return null;
    // Normalize path for lookup
    const base = distPath.replace(/^\.\//, '').replace(/^(dist|pkg)\//, '').replace(/\.(mjs|js|d\.mts|d\.ts)$/, '');
    const extensions = ['.ts', '.mts', '.mjs', '.js'];
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

  const safeResolveToDist = (srcPath) => {
    if (!srcPath || typeof srcPath !== 'string') return srcPath;
    let p = srcPath.replace(/^\.\//, '');
    if (p.startsWith('src/')) {
      p = p.replace('src/', 'dist/');
    } else if (p.startsWith('test/')) {
      p = p.replace('test/', 'dist/test/');
    } else if (!p.startsWith('dist/') && !p.startsWith('pkg/')) {
      p = 'dist/' + p;
    }
    
    if (p.endsWith('.d.ts') || p.endsWith('.d.mts')) return './' + p;
    if (p.endsWith('.mjs')) return './' + p;
    return './' + p.replace(/\.ts$/, '.js').replace(/\.mts$/, '.mjs');
  };

  for (const pkg of allPackages) {
    let pkgJson = JSON.parse(fs.readFileSync(pkg.jsonPath, 'utf8'));
    const original = JSON.stringify(pkgJson);

    if (pkgJson.name === 'refarm' && pkg.type !== 'apps' && pkg.type !== 'packages') continue;
    if (pkg.type === 'apps') continue;

    let changes = 0;

    // 1. Main
    if (mode === 'src') {
      if (pkgJson.main?.includes('dist/') || pkgJson.main?.includes('pkg/')) {
        const srcMatch = resolveToSrc(pkg.path, pkgJson.main);
        if (srcMatch) { pkgJson.main = srcMatch; changes++; }
      }
    } else {
      if (pkgJson.main && !pkgJson.main.includes('dist/') && !pkgJson.main.includes('pkg/')) {
        pkgJson.main = safeResolveToDist(pkgJson.main);
        changes++;
      }
    }

    // 1.1 Module
    if (mode === 'src') {
      if (pkgJson.module?.includes('dist/') || pkgJson.module?.includes('pkg/')) {
        const srcMatch = resolveToSrc(pkg.path, pkgJson.module);
        if (srcMatch) { pkgJson.module = srcMatch; changes++; }
      }
    } else {
      if (pkgJson.module && !pkgJson.module.includes('dist/') && !pkgJson.module.includes('pkg/')) {
        pkgJson.module = safeResolveToDist(pkgJson.module);
        changes++;
      }
    }

    // 2. Types
    if (mode === 'src') {
      if (pkgJson.types?.includes('dist/') || pkgJson.types?.includes('pkg/')) {
        const srcMatch = resolveToSrc(pkg.path, pkgJson.types);
        if (srcMatch) { pkgJson.types = srcMatch; changes++; }
      }
    } else {
      if (pkgJson.types && !pkgJson.types.includes('dist/') && !pkgJson.types.includes('pkg/')) {
        let t = safeResolveToDist(pkgJson.types);
        if (!t.endsWith('.d.ts') && !t.endsWith('.d.mts')) {
          t = t.replace(/\.js$/, '.d.ts').replace(/\.mjs$/, '.d.mts');
        }
        pkgJson.types = t;
        changes++;
      }
    }

    // 3. Exports
    if (pkgJson.exports) {
      const processExports = (obj, parentKey = null) => {
        for (const key in obj) {
          if (typeof obj[key] === 'string') {
            if (mode === 'src') {
              if (obj[key].includes('dist/') || obj[key].includes('pkg/')) {
                const srcMatch = resolveToSrc(pkg.path, obj[key]);
                if (srcMatch) { obj[key] = srcMatch; changes++; }
              }
            } else if (mode === 'dist') {
              if (obj[key].includes('src/') || obj[key].includes('test/') || obj[key].endsWith('.ts') || obj[key].endsWith('.mts')) {
                let d = safeResolveToDist(obj[key]);
                if (key === 'types' || parentKey === 'types') {
                  if (!d.endsWith('.d.ts') && !d.endsWith('.d.mts')) {
                    d = d.replace(/\.js$/, '.d.ts').replace(/\.mjs$/, '.d.mts');
                  }
                }
                obj[key] = d;
                changes++;
              }
            }
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            processExports(obj[key], key);
          }
        }
      };
      processExports(pkgJson.exports);
    }

    if (changes > 0) {
      console.log(chalk.gray(`  - Updated ${pkg.name}`));
      fs.writeFileSync(pkg.jsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    }
  }
  console.log(chalk.green(`\n✨ Resolution updated to ${mode}. Soil is synchronized.`));
}
