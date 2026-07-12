// Supabase/PostgREST silently caps every SELECT at 1000 rows (db-max-rows).
// Any list that grows past that starts silently losing data — the reception
// subscriptions list crossed 990 rows in 2026-07, one busy month of sales
// exceeds 1000, etc. This helper pages through `.range()` windows until a
// short page, so callers always get the complete set.
//
// Usage — the caller supplies a builder that applies .range(from, to):
//   const res = await fetchAllRows<Row>((from, to) =>
//     supabase.from("gym_subscriptions").select("*")
//       .is("cancelled_at", null)
//       .order("created_at", { ascending: false })   // stable order REQUIRED
//       .range(from, to));
//
// A stable .order() is required for correct pagination — without it,
// PostgREST may repeat/skip rows across pages.

// `data: unknown` (not T[]) so builders with dynamic select strings — which
// the typed client can't infer — still fit; rows are cast to T on return.
type PageResult = { data: unknown; error: { message: string } | null };

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<{ data: T[]; error: string | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error: error.message };
    const rows = (Array.isArray(data) ? data : []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return { data: all, error: null };
  }
}
