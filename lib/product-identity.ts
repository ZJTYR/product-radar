import type { IntelItem } from './types.ts';

const repoPattern = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;
const trackingParameter = /^(utm_.+|fbclid|gclid|msclkid)$/i;

function officialPage(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    for (const key of [...url.searchParams.keys()]) {
      if (trackingParameter.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const host = url.host.replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    const route = url.hash.startsWith('#/') || url.hash.startsWith('#!/') ? url.hash : '';
    return host + path + url.search + route;
  } catch { return ''; }
}

function githubRepo(value: string) {
  const match = /^github\.com\/([^/?#]+\/[^/?#]+)/i.exec(value);
  const repo = match?.[1].toLowerCase().replace(/\.git$/, '') || '';
  return repoPattern.test(repo) ? repo : '';
}

export function productKeys(items: readonly IntelItem[]) {
  const reposByPage = new Map<string, Set<string>>();
  const products = items.filter(item => item.kind === 'product').map(item => {
    const page = officialPage(item.website);
    const repo = item.repo?.toLowerCase().replace(/\.git$/, '');
    const repository = repo && repoPattern.test(repo) ? repo : githubRepo(officialPage(item.github || '') || page);
    if (page && repository) {
      const repos = reposByPage.get(page) ?? new Set<string>();
      repos.add(repository);
      reposByPage.set(page, repos);
    }
    return { id: item.id, page, repository };
  });
  return new Map(products.map(({ id, page, repository }) => {
    const repos = reposByPage.get(page);
    // 同一个官网地址若关联多个仓库，只采用条目各自的仓库或稳定 ID。
    const knownRepo = repository || (repos?.size === 1 ? [...repos][0] : '');
    const key = knownRepo ? `repo:${knownRepo}` : page && !repos ? `page:${page}` : `id:${id}`;
    return [id, key];
  }));
}

export function expandProductIds(keys: ReadonlyMap<string, string>, ids: Iterable<string>) {
  const result = new Set(ids);
  const selected = new Set([...result].map(id => keys.get(id)));
  for (const [id, key] of keys) {
    if (selected.has(key)) result.add(id);
  }
  return result;
}
