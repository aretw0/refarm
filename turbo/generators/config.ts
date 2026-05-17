import type { PlopTypes } from "@turbo/gen";

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
        default: true,
      },
    ],
    actions(data) {
      if (!data) return [];
      const { name, type } = data;
      const dest = `packages/{{name}}`;
      const templateDir = `turbo/generators/templates/${type}`;

      // SCREAMING_SNAKE_CASE: my-contract-v1 → MY_CONTRACT_V1
      data.constantName = name.replace(/-/g, "_").toUpperCase();
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

      // Patch root tsconfig.json paths for TS types (buildable, source-only, ui-library)
      if (type === "buildable" || type === "source-only" || type === "ui-library") {
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
