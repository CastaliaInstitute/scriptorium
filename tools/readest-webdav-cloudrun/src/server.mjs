import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Storage } from "@google-cloud/storage";
import WebSocket from "ws";

const PORT = Number(process.env.PORT || 8080);
const TEST_MODE = process.env.WEBDAV_TEST_MODE === "1";
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || "supabase").toLowerCase();
const SUPABASE_URL = TEST_MODE || STORAGE_BACKEND === "gcs"
  ? "https://127.0.0.1"
  : requiredEnv("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = TEST_MODE || STORAGE_BACKEND === "gcs"
  ? "test-key"
  : requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "readest";
const USERNAME = requiredEnv("WEBDAV_USERNAME");
const PASSWORD = requiredEnv("WEBDAV_PASSWORD");
const ROOT_PREFIX = cleanStoragePath(process.env.WEBDAV_ROOT_PREFIX || "");
const HIDE_LEGACY_ROOT_FOLDER = process.env.WEBDAV_HIDE_LEGACY_ROOT_FOLDER !== "false";
const LEGACY_TOP_LEVEL_PREFIX = cleanStoragePath(process.env.WEBDAV_LEGACY_TOP_LEVEL_PREFIX || "");
const VIRTUAL_ROOT_ALIASES = parseVirtualRootAliases(process.env.WEBDAV_VIRTUAL_ROOT_ALIASES || "");
const AUTO_START = process.env.WEBDAV_AUTO_START !== "0";

const storageApi = createStorageBackend();
function createStorageBackend() {
  if (TEST_MODE) return createInMemoryStorage();
  if (STORAGE_BACKEND === "gcs") return createGcsStorage();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  });
  return supabase.storage.from(BUCKET);
}

function createGcsStorage() {
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET);

  function normalize(path) {
    return cleanStoragePath(path || "");
  }

  function metadataToEntry(name, meta = {}) {
    return {
      name: basename(name),
      id: name,
      metadata: {
        size: Number(meta.size || 0),
        eTag: meta.etag || meta.generation || null,
        created_at: meta.timeCreated || new Date().toISOString(),
        updated_at: meta.updated || new Date().toISOString(),
      },
    };
  }

  async function list(prefix = "", { sortBy } = {}) {
    const cleaned = normalize(prefix);
    const options = {
      delimiter: "/",
      prefix: cleaned ? `${cleaned}/` : "",
      autoPaginate: false,
    };
    const [files, , response] = await bucket.getFiles(options);
    const entries = [];
    for (const dir of response.prefixes || []) {
      const name = dir.replace(/\/$/, "").split("/").pop();
      if (!name) continue;
      entries.push({
        name,
        id: null,
        metadata: {
          size: 0,
          eTag: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }
    for (const file of files) {
      const name = file.name;
      if (!name || name.endsWith("/.keep") || name === cleaned) continue;
      const relative = cleaned ? name.slice(`${cleaned}/`.length) : name;
      if (!relative || relative.includes("/")) continue;
      entries.push(metadataToEntry(name, file.metadata || {}));
    }
    if (sortBy?.column === "name") entries.sort((a, b) => a.name.localeCompare(b.name));
    return { data: entries, error: null };
  }

  async function download(path) {
    const key = normalize(path);
    try {
      const file = bucket.file(key);
      const [exists] = await file.exists();
      if (!exists) return { data: null, error: { message: "Not Found", statusCode: 404 } };
      const [buffer] = await file.download();
      const [metadata] = await file.getMetadata();
      return {
        data: {
          arrayBuffer: async () => buffer,
          type: metadata.contentType || "application/octet-stream",
        },
        error: null,
      };
    } catch (error) {
      return { data: null, error: { message: error.message || "Download failed", statusCode: error.code || 500 } };
    }
  }

  async function upload(path, body, options = {}) {
    const key = normalize(path);
    try {
      const data = Buffer.from(body || []);
      await bucket.file(key).save(data, {
        resumable: false,
        metadata: {
          contentType: options.contentType || "application/octet-stream",
        },
      });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: { message: error.message || "Upload failed", statusCode: error.code || 500 } };
    }
  }

  async function remove(paths = []) {
    const keys = Array.isArray(paths) ? paths : [paths];
    try {
      for (const rawPath of keys.filter(Boolean)) {
        const key = normalize(rawPath);
        const [files] = await bucket.getFiles({ prefix: key });
        await Promise.all(files.filter((file) => file.name === key || file.name.startsWith(`${key}/`)).map((file) =>
          file.delete({ ignoreNotFound: true })
        ));
      }
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: { message: error.message || "Remove failed", statusCode: error.code || 500 } };
    }
  }

  async function move(source, destination) {
    return doMoveCopy(source, destination, true);
  }

  async function copy(source, destination) {
    return doMoveCopy(source, destination, false);
  }

  async function doMoveCopy(source, destination, isMove) {
    const sourcePath = normalize(source);
    const destinationPath = normalize(destination);
    try {
      const [files] = await bucket.getFiles({ prefix: sourcePath });
      const affected = files.filter((file) => file.name === sourcePath || file.name.startsWith(`${sourcePath}/`));
      if (affected.length === 0) return { data: null, error: { message: "Not Found", statusCode: 404 } };
      for (const file of affected) {
        const suffix = file.name === sourcePath ? "" : file.name.slice(sourcePath.length + 1);
        const target = suffix ? joinPath(destinationPath, suffix) : destinationPath;
        await file.copy(bucket.file(target));
      }
      if (isMove) await Promise.all(affected.map((file) => file.delete({ ignoreNotFound: true })));
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: { message: error.message || "Move/copy failed", statusCode: error.code || 500 } };
    }
  }

  return { list, download, upload, remove, move, copy };
}

