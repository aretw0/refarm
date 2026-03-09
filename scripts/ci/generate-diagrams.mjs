import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';

const execAsync = promisify(exec);

const DIAGRAM_EXT = '.mermaid';

async function generateSVG(filePath) {
  const svgPath = filePath.replace(DIAGRAM_EXT, '.svg');
  console.log(`Generating SVG for ${filePath}...`);
  try {
    // Using npx mmdc to ensure we use the local version
    await execAsync(`npx mmdc -i ${filePath} -o ${svgPath} -t neutral`);
    console.log(`Successfully generated ${svgPath}`);
  } catch (error) {
    console.error(`Error generating SVG for ${filePath}:`, error.message);
  }
}

async function findMermaidFiles(dir) {
  const files = await fs.readdir(dir, { recursive: true });
  return files
    .filter(file => file.endsWith(DIAGRAM_EXT))
    .map(file => path.join(dir, file));
}

async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch');
  const targetDirs = ['docs', 'specs/ADRs'];

  for (const dir of targetDirs) {
    const fullPath = path.resolve(process.cwd(), dir);
    const files = await findMermaidFiles(fullPath);
    
    for (const file of files) {
      await generateSVG(file);
    }

    if (watchMode) {
      console.log(`Watching ${dir} for ${DIAGRAM_EXT} changes...`);
      chokidar.watch(fullPath, { ignored: /(^|[\/\\])\../ }).on('change', async (filePath) => {
        if (filePath.endsWith(DIAGRAM_EXT)) {
          await generateSVG(filePath);
        }
      });
    }
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
