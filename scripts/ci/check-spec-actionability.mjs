#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function getChangedFiles() {
  const out = runGit(['diff', '--name-only', '--diff-filter=ACMR']);
  if (!out) {
    return [];
  }
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function getTrackedSpecFiles() {
  const out = runGit(['ls-files', 'specs/**/*.md']);
  if (!out) {
    return [];
  }
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function isFeatureSpec(filePath) {
  return /^specs\/features\/.+\.md$/.test(filePath) && !filePath.endsWith('/template.md');
}

function isAdrSpec(filePath) {
  return /^specs\/ADRs\/ADR-\d+.*\.md$/.test(filePath);
}

function readStatus(content) {
  const match = content.match(/^\*\*Status\*\*:\s*(.+)$/m);
  return match ? match[1].trim().toLowerCase() : '';
}

function shouldCheckFeature(status) {
  return /(draft|in progress|proposed)/.test(status);
}

function shouldCheckAdr(status) {
  return /(draft|proposed)/.test(status);
}

function missingSections(content, requiredHeadings) {
  const missing = [];
  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) {
      missing.push(heading);
    }
  }
  return missing;
}

async function main() {
  const args = process.argv.slice(2);
  const checkAll = args.includes('--all');
  const jsonOutput = args.includes('--json');
  const strict = args.includes('--strict');

  const files = checkAll ? getTrackedSpecFiles() : getChangedFiles();
  const findings = [];

  for (const filePath of files) {
    if (!isFeatureSpec(filePath) && !isAdrSpec(filePath)) {
      continue;
    }

    const content = await readFile(filePath, 'utf8');
    const status = readStatus(content);

    if (isFeatureSpec(filePath)) {
      if (!shouldCheckFeature(status)) {
        continue;
      }
      const missing = missingSections(content, [
        '## Traceability Matrix',
        '## Execution Plan',
      ]);
      if (missing.length > 0) {
        findings.push({ filePath, kind: 'feature', status, missing });
      }
      continue;
    }

    if (isAdrSpec(filePath)) {
      if (!shouldCheckAdr(status)) {
        continue;
      }
      const missing = missingSections(content, ['## Operationalization']);
      if (missing.length > 0) {
        findings.push({ filePath, kind: 'adr', status, missing });
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ ok: strict ? findings.length === 0 : true, strict, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log('check-spec-actionability: ok');
  } else {
    console.error(
      strict
        ? 'check-spec-actionability: missing required actionability sections\n'
        : 'check-spec-actionability: suggestions found (informational by default)\n'
    );
    for (const finding of findings) {
      console.error(`- ${finding.filePath} [${finding.kind}] (status: ${finding.status})`);
      for (const heading of finding.missing) {
        console.error(`  - missing: ${heading}`);
      }
    }
    if (!strict) {
      console.error('\nRun with --strict to fail on findings.');
    }
  }

  process.exit(strict && findings.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`check-spec-actionability: failed: ${error.message}`);
  process.exit(1);
});
