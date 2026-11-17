import test from 'node:test';
import assert from 'node:assert/strict';
import { getCoverImage, getItemImages } from '../lib/media.ts';
import { catalogSchema, ingestSchema } from '../lib/validation.ts';
import { seedItems } from '../lib/seed.ts';

const image = { url: 'https://example.com/product.png', caption: '官方文档截图 · 商品详情示例', sourceUrl: 'https://example.com/docs/product' };
const item = { ...seedItems[0], image: undefined, imageCaption: undefined };

test('legacy covers, gallery-only records and empty records remain readable without changing stored data', () => {
  assert.deepEqual(getItemImages(item), []);
  assert.equal(getCoverImage(item), undefined);
  assert.deepEqual(getItemImages({ ...item, images: [image] }), [image]);
  const legacy = { ...item, image: '/images/cover.webp', imageCaption: '官方产品界面示意' };
  assert.deepEqual(getCoverImage(legacy), { url: legacy.image, caption: legacy.imageCaption, sourceUrl: item.website });
  const combined = { ...legacy, images: [image, { ...image, url: legacy.image, caption: '原始文档中的封面' }, image] };
  const before = structuredClone(combined);
  assert.deepEqual(getItemImages(combined).map(entry => entry.url), [legacy.image, image.url]);
  assert.equal(getCoverImage(combined).caption, '原始文档中的封面');
  assert.equal(getCoverImage(combined).sourceUrl, image.sourceUrl);
  assert.deepEqual(combined, before);
});

test('catalog and edition ingestion preserve all image provenance for product, design and news', () => {
  for (const kind of ['product', 'design', 'ai']) {
    const record = { ...item, kind, images: [image, { ...image, url: '/images/workflow.webp' }] };
    const catalog = catalogSchema.parse({ items: [record] });
    const edition = ingestSchema.parse({ date: '2026-10-22', items: [record] });
    assert.deepEqual(catalog.items[0].images, record.images);
    assert.deepEqual(edition.items[0].images, record.images);
  }
});

test('gallery requires safe URLs, explicit captions and original sources with bounded unique images', () => {
  const accepts = images => catalogSchema.safeParse({ items: [{ ...item, images }] }).success;
  assert.equal(accepts([]), true);
  assert.equal(accepts([image]), true);
  assert.equal(accepts(Array.from({ length: 50 }, (_, i) => ({ ...image, url: `https://example.com/${i}.png` }))), true);
  assert.equal(accepts(Array.from({ length: 51 }, (_, i) => ({ ...image, url: `https://example.com/${i}.png` }))), false);
  assert.equal(accepts([image, image]), false);
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,xxx', '//evil.example/a.png', '/images/../secret', '/images/%2e%2e/secret', '/api/export']) {
    assert.equal(accepts([{ ...image, url }]), false, url);
  }
  for (const patch of [{ caption: '' }, { caption: 'x'.repeat(301) }, { sourceUrl: '' }, { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: '/relative' }, { unknown: true }]) {
    assert.equal(accepts([{ ...image, ...patch }]), false, JSON.stringify(patch));
  }
});

test('missing-image review survives both catalogs and edition schemas without marking imaged or legacy items as reviewed', async () => {
  const collector = await import('../collector-site/lib/validation.ts');
  const review = {
    reason: 'no_product_ui',
    detail: '官方仓库仅提供 Agent 技能和示例指令。',
    checkedAt: '2026-11-17T02:00:00.000Z',
    sources: ['https://example.com/docs/skills'],
  };
  for (const schemas of [{ catalogSchema, ingestSchema }, collector]) {
    const reviewed = { ...item, missingImageReview: review };
    assert.deepEqual(schemas.catalogSchema.parse({ items: [reviewed] }).items[0].missingImageReview, review);
    assert.deepEqual(schemas.ingestSchema.parse({ date: '2026-10-22', items: [reviewed] }).items[0].missingImageReview, review);
    assert.equal(schemas.catalogSchema.parse({ items: [item] }).items[0].missingImageReview, undefined);

    for (const change of [
      { image: '/images/image.png' },
      { images: [image] },
      { missingImageReview: { ...review, detail: '  ' } },
      { missingImageReview: { ...review, sources: [] } },
      { missingImageReview: { ...review, checkedAt: 'yesterday' } },
    ]) {
      assert.equal(schemas.catalogSchema.safeParse({ items: [{ ...reviewed, ...change }] }).success, false);
    }
  }
});
