"use client";

/* eslint-disable @next/next/no-img-element -- Screenshots keep their verified source URLs. */

import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Expand, ExternalLink, ImageOff, Images, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import type { IntelItem } from "@/lib/types";
import { getItemImages } from "@/lib/media";

export function ImageGallery({ item }: { item: IntelItem }) {
  const images = getItemImages(item);
  // Reset image state when a refreshed record brings a different gallery.
  return <Gallery key={`${item.id}:${images.map(image => image.url).join("|")}`} item={item} />;
}

function Gallery({ item }: { item: IntelItem }) {
  const images = getItemImages(item);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const gallery = useRef<HTMLElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const titleId = useId();
  const image = images[index];

  function select(next: number) {
    setIndex((next + images.length) % images.length);
    setZoom(1);
  }
  function close() { dialog.current?.close(); }
  function retry() {
    setFailed(previous => ({ ...previous, [image.url]: false }));
    setRetries(previous => ({ ...previous, [image.url]: (previous[image.url] || 0) + 1 }));
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (images.length > 1) select(index + (event.key === "ArrowRight" ? 1 : -1));
    }
  }
  function startSwipe(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
    suppressClick.current = false;
    if (event.isPrimary && event.button === 0 && zoom === 1) gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function finishSwipe(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId || images.length < 2) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressClick.current = true;
      select(index + (dx < 0 ? 1 : -1));
    }
  }

  if (!image) return <div className="image-gallery-empty"><ImageOff size={20} /><span>暂未收集到可核验的产品或资讯配图</span></div>;

  function picture(lightbox = false) {
    return failed[image.url] ? <div className="image-gallery-error" role="status"><ImageOff size={28} /><strong>这张图片暂时无法加载</strong><p>可重试，或查看其他图片与原始来源。</p><button className="button secondary" onClick={retry}><RotateCcw size={14} />重新加载</button></div> : <img key={`${image.url}:${retries[image.url] || 0}`} src={image.url} alt={`${item.name} · ${image.caption}`} draggable={false} onError={() => setFailed(previous => ({ ...previous, [image.url]: true }))} style={lightbox && zoom > 1 ? { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none", height: "auto" } : undefined} />;
  }
  function navigation() {
    return images.length > 1 && <><button className="image-gallery-arrow previous" aria-label="上一张图片" onClick={() => select(index - 1)}><ChevronLeft size={23} /></button><button className="image-gallery-arrow next" aria-label="下一张图片" onClick={() => select(index + 1)}><ChevronRight size={23} /></button></>;
  }
  function caption() {
    return <div className="image-gallery-caption"><p aria-live="polite">{image.caption}</p><div><span>{index + 1} / {images.length}</span>{image.sourceUrl && <a href={image.sourceUrl} target="_blank" rel="noreferrer">图片来源 <ExternalLink size={12} /></a>}<a href={image.url} target="_blank" rel="noreferrer">查看原图 <ExternalLink size={12} /></a></div></div>;
  }

  return <section className="image-gallery" ref={gallery} tabIndex={-1} aria-label={`${item.name}图片集`} onKeyDown={keyboard} onPointerDown={event => event.stopPropagation()}>
    <div className="image-gallery-heading"><strong><Images size={16} />产品与资讯图集</strong><span>{images.length} 张 · 点击放大{images.length > 1 ? " · 左右切换" : ""}</span></div>
    <div className="image-gallery-stage" onPointerDown={startSwipe} onPointerUp={finishSwipe} onPointerCancel={() => { gesture.current = null; }}>
      {failed[image.url] ? picture() : <button className="image-gallery-open" ref={openButton} aria-label={`放大图片：${image.caption}`} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setZoom(1); dialog.current?.showModal(); }}>{picture()}<span className="image-gallery-expand"><Expand size={15} />放大查看</span></button>}
      {navigation()}
    </div>
    {caption()}
    {images.length > 1 && <div className="image-gallery-thumbnails" aria-label="选择图片">{images.map((entry, position) => <button key={entry.url} className={position === index ? "is-current" : ""} aria-label={`第 ${position + 1} 张：${entry.caption}`} aria-current={position === index ? "true" : undefined} onClick={() => select(position)}>{failed[entry.url] ? <ImageOff size={20} /> : <img src={entry.url} alt="" loading="lazy" draggable={false} onError={() => setFailed(previous => ({ ...previous, [entry.url]: true }))} />}<span>{position + 1}</span></button>)}</div>}
    <dialog ref={dialog} className="image-lightbox" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClose={event => { event.stopPropagation(); setZoom(1); (openButton.current || gallery.current)?.focus({ preventScroll: true }); }} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }} onKeyDown={keyboard}>
      <div className="image-lightbox-inner"><header className="image-lightbox-toolbar"><div><strong id={titleId}>{item.name}</strong><span>{index + 1} / {images.length}</span></div><div><button className="icon-button" aria-label="缩小图片" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><ZoomOut size={20} /></button><button className="image-gallery-zoom" aria-label="恢复适应窗口" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button className="icon-button" aria-label="放大图片" disabled={zoom >= 3 || failed[image.url]} onClick={() => setZoom(value => Math.min(3, value + .5))}><ZoomIn size={20} /></button><button className="icon-button" aria-label="关闭大图" onClick={close}><X size={23} /></button></div></header>
        <div className="image-lightbox-stage"><div className={`image-lightbox-canvas ${zoom > 1 ? "is-zoomed" : ""}`} onPointerDown={startSwipe} onPointerUp={finishSwipe} onPointerCancel={() => { gesture.current = null; }}>{picture(true)}</div>{navigation()}</div>
        {caption()}<p className="image-lightbox-help">{images.length > 1 ? "左右方向键或滑动切换 · " : ""}Esc 关闭大图{zoom > 1 ? " · 滚动查看放大区域" : ""}</p>
      </div>
    </dialog>
  </section>;
}
