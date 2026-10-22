import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const entry = join(root, "dist", "index.js");

beforeAll(() => {
  execFileSync(
    process.execPath,
    [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );
}, 120_000);

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("PLAY_")) env[k] = v;
  }
  return { ...env, ...extra };
}

describe("stdio server", () => {
  it("lists tools and answers list_apps over stdio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plm-stdio-"));
    const keyFile = join(dir, "key.json");
    await writeFile(keyFile, "{}");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: cleanEnv({
        PLAY_KEY_FILE: keyFile,
        PLAY_ALLOWED_PACKAGES: "no.example.app1,no.example.app2",
        PLAY_DRAFT_DIR: join(dir, "drafts"),
      }),
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("list_apps");
      expect(names).not.toContain("apply_draft");
      const res = await client.callTool({ name: "list_apps", arguments: {} });
      const text = (res.content as { text: string }[])[0]?.text ?? "";
      expect(JSON.parse(text).data.packages).toEqual(["no.example.app1", "no.example.app2"]);
    } finally {
      await client.close();
    }
  });

  it("exits with code 1 and a clear message on invalid configuration", () => {
    const result = spawnSync(process.execPath, [entry], { env: cleanEnv({}), encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PLAY_KEY_FILE");
    expect(result.stdout).toBe("");
  });
});
