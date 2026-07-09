# Secrets

Use repository secrets or organization-level secrets visible to the caller repos.

Required for EPUB upload:

```text
READEST_WEBDAV_URL
READEST_WEBDAV_USERNAME
READEST_WEBDAV_PASSWORD
```

Required for AI issue summaries:

```text
GEMINI_API_KEY
```

Optional repository variable:

```text
GEMINI_READEST_ISSUE_MODEL
```

Do not commit Readest sync JSON, WebDAV passwords, Supabase service keys, or
Gemini API keys.
