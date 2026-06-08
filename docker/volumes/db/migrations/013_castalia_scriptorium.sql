-- Migration 013: Castalia Scriptorium v0 repository and Codex draft storage

CREATE TABLE IF NOT EXISTS public.castalia_profiles (
  user_id uuid NOT NULL,
  email text,
  display_name text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT castalia_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT castalia_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.castalia_repositories (
  user_id uuid NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  url text,
  branch text,
  provider text NOT NULL DEFAULT 'castalia',
  role text NOT NULL DEFAULT 'owner',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT castalia_repositories_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT castalia_repositories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT castalia_repositories_provider CHECK (provider IN ('castalia', 'git', 'local')),
  CONSTRAINT castalia_repositories_role CHECK (role IN ('owner', 'editor', 'reader'))
);

CREATE TABLE IF NOT EXISTS public.castalia_codex_drafts (
  user_id uuid NOT NULL,
  repository_id text NOT NULL,
  book_hash text NOT NULL,
  section_index integer NOT NULL,
  section_label text,
  section_href text,
  html text NOT NULL,
  text text NOT NULL,
  sync_status text NOT NULL DEFAULT 'pushed',
  updated_at_ms bigint NOT NULL,
  pushed_at_ms bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT castalia_codex_drafts_pkey PRIMARY KEY (user_id, repository_id, book_hash, section_index),
  CONSTRAINT castalia_codex_drafts_repository_fkey FOREIGN KEY (user_id, repository_id)
    REFERENCES public.castalia_repositories (user_id, id) ON DELETE CASCADE,
  CONSTRAINT castalia_codex_drafts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT castalia_codex_drafts_section_index CHECK (section_index >= 0),
  CONSTRAINT castalia_codex_drafts_sync_status CHECK (sync_status IN ('local', 'pushed', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_castalia_repositories_user_updated
  ON public.castalia_repositories (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_castalia_codex_drafts_repository_updated
  ON public.castalia_codex_drafts (user_id, repository_id, updated_at_ms DESC);

ALTER TABLE public.castalia_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.castalia_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.castalia_codex_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY castalia_profiles_select ON public.castalia_profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_profiles_insert ON public.castalia_profiles
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_profiles_update ON public.castalia_profiles
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_profiles_delete ON public.castalia_profiles
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY castalia_repositories_select ON public.castalia_repositories
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_repositories_insert ON public.castalia_repositories
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_repositories_update ON public.castalia_repositories
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_repositories_delete ON public.castalia_repositories
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY castalia_codex_drafts_select ON public.castalia_codex_drafts
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_codex_drafts_insert ON public.castalia_codex_drafts
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_codex_drafts_update ON public.castalia_codex_drafts
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY castalia_codex_drafts_delete ON public.castalia_codex_drafts
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

GRANT ALL ON public.castalia_profiles TO authenticated;
GRANT ALL ON public.castalia_repositories TO authenticated;
GRANT ALL ON public.castalia_codex_drafts TO authenticated;
