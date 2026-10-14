// The database API returns at most 1,000 rows per request. For tables that
// can be bigger (regular classes, a month of 30-minute booking slots, one-off
// changes), read them page by page so nothing is silently cut off.
//   const { data, error } = await fetchAll(() => supabaseAdmin.from('x').select('*').order('id'));
// makeQuery must return a fresh query each time, with a stable order.
export async function fetchAll(makeQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}
