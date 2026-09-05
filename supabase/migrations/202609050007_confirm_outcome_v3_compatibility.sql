-- Older deployed databases may have v2 but not the later v3 outcome function.
-- Supply a v3-compatible wrapper only when v3 does not already exist.

begin;

do $$
begin
  if to_regprocedure('public.confirm_rescue_outcome_v3(uuid,text,text,uuid,text,integer,integer,integer,text,text,jsonb,text)') is null then
    execute $function$
      create function public.confirm_rescue_outcome_v3(
        p_sos_report_id uuid,
        p_mode text,
        p_destination_type text,
        p_destination_shelter_id uuid,
        p_destination_note text,
        p_confirmed_adult integer,
        p_confirmed_child integer,
        p_confirmed_elder integer,
        p_cannot_reach_reason text,
        p_notes text,
        p_people jsonb,
        p_count_discrepancy_note text
      )
      returns void
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $body$
      begin
        perform public.confirm_rescue_outcome_v2(
          p_sos_report_id,
          p_mode,
          p_destination_type,
          p_destination_shelter_id,
          p_destination_note,
          p_confirmed_adult,
          p_confirmed_child,
          p_confirmed_elder,
          p_cannot_reach_reason,
          p_notes,
          p_people,
          p_count_discrepancy_note
        );
      end;
      $body$;
    $function$;
  end if;
end;
$$;

revoke all on function public.confirm_rescue_outcome_v3(uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text) from public, anon;
grant execute on function public.confirm_rescue_outcome_v3(uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text) to authenticated;

commit;
