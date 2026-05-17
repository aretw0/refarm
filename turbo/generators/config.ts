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
    ],
    actions(data) {
      if (!data) return [];
      const { name, type } = data;
      const dest = `packages/{{name}}`;
      const templateDir = `turbo/generators/templates/${type}`;

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
            const tsconfig = JSON.parse(content);
            tsconfig.compilerOptions ??= {};
            const paths = tsconfig.compilerOptions.paths ?? {};
            paths[`@refarm.dev/${name}`] = [`./packages/${name}/src`];
            tsconfig.compilerOptions.paths = paths;
            return JSON.stringify(tsconfig, null, 2) + "\n";
          },
        });
      }

      return actions;
    },
  });
}