function createInMemoryStorage() {
  const objects = new Map();
  const metadata = new Map();

  function normalize(path) {
    return cleanStoragePath(path || "");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function setObject(path, data, type) {
    const key = normalize(path);
    const etag = `\"${randomUUID()}\"`;
    const buffer = Buffer.from(data || []);
    objects.set(key, buffer);
    const existingMetadata = metadata.get(key) || {};
    metadata.set(key, {
      size: buffer.length,
      etag,
      contentType: type || "application/octet-stream",
      createdAt: existingMetadata.createdAt || nowIso(),
      updatedAt: nowIso(),
    });
  }

  function cloneResponse(data) {
    return {
      data,
      error: null,
    };
  }

  function errorResponse(message, statusCode = 500) {
    return {
      data: null,
      error: {
        message,
        statusCode,
      },
    };
  }

  function list(prefix = "", { sortBy } = {}) {
    const cleaned = normalize(prefix);
    const children = new Map();

    const keys = [...objects.keys()];
    for (const key of keys) {
      if (!cleaned) {
        if (!key) continue;
        const first = key.split("/")[0];
        const rest = key.slice(first.length);
        const isDirectory = rest.includes("/");
        if (isDirectory) {
          if (!children.has(first)) {
            children.set(first, {
              name: first,
              isDirectory: true,
              size: 0,
              updatedAt: nowIso(),
              etag: null,
            });
          }
        } else {
          const childMeta = metadata.get(key);
          children.set(key, {
            name: key,
            isDirectory: false,
            size: Number(childMeta?.size || 0),
            updatedAt: childMeta?.updatedAt || nowIso(),
            etag: childMeta?.etag || null,
          });
        }
        continue;
      }

      const prefixWithSlash = `${cleaned}/`;
      if (!key.startsWith(prefixWithSlash)) continue;

      const relative = key.slice(prefixWithSlash.length);
      if (!relative) continue;
      const [first, ...rest] = relative.split("/");
      if (rest.length > 0) {
        const existing = children.get(first);
        children.set(first, {
          ...(existing || { updatedAt: nowIso(), size: 0, etag: null }),
          name: first,
          isDirectory: true,
        });
      } else {
        const childMeta = metadata.get(key);
        children.set(first, {
          name: first,
          isDirectory: false,
          size: Number(childMeta?.size || 0),
          updatedAt: childMeta?.updatedAt || nowIso(),
          etag: childMeta?.etag || null,
        });
      }
    }

    const data = [...children.values()];
    if (sortBy?.column === "name") {
      data.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Promise.resolve({ data: data.map((entry) => ({
      ...entry,
      id: entry.isDirectory ? null : entry.name,
      metadata: {
        size: entry.size,
        eTag: entry.etag,
        created_at: nowIso(),
        updated_at: entry.updatedAt,
      },
    })), error: null });
  }

  async function download(path) {
    const key = normalize(path);
    const data = objects.get(key);
    if (!data) return errorResponse("Not Found", 404);
    const meta = metadata.get(key) || {};
    return cloneResponse({
      arrayBuffer: async () => data,
      type: meta.contentType || "application/octet-stream",
    });
  }

  async function upload(path, body, options = {}) {
    setObject(path, body, options.contentType);
    return cloneResponse(null);
  }

  async function remove(paths = []) {
    const keys = Array.isArray(paths) ? paths : [paths];
    const normalized = keys.filter(Boolean).map(normalize).map((path) => `${path}`);
    for (const path of normalized) {
      const exactMatch = new RegExp(`^${escapeRegExp(path)}(?:/|$)`);
      for (const key of [...objects.keys()]) {
        if (exactMatch.test(key)) {
          objects.delete(key);
          metadata.delete(key);
        }
      }
    }
    return cloneResponse(null);
  }

  async function move(source, destination) {
    return doMoveCopy(source, destination, true);
  }

  async function copy(source, destination) {
    return doMoveCopy(source, destination, false);
  }

  async function doMoveCopy(source, destination, isMove) {
    const sourcePath = normalize(source);
    const destinationPath = normalize(destination);
    const sourcePrefix = sourcePath ? `${sourcePath}/` : "";
    const affected = [...objects.keys()].filter((key) =>
      key === sourcePath || (sourcePath && key.startsWith(`${sourcePath}/`)),
    );
    const sourceIsCollection = affected.some((key) => key.startsWith(`${sourcePath}/`));

    if (destinationPath === sourcePath || (isMove && destinationPath.startsWith(`${sourcePath}/`))) {
      return { data: null, error: { message: "Invalid destination", statusCode: 409 } };
    }

    if (affected.length === 0) return { data: null, error: { message: "Not Found", statusCode: 404 } };

    for (const key of affected) {
      const suffix = key === sourcePath ? "" : key.slice(sourcePrefix.length);
      const targetKey = sourceIsCollection
        ? normalize(joinPath(destinationPath, suffix))
        : destinationPath;
      const sourceData = objects.get(key) || new Uint8Array();
      const sourceMeta = metadata.get(key) || {};
      const etag = `\"${randomUUID()}\"`;
      objects.set(targetKey, Buffer.from(sourceData));
      metadata.set(targetKey, {
        ...sourceMeta,
        etag,
        updatedAt: nowIso(),
      });
    }

    if (isMove) {
      for (const key of affected) {
        objects.delete(key);
        metadata.delete(key);
      }
    }

    return { data: null, error: null };
  }

  return {
    list,
    download,
    upload,
    remove,
    move,
    copy,
    reset() {
      objects.clear();
      metadata.clear();
    },
  };
}

function parseVirtualRootAliases(value) {
  if (!value) return [];
  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator < 0) return null;
      const name = cleanStoragePath(entry.slice(0, separator));
      const target = cleanStoragePath(entry.slice(separator + 1));
      if (!name || !target) return null;
      return { name, target };
    })
    .filter(Boolean);
}

