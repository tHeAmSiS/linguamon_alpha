const CACHE='linguamon-alpha-v1';
const ASSETS=[
  './','./index.html','./style.css','./app.js','./manifest.json',
  './content/content.json','./content/version.json',
  './assets/icon.png',
  './assets/monsters/asteron_base.png','./assets/monsters/asteron_evo1.png','./assets/monsters/asteron_evo2.png',
  './assets/monsters/vocaryn_base.png','./assets/monsters/vocaryn_evo1.png','./assets/monsters/vocaryn_evo2.png',
  './assets/monsters/declara_base.png','./assets/monsters/declara_evo1.png','./assets/monsters/declara_evo2.png',
];
self.addEventListener('install', (e)=>{
  e.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e)=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k)));
    self.clients.claim();
  })());
});
self.addEventListener('fetch', (e)=>{
  const req=e.request;
  e.respondWith((async()=>{
    const cached = await caches.match(req);
    if(cached) return cached;
    try{
      const fresh = await fetch(req);
      return fresh;
    }catch(err){
      return cached || new Response('Offline', {status:503});
    }
  })());
});
