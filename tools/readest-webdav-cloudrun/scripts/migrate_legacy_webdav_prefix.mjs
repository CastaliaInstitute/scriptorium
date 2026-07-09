#!/usr/bin/env node
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function cleanPath(value) {
  return (value || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function parseArgs(argv) {
  const args = {
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "readest",
    sourcePrefix: process.env.WEBDAV_MIGRATE_SOURCE_PREFIX || "Readest",
    targetPrefix: process.env.WEBDAV_MIGRATE_TARGET_PREFIX || "",
    targetPath: process.env.WEBDAV_MIGRATE_TARGET_PATH || "",
    deleteSource: process.env.WEBDAV_MIGRATE_DELETE_SOURCE === "1",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--bucket") {
      args.bucket = argv[++index];
      continue;
    }
    if (token === "--source-prefix") {
      args.sourcePrefix = argv[++index];
      continue;
    }
    if (token === "--target-prefix") {
      args.targetPrefix = argv[++index];
      continue;
    }
    if (token === "--target-path") {
      args.targetPath = argv[++index];
      continue;
    }
    if (token === "--delete-source") {
      args.deleteSource = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
    }
  }

  if (args.help) {
    console.log(`Usage:\n  node scripts/migrate_legacy_webdav_prefix.mjs \\\n    [--bucket readest] \\\n    [--source-prefix Readest] \\\n    [--target-prefix \"\"] \\\n    [--target-path \"\"] \\\n    [--delete-source] \\\n    [--dry-run]`);
    process.exit(0);
  }

  if (!args.sourcePrefix) {
    throw new Error("--source-prefix is required");
  }

  return args;
}

async function resolveSourcePaths(api, sourcePrefix) {
  const { data: fileData, error: fileError } = await api.download(sourcePrefix);
  if (!fileError && fileData) {
    return { paths: [sourcePrefix], isFileSource: true };
  }

  const sourcePaths = await listRecursiveFiles(api, sourcePrefix);
  return { paths: sourcePaths, isFileSource: false };
}

function destinationPathForSource(sourcePrefix, sourcePath, targetPrefix, targetPath, isFileSource) {
  if (isFileSource) {
    if (targetPath) return cleanPath(targetPath);
    return targetPrefix ? `${cleanPath(targetPrefix)}/${basename(sourcePrefix)}` : basename(sourcePrefix);
  }

  const suffix = sourcePath === sourcePrefix ? "" : sourcePath.slice(sourcePrefix.length + 1);
  return targetPrefix ? `${cleanPath(targetPrefix)}/${suffix}` : suffix;
}

function basename(path) {
  return cleanPath(path).split("/").at(-1) || "";
}

async function listRecursiveFiles(api, prefix) {
  const files = [];
  const queue = [prefix];

  while (queue.length) {
    const current = queue.shift();
    let offset = 0;
    while (true) {
      const { data, error } = await api.list(current, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        throw new Error(`Storage list failed for ${current}: ${error.message}`);
      }

      for (const entry of data || []) {
        const childPath = [current, entry.name].filter(Boolean).join("/");
        if (entry.id === null) {
          queue.push(childPath);
          continue;
        }
        files.push(childPath);
      }

      if (!data || data.length < 1000) {
        break;
      }
      offset += data.length;
    }
  }

  return files;
}

async function migrateObject(api, sourcePath, destinationPath, dryRun, deleteSource) {
  const { data, error } = await api.download(sourcePath);
  if (error) {
    throw new Error(`Download failed for ${sourcePath}: ${error.message}`);
  }

  if (dryRun) {
    if (deleteSource) {
      console.log(`[dry-run] move ${sourcePath} -> ${destinationPath}`);
    } else {
      console.log(`[dry-run] copy ${sourcePath} -> ${destinationPath}`);
    }
    return;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const upload = await api.upload(destinationPath, buffer, {
    upsert: true,
    contentType: data.type || "application/octet-stream",
  });
  if (upload.error) {
    throw new Error(`Upload failed for ${sourcePath}: ${upload.error.message}`);
  }

  if (deleteSource) {
    const removed = await api.remove([sourcePath]);
    if (removed.error) {
      throw new Error(`Delete failed for ${sourcePath}: ${removed.error.message}`);
    }
  }

  if (deleteSource) {
    console.log(`moved ${sourcePath} -> ${destinationPath}`);
  } else {
    console.log(`copied ${sourcePath} -> ${destinationPath}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  requiredEnv("SUPABASE_URL");
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const sourcePrefix = cleanPath(args.sourcePrefix);
  const targetPrefix = cleanPath(args.targetPrefix);
  const targetPath = cleanPath(args.targetPath);

  const client = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const api = client.storage.from(args.bucket);

  const { paths: sourcePaths, isFileSource } = await resolveSourcePaths(api, sourcePrefix);
  if (!sourcePaths.length) {
    console.log(`No files found under ${sourcePrefix}`);
    return;
  }

  const sourceType = isFileSource ? "file" : "tree";
  console.log(`Found ${sourcePaths.length} file(s) under ${sourcePrefix} (${sourceType}).`);
  for (const sourcePath of sourcePaths) {
    const destinationPath = destinationPathForSource(
      sourcePrefix,
      sourcePath,
      targetPrefix,
      isFileSource ? targetPath : "",
      isFileSource,
    );
    await migrateObject(api, sourcePath, destinationPath, args.dryRun, args.deleteSource);
  }

  const destinationLabel = isFileSource && args.targetPath
    ? targetPath
    : (targetPrefix || "bucket root");
  console.log(`Completed migration from ${sourcePrefix} to ${destinationLabel}.`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
