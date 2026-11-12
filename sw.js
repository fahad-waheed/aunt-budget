"use strict";
// Green Budget service worker: makes the app open instantly and work offline.
// Change VERSION whenever you want every phone to drop its old cache.
const VERSION = "gb-v3";
const CORE = ["/", "/index.html", "/404.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map(async url => {
      try {
        const res = await fetch(new Request(url, {cache: "reload"}));
        if (res.ok || url === "/404.html") await cache.put(url, res);
      } catch (e) { /* offline during install: it will be cached on first use */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && url.origin === location.origin) {
    if (url.pathname === "/" || url.pathname === "/index.html") event.respondWith(appShell(event));
    else event.respondWith(otherPage(event));
    return;
  }
  if (url.origin === location.origin) { event.respondWith(staleWhileRevalidate(event)); return; }
  if (url.href === XLSX_URL) event.respondWith(cacheFirst(req));
});

// The app itself: show the saved copy instantly, refresh it in the background, tell the page if it changed.
async function appShell(event) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match("/index.html");
  const before = cached ? cached.clone() : null;
  const refresh = fetch("/index.html", {cache: "no-cache"}).then(async res => {
    if (!res || !res.ok) return null;
    if (before) {
      try {
        const texts = await Promise.all([before.text(), res.clone().text()]);
        if (texts[0] !== texts[1]) notifyUpdated();
      } catch (e) { /* ignore */ }
    }
    await cache.put("/index.html", res.clone());
    await cache.put("/", res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(refresh); return cached; }
  const res = await refresh;
  return res || new Response("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><body style='font-family:sans-serif;padding:24px'><h1>You are offline</h1><p>Open Green Budget once while you are online, and it will work offline from then on.</p>", {status: 503, headers: {"Content-Type": "text/html; charset=utf-8"}});
}

// Any other address: ask the network (so Vercel can show the real 404 page), fall back to the saved 404 page offline.
async function otherPage(event) {
  try { return await fetch(event.request); }
  catch (e) {
    const cache = await caches.open(VERSION);
    return (await cache.match("/404.html")) || (await cache.match("/index.html")) || Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(res => {
    if (res && res.ok) cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(refresh); return cached; }
  return (await refresh) || new Response("", {status: 504});
}

// The Excel library: keep one copy so Excel export also works offline.
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  } catch (e) { return Response.error(); }
}

async function notifyUpdated() {
  const clients = await self.clients.matchAll({type: "window"});
  clients.forEach(c => c.postMessage({type: "updated"}));
}
