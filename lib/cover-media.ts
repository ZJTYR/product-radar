export interface CoverMedia {
  src: string;
  srcSet?: string;
  sizes?: string;
}

const cardSizes = '(max-width: 480px) calc(100vw - 34px), (max-width: 1200px) 45vw, 25vw';
const featuredSizes = '(max-width: 760px) calc(100vw - 34px), (max-width: 980px) 72vw, 38vw';

// 仅使用官方页面已经采用的图片变体协议，详情图集始终使用采集原图。
export function coverMedia(source: string, large = false): CoverMedia {
  let url: URL;
  try { url = new URL(source); } catch { return { src: source }; }
  if (url.protocol !== 'https:' || url.username || url.password || [...url.searchParams.keys()].some(key => /signature|token|^sig$|^x-amz-/i.test(key))) return { src: source };
  const sizes = large ? featuredSizes : cardSizes;
  if (url.hostname === 'framerusercontent.com' && url.pathname.startsWith('/images/')) {
    const widths = large ? [512, 1024, 2048] : [512, 1024];
    const variant = (width: number) => { const image = new URL(url); image.searchParams.set('scale-down-to', String(width)); return image.href; };
    return { src: variant(large ? 1024 : 512), srcSet: widths.map(width => `${variant(width)} ${width}w`).join(', '), sizes };
  }
  if (url.hostname === 'www.qt.io' && url.pathname.startsWith('/hs-fs/hubfs/')) {
    const originalWidth = Number(url.searchParams.get('width'));
    const originalHeight = Number(url.searchParams.get('height'));
    // 缩略图本身太小时不放大，也不猜测它背后有更清晰的原始素材。
    if (!Number.isFinite(originalWidth) || originalWidth < 400 || !Number.isFinite(originalHeight) || originalHeight <= 0) return { src: source };
    const widths = [...new Set([400, 800, ...(large ? [1200] : []), originalWidth].filter(width => width <= originalWidth))].sort((a, b) => a - b);
    const variant = (width: number) => { const image = new URL(url); image.searchParams.set('width', String(width)); image.searchParams.set('height', String(Math.round(width * originalHeight / originalWidth))); return image.href; };
    return { src: variant(widths[0]), srcSet: widths.map(width => `${variant(width)} ${width}w`).join(', '), sizes };
  }
  return { src: source };
}
