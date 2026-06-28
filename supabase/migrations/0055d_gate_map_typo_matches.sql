-- ============================================================
-- 0055d — Gate map APPLY (typo matches, manager-confirmed). Run AFTER 0055c.
--
-- Surname/spelling differs from the handwritten list but the manager
-- confirmed these are the same person (handwriting typos). Each gate
-- number resolves to the DASHBOARD member name via best similarity match.
-- Safe to re-run; NOT EXISTS guards skip anything already mapped.
-- Requires public.gate_norm + pg_trgm from 0055a/0055b.
-- ============================================================
create extension if not exists pg_trgm;

with
confirmed(anviz_userid, file_name) as (
  values
  (11, 'محمد حمود'),
  (83, 'علي حسن'),
  (200, 'علي شروق'),
  (87, 'زين العابدين الشيخ'),
  (336, 'محمد القاشور'),
  (388, 'أحمد محيي الدين'),
  (390, 'علي الخضر'),
  (394, 'يوسف دروبش'),
  (385, 'أحمر هوارية'),
  (218, 'سامن بحري ساريلا'),
  (169, 'زين عبد'),
  (198, 'جودي جوني'),
  (257, 'لين'),
  (284, 'ورد العيراللة'),
  (107, 'دنيا قاسم'),
  (316, 'صبى هنيده'),
  (213, 'جنات سيع الليل نوار')
),
subs as (
  select distinct member_name
  from public.gym_subscriptions
  where cancelled_at is null and coalesce(btrim(member_name),'') <> ''
),
resolved as (
  select c.anviz_userid,
         (select su.member_name from subs su
            order by similarity(public.gate_norm(su.member_name), public.gate_norm(c.file_name)) desc,
                     su.member_name asc
            limit 1) as member_name
  from confirmed c
),
to_insert as (
  select distinct on (r.member_name) r.anviz_userid, r.member_name
  from resolved r
  where r.member_name is not null
    and not exists (select 1 from public.anviz_member_map a where a.anviz_userid = r.anviz_userid)
    and not exists (select 1 from public.anviz_member_map a
                      where public.gate_norm(a.member_name) = public.gate_norm(r.member_name))
  order by r.member_name, r.anviz_userid
)
insert into public.anviz_member_map (anviz_userid, member_name, notes)
select anviz_userid, member_name, 'imported from gate list (typo match)'
from to_insert
returning anviz_userid, member_name;

NOTIFY pgrst, 'reload schema';
