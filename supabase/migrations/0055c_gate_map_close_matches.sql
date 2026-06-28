-- ============================================================
-- 0055c — Gate map APPLY (close matches). Run AFTER 0055b.
--
-- These are the CLOSE_REVIEW rows I judged to be the SAME person —
-- the dashboard just carries an extra middle name, a coach suffix was
-- dropped, or a clear handwriting misspelling. Each gate number is
-- resolved to the DASHBOARD member name (best similarity match), NOT the
-- handwritten spelling, so the gate sync's name-join works.
--
-- Skipped on purpose (duplicate device numbers for one member — keep the
-- one inserted earlier): 136=135, 476=416, 207≈253, 220≈82.
-- Safe to re-run; NOT EXISTS guards skip anything already mapped.
-- Requires public.gate_norm + pg_trgm from 0055a/0055b.
-- ============================================================
create extension if not exists pg_trgm;

with
confirmed(anviz_userid, file_name) as (
  values
  (140, 'عبدالله احمد'),
  (159, 'حيدرة عيسى'),
  (313, 'احمد الراشد'),
  (190, 'الحسين ابراهيم'),
  (210, 'دينا محمد'),
  (481, 'علي معمار'),
  (36, 'عبد الرحمن الصالح نوار'),
  (58, 'مرح ابو خضور'),
  (99, 'جعفر اسماعيل'),
  (154, 'عبد القادر منون'),
  (233, 'محمد إبراهيم'),
  (246, 'هشام إبراهيم'),
  (19, 'نادية إبراهيم'),
  (55, 'إبراهيم سكر'),
  (95, 'جوى عيسى'),
  (119, 'محمد حسن'),
  (179, 'أياد العباسي'),
  (192, 'زين بليدي'),
  (206, 'عبدالله الخطيب'),
  (240, 'مصطفى محمد نعنوع'),
  (261, 'خالد العقاب'),
  (299, 'فارس الأحمد'),
  (305, 'احمد حاج حمود'),
  (341, 'منوار عبد اللطيف'),
  (21, 'آية إبراهيم'),
  (52, 'يارا رومية'),
  (128, 'حنين نزار حسين'),
  (497, 'كمال مصطفى'),
  (29, 'فادي عبد الرحيم'),
  (46, 'راما إسماعيل'),
  (180, 'ميسرة الأطرش'),
  (227, 'رهام اسماعيل'),
  (416, 'الحسين درباس'),
  (38, 'حسام الخطيب نوار'),
  (51, 'حمزة احمد'),
  (134, 'بشار صالح السالم'),
  (153, 'عبدالله الأحمد'),
  (158, 'حمادة العلي'),
  (194, 'ابراهيم اسبر'),
  (197, 'محمد سعد الدين'),
  (293, 'أياد حمشو'),
  (307, 'باسل ملحم'),
  (314, 'حسن شاهين'),
  (340, 'رشا إبراهيم'),
  (345, 'هادي ديبو'),
  (491, 'سليم موسى'),
  (318, 'جاد بلا'),
  (37, 'بيبرس سفلو نوار'),
  (166, 'زيد محمد'),
  (182, 'احمد العودة'),
  (187, 'ميشيل محفوض'),
  (205, 'ابراهيم بدوي'),
  (243, 'بشر الخطيب'),
  (244, 'مناف صقر'),
  (315, 'زهير سلمان'),
  (320, 'شام جندي'),
  (48, 'هادي إبراهيم'),
  (43, 'محمد صالح نوار'),
  (90, 'احمد عباس'),
  (118, 'ليث بركات'),
  (121, 'حسين ناصر'),
  (135, 'علي داؤود'),
  (149, 'يوسف طراف'),
  (214, 'كفاح زربا نوار'),
  (224, 'حسين شحود'),
  (230, 'أحمد منون'),
  (241, 'آية الراعي'),
  (282, 'زين محمد سلمان'),
  (295, 'عبدالقادر اسماعيل'),
  (309, 'كمال حبتة'),
  (113, 'هارون مقداد خدام'),
  (175, 'عيد الرحمن الحسين'),
  (281, 'فادي داؤود'),
  (54, 'هدى كرمي'),
  (66, 'يزن صقور'),
  (70, 'علي يوسف'),
  (71, 'مجد قاسم'),
  (81, 'شمس أحمد'),
  (203, 'رائد ديب'),
  (267, 'محمد مغربي'),
  (384, 'خليل عابدن'),
  (92, 'محمد مخلوف نادية'),
  (289, 'عمرو زهرة'),
  (76, 'علي عواد'),
  (188, 'ابراهيم عبدالله'),
  (156, 'محمد درويش'),
  (124, 'انس قاسم'),
  (42, 'سيما إبراهيم نوار'),
  (103, 'منيف الخوري'),
  (196, 'اكسم بركات'),
  (238, 'ذوالفقار عجورية'),
  (50, 'علي شبيب'),
  (91, 'سالي كوشيك'),
  (97, 'محمود رزوق'),
  (62, 'بانا عبدالله'),
  (25, 'ساميلا الراعي'),
  (104, 'جمال ياسين'),
  (221, 'نعمى جنوب ساملا'),
  (245, 'حافظ حصيروف'),
  (44, 'باسل مخلوف نوار'),
  (40, 'زينب معروف سالي'),
  (125, 'حازم العلي'),
  (216, 'عبد السائر السباعي سالي'),
  (397, 'إلياس بشو'),
  (222, 'حسن زاهر ناديا'),
  (223, 'أحمد قاسم ساملا'),
  (41, 'كرم نوفل سالي')
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
select anviz_userid, member_name, 'imported from gate list (close match)'
from to_insert
returning anviz_userid, member_name;

NOTIFY pgrst, 'reload schema';