function virtualAliasForRequestPath(path) {
  const requestPath = cleanStoragePath(path);
  for (const alias of VIRTUAL_ROOT_ALIASES) {
    if (requestPath === alias.name) {
      return { alias, suffix: "" };
    }
    if (requestPath.startsWith(`${alias.name}/`)) {
      return {
        alias,
        suffix: requestPath.slice(alias.name.length + 1),
      };
    }
  }
  return null;
}

function virtualAliasByTarget(targetPath) {
  const cleanedTarget = cleanStoragePath(targetPath);
  return VIRTUAL_ROOT_ALIASES.find((alias) => alias.target === cleanedTarget) || null;
}

const server = createServer(async (req, res) => {
  try {
    applyCors(req, res);
    if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/healthz") {
      sendText(res, 200, "ok\n");
      return;
    }

    if (!isAuthorized(req)) {
      res.writeHead(401, {
        "www-authenticate": 'Basic realm="Readest WebDAV"',
        "content-type": "text/plain; charset=utf-8",
      });
      res.end("Unauthorized\n");
      return;
    }

    await routeWebdav(req, res);
  } catch (error) {
    console.error(error);
    sendText(res, 500, "Internal Server Error\n");
  }
});

if (AUTO_START) {
  server.listen(PORT, () => {
    console.log(`Readest WebDAV listening on :${PORT}`);
  });
}

