-- Update RLS for doe_pending_downloads so developers and admins can read it
drop policy if exists "Admins can view pending downloads" on public.doe_pending_downloads;
create policy "Admins can view pending downloads"
  on public.doe_pending_downloads
  for select
  using (public.is_developer_or_admin());
