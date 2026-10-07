-- depi_execute, without the quadratic result building.
--
-- The first version (202609200004) added each statement's result with
-- `result := result || jsonb_build_array(...)`, which copies the whole result
-- so far every time: the cost grows with the square of the response. A full
-- staff workspace load (about 12 MB) took 3.5 s instead of 0.5 s, a 2,900-row
-- roster update held one transaction for 23 s, and a few leaders opening the
-- workspace together could reach the statement timeout. The results are now
-- collected in an array, which PL/pgSQL appends to in place, and turned into
-- JSON once at the end. Same input, same output, same transaction and
-- privileges.

create or replace function public.depi_execute(statements jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  item jsonb;
  statement text;
  parts jsonb[] := '{}';
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
      parts := array_append(parts, jsonb_build_object('rows', rows, 'changes', jsonb_array_length(rows)));
    else
      execute statement;
      get diagnostics affected = row_count;
      parts := array_append(parts, jsonb_build_object('rows', '[]'::jsonb, 'changes', affected));
    end if;
  end loop;
  return to_jsonb(parts);
end;
$$;

revoke all on function public.depi_execute(jsonb) from public, anon, authenticated;
grant execute on function public.depi_execute(jsonb) to service_role;
