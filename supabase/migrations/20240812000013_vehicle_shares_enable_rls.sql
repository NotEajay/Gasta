-- Enable RLS on vehicle_shares so the policies added in
-- 20240812000012_vehicle_shares_policies.sql are actually enforced.
-- The table and its policies already exist; only the enforcement flag is missing.
-- No DELETE policy is added: revocation stays the intended removal mechanism.

alter table public.vehicle_shares enable row level security;