export async function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve(server)).once("error", reject);
  });
}

export async function stopServer() {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
}

export function resetStorageForTests() {
  if (typeof storageApi.reset === "function") storageApi.reset();
}

async function routeWebdav(req, res) {
  const requestPath = requestRelativePath(req);
  const storagePath = toStoragePath(requestPath);

  if ((req.method === "GET" || req.method === "HEAD") && requestPath === "opds") {
    await handleOpdsCatalog(req, res, req.method === "HEAD");
    return;
  }

  switch (req.method) {
    case "OPTIONS":
      sendOptions(res);
      return;
    case "PROPFIND":
      await handlePropfind(req, res, requestPath, storagePath);
      return;
    case "GET":
    case "HEAD":
      await handleGet(req, res, storagePath, req.method === "HEAD");
      return;
    case "PUT":
      await handlePut(req, res, storagePath);
      return;
    case "DELETE":
      await handleDelete(res, storagePath, isCollectionRequest(req));
      return;
    case "MKCOL":
      await handleMkcol(res, storagePath);
      return;
    case "MOVE":
      await handleMoveCopy(req, res, storagePath, "move");
      return;
    case "COPY":
      await handleMoveCopy(req, res, storagePath, "copy");
      return;
    case "LOCK":
      sendLock(res, requestPath);
      return;
    case "UNLOCK":
      res.writeHead(204, davHeaders());
      res.end();
      return;
    default:
      res.writeHead(405, {
        ...davHeaders(),
        allow: allowedMethods(),
        "content-type": "text/plain; charset=utf-8",
      });
      res.end("Method Not Allowed\n");
  }
}

