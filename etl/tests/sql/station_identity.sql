-- Execute after the official-directory and multi-brand migrations in an isolated DB.
insert into public.oil_companies (id,name,slug) values
 ('10000000-0000-4000-8000-000000000001','Caltex','caltex'),
 ('10000000-0000-4000-8000-000000000002','PTT','ptt');
insert into public.regions (id,code) values ('20000000-0000-4000-8000-000000000001','NCR');
insert into auth.users (id) values ('30000000-0000-4000-8000-000000000001');
insert into public.fuel_stations
 (id,name,oil_company_id,region_id,address,latitude,longitude,source_type,source_url,source_station_id,directory_key,last_synced_at)
 values
 ('40000000-0000-4000-8000-000000000001','Shared Name','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Road A',14,121,'official_directory','https://www.caltex.com/','one','source:one',now()),
 ('40000000-0000-4000-8000-000000000002','Shared Name','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Road B',14,121,'official_directory','https://www.caltex.com/','two','source:two',now());
-- Match the creator policy so the restrictive official-directory guard is what
-- rejects the authenticated update below.
update public.fuel_stations set created_by='30000000-0000-4000-8000-000000000001'
 where source_type='official_directory';
set role authenticated;
set request.jwt.claim.sub='30000000-0000-4000-8000-000000000001';
do $$ declare result uuid; begin
 result := public.create_fuel_station('Shared Name','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',14,121,'Community Road');
 if result in ('40000000-0000-4000-8000-000000000001'::uuid,'40000000-0000-4000-8000-000000000002'::uuid) then raise exception 'Official record reused by community RPC'; end if;
 if (select count(*) from public.fuel_stations where source_type='official_directory' and oil_company_id='10000000-0000-4000-8000-000000000001') <> 2 then raise exception 'Official metadata changed'; end if;
 if public.create_fuel_station('Shared Name','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',14,121,'Again') <> result then raise exception 'Community identity changed'; end if;
 begin
  insert into public.fuel_stations(name,oil_company_id,region_id,address,latitude,longitude,created_by) values('Shared Name','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Duplicate',14,121,auth.uid());
  raise exception 'Duplicate community identity accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.fuel_stations(name,oil_company_id,region_id,address,latitude,longitude,source_type,source_url,directory_key,last_synced_at,created_by)
   values('Spoofed Official','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Spoof',14,121,'official_directory','https://www.pttphilippines.com/','spoof',now(),auth.uid());
  raise exception 'Authenticated official insert accepted';
 exception when insufficient_privilege then null; end;
 update public.fuel_stations set name='Hijacked' where id='40000000-0000-4000-8000-000000000001';
 if found then raise exception 'Authenticated official update accepted'; end if;
end $$;
reset role;
select 'station identity, community RPC and official-write guards passed' as verification;
