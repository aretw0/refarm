import {
  changedSourceFiles,
  organizeImports,
  uniqueSourceFiles,
} from "./imports.mjs";

export function printImportsUsage(stream = process.stderr) {
  stream.write("Usage: refarm-task imports [--check] [--all|file...]\n");
  stream.write("\n");
  stream.write("Defaults to changed source files from git. Skips dist/, build/, .turbo/, node_modules/, and .d.ts.\n");
}

export function runImportsCommand(argv = process.argv.slice(2), options = {}) {
  const root = options.cwd ?? process.cwd();
  const stderr = options.stderr ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;
  const args = argv[0] === "imports" ? argv.slice(1) : argv;
  const check = args.includes("--check");
  const all = args.includes("--all");
  const files = args.filter((arg) => arg !== "--check" && arg !== "--all");

  if (args.includes("--help") || args.includes("-h")) {
    printImportsUsage(stderr);
    return 0;
  }

  let selected;
  if (all) {
    stderr.write("Use explicit files or changed-file mode; --all is intentionally not implemented for this repo.\n");
    return 1;
  } else if (files.length > 0) {
    selected = uniqueSourceFiles(files, root);
  } else {
    selected = changedSourceFiles(root);
  }

  if (selected.length === 0) {
    stdout.write("No changed source files to organize.\n");
    return 0;
  }

  const changed = organizeImports(selected, { root, check });
  if (changed.length === 0) {
    stdout.write(`Imports already organized (${selected.length} file${selected.length === 1 ? "" : "s"} checked).\n`);
    return 0;
  }

  for (const file of changed) stdout.write(`${file}\n`);

  if (check) {
    stderr.write(`Imports need organizing in ${changed.length} file${changed.length === 1 ? "" : "s"}.\n`);
    return 1;
  }

  stdout.write(`Organized imports in ${changed.length} file${changed.length === 1 ? "" : "s"}.\n`);
  return 0;
}

