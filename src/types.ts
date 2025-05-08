import type { Fetcher, KVNamespace } from '@cloudflare/workers-types';

export type Bindings = {
  WORKER_ENV: string
  AUTH_TOKEN: string
  ASSETS: Fetcher
  USER_STATS_KV: KVNamespace
  BALLOON_STATE_KV: KVNamespace
}