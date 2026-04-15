import { defineConfig } from 'vite';

/** Base path must match the URL path (e.g. repo name for gh.io project pages). */
function productionBase() {
  const raw = process.env.VITE_BASE_PATH;
  if (raw == null || raw === '') return '/chase-tool/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? productionBase() : '/',
}));
