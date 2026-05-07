-- ============================================================
-- 0026 — supplement catalog import (163 products)
--
-- Imports the supplier price list previously kept in
-- data/catalog/supplements.json (and the supplier PDF) into
-- public.products as the canonical source of truth.
--
-- Brands covered: LEVRONE (Gold / Blue / Anabolic), BAD ASS,
-- FA, YAVA LABS, OLIMP, plus a few generic items.
--
-- All cost/price values are in USD. Each row gets stock=0 and
-- low_stock_threshold=3 — the gym fills real stock via the UI.
-- Some rows have NULL cost (samples, single-price items).
--
-- Upsert behavior: for each row, if a product with the same
-- name (case-insensitive) already exists, UPDATE it with the
-- PDF values; otherwise INSERT a new row. This means existing
-- "Shaker" from migration 0021 will get its values refreshed
-- to match the PDF's "shaker" entry, and the two extra shaker
-- variants ("Shaker YAVA LABS", "shaker ريفليكس") become
-- new rows.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

WITH pdf_data (name, category, cost, price) AS (
  VALUES
    -- ── LEVRONE Gold ─────────────────────────────────────────
    ('LEVRONE levrone gold whey 2 kg snikers',                       'protein',     47.0::numeric, 60.0::numeric),
    ('LEVRONE levrone gold whey 2 kg chocolate',                     'protein',     47.0,          60.0),
    ('LEVRONE levrone gold iso 2 kg snikers',                        'protein',     57.0,          65.0),
    ('LEVRONE levrone gold iso 2 kg chocolate',                      'protein',     57.0,          65.0),
    ('LEVRONE levrone gold glutamine 300g',                          'amino',       14.0,          18.0),
    ('LEVRONE levrone gold creatine 300 g 2027',                     'creatine',    13.0,          15.0),
    ('LEVRONE levrone gold creatine 300 g 2028',                     'creatine',    13.0,          17.0),
    ('LEVRONE levrone gold creatine 500 g private label',            'creatine',    22.0,          30.0),
    ('LEVRONE levrone gold creatine 1 kg',                           'creatine',    32.0,          42.0),
    ('LEVRONE levrone gold leen mass 6 kg chocolate',                'mass_gainer', 60.0,          70.0),
    ('LEVRONE levrone gold leen mass 6 kg snikers',                  'mass_gainer', 60.0,          70.0),
    ('LEVRONE levrone gold leen mass 6 kg strawberry',               'mass_gainer', 60.0,          70.0),
    ('LEVRONE levrone gold lean mass 3 kg chocolate',                'mass_gainer', 35.0,          40.0),
    ('LEVRONE levrone gold beta-alanine 300 g private',              'health',      15.0,          20.0),
    ('LEVRONE levrone gold beta-alanine 120 tabs',                   'health',      15.0,          20.0),
    ('LEVRONE levrone gold amino 350 tabs private label',            'amino',       23.0,          25.0),
    ('LEVRONE levrone gold beef amino 600 tabs',                     'amino',       30.0,          35.0),
    ('LEVRONE levrone gold pro zmax 90 tabs private label',          'health',      13.0,          16.0),
    ('LEVRONE levrone gold lion''s mane 1000 90 tabs',               'focus',       15.0,          18.0),
    ('LEVRONE levrone gold tribulus 90 tabs',                        'health',      17.0,          20.0),

    -- ── LEVRONE Blue ─────────────────────────────────────────
    ('LEVRONE levrone whey supreme 2 kg chocolate',                  'protein',     50.0,          60.0),
    ('LEVRONE levrone whey supreme 2 kg snikers',                    'protein',     50.0,          60.0),
    ('LEVRONE levrone whey supreme 2 kg cookies & cream',            'protein',     50.0,          60.0),
    ('LEVRONE levrone whey supreme 2 kg strawberry-banana',          'protein',     50.0,          60.0),
    ('LEVRONE levrone crea 240 g fruit massage',                     'creatine',    13.0,          20.0),
    ('LEVRONE levrone legendary beta alanine 300 g citrus-peach',    'health',      18.0,          22.0),
    ('LEVRONE levrone bcaa 400 g lychee',                            'amino',       18.0,          22.0),
    ('LEVRONE levrone bcaa 400 g blackberry-pineapple',              'amino',       18.0,          22.0),
    ('LEVRONE levrone bcaa 400 g dragon fruit',                      'amino',       18.0,          22.0),
    ('LEVRONE levrone bcaa 400 g orange-mango',                      'amino',       18.0,          22.0),
    ('LEVRONE levrone test am pm formula 240 (2*120)',               'health',      35.0,          45.0),
    ('LEVRONE wellness series cla 3000 90 caps',                     'fat_burner',  15.0,          20.0),
    ('LEVRONE levrolegendary lipo burn 90 caps',                     'fat_burner',  18.0,          23.0),
    ('LEVRONE wellness series vitamin c with rose hip extract 90 tabs','health',    12.0,          17.0),
    ('LEVRONE levrone wellness series omega 3 90 caps',              'health',      14.0,          17.0),

    -- ── LEVRONE Anabolic ─────────────────────────────────────
    ('LEVRONE anabolic prime pro 2 kg strawberry',                   'protein',     55.0,          65.0),
    ('LEVRONE anabolic prime pro 2 kg banana-peach',                 'protein',     55.0,          65.0),
    ('LEVRONE anabolic prime pro 2 kg caramel',                      'protein',     55.0,          65.0),
    ('LEVRONE anabolic cream of rice 2 kg cherry-apple',             'mass_gainer', 30.0,          35.0),
    ('LEVRONE anabolic cream of rice 2 kg forest berry',             'mass_gainer', 30.0,          35.0),
    ('LEVRONE anabolic crea 10 207 g mango-lemon',                   'creatine',    14.0,          20.0),
    ('LEVRONE anabolic mass 3 kg strawberry',                        'mass_gainer', 36.0,          42.0),
    ('LEVRONE anabolic crea 1 kg',                                   'creatine',    33.0,          43.0),
    ('LEVRONE anabolic bcaa hydration & electrolytes 375 g dragon fruit',   'amino', 20.0,         25.0),
    ('LEVRONE anabolic bcaa hydration & electrolytes 375 g orange-mango',   'amino', 20.0,         25.0),
    ('LEVRONE anabolic bcaa hydration & electrolytes 375 g exotic',         'amino', 20.0,         25.0),
    ('LEVRONE anabolic leaa 240 g sour watermelon',                  'amino',       20.0,          25.0),
    ('LEVRONE anabolic eaa+bcaa 1000 ml orange',                     'amino',       25.0,          30.0),
    ('LEVRONE anabolic ice BCAA 375 icy mango-passion fruit',        'amino',       21.0,          26.0),
    ('LEVRONE anabolic ice eaa 420 g icy orange-mango',              'amino',       22.0,          27.0),
    ('LEVRONE anabolic sleep Bombs 90 tabs',                         'health',      22.0,          30.0),
    ('LEVRONE anabolic test 90 tabs',                                'health',      30.0,          35.0),
    ('LEVRONE anabolic Amino 300 tabs',                              'amino',       26.0,          30.0),
    ('LEVRONE anabolic cuts 30 sachets',                             'fat_burner',  35.0,          40.0),
    ('LEVRONE anabolic leaa 240 g orange-mango',                     'amino',       20.0,          25.0),
    ('LEVRONE shaaboom pump 385 g orange-mango',                     'pre_workout', 22.0,          25.0),
    ('LEVRONE shaaboom energy pump 320 ml orange cherry',            'pre_workout', NULL,          2.0),
    ('LEVRONE shaaboom energy pump 320 ml fruit punch',              'pre_workout', NULL,          2.0),

    -- ── Accessories / FA ─────────────────────────────────────
    ('FA creatine 300 g',                                            'creatine',    13.0,          16.0),
    ('shaker',                                                       'accessory',   NULL,          4.0),

    -- ── BAD ASS ──────────────────────────────────────────────
    ('BAD ASS whey 2 kg chocolate',                                  'protein',     45.0,          55.0),
    ('BAD ASS whey 2 kg cookies & cream',                            'protein',     45.0,          55.0),
    ('BAD ASS anabolic iso 2 kg vanilla jordan',                     'protein',     54.0,          64.0),
    ('BAD ASS anabolic bcaa 8:1:1 400 g exotic',                     'amino',       20.0,          25.0),
    ('BAD ASS pump 350 g mango-lemon',                               'pre_workout', 20.0,          25.0),
    ('BAD ASS pump 350 g citrus-peach',                              'pre_workout', 20.0,          25.0),

    -- ── Mixed Supplements ────────────────────────────────────
    ('amino eaa xpload powder pineapple 520 g',                      'amino',       27.0,          30.0),
    ('amino eaa xpload powder ice tea peach 520 g',                  'amino',       27.0,          30.0),
    ('amino target xplode 275 g lemon',                              'amino',       19.0,          25.0),
    ('rocky athletes glutamine 250 g',                               'amino',       15.0,          20.0),
    ('creatine monohydrate powder 250 g',                            'creatine',    16.0,          20.0),
    ('gain bolic 6000 vanilla 6800 g',                               'mass_gainer', 75.0,          80.0),
    ('platinum ginseng sport edition 60 caps',                       'focus',       13.0,          17.0),
    ('r-weiler focus cola 300g',                                     'pre_workout', 25.0,          30.0),
    ('whey protein complex 100% double chocolate 2270 g',            'protein',     67.0,          75.0),
    ('whey protein complex 100% cookies cream 2270 g',               'protein',     67.0,          75.0),
    ('whey protein complex 100% blueberry 2270 g',                   'protein',     67.0,          75.0),
    ('knockout 2.0',                                                 'pre_workout', 25.0,          30.0),

    -- ── YAVA LABS ────────────────────────────────────────────
    ('YAVA LABS BCAA 300g Blueberry Lemonade',                       'amino',       20.0,          25.0),
    ('YAVA LABS BCAA 300g Citrus Orange',                            'amino',       20.0,          25.0),
    ('YAVA LABS BCAA 300g Energy Drink',                             'amino',       20.0,          25.0),
    ('YAVA LABS BREON BCAA 300g Strawberry Mango',                   'amino',       20.0,          25.0),
    ('YAVA LABS Vegan Protein 2 kg Chocolate Ice Cream',             'protein',     53.0,          62.0),
    ('YAVA LABS Vegan Protein 2 kg Salted Caramel',                  'protein',     53.0,          62.0),
    ('YAVA LABS Vegan Protein 2 kg Strawberry Ice Cream',            'protein',     53.0,          62.0),
    ('YAVA LABS ELITE WHEY 1 kg Chocolate Toffee Caramel',           'protein',     33.0,          39.0),
    ('YAVA LABS ELITE WHEY 1 kg Chocolate Ice Cream',                'protein',     33.0,          39.0),
    ('YAVA LABS ELITE WHEY 1 kg Cookies & Cream',                    'protein',     33.0,          39.0),
    ('YAVA LABS ELITE WHEY 1 kg Strawberry Ice Cream',               'protein',     33.0,          39.0),
    ('YAVA LABS ISO WHEY 1 kg Chocolate Ice Cream',                  'protein',     40.0,          47.0),
    ('YAVA LABS ISO WHEY 1 kg Cookies & Cream',                      'protein',     40.0,          47.0),
    ('YAVA LABS BREON ISO WHEY 1 kg Strawberry Ice Cream',           'protein',     40.0,          47.0),
    ('YAVA LABS ISO WHEY 1 kg Pistachio',                            'protein',     40.0,          47.0),
    ('YAVA LABS Night Protein CASEINE 1 kg Strawberry Ice Cream',    'protein',     37.0,          43.0),
    ('YAVA LABS Night Protein CASEINE 1 kg Chocolate Ice Cream',     'protein',     37.0,          43.0),
    ('YAVA LABS Night Protein CASEINE 1 kg Vanilla Ice Cream',       'protein',     37.0,          43.0),
    ('YAVA LABS Bulk Mass 3 kg Chocolate',                           'mass_gainer', 35.0,          41.0),
    ('YAVA LABS BREON Bulk Mass 3 kg Cookies & Cream',               'mass_gainer', 35.0,          41.0),
    ('YAVA LABS Bulk Mass 1.5 kg Strawberry',                        'mass_gainer', 23.0,          27.0),
    ('YAVA LABS Bulk Mass 1.5 kg Chocolate',                         'mass_gainer', 23.0,          27.0),
    ('YAVA LABS BREON Bulk Mass 1.5 kg Cookies & Cream',             'mass_gainer', 23.0,          27.0),
    ('YAVA LABS Bulk Mass 1.5 kg Vanilla',                           'mass_gainer', 23.0,          27.0),
    ('YAVA LABS COMPLEX MASS PRO 6 kg Cookies & Cream',              'mass_gainer', 60.0,          76.0),
    ('YAVA LABS COMPLEX MASS PRO 6 kg Chocolate',                    'mass_gainer', 60.0,          76.0),
    ('YAVA LABS COMPLEX MASS PRO 6 kg Chocolate Toffee Caramel',     'mass_gainer', 60.0,          76.0),
    ('YAVA LABS PRE workout STIM FREE 300g Blueberry',               'pre_workout', 17.0,          20.0),
    ('YAVA LABS PRE workout STIM FREE 300g Energy',                  'pre_workout', 20.0,          25.0),
    ('YAVA LABS CREATINE+Taurine 300g Neutral',                      'creatine',    20.0,          25.0),
    ('YAVA LABS CREATINE 300g Pure',                                 'creatine',    16.0,          22.0),
    ('YAVA LABS CREATINE 500g Pure',                                 'creatine',    23.0,          32.0),
    ('YAVA LABS Omega 3 90 softgel',                                 'health',      14.0,          18.0),
    ('YAVA LABS CREATINE Gummies 240g Lemon & Lime',                 'creatine',    20.0,          23.0),
    ('YAVA LABS CREATINE Gummies 240g Raspberry',                    'creatine',    20.0,          23.0),
    ('YAVA LABS Protein Spread Hazelnut 350 g',                      'other',       NULL,          14.0),
    ('YAVA LABS GREEN LINE Green TEA 500mg 90 caps',                 'fat_burner',  25.0,          30.0),
    ('YAVA LABS PREMIUM 100% Beef PROTEIN 2 kg Bubble Gum',          'protein',     56.0,          65.0),
    ('YAVA LABS PREMIUM 100% Beef PROTEIN 2 kg Cherry',              'protein',     56.0,          65.0),
    ('YAVA LABS PREMIUM 100% Beef PROTEIN 2 kg Cola',                'protein',     56.0,          65.0),
    ('YAVA LABS PREMIUM 100% Beef PROTEIN 2 kg Mango',               'protein',     56.0,          65.0),
    ('YAVA LABS PREMIUM 100% Beef PROTEIN 2 kg Passion Fruit',       'protein',     56.0,          65.0),
    ('YAVA LABS PREMIUM 100% Beef PROTEIN 2 kg Pineapple',           'protein',     56.0,          65.0),
    ('YAVA PREMIUM WHEY 2 kg Raspberry White Chocolate',             'protein',     70.0,          82.0),
    ('YAVA PREMIUM WHEY 2 kg Strawberry Chocolate',                  'protein',     70.0,          82.0),
    ('YAVA PREMIUM WHEY 2 kg Cherry Chocolate',                      'protein',     70.0,          82.0),
    ('YAVA PREMIUM WHEY 2 kg Banana Chocolate',                      'protein',     70.0,          82.0),
    ('YAVA PREMIUM ISO 2 kg Raspberry White Chocolate',              'protein',     86.0,          100.0),
    ('YAVA PREMIUM ISO 2 kg Strawberry Chocolate',                   'protein',     86.0,          100.0),
    ('YAVA PREMIUM ISO 2 kg Cherry Chocolate',                       'protein',     86.0,          100.0),
    ('YAVA PREMIUM ISO 2 kg Banana Chocolate',                       'protein',     86.0,          100.0),
    ('YAVA LABS Multivitamin 60 caps',                               'health',      13.0,          15.0),
    ('YAVA LABS SAMPLES Pure ISO 30g BREON Strawberry Ice Cream',    'other',       NULL,          2.0),
    ('YAVA LABS EAA 10g Lemon Mojito SAMPLE',                        'other',       NULL,          1.0),
    ('YAVA LABS PRE workout 10g Cotton Candy SAMPLE',                'other',       NULL,          1.0),
    ('Shaker YAVA LABS',                                             'accessory',   4.0,           6.0),
    ('YAVA LABS CARRNI SHOT',                                        'fat_burner',  NULL,          2.0),

    -- ── Accessories ──────────────────────────────────────────
    ('shaker ريفليكس',                                                'accessory',   NULL,          4.0),

    -- ── OLIMP ────────────────────────────────────────────────
    ('OLIMP Alkagen 120caps',                                        'health',      18.0,          23.0),
    ('OLIMP Ashwagandha 600 Sport 60caps',                           'focus',       14.0,          17.0),
    ('OLIMP Carbonox-bl-rsbry-1kg',                                  'mass_gainer', 15.0,          20.0),
    ('OLIMP Carbonox-grpfrt-1kg',                                    'mass_gainer', 15.0,          20.0),
    ('OLIMP Carbonox-lmn-1kg',                                       'mass_gainer', 15.0,          20.0),
    ('OLIMP Carbonox-pnpl-1kg',                                      'mass_gainer', 15.0,          20.0),
    ('OLIMP Carbonox-rng-1kg',                                       'mass_gainer', 15.0,          20.0),
    ('OLIMP Carbonox-wtrmln-1kg',                                    'mass_gainer', 15.0,          20.0),
    ('OLIMP Gold Omega 3 120caps',                                   'health',      24.0,          30.0),
    ('OLIMP Gold Omega 3 D3+K2 Sport Edition 60caps',                'health',      20.0,          25.0),
    ('OLIMP Max Mass 3xl 6000g-chc',                                 'mass_gainer', 67.0,          75.0),
    ('OLIMP Max Mass 3xl 6000g-strwb',                               'mass_gainer', 67.0,          75.0),
    ('OLIMP Max Mass 3xl 6000g-vnl',                                 'mass_gainer', 67.0,          75.0),
    ('OLIMP Vita-Min Multiple Shot 25ml',                            'health',      NULL,          2.0),
    ('OLIMP Vita-Min Multiple Sport Mega Caps 60caps',               'health',      15.0,          18.0),
    ('OLIMP Vita-Min One 60caps',                                    'health',      12.0,          15.0),
    ('OLIMP Citrulline Malate 200g',                                 'pre_workout', 19.0,          25.0),
    ('OLIMP Im Pro Protein Bar 40g',                                 'other',       NULL,          2.0),
    ('OLIMP Whey Protein Complex 100%-blbr-700g',                    'protein',     25.0,          30.0),
    ('OLIMP Whey Protein Complex 100%-chc-700g',                     'protein',     25.0,          30.0),
    ('OLIMP Whey Protein Complex 100%-ck-crm-700g',                  'protein',     25.0,          30.0),
    ('OLIMP Whey Protein Complex 100%-dbl-chc-1800g',                'protein',     63.0,          70.0),
    ('OLIMP Whey Protein Complex 100%-dbl-chc-700g',                 'protein',     25.0,          30.0),
    ('OLIMP Whey Protein Complex 100%-strwb-1800g',                  'protein',     63.0,          70.0),
    ('OLIMP Whey Protein Complex 100%-strwb-700g',                   'protein',     25.0,          30.0),
    ('OLIMP Whey Protein Complex 100%-vnl-1800g',                    'protein',     63.0,          70.0),
    ('OLIMP Whey Protein Complex 100%-vnl-700g',                     'protein',     25.0,          30.0)
),
updated AS (
  -- Refresh any existing same-named row (case-insensitive) with the PDF values.
  UPDATE public.products p
     SET cost           = pd.cost,
         cost_currency  = 'usd',
         price          = pd.price,
         price_currency = 'usd',
         category       = pd.category
    FROM pdf_data pd
   WHERE lower(p.name) = lower(pd.name)
   RETURNING lower(p.name) AS name_lower
)
INSERT INTO public.products
  (name, category, cost, cost_currency, price, price_currency, stock, low_stock_threshold)
SELECT pd.name, pd.category, pd.cost, 'usd', pd.price, 'usd', 0, 3
  FROM pdf_data pd
 WHERE NOT EXISTS (
        SELECT 1 FROM updated u WHERE u.name_lower = lower(pd.name)
      );

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   DELETE FROM public.products
--    WHERE name IN (
--      'LEVRONE levrone gold whey 2 kg snikers',
--      'LEVRONE levrone gold whey 2 kg chocolate',
--      -- … (full list of 163 names)
--    );
--   NOTIFY pgrst, 'reload schema';
--
-- Reverting the upsert (i.e., restoring previous values for the
-- same-named "Shaker" / "shaker") cannot be done automatically —
-- the prior values were overwritten. Restore from a DB snapshot
-- if you need them back.
-- ============================================================
