import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

async function keyFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "plm-key-"));
  const file = join(dir, "key.json");
  await writeFile(file, "{}");
  return file;
}

describe("loadConfig", () => {
  it("parses a valid configuration with defaults", async () => {
    const config = loadConfig({
      PLAY_KEY_FILE: await keyFile(),
      PLAY_ALLOWED_PACKAGES: " no.example.app1 , no.example.app2,no.example.app1",
    });
    expect(config.allowedPackages).toEqual(["no.example.app1", "no.example.app2"]);
    expect(config.enableApply).toBe(false);
    expect(config.logLevel).toBe("info");
    expect(config.draftDir.endsWith("drafts")).toBe(true);
  });

  it("enables apply only for the literal 'true'", async () => {
    const base = { PLAY_KEY_FILE: await keyFile(), PLAY_ALLOWED_PACKAGES: "no.example.app1" };
    expect(loadConfig({ ...base, PLAY_ENABLE_APPLY: "true" }).enableApply).toBe(true);
    expect(() => loadConfig({ ...base, PLAY_ENABLE_APPLY: "yes" })).toThrow(ConfigError);
  });

  it("rejects missing required variables", () => {
    expect(() => loadConfig({})).toThrow(/PLAY_KEY_FILE/);
  });

  it("rejects invalid package names", async () => {
    const file = await keyFile();
    expect(() => loadConfig({ PLAY_KEY_FILE: file, PLAY_ALLOWED_PACKAGES: "bad name" })).toThrow();
  });

  it("rejects a missing key file", () => {
    expect(() =>
      loadConfig({ PLAY_KEY_FILE: "/does/not/exist.json", PLAY_ALLOWED_PACKAGES: "no.example.app1" }),
    ).toThrow(/PLAY_KEY_FILE/);
  });

  it("rejects an invalid log level", () => {
    expect(() =>
      loadConfig({ PLAY_KEY_FILE: "x", PLAY_ALLOWED_PACKAGES: "no.example.app1", LOG_LEVEL: "loud" }),
    ).toThrow(ConfigError);
  });
});
