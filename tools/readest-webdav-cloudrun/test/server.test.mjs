import assert from "node:assert";
import { before, beforeEach, afterEach, test } from "node:test";

const USERNAME = "reader";
const PASSWORD = "readest-pass";
const AUTH_HEADER = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
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
  process.env.WEBDAV_VIRTUAL_ROOT_ALIASES = "La Recherche=Readest/Readest;Twenty Dollar Words=Readest";

  serverModule = await import("../src/server.mjs");
  return serverModule;
}

async function authFetch(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", AUTH_HEADER);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });
  return response;
}

async function parseText(response) {
  return response.text();
}

before(async () => {
  const mod = await loadServerModule();
  await mod.stopServer().catch(() => {});
});

beforeEach(async () => {
  const mod = await loadServerModule();
  port = 19200 + Math.floor(Math.random() * 1200);
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

test("healthcheck is public while DAV methods require auth", async () => {
  const publicHealth = await fetch(`${baseUrl}/healthz`);
  assert.equal(publicHealth.status, 200, "health endpoint should bypass auth");

  const unauthorized = await fetch(`${baseUrl}/`, { method: "OPTIONS" });
  assert.equal(unauthorized.status, 401, "missing auth should be rejected");
  const wwwAuth = unauthorized.headers.get("www-authenticate");
  assert.ok(wwwAuth?.includes("Basic"));
});

test("supports OPTIONS/PROPFIND and collection traversal", async () => {
  const options = await authFetch("/", { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("dav"), "1, 2");

  const mkcolRoot = await authFetch("/La Recherche", { method: "MKCOL" });
  assert.equal(mkcolRoot.status, 201);
  const mkcolTdW = await authFetch("/Twenty Dollar Words", { method: "MKCOL" });
  assert.equal(mkcolTdW.status, 201);

  await authFetch("/La Recherche/Absinthe.epub", {
    method: "PUT",
    body: "dummy-epub-bytes",
  });
  await authFetch("/Twenty Dollar Words/Isibella.epub", {
    method: "PUT",
    body: "other-dummy-epub-bytes",
  });
  const propfind = await authFetch("/", { method: "PROPFIND", headers: { Depth: "1" } });
  assert.equal(propfind.status, 207);
  const propBody = await parseText(propfind);
  assert.ok(propBody.includes("La%20Recherche"));
  assert.ok(propBody.includes("Twenty%20Dollar%20Words"));
});

test("serves OPDS feed from ebook entries and cover links", async () => {
  await authFetch("/covers", { method: "MKCOL" });
  await authFetch("/La Recherche/Return to the Chateau.epub", {
    method: "PUT",
    body: "epub-bytes",
  });
  await authFetch("/covers/Return to the Chateau.png", {
    method: "PUT",
    body: "fake-cover",
    headers: {
      "Content-Type": "image/png",
    },
  });

  const opds = await authFetch("/opds", { headers: { Depth: "0" } });
  assert.equal(opds.status, 200);
  const opdsXml = await parseText(opds);
  assert.ok(opdsXml.includes("<feed"));
  assert.ok(opdsXml.includes("<title>Return To The Chateau</title>"));
});

test("supports MOVE/COPY object operations", async () => {
  await authFetch("/source.epub", { method: "PUT", body: "v1" });

  const copy = await authFetch("/source.epub", {
    method: "COPY",
    headers: {
      Destination: `${baseUrl}/archived.epub`,
    },
  });
  assert.equal(copy.status, 201);
  const copied = await authFetch("/archived.epub");
  assert.equal(copied.status, 200);
  const moved = await authFetch("/source.epub", {
    method: "MOVE",
    headers: {
      Destination: `${baseUrl}/moved.epub`,
    },
  });
  assert.equal(moved.status, 201);
  const movedRes = await authFetch("/moved.epub");
  assert.equal(movedRes.status, 200);
  const original = await authFetch("/source.epub");
  assert.equal(original.status, 404);
});

test("projects legacy storage into virtual series folders", async () => {
  await authFetch("/Readest/Absinthe/Absinthe-email.epub", { method: "PUT", body: "tdw" });
  await authFetch("/Readest/Readest/books/book-1/The Sentence.epub", { method: "PUT", body: "lr" });

  const root = await authFetch("/", { method: "PROPFIND", headers: { Depth: "1" } });
  assert.equal(root.status, 207);
  const rootXml = await parseText(root);
  assert.ok(rootXml.includes("La%20Recherche"));
  assert.ok(rootXml.includes("Twenty%20Dollar%20Words"));
  assert.ok(!rootXml.includes("/Readest/"));

  const tdw = await authFetch("/Twenty Dollar Words", { method: "PROPFIND", headers: { Depth: "1" } });
  const tdwXml = await parseText(tdw);
  assert.ok(tdwXml.includes("Absinthe"));
  assert.ok(!tdwXml.includes("Readest"));

  const lr = await authFetch("/La Recherche/books/book-1/The Sentence.epub");
  assert.equal(lr.status, 200);

  const lrBooks = await authFetch("/La Recherche/books", { method: "PROPFIND", headers: { Depth: "1" } });
  const lrBooksXml = await parseText(lrBooks);
  assert.ok(lrBooksXml.includes("book-1"));
});

test("supports DELETE and lock workflow", async () => {
  await authFetch("/to-delete.epub", { method: "PUT", body: "delete-me" });
  const lock = await authFetch("/to-delete.epub", { method: "LOCK" });
  assert.equal(lock.status, 200);
  assert.ok(lock.headers.get("lock-token")?.startsWith("<opaquelocktoken:"));

  const removed = await authFetch("/to-delete.epub", { method: "DELETE" });
  assert.equal(removed.status, 204);

  const notFound = await authFetch("/to-delete.epub");
  assert.equal(notFound.status, 404);

  const unlock = await authFetch("/to-delete.epub", { method: "UNLOCK" });
  assert.equal(unlock.status, 204);
});
