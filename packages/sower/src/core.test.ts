import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SowerCore } from "./core";

describe("SowerCore Scaffolding (Isolated)", () => {
    let tempDir: string;

    beforeEach(() => {
        // Create a unique temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sower-test-"));
        vi.stubEnv("REFARM_SITE_URL", "https://aretw0.github.io/refarm");
    });

    afterEach(() => {
        // Cleanup the temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        vi.unstubAllEnvs();
    });

    it("should hydrate the 'courier' template correctly", async () => {
        const sower = new SowerCore();
        const projectName = "test-courier-farm";
        const targetDir = path.join(tempDir, projectName);

        const result = await sower.scaffold("courier", { 
            name: projectName, 
            targetDir 
        });

        expect(result).toBeDefined();
        expect(result?.tier).toBe("citizen");
        expect(result?.config.type).toBe("app");

        // Verify files were copied (template has README.md in typescript subpath)
        const readmePath = path.join(targetDir, "README.md");
        expect(fs.existsSync(readmePath)).toBe(true);

        // Verify token substitution
        const readmeContent = fs.readFileSync(readmePath, "utf-8");
        expect(readmeContent).toContain(projectName);
    });

    it("should hydrate the 'rust-plugin' template correctly", async () => {
        const sower = new SowerCore();
        const projectName = "test-rust-plugin";
        const targetDir = path.join(tempDir, projectName);

        const result = await sower.scaffold("rust-plugin", { 
            name: projectName, 
            targetDir 
        });

        expect(result).toBeDefined();
        expect(result?.tier).toBe("citizen");
        expect(result?.config.type).toBe("plugin");
        expect(result?.config.engine).toBe("heartwood");

        // Verify files were copied (rust-plugin has Cargo.toml)
        expect(fs.existsSync(path.join(targetDir, "Cargo.toml"))).toBe(true);
    });

    it("should generate correct brand configuration", async () => {
        const sower = new SowerCore();
        const projectName = "My Awesome Farm";
        const targetDir = path.join(tempDir, "my-awesome-farm");

        const result = await sower.scaffold("courier", { 
            name: projectName, 
            targetDir 
        });

        expect(result?.config.brand.name).toBe(projectName);
        expect(result?.config.brand.slug).toBe("my-awesome-farm");
    });
});
