import assert from "node:assert";
import { spawn } from "node:child_process";
import { before, beforeEach, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const USERNAME = "reader";
const PASSWORD = "readest-pass";
const AUTH_HEADER = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "../scripts/smoke_webdav_opds.mjs");

let serverModule;
let baseUrl;
let port;

async function loadServerModule() {
  if (serverModule) return serverModule;

  process.env.WEBDAV_TEST_MODE = "1";
  process.env.WEBDAV_AUTO_START = "0";
  process.env.WEBDAV_USERNAME = USERNAME;
  process.env.WEBDAV_PASSWORD = PASSWORD;
  process.env.WEBDAV_ROOT_PREFIX = "";
  process.env.WEBDAV_HIDE_LEGACY_ROOT_FOLDER = "true";

  serverModule = await import("../src/server.mjs");
  return serverModule;
}

async function authFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", AUTH_HEADER);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
}

function runSmoke(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

before(async () => {
  const mod = await loadServerModule();
  await mod.stopServer().catch(() => {});
});

beforeEach(async () => {
  const mod = await loadServerModule();
  port = 20500 + Math.floor(Math.random() * 1200);
  process.env.PORT = String(port);
  baseUrl = `http://127.0.0.1:${port}`;
  mod.resetStorageForTests();
  await mod.startServer(port);
});

afterEach(async () => {
  if (serverModule) {
    await serverModule.stopServer().catch(() => {});
  }
});

test("smoke verifier confirms health, root folders, and OPDS acquisition feed", async () => {
  await authFetch("/La Recherche", { method: "MKCOL" });
  await authFetch("/Twenty Dollar Words", { method: "MKCOL" });
  await authFetch("/La Recherche/Absinthe.epub", { method: "PUT", body: "epub" });

  const result = await runSmoke([
    "--url",
    baseUrl,
    "--username",
    USERNAME,
    "--password",
    PASSWORD,
    "--expect-folder",
    "La Recherche",
    "--expect-folder",
    "Twenty Dollar Words",
    "--require-opds-entry",
    "Absinthe",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ok GET \/healthz/);
  assert.match(result.stdout, /ok PROPFIND \//);
  assert.match(result.stdout, /ok GET \/opds/);
});

test("smoke verifier fails when an expected root folder is missing", async () => {
  const result = await runSmoke([
    "--url",
    baseUrl,
    "--username",
    USERNAME,
    "--password",
    PASSWORD,
    "--expect-folder",
    "La Recherche",
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /did not expose expected folder: La Recherche/);
});
