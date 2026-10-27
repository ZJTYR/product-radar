import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postcss from 'postcss';

const compact = value => value.replace(/\s+/g, '').toLowerCase();
const requirements = [
  { selector: '.frontier-list', properties: { display: value => value === 'grid', 'grid-template-columns': value => compact(value) === 'repeat(2,minmax(0,1fr))' } },
  { selector: '.frontier-card', properties: { padding: value => value !== '0', background: value => !['none', 'transparent'].includes(value), border: value => value !== '0' && value !== 'none' } },
  { selector: '.product-grid.discovery-product-grid', properties: { 'grid-template-columns': value => compact(value) === 'repeat(4,minmax(0,1fr))' } },
  { selector: '.grid-card-actions', properties: { display: value => value === 'flex' } },
  { selector: '.history-day-open', properties: { display: value => value === 'flex' } },
  { selector: '.discovery-grid-toolbar', properties: { display: value => value === 'flex' } },
  { selector: '.image-gallery-stage', properties: { height: value => parseFloat(value) >= 300, position: value => value === 'relative' } },
  { selector: '.image-gallery-thumbnails', properties: { display: value => value === 'flex', 'overflow-x': value => value === 'auto' } },
  { selector: '.image-lightbox', properties: { 'max-width': value => value.includes('100vw'), overflow: value => value === 'hidden' } },
  { selector: '.image-lightbox-canvas', properties: { display: value => value === 'flex', overflow: value => value === 'auto' } },
  { selector: '.annotation-selection-toolbar', properties: { display: value => value === 'flex', position: value => value === 'fixed' } },
  { selector: '.annotation-notebook-inner', properties: { display: value => value === 'flex', 'flex-direction': value => value === 'column' } },
  { selector: '.annotation-notebook-scroll', properties: { overflow: value => value === 'auto' } },
  { selector: '.annotation-editor-inner', properties: { display: value => value === 'flex' } },
  { selector: '.annotation-highlight', properties: { background: value => !['none', 'transparent'].includes(value) } },
];

// 只认可无条件规则；样式误放在窄屏、减少动画等条件中也必须阻止发布。
function isUnconditional(rule) {
  for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name !== 'layer') return false;
    if (parent.type === 'rule') return false;
  }
  return true;
}

export function inspectStyleArtifacts(sources) {
  const declarations = new Map(requirements.map(requirement => [requirement.selector, new Map()]));
  const errors = [];
  for (const source of sources) {
    let root;
    try { root = postcss.parse(source.css, { from: source.from }); }
    catch (error) { errors.push(`CSS 无法解析：${source.from || '输入'}：${error.reason || error.message}`); continue; }
    root.walkRules(rule => {
      if (!isUnconditional(rule)) return;
      for (const selector of postcss.list.comma(rule.selector)) {
        const properties = declarations.get(selector.trim());
        if (!properties) continue;
        rule.each(node => { if (node.type === 'decl') properties.set(node.prop, node.value.trim()); });
      }
    });
  }
  for (const requirement of requirements) {
    const properties = declarations.get(requirement.selector);
    for (const [property, valid] of Object.entries(requirement.properties)) {
      const value = properties.get(property);
      if (!value || !valid(value)) errors.push(`${requirement.selector} 缺少无条件的有效 ${property} 声明`);
    }
  }
  return errors;
}

async function cssFiles(target) {
  const info = await stat(target);
  if (info.isFile()) {
    if (!target.endsWith('.css')) throw new Error('样式检查只接受 CSS 文件或构建目录');
    return [target];
  }
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? cssFiles(join(target, entry.name)) : entry.isFile() && entry.name.endsWith('.css') ? [join(target, entry.name)] : []));
  return nested.flat().sort();
}

export async function verifyStylePath(target) {
  const files = await cssFiles(target);
  if (!files.length) throw new Error(`没有找到 CSS 构建产物：${target}`);
  const sources = await Promise.all(files.map(async from => ({ from, css: await readFile(from, 'utf8') })));
  const errors = inspectStyleArtifacts(sources);
  if (errors.length) throw new Error(`样式产物检查失败：\n${errors.map(error => `- ${error}`).join('\n')}`);
  return { files: files.length, modules: requirements.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../.next/static/', import.meta.url));
  try {
    const result = await verifyStylePath(target);
    console.log(`样式产物检查通过：${result.files} 个 CSS 文件，${result.modules} 个关键布局模块。`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
