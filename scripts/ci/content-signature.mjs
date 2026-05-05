#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {
    name: 'validation',
    output: 'signature_key',
    patternsFile: '',
    prefix: 'refarm-validation',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--name') args.name = argv[++index] || args.name;
    else if (arg === '--output') args.output = argv[++index] || args.output;
    else if (arg === '--patterns-file') args.patternsFile = argv[++index] || args.patternsFile;
    else if (arg === '--prefix') args.prefix = argv[++index] || args.prefix;
    else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readPatterns(patternsFile) {
  const fromEnv = process.env.REFARM_SIGNATURE_PATTERNS || '';
  const fromFile = patternsFile && existsSync(patternsFile) ? readFileSync(patternsFile, 'utf8') : '';
  return `${fromFile}\n${fromEnv}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function gitLsFiles(pattern) {
  const output = execFileSync('git', ['ls-files', '--', pattern], { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const args = parseArgs(process.argv.slice(2));
const patterns = readPatterns(args.patternsFile);
if (patterns.length === 0) {
  throw new Error('No signature patterns were provided. Use --patterns-file or REFARM_SIGNATURE_PATTERNS.');
}

const files = [...new Set(patterns.flatMap(gitLsFiles))].sort();
const hash = createHash('sha256');
hash.update(`name=${args.name}\0`);
hash.update(`version=${process.env.REFARM_SIGNATURE_VERSION || '1'}\0`);
hash.update(`extra=${process.env.REFARM_SIGNATURE_EXTRA || ''}\0`);

for (const pattern of patterns) {
  hash.update(`pattern=${pattern}\0`);
}

for (const file of files) {
  hash.update(`file=${file}\0`);
  hash.update(readFileSync(file));
  hash.update('\0');
}

const digest = hash.digest('hex');
const slug = args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'validation';
const key = `${args.prefix}-${slug}-${digest}`;
const outputPath = process.env.GITHUB_OUTPUT;

if (outputPath) {
  appendFileSync(outputPath, `${args.output}=${key}\n`);
  appendFileSync(outputPath, `${args.output}_files=${files.length}\n`);
}

console.log(`::notice::${args.name} signature ${digest.slice(0, 16)} covers ${files.length} files`);
console.log(key);
