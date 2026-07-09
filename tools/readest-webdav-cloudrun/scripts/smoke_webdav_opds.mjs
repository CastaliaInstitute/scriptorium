#!/usr/bin/env node

const DEFAULT_EXPECTED_FOLDERS = [];

function usage() {
  return [
    "Usage: smoke_webdav_opds.mjs --url URL --username USER --password PASS [options]",
    "",
    "Options:",
    "  --expect-folder NAME          Require a top-level WebDAV folder. Repeatable.",
    "  --ensure-folder NAME          Create a top-level WebDAV folder before checks. Repeatable.",
    "  --require-opds-entry TEXT     Require an OPDS entry title or acquisition href containing TEXT. Repeatable.",
    "  --help                       Show this help.",
    "",
    "Environment fallbacks:",
    "  READEST_WEBDAV_URL, READEST_WEBDAV_USERNAME, READEST_WEBDAV_PASSWORD",
  ].join("\n");
}

export function parseArgs(argv, env = process.env) {
  const options = {
    url: env.READEST_WEBDAV_URL || "",
    username: env.READEST_WEBDAV_USERNAME || "",
    password: env.READEST_WEBDAV_PASSWORD || "",
    expectedFolders: [...DEFAULT_EXPECTED_FOLDERS],
    ensuredFolders: [],
    requiredOpdsEntries: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    switch (arg) {
      case "--url":
        options.url = next();
        break;
      case "--username":
        options.username = next();
        break;
      case "--password":
        options.password = next();
        break;
      case "--expect-folder":
        options.expectedFolders.push(next());
        break;
      case "--ensure-folder":
        options.ensuredFolders.push(next());
        break;
      case "--require-opds-entry":
        options.requiredOpdsEntries.push(next());
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.url = options.url.replace(/\/+$/, "");
  return options;
}

export async function runSmoke(options) {
  if (!options.url || !options.username || !options.password) {
    throw new Error("Missing --url, --username, or --password.");
  }

  const authHeaders = {
    Authorization: `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`,
  };
  const results = [];

  const health = await fetch(`${options.url}/healthz`);
  assertStatus(health, 200, "GET /healthz");
  const healthBody = await health.text();
  assertIncludes(healthBody, "ok", "GET /healthz body");
  results.push("GET /healthz");

  const optionsResponse = await fetch(`${options.url}/`, {
    method: "OPTIONS",
    headers: authHeaders,
  });
  assertStatus(optionsResponse, 204, "OPTIONS /");
  const davHeader = optionsResponse.headers.get("dav") || "";
  assertIncludes(davHeader, "1", "OPTIONS / DAV header");
  results.push("OPTIONS /");

  let createdFolders = 0;
  for (const folder of options.ensuredFolders) {
    if (await ensureFolder(options.url, authHeaders, folder)) createdFolders += 1;
  }
  if (options.ensuredFolders.length > 0) {
    results.push(`MKCOL (${createdFolders}/${options.ensuredFolders.length} folders created)`);
  }

  const root = await fetch(`${options.url}/`, {
    method: "PROPFIND",
    headers: {
      ...authHeaders,
      Depth: "1",
    },
  });
  assertStatus(root, 207, "PROPFIND /");
  const rootXml = await root.text();
  assertIncludes(rootXml, "multistatus", "PROPFIND / XML");
  const rootHrefs = extractHrefs(rootXml).map(decodeHref);
  for (const folder of options.expectedFolders) {
    if (!rootHrefs.some((href) => pathSegments(href).includes(folder))) {
      throw new Error(`PROPFIND / did not expose expected folder: ${folder}`);
    }
  }
  results.push(`PROPFIND / (${rootHrefs.length} hrefs)`);

  const opds = await fetch(`${options.url}/opds`, {
    headers: authHeaders,
  });
  assertStatus(opds, 200, "GET /opds");
  const opdsXml = await opds.text();
  assertIncludes(opdsXml, "<feed", "GET /opds feed");
  assertIncludes(opdsXml, "opds", "GET /opds namespace/profile");
  for (const entry of options.requiredOpdsEntries) {
    if (!opdsXml.includes(entry)) {
      throw new Error(`GET /opds did not include required entry text: ${entry}`);
    }
  }
  results.push("GET /opds");

  return results;
}

async function ensureFolder(baseUrl, authHeaders, folder) {
  const folderUrl = `${baseUrl}/${folder.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  const existing = await fetch(folderUrl, {
    method: "PROPFIND",
    headers: {
      ...authHeaders,
      Depth: "0",
    },
  });
  if (existing.status === 207) return false;
  if (existing.status !== 404) {
    throw new Error(`PROPFIND /${folder} returned ${existing.status}; expected 207 or 404`);
  }

  const created = await fetch(folderUrl, {
    method: "MKCOL",
    headers: authHeaders,
  });
  if (created.status !== 201) {
    throw new Error(`MKCOL /${folder} returned ${created.status}; expected 201`);
  }
  return true;
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}; expected ${expected}`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label} did not include ${JSON.stringify(expected)}`);
  }
}

function extractHrefs(xml) {
  const hrefs = [];
  const pattern = /<D:href>(.*?)<\/D:href>/g;
  for (const match of xml.matchAll(pattern)) {
    hrefs.push(match[1]);
  }
  return hrefs;
}

function decodeHref(href) {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function pathSegments(href) {
  return href
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const results = await runSmoke(options);
  for (const result of results) {
    console.log(`ok ${result}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