async function handleOpdsCatalog(req, res, headOnly) {
  const books = (await collectOpdsEntries())
    .filter((child) => !child.isDirectory && child.name.toLowerCase().endsWith(".epub"));
  const covers = new Map((await collectOpdsCovers()));
  const updated = new Date(
    books.reduce((latest, book) => Math.max(latest, Date.parse(book.updatedAt) || 0), Date.now()),
  ).toISOString();
  const entries = books.map((book) => {
    const href = `/${(book.path || "").split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
    const title = titleFromFilename(book.name);
    const id = String(book.etag || book.name).replace(/^"+|"+$/g, "");
    const cover = covers.get(PathStem(book.name));
    const imageLinks = cover ? [
      `<link rel="http://opds-spec.org/image" type="${xmlEscape(contentType(cover.name))}" href="${xmlEscape(`/covers/${encodeURIComponent(cover.name)}`)}" />`,
      `<link rel="http://opds-spec.org/image/thumbnail" type="${xmlEscape(contentType(cover.name))}" href="${xmlEscape(`/covers/${encodeURIComponent(cover.name)}`)}" />`,
    ] : [];
    return [
      "<entry>",
      `<title>${xmlEscape(title)}</title>`,
      `<id>${xmlEscape(`urn:readest-webdav:${id}`)}</id>`,
      `<updated>${xmlEscape(new Date(book.updatedAt).toISOString())}</updated>`,
      ...imageLinks,
      `<link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="${xmlEscape(href)}" />`,
      `<link rel="alternate" type="application/epub+zip" href="${xmlEscape(href)}" />`,
      "</entry>",
    ].join("");
  }).join("\n");

  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">',
    "<title>AtelierNymphet EPUBs</title>",
    "<id>urn:readest-webdav:ateliernymphet</id>",
    `<updated>${xmlEscape(updated)}</updated>`,
    '<link rel="self" href="/opds" type="application/atom+xml;profile=opds-catalog;kind=acquisition" />',
    entries,
    "</feed>",
  ].join("\n");

  res.writeHead(200, {
    ...davHeaders(),
    "content-type": "application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  if (headOnly) res.end();
  else res.end(body);
}

async function handlePropfind(req, res, requestPath, storagePath) {
  const depth = req.headers.depth || "infinity";
  const responses = [];
  const virtualAlias = virtualAliasForRequestPath(requestPath);
  const rootMeta = await statPath(storagePath, requestPath === "" || requestPath.endsWith("/"));

  if (!rootMeta.exists && requestPath !== "") {
    sendText(res, 404, "Not Found\n", davHeaders());
    return;
  }

  responses.push(propResponse(requestHref(req, requestPath, rootMeta.isDirectory), rootMeta));

  if (depth !== "0" && rootMeta.isDirectory) {
    const children = await filterRootChildren(await listChildren(storagePath), requestPath, storagePath, virtualAlias);
    for (const child of children) {
      const childPath = joinPath(requestPath, child.name);
      responses.push(propResponse(requestHref(req, childPath, child.isDirectory), child));
    }
  }

  const body = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${responses.join("\n")}\n</D:multistatus>`;
  res.writeHead(207, {
    ...davHeaders(),
    "content-type": "application/xml; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleGet(req, res, storagePath, headOnly) {
  const { data, error } = await storageApi.download(storagePath);
  if (error) {
    sendText(res, 404, "Not Found\n", davHeaders());
    return;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  res.writeHead(200, {
    ...davHeaders(),
    "content-type": data.type || contentType(storagePath),
    "content-length": buffer.length,
    "last-modified": new Date().toUTCString(),
  });
  if (headOnly) res.end();
  else res.end(buffer);
}

async function handlePut(req, res, storagePath) {
  if (!storagePath || storagePath.endsWith("/")) {
    sendText(res, 409, "Cannot PUT a collection\n", davHeaders());
    return;
  }

  const body = await readRequestBody(req);
  const { error } = await storageApi.upload(storagePath, body, {
    upsert: true,
    contentType: req.headers["content-type"] || contentType(storagePath),
  });

  if (error) {
    const status = storageStatusCodeFor(error);
    sendText(res, status, `Storage upload failed: ${error.message}\n`, davHeaders());
    return;
  }

  res.writeHead(201, davHeaders());
  res.end();
}

async function handleDelete(res, storagePath, isCollection) {
  const paths = isCollection ? await listRecursive(storagePath) : [storagePath];
  if (paths.length === 0 && isCollection) {
    res.writeHead(204, davHeaders());
    res.end();
    return;
  }

  const { error } = await storageApi.remove(paths);
  if (error) {
    const status = storageStatusCodeFor(error);
    sendText(res, status, `Storage delete failed: ${error.message}\n`, davHeaders());
    return;
  }

  res.writeHead(204, davHeaders());
  res.end();
}

async function handleMkcol(res, storagePath) {
  const keepPath = joinPath(storagePath, ".keep");
  const { error } = await storageApi.upload(keepPath, new Uint8Array(), {
    upsert: true,
    contentType: "application/octet-stream",
  });

  if (error) {
    const status = storageStatusCodeFor(error);
    sendText(res, status, `Storage collection create failed: ${error.message}\n`, davHeaders());
    return;
  }

  res.writeHead(201, davHeaders());
  res.end();
}

async function handleMoveCopy(req, res, storagePath, operation) {
  const destination = req.headers.destination;
  if (!destination) {
    sendText(res, 400, "Missing Destination header\n", davHeaders());
    return;
  }

  const destinationPath = toStoragePath(relativePathFromDestination(destination));
  const result = operation === "move"
    ? await storageApi.move(storagePath, destinationPath)
    : await storageApi.copy(storagePath, destinationPath);

  if (result.error) {
    const status = storageStatusCodeFor(result.error);
    sendText(res, status, `Storage ${operation} failed: ${result.error.message}\n`, davHeaders());
    return;
  }

  res.writeHead(201, davHeaders());
  res.end();
}

function sendOptions(res) {
  res.writeHead(204, {
    ...davHeaders(),
    allow: allowedMethods(),
    "ms-author-via": "DAV",
  });
  res.end();
}

function sendLock(res, requestPath) {
  const token = `opaquelocktoken:${randomUUID()}`;
  const body = `<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>infinity</D:depth><D:owner><D:href>${xmlEscape(requestPath)}</D:href></D:owner><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`;
  res.writeHead(200, {
    ...davHeaders(),
    "lock-token": `<${token}>`,
    "content-type": "application/xml; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function statPath(storagePath, requestedDirectory) {
  if (!storagePath || requestedDirectory) {
    return {
      name: basename(storagePath) || "",
      isDirectory: true,
      size: 0,
      updatedAt: new Date().toISOString(),
      exists: true,
    };
  }

  const parent = dirname(storagePath);
  const name = basename(storagePath);
  const children = await listChildren(parent);
  const found = children.find((child) => child.name === name);
  if (found) return { ...found, exists: true };

  const nested = await listChildren(storagePath);
  if (nested.length > 0) {
    return {
      name,
      isDirectory: true,
      size: 0,
      updatedAt: new Date().toISOString(),
      exists: true,
    };
  }

  return {
    name,
    isDirectory: false,
    size: 0,
    updatedAt: new Date().toISOString(),
    exists: false,
  };
}

async function listChildren(storagePath) {
  const { data, error } = await storageApi.list(storagePath, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) return [];

  return data
    .filter((entry) => !isHiddenStoragePath(joinPath(storagePath, entry.name)))
    .map((entry) => ({
      name: entry.name,
      isDirectory: entry.id === null,
      size: Number(entry.metadata?.size || 0),
      updatedAt: entry.updated_at || entry.created_at || new Date().toISOString(),
      etag: entry.metadata?.eTag || entry.id || null,
      exists: true,
    }));
}

async function listRecursiveEntries(storagePath) {
  const children = await listChildren(storagePath);
  const results = [];
  for (const child of children) {
    const childPath = joinPath(storagePath, child.name);
    if (child.isDirectory) {
      results.push(...await listRecursiveEntries(childPath));
      continue;
    }
    results.push({ ...child, path: childPath, exists: true });
  }
  return results;
}

async function listRecursive(storagePath) {
  const children = await listChildren(storagePath);
  const paths = [];
  for (const child of children) {
    const childPath = joinPath(storagePath, child.name);
    if (child.isDirectory) paths.push(...await listRecursive(childPath));
    else paths.push(childPath);
  }
  return paths;
}

async function collectOpdsEntries() {
  const roots = ROOT_PREFIX ? [ROOT_PREFIX, ""] : [""];
  const seen = new Set();
  const entries = [];
  for (const root of roots) {
    const children = await listRecursiveEntries(root);
    for (const child of children) {
      const key = child.path || child.name;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(child);
    }
  }
  return entries;
}

async function filterRootChildren(children, requestPath, storagePath, virtualAlias = null) {
  if (requestPath === "" && VIRTUAL_ROOT_ALIASES.length > 0) {
    const legacyChildren = await listChildren(LEGACY_TOP_LEVEL_PREFIX || storagePath);
    if (legacyChildren.length > 0) {
      return VIRTUAL_ROOT_ALIASES.map((alias) => ({
        name: alias.name,
        isDirectory: true,
        size: 0,
        updatedAt: new Date().toISOString(),
        etag: null,
        exists: true,
      }));
    }
  }

  if (virtualAlias) {
    const aliasBasename = basename(virtualAlias.alias.target);
    return children.filter((child) => child.name !== aliasBasename);
  }

  if (!HIDE_LEGACY_ROOT_FOLDER) return children;
  if (requestPath !== "") return children;

  if (storagePath === ROOT_PREFIX && ROOT_PREFIX && cleanStoragePath(ROOT_PREFIX) === cleanStoragePath(LEGACY_TOP_LEVEL_PREFIX)) {
    return children.filter((child) => !(child.isDirectory && cleanStoragePath(child.name) === ROOT_PREFIX));
  }

  if (storagePath !== "") return children;
  const matchingLegacy = children.find((child) =>
    child.isDirectory && cleanStoragePath(child.name) === LEGACY_TOP_LEVEL_PREFIX);

  if (!matchingLegacy) return children;
  return listChildren(cleanStoragePath(matchingLegacy.name));
}

async function collectOpdsCovers() {
  const coverRoots = [joinPath(ROOT_PREFIX, "covers"), "covers"];
  const covers = [];
  const seen = new Set();
  for (const root of coverRoots) {
    const children = await listChildren(root);
    for (const child of children) {
      if (!child.isDirectory && /^image\//.test(contentType(child.name))) {
        const stem = PathStem(child.name);
        if (seen.has(stem)) continue;
        seen.add(stem);
        covers.push(child);
      }
    }
  }
  return covers.map((child) => [PathStem(child.name), child]);
}

function trimPrefix(value, prefix) {
  if (value.startsWith(prefix)) return value.slice(prefix.length);
  return value;
}

function propResponse(href, meta) {
  const resourceType = meta.isDirectory ? "<D:collection/>" : "";
  const contentLength = meta.isDirectory ? "" : `<D:getcontentlength>${meta.size || 0}</D:getcontentlength>`;
  const contentTypeProp = meta.isDirectory ? "" : `<D:getcontenttype>${xmlEscape(contentType(meta.name))}</D:getcontenttype>`;
  const etag = meta.etag ? `<D:getetag>"${xmlEscape(meta.etag)}"</D:getetag>` : "";

  return `<D:response><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop><D:resourcetype>${resourceType}</D:resourcetype>${contentLength}${contentTypeProp}<D:getlastmodified>${new Date(meta.updatedAt).toUTCString()}</D:getlastmodified>${etag}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

function requestHref(req, relativePath, isDirectory) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  let pathname = `/${relativePath.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  if (isDirectory && !pathname.endsWith("/")) pathname += "/";
  return pathname || "/";
}

function requestRelativePath(req) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  return cleanStoragePath(decodeURIComponent(url.pathname));
}

function relativePathFromDestination(destination) {
  const url = new URL(destination);
  return cleanStoragePath(decodeURIComponent(url.pathname));
}

function toStoragePath(relativePath) {
  const virtualAlias = virtualAliasForRequestPath(relativePath);
  if (virtualAlias) {
    return joinPath(virtualAlias.alias.target, virtualAlias.suffix);
  }

  const targetPath = cleanStoragePath(relativePath);
  if (!ROOT_PREFIX) return targetPath;
  if (targetPath === ROOT_PREFIX) return targetPath;
  if (targetPath.startsWith(`${ROOT_PREFIX}/`)) return targetPath;
  return joinPath(ROOT_PREFIX, targetPath);
}

function cleanStoragePath(path) {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function joinPath(...parts) {
  return cleanStoragePath(parts.filter(Boolean).join("/"));
}

function dirname(path) {
  const parts = cleanStoragePath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function basename(path) {
  const parts = cleanStoragePath(path).split("/").filter(Boolean);
  return parts.at(-1) || "";
}

function isCollectionRequest(req) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  return url.pathname.endsWith("/");
}

function storageStatusCodeFor(error) {
  if (error?.message && /DatabaseReadOnly/i.test(error.message)) return 503;
  if (error?.statusCode) return Number(error.statusCode) >= 400 ? error.statusCode : 502;
  return 502;
}

function contentType(path) {
  if (path.endsWith(".epub")) return "application/epub+zip";
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".xml")) return "application/xml";
  if (path.endsWith(".xhtml") || path.endsWith(".html")) return "application/xhtml+xml";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function titleFromFilename(filename) {
  return PathStem(filename)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function PathStem(path) {
  return basename(path).replace(/\.[^.]+$/, "");
}

function isHiddenStoragePath(path) {
  const relative = cleanStoragePath(path).replace(new RegExp(`^${escapeRegExp(ROOT_PREFIX)}(?:/|$)`), "");
  return relative.split("/").some((part) => part === ".keep");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function isAuthorized(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  return secureEqual(decoded.slice(0, separator), USERNAME) &&
    secureEqual(decoded.slice(separator + 1), PASSWORD);
}

function secureEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function davHeaders() {
  return {
    dav: "1, 2",
    "cache-control": "no-store",
  };
}

function allowedMethods() {
  return "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, LOCK, UNLOCK";
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;

  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", allowedMethods());
  res.setHeader("access-control-allow-headers", "Authorization, Depth, Destination, Content-Type, Content-Length, If-Match, Overwrite, If-None-Match, Lock-Token, X-Requested-With");
  res.setHeader("access-control-expose-headers", "dav, ms-author-via, content-type, content-length, content-disposition, location, etag, last-modified");
  res.setHeader("access-control-max-age", "86400");
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...headers,
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
