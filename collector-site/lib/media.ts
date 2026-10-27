import type { IntelImage, IntelItem } from './types.ts';

// 旧封面保留在首位；相同 URL 的图集记录提供更精确的说明与原始来源。
export function getItemImages(item: IntelItem): IntelImage[] {
  const images: IntelImage[] = [];
  const seen = new Set<string>();
  if (item.image) {
    const matching = item.images?.find(image => image.url === item.image);
    images.push(matching ?? {
      url: item.image,
      caption: item.imageCaption || `${item.name} 产品配图`,
      sourceUrl: item.website || item.sources[0]?.url || '',
    });
    seen.add(item.image);
  }
  for (const image of item.images ?? []) {
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    images.push(image);
  }
  return images;
}

export function getCoverImage(item: IntelItem): IntelImage | undefined {
  return getItemImages(item)[0];
}
