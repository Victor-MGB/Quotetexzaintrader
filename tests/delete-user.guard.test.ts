import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The delete-user script is the one piece of code in this repo whose whole job is
 * to destroy production rows, and it did exactly that once because it trusted the
 * ambient DATABASE_URL. These tests drive the real script as a subprocess, with a
 * database URL chosen by the test, and assert on what it refuses to do.
 *
 * Nothing here can reach production: every URL is either loopback, unresolvable
 * (.invalid is reserved and can never resolve) or malformed, and dotenv is pointed
 * at /dev/null so the repo's real .env is never read.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");

function run(args: string[], databaseUrl: string): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/delete-user.ts", ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        // Keep the repo's .env out of the child entirely, so DATABASE_URL below is
        // the only one the script can possibly see.
        DOTENV_CONFIG_PATH: "/dev/null",
        BOT_TOKEN: "0:test-token-never-sent",
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        DB_SSL: "false",
        ADMIN_IDS: "1000000001",
        SESSION_TIMEOUT_MINUTES: "30",
        DATABASE_URL: databaseUrl,
      },
    },
  );
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const REMOTE = "postgresql://user:pw@db.invalid:5432/postgres";
const LOCAL = "postgresql://user:pw@127.0.0.1:1/postgres";

describe("delete-user refuses a database that is not disposable", () => {
  it("stops before touching a remote host", () => {
    const { status, output } = run(["1000000009"], REMOTE);

    assert.equal(status, 1, "a remote host is a refusal, not a warning");
    assert.match(output, /Refusing to delete from db\.invalid/);
    assert.doesNotMatch(output, /About to delete/, "it must not even read the account");
  });

  it("names the escape hatch instead of just failing", () => {
    const { output } = run(["1000000009"], REMOTE);

    assert.match(output, /--force-remote/, "the operator is told how to proceed deliberately");
  });

  it("proceeds past the guard when the remote host is forced", () => {
    // db.invalid can never resolve, so the run dies trying to connect. What
    // matters is that it got past the host check rather than being refused.
    const { output } = run(["1000000009", "--force-remote"], REMOTE);

    assert.doesNotMatch(output, /Refusing to delete from/);
  });

  it("allows a loopback host without any flag", () => {
    // Port 1 is closed, so this fails on connect. The guard is what is under test.
    const { output } = run(["1000000009"], LOCAL);

    assert.doesNotMatch(output, /Refusing to delete from/);
    assert.match(output, /127\.0\.0\.1.*\(local\)/, "and it says which host it is on");
  });

  it("refuses a database URL it cannot parse rather than guessing", () => {
    const { status, output } = run(["1000000009"], "this-is-not-a-url");

    assert.equal(status, 1);
    assert.match(output, /DATABASE_URL is missing or not a valid URL/);
    assert.doesNotMatch(output, /About to delete/);
  });
});
