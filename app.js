// Linguamon Alpha - single-file vanilla app
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

const VERSION_URL = 'content/version.json';
const CONTENT_URL = 'content/content.json';

// ---------- Utilities ----------
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function uid(){ return Math.random().toString(16).slice(2)+Date.now().toString(16); }
function normalizeInput(s){
  return (s ?? '')
    .toString()
    .trim()
    .replace(/\s+/g,' ')
    .replace(/[ĀÂÃÄÅ]/g,'A').replace(/[āâãäå]/g,'a')
    .replace(/[ĒÊËĖ]/g,'E').replace(/[ēêëė]/g,'e')
    .replace(/[ĪÎÏ]/g,'I').replace(/[īîï]/g,'i')
    .replace(/[ŌÔÖÕ]/g,'O').replace(/[ōôöõ]/g,'o')
    .replace(/[ŪÛÜ]/g,'U').replace(/[ūûü]/g,'u');
}
function downloadText(filename, text){
  const blob = new Blob([text], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}
async function readFileText(file){
  return await file.text();
}

// ---------- Simple IndexedDB ----------
const DB_NAME = 'linguamon_alpha';
const DB_VER = 1;
let _db;
function idb(){
  if(_db) return Promise.resolve(_db);
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if(!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(_db = req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kvGet(key){
  const db = await idb();
  return await new Promise((resolve,reject)=>{
    const tx = db.transaction('kv','readonly');
    const st = tx.objectStore('kv');
    const r = st.get(key);
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}
async function kvSet(key, val){
  const db = await idb();
  return await new Promise((resolve,reject)=>{
    const tx = db.transaction('kv','readwrite');
    const st = tx.objectStore('kv');
    const r = st.put(val, key);
    r.onsuccess=()=>resolve(true);
    r.onerror=()=>reject(r.error);
  });
}
async function blobSet(key, blob){
  const db = await idb();
  return await new Promise((resolve,reject)=>{
    const tx = db.transaction('blobs','readwrite');
    const st = tx.objectStore('blobs');
    const r = st.put(blob, key);
    r.onsuccess=()=>resolve(true);
    r.onerror=()=>reject(r.error);
  });
}
async function blobGet(key){
  const db = await idb();
  return await new Promise((resolve,reject)=>{
    const tx = db.transaction('blobs','readonly');
    const st = tx.objectStore('blobs');
    const r = st.get(key);
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}

// ---------- Game Data ----------
let CONTENT = null;
let PROFILE = null;
const DEFAULT_PROFILE = {
  createdAt: new Date().toISOString(),
  deviceId: uid(),
  xp: 0,
  level: 1,
  starterLine: null, // 'Asteron' | 'Vocaryn' | 'Declara'
  unlockedMonsters: {}, // monsterId -> {color:0..4, unlockedColors:[bool]}
  progress: {}, // packId -> {runs:0, lastMode:'', bossDefeated:false}
};

function xpToNext(level){
  if(level <= 10) return 180 + 60*(level-1);
  return 720 + 90*(level-10);
}
function applyXp(delta){
  PROFILE.xp += delta;
  while(PROFILE.xp >= xpToNext(PROFILE.level)){
    PROFILE.xp -= xpToNext(PROFILE.level);
    PROFILE.level += 1;
  }
}

const COLOR_FILTERS = [
  '', // default
  'hue-rotate(35deg) saturate(1.1)',
  'hue-rotate(85deg) saturate(1.15)',
  'hue-rotate(140deg) saturate(1.05)',
  'hue-rotate(220deg) saturate(1.2)'
];

function getMonsterSprite(mon){
  return mon.sprite;
}
async function getMonsterSpriteUrl(monId, defaultUrl){
  // allow override via blobs (admin zip upload)
  const blob = await blobGet('monster:'+monId);
  if(blob){
    return URL.createObjectURL(blob);
  }
  return defaultUrl;
}

// ---------- Loading ----------
async function loadContent(){
  const res = await fetch(CONTENT_URL, {cache:'no-store'});
  if(!res.ok) throw new Error('Konnte content.json nicht laden');
  CONTENT = await res.json();
}
async function loadProfile(){
  const p = await kvGet('profile');
  if(p){
    PROFILE = p;
    return;
  }
  PROFILE = structuredClone(DEFAULT_PROFILE);
  await kvSet('profile', PROFILE);
}
async function saveProfile(){
  await kvSet('profile', PROFILE);
}

// ---------- Router / Views ----------
const appEl = $('#app');
window.addEventListener('hashchange', render);

function route(){
  return location.hash.replace(/^#\/?/, '');
}
function nav(to){
  location.hash = '#/' + to;
}

function cardPack(pack){
  const prog = PROFILE.progress[pack.id] || {runs:0,bossDefeated:false};
  return `
  <div class="card">
    <div class="row" style="justify-content:space-between; align-items:flex-start;">
      <div>
        <h3>${pack.title}</h3>
        <p>${pack.subtitle ?? ''}</p>
      </div>
      <div class="badge">${prog.bossDefeated ? 'Boss ✅' : 'Boss ⏳'}</div>
    </div>
    <div class="sep"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn ghost" data-go="pack:${pack.id}:analyse">Formen analysieren</button>
      <button class="btn ghost" data-go="pack:${pack.id}:build">Formen bilden</button>
      <button class="btn ghost" data-go="pack:${pack.id}:vocab">Vokabeln</button>
      <button class="btn" data-go="pack:${pack.id}:mix">Mix</button>
    </div>
    <div class="row" style="margin-top:10px; justify-content:space-between;">
      <span class="small muted">Runs: ${prog.runs}</span>
      <button class="btn ghost" data-go="boss:${pack.id}">Solo-Boss</button>
    </div>
  </div>`;
}

async function renderHome(){
  const packs = CONTENT.packs.filter(p=>p.phase==='lehrbuch').sort((a,b)=>a.order-b.order);
  const lvl = PROFILE.level;
  const next = xpToNext(lvl);
  const percent = Math.round((PROFILE.xp/next)*100);
  appEl.innerHTML = `
    <div class="grid cards">
      <div class="card">
        <h3>Profil</h3>
        <div class="row" style="justify-content:space-between; align-items:flex-end;">
          <div>
            <div class="badge">Level</div>
            <div class="kpi">${lvl}</div>
          </div>
          <div style="min-width:220px">
            <div class="row" style="justify-content:space-between;">
              <span class="small muted">XP</span>
              <span class="small muted">${PROFILE.xp} / ${next}</span>
            </div>
            <div class="progress"><div style="width:${percent}%"></div></div>
          </div>
        </div>
        <div class="sep"></div>
        <div class="row" style="flex-wrap:wrap;">
          <button class="btn ghost" data-go="album">Sammelalbum</button>
          <button class="btn ghost" data-go="classboss">Klassenboss</button>
        </div>
        <p class="hint small" style="margin-top:10px">Tipp: Export/Import nutzt du, um deinen „Account“ zwischen Schule und Zuhause mitzunehmen.</p>
      </div>
      ${packs.map(cardPack).join('')}
    </div>
  `;

  // starter selection on first run
  if(!PROFILE.starterLine){
    const starters = ['Asteron','Vocaryn','Declara'];
    const starterMon = CONTENT.monsters.filter(m=>m.stage===1);
    const cards = await Promise.all(starters.map(async line=>{
      const mon = starterMon.find(m=>m.line===line);
      const url = await getMonsterSpriteUrl(mon.id, mon.sprite);
      return `
        <div class="monCard">
          <img src="${url}" style="filter:${COLOR_FILTERS[0]}" alt="">
          <div class="row" style="justify-content:space-between; margin-top:8px">
            <div>
              <div style="font-weight:800">${line}</div>
              <div class="small muted">${mon.lore}</div>
            </div>
          </div>
          <button class="btn" style="margin-top:10px; width:100%" data-starter="${line}">Wählen</button>
        </div>`;
    }));
    appEl.insertAdjacentHTML('afterbegin', `
      <div class="card" style="margin-bottom:14px">
        <h3>Wähle dein Starter-Linguamon</h3>
        <p class="muted">Du kannst später alle Linien freischalten – aber starte mit einem Begleiter.</p>
        <div class="sep"></div>
        <div class="monGrid">${cards.join('')}</div>
      </div>
    `);
    $$('[data-starter]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        PROFILE.starterLine = btn.getAttribute('data-starter');
        // unlock first stage of that line
        for(const mon of CONTENT.monsters.filter(m=>m.line===PROFILE.starterLine && m.stage===1)){
          PROFILE.unlockedMonsters[mon.id] = {color:0, unlockedColors:[true,false,false,false,false]};
        }
        await saveProfile();
        render();
      });
    });
  }
}

function pickTasksForSession(packId, mode){
  const allTasks = CONTENT.tasks.filter(t=>t.pack_id===packId);
  const vocab = CONTENT.vocab[packId] ?? [];
  // session length (alpha): 10 questions
  const N = 10;
  let pool = [];
  if(mode==='analyse'){
    pool = allTasks.filter(t=>t.type==='typing' || (t.type==='single_choice' && t.tags?.includes('Analyse')));
    if(pool.length < 6) pool = allTasks;
  } else if(mode==='build'){
    pool = allTasks.filter(t=>t.type==='build_form' || t.type==='drag_drop');
    if(pool.length < 6) pool = allTasks;
  } else if(mode==='vocab'){
    // generate vocab typing tasks on the fly
    const gen = vocab.map((v,i)=>({
      id:`voc_${packId}_${i}_${uid()}`,
      pack_id: packId,
      type:'typing',
      prompt:`Übersetze ins Deutsche: <b>${v.la}</b>`,
      answer: v.de.split(/[,;\/]/).map(x=>normalizeInput(x)),
      difficulty:'leicht',
      tags:['Vokabeln'],
      is_heavy:false,
      _vocab:true
    }));
    pool = gen;
  } else { // mix
    pool = [...allTasks];
    // add a few vocab tasks
    const gen = (vocab.slice(0, Math.min(6, vocab.length))).map((v,i)=>({
      id:`voc_${packId}_${i}_${uid()}`,
      pack_id: packId,
      type:'typing',
      prompt:`Übersetze ins Deutsche: <b>${v.la}</b>`,
      answer: v.de.split(/[,;\/]/).map(x=>normalizeInput(x)),
      difficulty:'leicht',
      tags:['Vokabeln'],
      is_heavy:false,
      _vocab:true
    }));
    pool.push(...gen);
  }
  // shuffle
  pool = pool.sort(()=>Math.random()-0.5);
  return pool.slice(0, Math.min(N, pool.length));
}

async function renderSession(packId, mode){
  const pack = CONTENT.packs.find(p=>p.id===packId);
  const tasks = pickTasksForSession(packId, mode);
  let idx = 0;
  let correct = 0;
  let streak = 0;
  let usedHelp = 0;

  function baseXpFor(task){
    const m = task.type;
    if(m==='single_choice') return 10;
    if(m==='multi_choice') return 14;
    if(m==='drag_drop') return 16;
    if(m==='typing') return 18;
    if(m==='build_form') return 24;
    return 10;
  }
  function applyHelpMultiplier(xp){
    if(usedHelp===0) return xp;
    if(usedHelp===1) return Math.round(xp*0.7);
    return Math.round(xp*0.5);
  }

  function view(){
    const t = tasks[idx];
    const prog = Math.round(((idx)/tasks.length)*100);
    appEl.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div>
            <div class="badge">${pack.title} · ${modeLabel(mode)}</div>
            <div class="small muted">Aufgabe ${idx+1} / ${tasks.length}</div>
          </div>
          <div class="badge">✅ ${correct} · 🔥 ${streak}</div>
        </div>
        <div class="sep"></div>
        <div class="progress"><div style="width:${prog}%"></div></div>
        <div class="sep"></div>
        <div class="quizPrompt">${t.prompt}</div>
        <div id="taskArea"></div>
        <div class="sep"></div>
        <div class="row" style="flex-wrap:wrap; justify-content:space-between;">
          <div class="row" style="flex-wrap:wrap;">
            <button class="btn ghost" id="btnHint">Hinweis</button>
            <span class="small muted">Hinweis kostet XP</span>
          </div>
          <div class="row">
            <button class="btn ghost" id="btnQuit">Beenden</button>
          </div>
        </div>
        <p id="hintBox" class="hint small" style="display:none; margin-top:10px"></p>
      </div>
    `;
    $('#btnQuit').onclick = ()=>nav('');
    $('#btnHint').onclick = ()=>{
      usedHelp = clamp(usedHelp+1,0,2);
      const hb = $('#hintBox');
      hb.style.display = 'block';
      hb.innerHTML = hintFor(t);
    };
    renderTask(t);
  }

  function hintFor(t){
    if(t.type==='build_form') return 'Tipp: Schreibe die <b>vollständige Form</b>. Achte auf Stamm + Endung.';
    if(t.type==='typing') return 'Tipp: Nutze das Format <b>Kasus Numerus Genus</b> (z.B. „Akk Sg f“), oder übersetze das Wort.';
    if(t.type==='drag_drop') return 'Tipp: Denke an typische Endungen (-us/-um, -a/-am, -t/-nt, -re).';
    return 'Tipp: Lies die Optionen sorgfältig – oft verrät eine Endung die richtige Lösung.';
  }

  function modeLabel(m){
    return m==='analyse'?'Formen analysieren':m==='build'?'Formen bilden':m==='vocab'?'Vokabeln': 'Mix';
  }

  function renderTask(t){
    const area = $('#taskArea');
    if(t.type==='single_choice'){
      area.innerHTML = `<div class="options">${t.options.map((o,i)=>`<div class="option" data-i="${i}">${o}</div>`).join('')}</div>`;
      $$('.option', area).forEach(opt=>{
        opt.addEventListener('click', async ()=>{
          const i = Number(opt.getAttribute('data-i'));
          const isCorrect = t.correct_indices.includes(i);
          await grade(isCorrect, t, {el:opt});
        });
      });
    } else if(t.type==='typing' || t.type==='build_form'){
      area.innerHTML = `
        <div class="stack">
          <input class="text" id="ans" placeholder="Antwort eingeben …"/>
          <div class="row end">
            <button class="btn" id="btnOk">OK</button>
          </div>
          <div class="small muted">Groß-/Kleinschreibung egal. Keine Makrons nötig.</div>
        </div>
      `;
      $('#btnOk').onclick = async ()=>{
        const raw = $('#ans').value;
        const got = normalizeInput(raw).toLowerCase();
        let ok = false;
        if(t.type==='typing'){
          const answers = (t.answer || []).map(a=>normalizeInput(a).toLowerCase());
          ok = answers.includes(got) || answers.some(a=>got===a);
        } else {
          ok = normalizeInput(t.answer_full).toLowerCase() === got;
        }
        await grade(ok, t);
      };
      $('#ans').addEventListener('keydown', (e)=>{
        if(e.key==='Enter'){ e.preventDefault(); $('#btnOk').click(); }
      });
    } else if(t.type==='drag_drop'){
      // simple select-based drag for alpha
      area.innerHTML = `
        <div class="stack">
          ${t.targets.map(trg=>{
            const opts = t.items.map(it=>`<option value="${it}">${it}</option>`).join('');
            return `<label class="small muted">${trg}<br><select class="text" data-target="${trg}">
              <option value="">– wählen –</option>${opts}
            </select></label>`;
          }).join('')}
          <div class="row end"><button class="btn" id="btnCheck">Prüfen</button></div>
        </div>
      `;
      $('#btnCheck').onclick = async ()=>{
        const sels = $$('select[data-target]', area);
        let ok = true;
        for(const sel of sels){
          const trg = sel.getAttribute('data-target');
          const chosen = sel.value;
          if(!chosen || t.mapping[chosen] !== trg) ok = false;
        }
        await grade(ok, t);
      };
    } else {
      area.innerHTML = `<p class="muted">Aufgabentyp (Alpha) noch nicht implementiert.</p>`;
    }
  }

  async function grade(ok, t, ctx={}){
    // visual feedback if option
    if(ctx.el){
      ctx.el.classList.add(ok?'correct':'wrong');
      // mark correct
      $$('.option', $('#taskArea')).forEach(o=>{
        const i=Number(o.getAttribute('data-i'));
        if(t.correct_indices.includes(i)) o.classList.add('correct');
      });
    }
    let xp = baseXpFor(t);
    // streak bonus
    if(ok){
      streak += 1;
      if(streak >= 3) xp += clamp((streak-2)*2, 0, 10);
    } else {
      streak = 0;
    }
    xp = applyHelpMultiplier(xp);
    if(ok){
      correct += 1;
      applyXp(xp);
    } else {
      // small consolation: 0 xp
    }
    await saveProfile();
    // next
    setTimeout(async ()=>{
      idx += 1;
      usedHelp = 0;
      if(idx >= tasks.length){
        // update progress
        const prog = PROFILE.progress[packId] || {runs:0,bossDefeated:false};
        prog.runs += 1;
        prog.lastMode = mode;
        PROFILE.progress[packId] = prog;
        await saveProfile();
        renderSummary(packId, mode, correct, tasks.length);
      } else {
        view();
      }
    }, ctx.el ? 450 : 0);
  }

  view();
}

async function renderSummary(packId, mode, correct, total){
  const pack = CONTENT.packs.find(p=>p.id===packId);
  const pct = Math.round((correct/total)*100);
  appEl.innerHTML = `
    <div class="card">
      <h3>Runde abgeschlossen</h3>
      <p class="muted">${pack.title} · ${mode}</p>
      <div class="sep"></div>
      <div class="row" style="justify-content:space-between; align-items:flex-end;">
        <div>
          <div class="badge">Trefferquote</div>
          <div class="kpi">${pct}%</div>
          <div class="small muted">${correct} / ${total} richtig</div>
        </div>
        <div>
          <div class="badge">Level</div>
          <div class="kpi">${PROFILE.level}</div>
        </div>
      </div>
      <div class="sep"></div>
      <div class="row end" style="flex-wrap:wrap;">
        <button class="btn ghost" data-go="">Zur Übersicht</button>
        <button class="btn" data-go="boss:${packId}">Solo-Boss starten</button>
      </div>
    </div>
  `;
  $$('[data-go]').forEach(b=>b.onclick=()=>nav(b.getAttribute('data-go')));
}

function bossConfigForPack(packId){
  if(packId==='salve') return {hp:40};
  if(packId==='l1') return {hp:50};
  return {hp:60};
}

function pickBossTaskPool(packId){
  // solo boss: only current lesson pack, plus a couple vocab items
  const base = CONTENT.tasks.filter(t=>t.pack_id===packId);
  const voc = (CONTENT.vocab[packId] ?? []).map((v,i)=>({
    id:`bossvoc_${packId}_${i}_${uid()}`,
    pack_id:packId,
    type:'typing',
    prompt:`Übersetze ins Deutsche: <b>${v.la}</b>`,
    answer: v.de.split(/[,;\/]/).map(x=>normalizeInput(x)),
    difficulty:'leicht',
    tags:['Vokabeln'],
    is_heavy:false,
    _vocab:true
  }));
  return [...base, ...voc];
}

async function renderBossSolo(packId){
  const pack = CONTENT.packs.find(p=>p.id===packId);
  const cfg = bossConfigForPack(packId);
  const TIME_LIMIT = 10*60; // seconds
  const HEAVY_RATE = 0.10;
  const CRIT_DAMAGE = 2;
  const HEAL_PER_WRONG = 1;
  const HEAL_CAP = 20;
  const QUOTE = 3;

  let timeLeft = TIME_LIMIT;
  let bossHp = cfg.hp;
  let bossMax = cfg.hp;
  let warmHits = 0; // correct before damage counts
  let healsUsed = 0;

  const pool = pickBossTaskPool(packId);

  function isHeavy(task){
    return !!task.is_heavy || task.type==='build_form' || task.difficulty==='schwer';
  }
  function drawTask(){
    // choose heavy 10%: try to pick from heavy tasks
    const wantHeavy = Math.random() < HEAVY_RATE;
    const heavyPool = pool.filter(isHeavy);
    const lightPool = pool.filter(t=>!isHeavy(t));
    let t;
    if(wantHeavy && heavyPool.length) t = heavyPool[randInt(0, heavyPool.length-1)];
    else t = pool[randInt(0, pool.length-1)] || lightPool[0] || heavyPool[0];
    t = structuredClone(t);
    t._bossHeavy = wantHeavy && isHeavy(t);
    return t;
  }

  let current = drawTask();
  let correct = 0;
  let wrong = 0;

  function render(){
    const pct = Math.round((bossHp/bossMax)*100);
    appEl.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="badge">Solo-Boss · ${pack.title}</div>
            <div class="small muted">Mischmodus · alle Aufgabentypen</div>
          </div>
          <div class="badge">${fmtTime(timeLeft)}</div>
        </div>
        <div class="sep"></div>
        <div class="row" style="justify-content:space-between;">
          <div>
            <div class="badge">Boss-HP</div>
            <div class="kpi">${bossHp}</div>
            <div class="small muted">Heals: ${healsUsed}/${HEAL_CAP}</div>
          </div>
          <div style="min-width:260px">
            <div class="small muted">Fortschritt</div>
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div class="small muted" style="margin-top:6px">Quote: ${Math.min(correct,QUOTE)}/${QUOTE} · Treffer: ✅ ${correct} · ❌ ${wrong}</div>
          </div>
        </div>
        <div class="sep"></div>
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div class="quizPrompt" style="margin:0">${current.prompt}</div>
          ${current._bossHeavy ? `<span class="badge" style="color:var(--warn)">Heavy · Crit möglich</span>` : `<span class="badge">Normal</span>`}
        </div>
        <div class="sep"></div>
        <div id="bossTask"></div>
        <div class="sep"></div>
        <div class="row end">
          <button class="btn ghost" id="btnQuit">Abbrechen</button>
        </div>
        <p class="hint small">Regeln: erst ab ${QUOTE} richtigen Antworten zählt Schaden. Falsch = Boss heilt +1 (bis Cap). Heavy richtig = Crit (2 Schaden).</p>
      </div>
    `;
    $('#btnQuit').onclick = ()=>nav('');
    renderBossTask(current);
  }

  function renderBossTask(t){
    const area = $('#bossTask');
    // reuse minimal renderer from session
    if(t.type==='single_choice'){
      area.innerHTML = `<div class="options">${t.options.map((o,i)=>`<div class="option" data-i="${i}">${o}</div>`).join('')}</div>`;
      $$('.option', area).forEach(opt=>{
        opt.addEventListener('click', async ()=>{
          const i = Number(opt.getAttribute('data-i'));
          const ok = t.correct_indices.includes(i);
          await grade(ok, t, {el:opt});
        });
      });
    } else if(t.type==='typing' || t.type==='build_form'){
      area.innerHTML = `
        <div class="stack">
          <input class="text" id="ans" placeholder="Antwort eingeben …"/>
          <div class="row end">
            <button class="btn" id="btnOk">OK</button>
          </div>
        </div>
      `;
      $('#btnOk').onclick = async ()=>{
        const got = normalizeInput($('#ans').value).toLowerCase();
        let ok=false;
        if(t.type==='typing'){
          const answers = (t.answer||[]).map(a=>normalizeInput(a).toLowerCase());
          ok = answers.includes(got);
        } else {
          ok = normalizeInput(t.answer_full).toLowerCase() === got;
        }
        await grade(ok, t);
      };
      $('#ans').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnOk').click(); }});
    } else if(t.type==='drag_drop'){
      area.innerHTML = `
        <div class="stack">
          ${t.targets.map(trg=>{
            const opts = t.items.map(it=>`<option value="${it}">${it}</option>`).join('');
            return `<label class="small muted">${trg}<br><select class="text" data-target="${trg}">
              <option value="">– wählen –</option>${opts}
            </select></label>`;
          }).join('')}
          <div class="row end"><button class="btn" id="btnCheck">Prüfen</button></div>
        </div>
      `;
      $('#btnCheck').onclick = async ()=>{
        const sels = $$('select[data-target]', area);
        let ok=true;
        for(const sel of sels){
          const trg=sel.getAttribute('data-target');
          const chosen=sel.value;
          if(!chosen || t.mapping[chosen]!==trg) ok=false;
        }
        await grade(ok,t);
      };
    } else {
      area.innerHTML = `<p class="muted">Aufgabentyp (Alpha) noch nicht implementiert.</p>`;
    }
  }

  async function grade(ok, t, ctx={}){
    if(ctx.el){
      ctx.el.classList.add(ok?'correct':'wrong');
      $$('.option', $('#bossTask')).forEach(o=>{
        const i=Number(o.getAttribute('data-i'));
        if(t.correct_indices.includes(i)) o.classList.add('correct');
      });
    }
    if(ok){
      correct += 1;
      // quote gate
      if(correct <= QUOTE){
        warmHits += 1;
      } else {
        const dmg = t._bossHeavy ? CRIT_DAMAGE : 1;
        bossHp = Math.max(0, bossHp - dmg);
      }
    } else {
      wrong += 1;
      if(healsUsed < HEAL_CAP){
        bossHp = Math.min(bossMax, bossHp + HEAL_PER_WRONG);
        healsUsed += 1;
      }
    }
    // win/lose checks
    if(bossHp <= 0){
      await bossWin(packId);
      return;
    }
    current = drawTask();
    render();
  }

  async function bossWin(packId){
    // mark boss defeated
    const prog = PROFILE.progress[packId] || {runs:0,bossDefeated:false};
    prog.bossDefeated = true;
    PROFILE.progress[packId] = prog;

    // reward: unlock one color (starter line only, alpha)
    const starterIds = CONTENT.monsters.filter(m=>m.line===PROFILE.starterLine).map(m=>m.id);
    const owned = starterIds.filter(id=>PROFILE.unlockedMonsters[id]);
    // ensure stages unlock progressively
    for(const mon of CONTENT.monsters.filter(m=>m.line===PROFILE.starterLine).sort((a,b)=>a.stage-b.stage)){
      if(!PROFILE.unlockedMonsters[mon.id]){
        PROFILE.unlockedMonsters[mon.id] = {color:0, unlockedColors:[true,false,false,false,false]};
        break;
      }
    }
    // unlock a new color on a random owned monster
    const pick = owned.length ? owned[randInt(0, owned.length-1)] : starterIds[0];
    if(pick){
      const entry = PROFILE.unlockedMonsters[pick] || {color:0, unlockedColors:[true,false,false,false,false]};
      // unlock next locked
      const idx = entry.unlockedColors.findIndex(x=>x===false);
      if(idx!==-1) entry.unlockedColors[idx]=true;
      PROFILE.unlockedMonsters[pick]=entry;
    }
    applyXp(120); // boss bonus
    await saveProfile();

    appEl.innerHTML = `
      <div class="card">
        <h3>Boss besiegt! 🎉</h3>
        <p class="muted">Du hast den Solo-Boss von <b>${pack.title}</b> besiegt.</p>
        <div class="sep"></div>
        <div class="row" style="justify-content:space-between;">
          <div class="badge">Bonus</div>
          <div class="badge">+120 XP</div>
        </div>
        <p class="hint small" style="margin-top:10px">Belohnung: neue Linguamon-Stufe oder neue Farbvariante im Album.</p>
        <div class="sep"></div>
        <div class="row end">
          <button class="btn ghost" data-go="album">Zum Album</button>
          <button class="btn" data-go="">Zur Übersicht</button>
        </div>
      </div>
    `;
    $$('[data-go]').forEach(b=>b.onclick=()=>nav(b.getAttribute('data-go')));
  }

  // timer loop
  const timer = setInterval(async ()=>{
    timeLeft -= 1;
    if(timeLeft <= 0){
      clearInterval(timer);
      appEl.innerHTML = `
        <div class="card">
          <h3>Zeit abgelaufen</h3>
          <p class="muted">Der Boss hat durchgehalten. Nächstes Mal klappt’s!</p>
          <div class="sep"></div>
          <div class="row end">
            <button class="btn ghost" data-go="boss:${packId}">Nochmal</button>
            <button class="btn" data-go="">Zur Übersicht</button>
          </div>
        </div>
      `;
      $$('[data-go]').forEach(b=>b.onclick=()=>nav(b.getAttribute('data-go')));
    } else {
      // re-render only badge/time (cheap: full render)
      render();
    }
  }, 1000);

  render();
}

function fmtTime(s){
  const m = Math.floor(s/60);
  const r = s%60;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

async function renderAlbum(){
  // ensure at least starter base exists (if profile migrated)
  if(PROFILE.starterLine && Object.keys(PROFILE.unlockedMonsters).length===0){
    const base = CONTENT.monsters.find(m=>m.line===PROFILE.starterLine && m.stage===1);
    PROFILE.unlockedMonsters[base.id] = {color:0, unlockedColors:[true,false,false,false,false]};
    await saveProfile();
  }
  const cards = await Promise.all(CONTENT.monsters.map(async mon=>{
    const owned = PROFILE.unlockedMonsters[mon.id];
    const url = await getMonsterSpriteUrl(mon.id, mon.sprite);
    const filter = owned ? COLOR_FILTERS[owned.color||0] : 'grayscale(1) brightness(.5)';
    return `
      <div class="monCard">
        <img src="${url}" style="filter:${filter}" alt="">
        <div style="margin-top:8px; font-weight:900">${owned?mon.name:'????'}</div>
        <div class="small muted">${owned?mon.lore:'Noch nicht entdeckt.'}</div>
        ${owned ? renderColorPicker(mon.id, owned) : `<div class="small muted" style="margin-top:6px">Freischalten über Bosse & Quests (Alpha).</div>`}
      </div>
    `;
  }));
  appEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>
          <h3>Sammelalbum</h3>
          <p class="muted">Linguamon-Spezies · Farben (5 Varianten pro Modell)</p>
        </div>
        <button class="btn ghost" data-go="">Zur Übersicht</button>
      </div>
      <div class="sep"></div>
      <div class="monGrid">${cards.join('')}</div>
    </div>
  `;
  $('[data-go]').onclick = ()=>nav('');
  // bind color pickers
  $$('button[data-color]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const monId = btn.getAttribute('data-mon');
      const color = Number(btn.getAttribute('data-color'));
      const entry = PROFILE.unlockedMonsters[monId];
      if(entry && entry.unlockedColors[color]){
        entry.color = color;
        PROFILE.unlockedMonsters[monId]=entry;
        await saveProfile();
        render();
      }
    });
  });
}
function renderColorPicker(monId, entry){
  const pills = entry.unlockedColors.map((ok,i)=>{
    const active = entry.color===i;
    const style = ok ? `filter:${COLOR_FILTERS[i]}` : 'opacity:.35';
    return `<button class="btn ghost" style="padding:6px 8px" data-color="${i}" data-mon="${monId}" ${ok?'':'disabled'}>
      <span class="badge" style="${style}">${active?'●':'○'}</span>
    </button>`;
  }).join('');
  return `<div class="row" style="margin-top:10px; flex-wrap:wrap">${pills}</div>`;
}

// ---------- Class Boss (Alpha token mode) ----------
async function renderClassBoss(){
  appEl.innerHTML = `
    <div class="grid cards">
      <div class="card">
        <h3>Klassenboss (Alpha)</h3>
        <p class="muted">Token-Modus (6-stellig). Kein Live-Sync – ideal für Unterricht ohne Infrastruktur.</p>
        <div class="sep"></div>
        <div class="row" style="flex-wrap:wrap;">
          <button class="btn" data-go="classboss-host">Beamer-Host</button>
          <button class="btn ghost" data-go="classboss-join">Schüler: beitreten</button>
          <button class="btn ghost" data-go="">Zur Übersicht</button>
        </div>
        <p class="hint small" style="margin-top:10px">Ablauf: Host startet Session → Schüler lösen Aufgaben bis Quote (3 richtig) → erhalten 6-stelligen Token → Host tippt Token ein → Boss nimmt Schaden.</p>
      </div>
    </div>
  `;
  $$('[data-go]').forEach(b=>b.onclick=()=>nav(b.getAttribute('data-go')));
}

function makeSessionCode(){
  const chars='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({length:6},()=>chars[randInt(0,chars.length-1)]).join('');
}

async function renderClassBossHost(){
  const TIME = 10*60;
  let timeLeft = TIME;
  let bossHp = 35;
  let bossMax = 35;
  let used = new Set();
  let tokensIn = 0;

  const sessionCode = makeSessionCode();

  function render(){
    const pct = Math.round((bossHp/bossMax)*100);
    appEl.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="badge">Beamer-Host</div>
            <h3 style="margin:6px 0 0 0">Session-Code: <span class="inline">${sessionCode}</span></h3>
            <p class="muted">Schüler geben diesen Code ein.</p>
          </div>
          <div class="badge">${fmtTime(timeLeft)}</div>
        </div>
        <div class="sep"></div>
        <div class="row" style="justify-content:space-between;">
          <div>
            <div class="badge">Boss-HP</div>
            <div class="kpi">${bossHp}</div>
            <div class="small muted">Tokens: ${tokensIn}</div>
          </div>
          <div style="min-width:260px">
            <div class="small muted">Fortschritt</div>
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div class="small muted" style="margin-top:6px">Ein Token zählt 1 Schaden (Crit-Token 2).</div>
          </div>
        </div>
        <div class="sep"></div>
        <div class="row" style="flex-wrap:wrap; align-items:flex-end;">
          <div style="flex:1; min-width:260px">
            <label class="small muted">Token eingeben (6 Ziffern)</label>
            <input class="text" id="token" inputmode="numeric" placeholder="123456">
          </div>
          <button class="btn" id="btnSubmit">Einlösen</button>
          <button class="btn ghost" id="btnReset">Tokens löschen</button>
          <button class="btn ghost" data-go="classboss">Zurück</button>
        </div>
        <p id="msg" class="hint small" style="margin-top:10px"></p>
      </div>
    `;
    $('[data-go]').onclick=()=>nav('classboss');
    $('#btnReset').onclick=()=>{
      used = new Set(); tokensIn = 0;
      $('#msg').textContent = 'Alle Tokens wurden gelöscht.';
    };
    $('#btnSubmit').onclick=()=>{
      const v = ($('#token').value || '').trim();
      const msg = $('#msg');
      msg.textContent = '';
      if(!/^\d{6}$/.test(v)){
        msg.textContent = 'Ungültig: Token muss 6 Ziffern haben.';
        return;
      }
      if(used.has(v)){
        msg.textContent = 'Dieser Token wurde bereits verwendet.';
        return;
      }
      used.add(v);
      tokensIn += 1;
      // Crit token: if first digit is 9 => 2 damage (simple convention shown to students)
      const dmg = v.startsWith('9') ? 2 : 1;
      bossHp = Math.max(0, bossHp - dmg);
      msg.textContent = dmg===2 ? 'Crit-Token! Boss nimmt 2 Schaden.' : 'Token gültig. Boss nimmt 1 Schaden.';
      $('#token').value='';
      if(bossHp===0){
        msg.textContent = 'Boss besiegt! 🎉';
      }
      render();
    };
    $('#token').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnSubmit').click(); }});
  }

  const timer = setInterval(()=>{
    timeLeft -= 1;
    if(timeLeft<=0){
      clearInterval(timer);
      appEl.innerHTML = `
        <div class="card">
          <h3>Session beendet</h3>
          <p class="muted">Zeit ist abgelaufen.</p>
          <div class="sep"></div>
          <div class="row end">
            <button class="btn ghost" data-go="classboss-host">Nochmal</button>
            <button class="btn" data-go="classboss">Zurück</button>
          </div>
        </div>
      `;
      $$('[data-go]').forEach(b=>b.onclick=()=>nav(b.getAttribute('data-go')));
    } else {
      render();
    }
  }, 1000);

  render();
  // store for join page (alpha convenience)
  await kvSet('lastClassBossSessionCode', sessionCode);
}

async function renderClassBossJoin(){
  const last = await kvGet('lastClassBossSessionCode');
  appEl.innerHTML = `
    <div class="card">
      <h3>Klassenboss beitreten</h3>
      <p class="muted">Gib den Session-Code vom Beamer ein. Danach löst du Aufgaben im Mischmodus. Sobald du 3 richtige hast, bekommst du einen 6-stelligen Token.</p>
      <div class="sep"></div>
      <label class="small muted">Session-Code</label>
      <input class="text" id="code" placeholder="z.B. ${last||'AB12CD'}" value="${last||''}">
      <div class="row end" style="margin-top:12px">
        <button class="btn ghost" data-go="classboss">Abbrechen</button>
        <button class="btn" id="btnJoin">Start</button>
      </div>
      <p class="hint small" style="margin-top:10px">Hinweis: Der Code dient in der Alpha nur zur Zuordnung – nicht zur technischen Verifikation.</p>
    </div>
  `;
  $('[data-go]').onclick=()=>nav('classboss');
  $('#btnJoin').onclick=()=>{
    const code = ($('#code').value||'').trim().toUpperCase();
    if(!code){ alert('Bitte Session-Code eingeben.'); return; }
    nav('classboss-play:'+code);
  };
}

async function renderClassBossPlay(sessionCode){
  // Mix from Salve–L2 (alpha default)
  const pool = [...pickTasksForSession('salve','mix'), ...pickTasksForSession('l1','mix'), ...pickTasksForSession('l2','mix')];
  // just reuse a quick loop until quota reached
  let correct = 0;
  let current = pool[randInt(0,pool.length-1)];
  const QUOTE = 3;

  function tokenFor(isCrit){
    // 6 digits; crit tokens start with 9
    const rest = randInt(0,99999).toString().padStart(5,'0');
    return (isCrit ? '9' : randInt(1,8).toString()) + rest;
  }

  function render(){
    appEl.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div>
            <div class="badge">Klassenboss · Schüler</div>
            <div class="small muted">Session: <span class="inline">${sessionCode}</span></div>
          </div>
          <div class="badge">Quote: ${Math.min(correct,QUOTE)}/${QUOTE}</div>
        </div>
        <div class="sep"></div>
        <div class="quizPrompt">${current.prompt}</div>
        <div id="area"></div>
        <div class="sep"></div>
        <div class="row end">
          <button class="btn ghost" data-go="classboss">Beenden</button>
        </div>
        <p class="hint small">Wenn du ${QUOTE} richtige Antworten hast, bekommst du deinen Token.</p>
      </div>
    `;
    $('[data-go]').onclick=()=>nav('classboss');
    renderTask(current);
  }

  function renderTask(t){
    const area = $('#area');
    if(t.type==='single_choice'){
      area.innerHTML = `<div class="options">${t.options.map((o,i)=>`<div class="option" data-i="${i}">${o}</div>`).join('')}</div>`;
      $$('.option', area).forEach(opt=>{
        opt.addEventListener('click', async ()=>{
          const i = Number(opt.getAttribute('data-i'));
          const ok = t.correct_indices.includes(i);
          await grade(ok, t, {el:opt});
        });
      });
    } else if(t.type==='typing' || t.type==='build_form'){
      area.innerHTML = `
        <div class="stack">
          <input class="text" id="ans" placeholder="Antwort eingeben …"/>
          <div class="row end"><button class="btn" id="btnOk">OK</button></div>
        </div>
      `;
      $('#btnOk').onclick = async ()=>{
        const got = normalizeInput($('#ans').value).toLowerCase();
        let ok=false;
        if(t.type==='typing'){
          const answers = (t.answer||[]).map(a=>normalizeInput(a).toLowerCase());
          ok = answers.includes(got);
        } else {
          ok = normalizeInput(t.answer_full).toLowerCase() === got;
        }
        await grade(ok, t);
      };
      $('#ans').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnOk').click(); }});
    } else if(t.type==='drag_drop'){
      area.innerHTML = `
        <div class="stack">
          ${t.targets.map(trg=>{
            const opts = t.items.map(it=>`<option value="${it}">${it}</option>`).join('');
            return `<label class="small muted">${trg}<br><select class="text" data-target="${trg}">
              <option value="">– wählen –</option>${opts}
            </select></label>`;
          }).join('')}
          <div class="row end"><button class="btn" id="btnCheck">Prüfen</button></div>
        </div>
      `;
      $('#btnCheck').onclick = async ()=>{
        const sels = $$('select[data-target]', area);
        let ok=true;
        for(const sel of sels){
          const trg=sel.getAttribute('data-target');
          const chosen=sel.value;
          if(!chosen || t.mapping[chosen]!==trg) ok=false;
        }
        await grade(ok,t);
      };
    } else {
      area.innerHTML = `<p class="muted">Aufgabentyp (Alpha) noch nicht implementiert.</p>`;
    }
  }

  async function grade(ok, t, ctx={}){
    if(ctx.el){
      ctx.el.classList.add(ok?'correct':'wrong');
      $$('.option', $('#area')).forEach(o=>{
        const i=Number(o.getAttribute('data-i'));
        if(t.correct_indices.includes(i)) o.classList.add('correct');
      });
    }
    if(ok) correct += 1;
    if(correct >= QUOTE){
      // token award: 10% chance crit (starts with 9)
      const isCrit = Math.random() < 0.10;
      const tok = tokenFor(isCrit);
      appEl.innerHTML = `
        <div class="card">
          <h3>Quote erreicht! ✅</h3>
          <p class="muted">Zeig diesen Token der Lehrkraft am Beamer-Host.</p>
          <div class="sep"></div>
          <div class="kpi" style="letter-spacing:2px">${tok}</div>
          <p class="hint small">${isCrit ? 'Dieser Token ist ein <b>Crit</b> (2 Schaden).' : 'Normaler Token (1 Schaden).'}</p>
          <div class="sep"></div>
          <div class="row end">
            <button class="btn" data-go="classboss">Fertig</button>
          </div>
        </div>
      `;
      $('[data-go]').onclick=()=>nav('classboss');
      return;
    }
    current = pool[randInt(0,pool.length-1)];
    setTimeout(render, ctx.el?350:0);
  }

  render();
}

// ---------- Admin (hidden URL) ----------
async function renderAdmin(){
  // editable copy of content in kv (teacher device)
  let localContent = await kvGet('content_override');
  if(!localContent){
    localContent = CONTENT;
    await kvSet('content_override', localContent);
  }

  appEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>
          <h3>Admin (Alpha)</h3>
          <p class="muted">Aufgaben/Packs/Monster bearbeiten · ZIP-Batch-Upload für Sprites</p>
        </div>
        <div class="row">
          <button class="btn ghost" id="btnBack">Zur Übersicht</button>
          <button class="btn" id="btnSave">Aktivieren</button>
        </div>
      </div>
      <div class="sep"></div>

      <div class="grid cards">
        <div class="card">
          <h3>Content Export/Import</h3>
          <div class="row" style="flex-wrap:wrap;">
            <button class="btn ghost" id="btnExportContent">Content exportieren</button>
            <label class="btn ghost" style="cursor:pointer">
              Content importieren<input id="fileContent" type="file" accept="application/json" style="display:none">
            </label>
          </div>
          <p class="hint small">Export enthält Aufgaben/Packs/Vokabeln/Monster-Metadaten. Sprites liegen separat.</p>
        </div>

        <div class="card">
          <h3>Sprites ZIP hochladen</h3>
          <p class="muted small">Dateinamen: <code class="inline">asteron_base.png</code>, <code class="inline">asteron_evo1.png</code>, … (9 Dateien)</p>
          <label class="btn ghost" style="cursor:pointer; display:inline-block">
            ZIP wählen<input id="zipSprites" type="file" accept=".zip" style="display:none">
          </label>
          <div id="zipMsg" class="hint small" style="margin-top:10px"></div>
        </div>

        <div class="card">
          <h3>Aufgaben</h3>
          <p class="muted small">Minimal-Editor: Liste anzeigen + neue Aufgabe hinzufügen (Typing / Build / Single).</p>
          <div class="row" style="flex-wrap:wrap;">
            <select class="text" id="selPack"></select>
            <button class="btn ghost" id="btnAdd">+ Aufgabe</button>
          </div>
          <div id="taskList" class="stack" style="margin-top:12px; max-height:380px; overflow:auto"></div>
        </div>
      </div>
    </div>
  `;

  $('#btnBack').onclick = ()=>nav('');
  $('#btnSave').onclick = async ()=>{
    await kvSet('content_override', localContent);
    // also refresh global content for runtime
    CONTENT = localContent;
    alert('Aktiviert auf diesem Gerät. (Schülergeräte sehen Content aus dem Repo.)');
    nav('');
  };

  // pack select
  const selPack = $('#selPack');
  localContent.packs.forEach(p=>{
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.title}`;
    selPack.appendChild(opt);
  });

  function renderTaskList(){
    const packId = selPack.value;
    const list = $('#taskList');
    const tks = localContent.tasks.filter(t=>t.pack_id===packId).slice(0, 80);
    list.innerHTML = tks.map(t=>`
      <div class="monCard">
        <div class="row" style="justify-content:space-between">
          <div style="font-weight:800">${t.type}</div>
          <span class="badge">${t.difficulty||''}${t.is_heavy?' · heavy':''}</span>
        </div>
        <div class="small muted" style="margin-top:6px">${t.prompt}</div>
      </div>
    `).join('') || `<div class="small muted">Keine Aufgaben im Pack.</div>`;
  }
  selPack.onchange = renderTaskList;
  renderTaskList();

  $('#btnAdd').onclick = ()=>{
    const packId = selPack.value;
    const newId = `u_${packId}_${uid()}`;
    localContent.tasks.push({
      id: newId,
      pack_id: packId,
      type: 'typing',
      prompt: 'Analysiere die Form <b>…</b>:',
      answer: ['Akk Sg f'],
      difficulty: 'mittel',
      tags: ['Alpha'],
      is_heavy: false
    });
    renderTaskList();
  };

  // Content export/import
  $('#btnExportContent').onclick = ()=>{
    downloadText(`linguamon_content_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(localContent, null, 2));
  };
  $('#fileContent').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    try{
      const txt = await readFileText(f);
      localContent = JSON.parse(txt);
      // re-render pack select
      selPack.innerHTML='';
      localContent.packs.forEach(p=>{
        const opt = document.createElement('option');
        opt.value=p.id; opt.textContent=p.title;
        selPack.appendChild(opt);
      });
      renderTaskList();
      alert('Content importiert (lokal).');
    } catch(err){
      alert('Import fehlgeschlagen: '+err.message);
    }
  });

  // ZIP sprites
  $('#zipSprites').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    const msg = $('#zipMsg');
    msg.textContent = 'Lade ZIP…';
    try{
      const zip = await JSZip.loadAsync(f);
      const wanted = [
        'asteron_base.png','asteron_evo1.png','asteron_evo2.png',
        'vocaryn_base.png','vocaryn_evo1.png','vocaryn_evo2.png',
        'declara_base.png','declara_evo1.png','declara_evo2.png'
      ];
      let ok=0;
      for(const name of wanted){
        const entry = zip.file(name);
        if(!entry) continue;
        const blob = await entry.async('blob');
        const monId = name.replace('.png',''); // blob key
        await blobSet('monster:'+monId, blob);
        ok += 1;
      }
      msg.textContent = `ZIP verarbeitet. ${ok}/${wanted.length} Sprites übernommen (lokal auf diesem Gerät).`;
    }catch(err){
      msg.textContent = 'ZIP Fehler: '+err.message;
    }
  });
}

// ---------- Main render ----------
async function render(){
  const r = route();
  if(!CONTENT || !PROFILE){
    appEl.innerHTML = `<div class="card"><h3>Lade…</h3><p class="muted">Content wird geladen.</p></div>`;
    return;
  }

  if(r.startsWith('pack:')){
    const [, packId, mode] = r.split(':');
    return renderSession(packId, mode);
  }
  if(r.startsWith('boss:')){
    const [, packId] = r.split(':');
    return renderBossSolo(packId);
  }
  if(r==='album') return renderAlbum();
  if(r==='classboss') return renderClassBoss();
  if(r==='classboss-host') return renderClassBossHost();
  if(r==='classboss-join') return renderClassBossJoin();
  if(r.startsWith('classboss-play:')){
    const code = r.split(':')[1];
    return renderClassBossPlay(code);
  }
  if(r==='admin') return renderAdmin();
  return renderHome();
}

// ---------- Topbar controls ----------
$('#btnFullscreen').addEventListener('click', async ()=>{
  try{
    if(!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  }catch(e){ alert('Fullscreen nicht möglich: ' + e.message); }
});
$('#btnExport').addEventListener('click', async ()=>{
  await saveProfile();
  downloadText(`linguamon_export_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(PROFILE, null, 2));
});
$('#btnImport').addEventListener('click', ()=>{
  $('#dlgImport').showModal();
});
$('#btnDoImport').addEventListener('click', async (e)=>{
  e.preventDefault();
  const f = $('#importFile').files?.[0];
  if(!f){ alert('Bitte Datei auswählen.'); return; }
  try{
    const txt = await readFileText(f);
    const p = JSON.parse(txt);
    PROFILE = p;
    await saveProfile();
    $('#dlgImport').close();
    render();
  }catch(err){
    alert('Import fehlgeschlagen: ' + err.message);
  }
});
$('#btnAdmin').addEventListener('click', ()=>{
  // show hint about hidden url
  $('#dlgAdminLock').showModal();
  // also navigate
  nav('admin');
});

// ---------- Bootstrap ----------
(async ()=>{
  // register service worker (best-effort)
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('sw.js'); }catch(e){}
  }
  await loadContent();
  // local override for teacher device
  const override = await kvGet('content_override');
  if(override) CONTENT = override;
  await loadProfile();
  await render();
})();
