-- Server-only SQL transport for the Cloudflare Worker runtime.
--
-- The Worker cannot open a raw TLS connection to the Supabase pooler: the
-- pooler's certificate chain is issued by Supabase's private CA and workerd
-- validates against public roots only (there is no custom-CA option in
-- cloudflare:sockets). Instead the application adapter (lib/data/rpc.ts)
-- sends its already-translated statements over HTTPS to this function through
-- PostgREST (/rest/v1/rpc/depi_execute) with the service role.
--
-- One call = one transaction, so the adapter's batch() stays atomic and the
-- deferred three-link constraint still fires at commit. Only service_role may
-- execute it; anon and authenticated clients get no access.

create or replace function public.depi_execute(statements jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  item jsonb;
  statement text;
  result jsonb := '[]'::jsonb;
  rows jsonb;
  affected bigint;
begin
  if jsonb_typeof(statements) <> 'array' then
    raise exception 'statements must be a JSON array' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(statements) loop
    statement := item->>'sql';
    if statement is null or btrim(statement) = '' then
      raise exception 'empty statement' using errcode = '22023';
    end if;
    if coalesce(item->>'mode', 'exec') = 'rows' then
      execute 'with _depi_rows as (' || statement || ') '
           || 'select coalesce(jsonb_agg(to_jsonb(_depi_rows)), ''[]''::jsonb) from _depi_rows'
        into rows;
      result := result || jsonb_build_array(jsonb_build_object('rows', rows, 'changes', jsonb_array_length(rows)));
    else
      execute statement;
      get diagnostics affected = row_count;
      result := result || jsonb_build_array(jsonb_build_object('rows', '[]'::jsonb, 'changes', affected));
    end if;
  end loop;
  return result;
end;
$$;

revoke all on function public.depi_execute(jsonb) from public, anon, authenticated;
grant execute on function public.depi_execute(jsonb) to service_role;
