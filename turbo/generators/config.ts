import type { PlopTypes } from "@turbo/gen";

/** my-contract-v1 → MyContractV1 */
function toPascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("package", {
    description: "Scaffold a new @refarm.dev package",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Package name (without scope, e.g. my-contract-v1):",
        validate: (v: string) =>
          /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(v) || "Use lowercase kebab-case",
      },
      {
        type: "list",
        name: "type",
        message: "Package type:",
        choices: [
          "contract-v1",
          "buildable",
          "source-only",
          "wasm-component",
          "ui-library",
          "js-tool",
          "config-pkg",
        ],
      },
      {
        type: "input",
        name: "description",
        message: "Description:",
      },
      {
        type: "confirm",
        name: "private",
        message: "Private?",
        default: false,
      },
      {
        type: "list",
        name: "gate",
        message: "Register in capability gates (test-capabilities + gate-smoke-contracts + changeset)?",
        choices: ["none", "test:unit", "test:conformance"],
        default: (answers: { type?: string }) =>
          answers.type === "contract-v1" ? "test:unit" : "none",
      },
    ],
    actions(data) {
      if (!data) return [];
      const { name, type } = data;
      const dest = `packages/{{name}}`;
      const templateDir = `templates/${type}`;

      // SCREAMING_SNAKE_CASE: my-contract-v1 → MY_CONTRACT_V1
      data.constantName = name.replace(/-/g, "_").toUpperCase();
      // PascalCase: my-contract-v1 → MyContractV1
      data.pascalName = toPascalCase(name);
      data.privateStr = data.private ? "true" : "false";

      const actions: PlopTypes.ActionType[] = [
        {
          type: "addMany",
          destination: dest,
          templateFiles: `${templateDir}/**`,
          base: templateDir,
          globOptions: { dot: true },
        },
      ];

      // Patch root tsconfig.json paths for TS types
      const needsRootPaths = ["buildable", "source-only", "ui-library", "contract-v1"];
      if (needsRootPaths.includes(type)) {
        actions.push({
          type: "modify",
          path: "tsconfig.json",
          transform(content: string) {
            const key = `@refarm.dev/${name}`;
            if (content.includes(`"${key}"`)) return content;
            const newLine = `      "${key}": ["./packages/${name}/src"]`;
            // Surgical insert: find the closing } of the "paths" block by counting braces
            const pathsStart = content.indexOf('"paths"');
            if (pathsStart === -1) return content;
            let depth = 0;
            let closingIdx = -1;
            for (let i = content.indexOf("{", pathsStart); i < content.length; i++) {
              if (content[i] === "{") depth++;
              else if (content[i] === "}") {
                depth--;
                if (depth === 0) {
                  closingIdx = i;
                  break;
                }
              }
            }
            if (closingIdx === -1) return content;
            const before = content.slice(0, closingIdx).trimEnd();
            const after = content.slice(closingIdx);
            const needsComma = !before.endsWith(",");
            return `${before}${needsComma ? "," : ""}\n${newLine}\n    ${after}`;
          },
        });
      }

      // Register the package in the capability gates + a release changeset.
      // Closes the "registered in only one list" gap (see docs/PACKAGE_ACCEPTANCE_CHECKLIST.md):
      // a new gated package must appear in BOTH test-capabilities.mjs and gate-smoke-contracts.mjs.
      const gate = typeof data.gate === "string" ? data.gate : "none";
      if (gate !== "none") {
        const key = `packages/${name}`;
        const stepRun = `\t["${key}", "${gate}"],`;
        const stepBuild = `\t["${key}", "build"],`;

        const insertIntoSteps = (
          file: string,
          newLines: string,
        ): PlopTypes.ActionType => ({
          type: "modify",
          path: `scripts/ci/${file}`,
          transform(content: string) {
            const start = content.indexOf("const STEPS = [");
            if (start === -1) return content;
            const close = content.indexOf("];", start);
            if (close === -1) return content;
            // Idempotent: skip if this package is already registered in the array.
            if (content.slice(start, close).includes(`"${key}"`)) return content;
            return `${content.slice(0, close)}${newLines}${content.slice(close)}`;
          },
        });

        // test-capabilities.mjs runs the gate script only; gate-smoke-contracts.mjs builds first.
        actions.push(insertIntoSteps("test-capabilities.mjs", `${stepRun}\n`));
        actions.push(
          insertIntoSteps("gate-smoke-contracts.mjs", `${stepBuild}\n${stepRun}\n`),
        );
        actions.push({
          type: "add",
          path: ".changeset/{{name}}.md",
          template: '---\n"@refarm.dev/{{name}}": minor\n---\n\n{{description}}\n',
        });
      }

      return actions;
    },
  });
}
