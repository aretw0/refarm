import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);

    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            if (!['node_modules', '.git', 'dist', '.turbo', '.astro'].includes(file)) {
                arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
            }
        } else {
            const ext = path.extname(file);
            if (['.md', '.ts', '.mjs', '.json', '.jsonld', '.yml', '.yaml', '.wit'].includes(ext) || file === 'package.json') {
                arrayOfFiles.push(path.join(dirPath, "/", file));
            }
        }
    });

    return arrayOfFiles;
}

function replaceInFile(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let changed = false;

    // Sort keys by length descending to replace longer matches first
    const keys = Object.keys(replacements).sort((a, b) => b.length - a.length);

    for (const search of keys) {
        const replace = replacements[search];
        if (content.includes(search)) {
            content = content.split(search).join(replace);
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`Updated: ${filePath}`);
    }
}

async function main() {
    console.log("🚨 DOOMSDAY REBRAND PROTOCOL 🚨");
    console.log("This script will perform a highly destructive, atomic find-and-replace across the entire monorepo.");
    console.log("Use this if faced with a Cease & Desist or a forced pivot.");

    const confirm = await question("\nAre you ABSOLUTELY sure you want to proceed? (Type 'I_AM_SURE'): ");
    if (confirm !== 'I_AM_SURE') {
        console.log("Aborted.");
        process.exit(0);
    }

    const configPath = path.resolve(process.cwd(), 'refarm.config.json');
    if (!fs.existsSync(configPath)) {
        console.error("refarm.config.json not found. Must run from project root.");
        process.exit(1);
    }

    const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const oldName = currentConfig.brand.name; // e.g. Refarm
    const oldSlug = currentConfig.brand.slug; // e.g. refarm

    console.log(`\nCurrent Identity:`);
    console.log(`Name: ${oldName}, Slug: ${oldSlug}`);

    const newName = await question("\nEnter New Brand Name (e.g. Yield): ");
    const newSlug = await question("Enter New Slug (e.g. yield): ");
    const newPrefix = await question(`Enter New Package/Domain Prefix (e.g. yield): `);

    if (!newName || !newSlug || !newPrefix) {
        console.log("Invalid input. Aborting.");
        process.exit(1);
    }

    // Safety check - we dynamically generate the old ones based on the slug to ensure accurate replacement 
    // even if it was run previously
    const replacements = {
        [oldName]: newName,
        [oldSlug]: newSlug,
        [`@${oldSlug}.dev`]: `@${newPrefix}.dev`,
        [`@${oldSlug}.me`]: `@${newPrefix}.me`,
        [`@${oldSlug}.social`]: `@${newPrefix}.social`,
        [`${oldSlug}.dev.br`]: `${newPrefix}.dev.br`,
        [`${oldSlug}.dev`]: `${newPrefix}.dev`,
        [`${oldSlug}-dev`]: `${newPrefix}-dev`,
    };

    console.log("\nReplacements Map:", replacements);

    const finalConfirm = await question("\nApply these replacements globally? (Y/n): ");
    if (finalConfirm.trim().toLowerCase() === 'n') {
        console.log("Aborted.");
        process.exit(0);
    }

    const files = getAllFiles(process.cwd());
    console.log(`\nScanning ${files.length} files...`);

    for (const file of files) {
        replaceInFile(file, replacements);
    }

    console.log("\n📦 Relinking Turborepo dependencies (npm install)...");
    try {
        execSync('npm install', { stdio: 'inherit' });
    } catch (err) {
        console.error("npm install failed, you may need to resolve some manual package name conflicts in package.json");
    }

    console.log("\n✅ Rebrand protocol complete. Please review the git diff carefully.");
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
