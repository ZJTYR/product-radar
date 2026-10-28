import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectStyleArtifacts, verifyStylePath } from '../scripts/verify-styles.mjs';

// 用最小编译结果描述布局契约，不依赖源码是否存在同名类。
const layoutCss = `
.frontier-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
.frontier-card{padding:14px 16px;background:#fff;border:1px solid #ccd9c6}
.frontier-card:last-child:nth-child(odd){grid-column:1/-1}
.frontier-open>p{-webkit-line-clamp:2;overflow:hidden}
.product-grid.discovery-product-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
.grid-card-actions,.history-day-open,.discovery-grid-toolbar{display:flex}
.image-gallery-stage{height:380px;position:relative}
.image-gallery-thumbnails{display:flex;overflow-x:auto}
.image-lightbox{max-width:calc(100vw - 40px);overflow:hidden}
.image-lightbox-canvas{display:flex;overflow:auto}
.annotation-selection-toolbar{display:flex;position:fixed}
.annotation-notebook-inner{display:flex;flex-direction:column}
.annotation-notebook-scroll{overflow:auto}
.annotation-editor-inner{display:flex}
.annotation-highlight{background:#dbebce}
`;

test('compiled layout contracts pass across split and immutable CSS output paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'radar-style-artifacts-'));
  try {
    await mkdir(join(directory, 'immutable', 'chunks'), { recursive: true });
    await writeFile(join(directory, 'immutable', 'chunks', 'page.css'), layoutCss);
    await writeFile(join(directory, 'base.css'), 'body{margin:0}');
    assert.deepEqual(await verifyStylePath(directory), { files: 2, modules: 17 });
    assert.deepEqual(await verifyStylePath(join(directory, 'immutable', 'chunks', 'page.css')), { files: 1, modules: 17 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('old compiled CSS cannot pass merely because the old page still has styling', () => {
  const errors = inspectStyleArtifacts([{ css: '.product-card{background:#fff}.recommendation-view{display:block}' }]);
  assert.ok(errors.some(error => error.includes('.frontier-list')));
  assert.ok(errors.some(error => error.includes('.grid-card-actions')));
});

test('layout rules hidden inside a media condition fail the artifact gate', () => {
  const errors = inspectStyleArtifacts([{ css: `@media(max-width:1440px){${layoutCss}}` }]);
  assert.ok(errors.some(error => error.includes('.frontier-list')));
  assert.ok(errors.some(error => error.includes('.product-grid.discovery-product-grid')));
  assert.deepEqual(inspectStyleArtifacts([{ css: `@layer application{${layoutCss}}` }]), []);
});

test('missing or overridden critical layout declarations fail even when selectors exist', () => {
  const missing = inspectStyleArtifacts([{ css: layoutCss.replace('padding:14px 16px;', '') }]);
  assert.ok(missing.some(error => error.includes('.frontier-card') && error.includes('padding')));
  const overridden = inspectStyleArtifacts([{ css: `${layoutCss}.frontier-list{display:block}` }]);
  assert.ok(overridden.some(error => error.includes('.frontier-list') && error.includes('display')));
});
