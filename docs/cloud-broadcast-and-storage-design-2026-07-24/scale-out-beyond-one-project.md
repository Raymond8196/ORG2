# Scaling Beyond One Supabase Project (design note, not scheduled)

Date: 2026-07-24. Context: with the 0003–0006 batches applied, every
audit-identified bottleneck inside the single project is closed. This note
records the levers for the next magnitude so the decision is pre-made, not
made under fire. Watch `cloud_ops_stats()` (0006) for the approach signals.

## Order of levers

1. **Read replicas (first, cheapest).** Supabase read replicas take the
   read-heavy RPCs (listings, event pages, roster) off the primary. Client
   prerequisite is already in place: every call goes through
   `getCloudEndpoint()`; add a `readReplicaUrl` to `CloudEndpoint` and route
   the read-only RPC allowlist there. Writes, realtime, storage stay primary.
2. **Storage/CDN egress** is already offloaded (0005): replay bytes go
   through the Storage CDN, not Postgres. Nothing further until multi-region.
3. **Org sharding (the real split).** The schema is shard-friendly: every
   row is org-scoped, cross-org state lives only in `orgs`/`org_memberships`/
   `cloud_profiles`. Split = a directory service mapping org → project
   (endpoint + anon key), fetched at roster load; the client already keys
   caches and capability memory per endpoint URL. Realtime channels and
   storage buckets shard with their org's project. Grants/billing stay on a
   control-plane project.
4. **Multi-region** follows sharding (assign orgs to regional projects);
   no code shape changes beyond the directory.

## Signals to act on (from `cloud_ops_stats()` + Supabase dashboard)

- Realtime messages/month approaching 60% of plan → widen per-kind debounce
  or start read-replica work (messages are per-delivery; replicas do not
  help — narrowing and debounce do).
- Primary CPU sustained > 50% or connection peak > 300 → read replicas.
- Any single org > ~20% of total write volume → that org is the first
  sharding candidate.

## Explicitly rejected

- Cross-tenant content-addressed dedup for replay objects (side channel —
  see SharedSessionPerformance.md).
- Per-user database pooling changes (PostgREST + RPC design keeps
  connections flat; the lease already bounds realtime sockets).
