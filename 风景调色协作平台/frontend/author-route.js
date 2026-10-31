/* Shared, public-only author addresses for the host and standalone community. */
(() => {
  const normalize = value => {
    const id = Number(value?.author);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const page = Number(value.page);
    return { author: id, sort: value.sort === 'favorites' ? 'favorites' : 'latest',
      page: Number.isSafeInteger(page) && page > 0 && page <= 1000000 ? page : 1,
      search: String(value.search || '').trim().slice(0, 100) };
  };
  const parse = search => {
    const params = new URLSearchParams(search);
    return normalize({ author: params.get('author'), sort: params.get('author_sort'), page: params.get('author_page'), search: params.get('author_search') });
  };
  const url = (base, value) => {
    const result = new URL(base, location.href), route = normalize(value);
    for (const key of ['author', 'author_sort', 'author_page', 'author_search']) result.searchParams.delete(key);
    if (route) {
      result.searchParams.set('author', route.author);
      if (route.sort !== 'latest') result.searchParams.set('author_sort', route.sort);
      if (route.page !== 1) result.searchParams.set('author_page', route.page);
      if (route.search) result.searchParams.set('author_search', route.search);
    }
    return result;
  };
  window.AuthorRoute = { normalize, parse, url };
})();
