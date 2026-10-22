// Independent workspace routes share the current in-memory record and editor.
export const PAGE_ROUTES = Object.freeze([
  {path:'/tutorial', id:'usage-guide', label:'使用教程', title:'使用教程与简介'},
  {path:'/diagnostics', id:'workspace', label:'编译诊断', title:'编译诊断工作台'},
  {path:'/documents', id:'document-evidence', label:'文档依据', title:'官方文档依据'},
  {path:'/records', id:'evidence', label:'记录依据', title:'诊断记录依据'},
  {path:'/history', id:'task-history', label:'任务历史', title:'本机编译历史'}
].map(Object.freeze));

export function initNavigation() {
  const byPath = new Map(PAGE_ROUTES.map(route => [route.path, route]));
  const byHash = new Map(PAGE_ROUTES.map(route => [`#${route.id}`, route]));
  const resolveRoute = value => {
    let url;
    try { url = new URL(value, window.location.href); } catch { return null; }
    if (url.origin !== window.location.origin) return null;
    // Old bookmarks used section anchors. Migrate them to the matching page URL.
    if (byHash.has(url.hash)) return byHash.get(url.hash);
    return byPath.get(url.pathname === '/' ? PAGE_ROUTES[0].path : url.pathname) ?? null;
  };
  const render = route => {
    document.querySelectorAll('.action-menu[open]').forEach(menu => { menu.open = false; });
    document.body.dataset.page = route.path.slice(1);
    for (const page of document.querySelectorAll('[data-page-view]')) page.hidden = page.id !== route.id;
    for (const link of document.querySelectorAll('.nav-item[data-route]')) {
      const active = resolveRoute(link.href) === route;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.getElementById('section-name').textContent = route.label;
    document.title = `${route.title} · Doctor`;
    document.getElementById('main-content').focus({preventScroll:true});
    window.scrollTo({top:0, left:0, behavior:'instant'});
  };
  const navigate = path => {
    const route = resolveRoute(path);
    if (!route) return false;
    if (window.location.pathname !== route.path || window.location.search || window.location.hash) {
      window.history.pushState(null, '', route.path);
    }
    render(route);
    return true;
  };
  const showLocation = () => {
    const route = resolveRoute(window.location.href);
    if (!route) return;
    if (window.location.pathname === '/' || byHash.has(window.location.hash)) {
      window.history.replaceState(window.history.state, '', route.path);
    }
    render(route);
  };
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[data-route]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || !resolveRoute(link.href)) return;
    event.preventDefault();
    navigate(link.href);
  });
  window.addEventListener('popstate', showLocation);
  window.addEventListener('hashchange', () => {
    if (byHash.has(window.location.hash)) showLocation();
  });
  showLocation();
  return {navigate};
}
