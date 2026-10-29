"use client";

/* eslint-disable @next/next/no-img-element -- 公共来源图片仅使用其官方 CDN 已提供的响应式变体。 */

import { useState } from 'react';
import { Compass, Image as ImageIcon } from 'lucide-react';
import type { IntelItem } from '@/lib/types';
import { getCoverImage } from '@/lib/media';
import { coverMedia } from '@/lib/cover-media';

export function Visual({ item, large = false }: { item: IntelItem; large?: boolean }) {
  return <ProductVisual key={`${item.id}:${getCoverImage(item)?.url || 'no-image'}`} item={item} large={large} />;
}

function ProductVisual({ item, large }: { item: IntelItem; large: boolean }) {
  const [imageState, setImageState] = useState<'responsive' | 'original' | 'failed'>('responsive');
  const cover = getCoverImage(item);
  const hasImage = Boolean(cover) && imageState !== 'failed';
  const caption = cover?.caption || '公开产品配图';
  const media = cover ? coverMedia(cover.url, large) : undefined;
  const showOriginal = imageState === 'original';
  return <div className={`visual ${large ? 'visual-large' : ''} ${hasImage ? 'visual-image' : 'visual-empty'}`}>
    {hasImage ? <><img src={showOriginal ? cover?.url : media?.src} srcSet={showOriginal ? undefined : media?.srcSet} sizes={showOriginal ? undefined : media?.sizes} alt={`${item.name} · ${caption}`} onError={() => setImageState(!showOriginal && Boolean(media?.srcSet) ? 'original' : 'failed')} loading={large ? 'eager' : 'lazy'} decoding="async" fetchPriority={large ? 'high' : 'auto'} /><span className="visual-kind" title={caption} aria-hidden="true"><ImageIcon size={11} />产品配图</span></> : <div className="visual-fallback"><Compass size={19} /><span><strong>{item.name}</strong><small>{imageState === 'failed' ? '产品配图暂时无法加载' : '暂无产品截图'}</small></span></div>}
  </div>;
}
