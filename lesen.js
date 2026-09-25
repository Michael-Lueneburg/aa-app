// AA-Reflex – PDF-Funktionen (Bibliothek, Leser, Gebete aus PDF übernehmen).
// Nutzt Mozillas pdf.js (vendor/pdfjs, Apache-2.0). Alles läuft lokal auf dem Gerät.
(function () {
  "use strict";
  const BASE = "vendor/pdfjs/";
  let libPromise = null;

  function lib() {
    if (!libPromise) {
      libPromise = import("./" + BASE + "pdf.min.mjs").then((m) => {
        m.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.mjs";
        return m;
      });
    }
    return libPromise;
  }

  async function open(data) {
    const pdfjs = await lib();
    const task = pdfjs.getDocument({
      data: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
      standardFontDataUrl: BASE + "standard_fonts/",
      wasmUrl: BASE + "wasm/",
      isEvalSupported: false
    });
    return task.promise;
  }

  // Text einer Seite als Zeilen (gruppiert nach y-Position, sortiert nach x).
  async function pageLines(doc, n) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = it.transform[5], x = it.transform[4];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < h * 0.45);
      if (!row) { row = { y, h, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let out = "", lastEnd = null;
      for (const it of r.items) {
        if (lastEnd !== null && it.x - lastEnd > r.h * 0.15 && !out.endsWith(" ") && !it.s.startsWith(" ")) out += " ";
        out += it.s;
        lastEnd = it.x + it.w;
      }
      return { text: out.replace(/\s+/g, " ").trim(), y: r.y, h: r.h };
    }).filter((l) => l.text);
  }

  async function pageText(doc, n) {
    return (await pageLines(doc, n)).map((l) => l.text).join("\n");
  }

  // ---------- Gebete aus einer PDF herauslösen ----------
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");

  async function extractPrayers(doc, fileName) {
    const n = doc.numPages;
    const pages = [];
    for (let i = 1; i <= n; i++) pages.push(await pageLines(doc, i));

    // 1) Wiederkehrende Fußzeile erkennen (z. B. „Sammlung_05_21   7")
    const footerKey = {};
    pages.forEach((ls) => {
      const last = ls[ls.length - 1];
      if (last && /\d{1,3}$/.test(last.text)) {
        const k = last.text.replace(/\s*\d{1,3}$/, "").trim();
        footerKey[k] = (footerKey[k] || 0) + 1;
      }
    });
    const footer = Object.entries(footerKey).filter(([k, c]) => c >= Math.max(2, n * 0.4)).map(([k]) => k)[0];
    const isFooter = (t) => footer !== undefined && (footer === "" ? /^\d{1,3}$/.test(t) : t.startsWith(footer) && /\d{1,3}$/.test(t));
    const printed = {}; // gedruckte Seitenzahl -> PDF-Seite
    pages.forEach((ls, i) => {
      const last = ls[ls.length - 1];
      if (last && isFooter(last.text)) printed[Number(last.text.match(/(\d{1,3})$/)[1])] = i + 1;
    });
    const offsets = Object.entries(printed).map(([p, i]) => i - Number(p));
    const offset = offsets.length ? offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)] : 0;
    const toIndex = (p) => printed[p] || Math.min(n, Math.max(1, p + offset));
    const clean = (ls) => ls.filter((l) => !isFooter(l.text));

    // 2) Inhaltsverzeichnis suchen (Zeilen „Titel …… 12")
    const toc = [];
    let tocPages = new Set();
    for (let i = 0; i < Math.min(n, 5); i++) {
      const hits = clean(pages[i]).map((l) => l.text.match(/^(.{2,80}?)[\s.·…_-]{1,}(\d{1,3})$/)).filter(Boolean);
      if (hits.length >= 4 || (hits.length >= 1 && tocPages.size)) {
        tocPages.add(i + 1);
        hits.forEach((m) => toc.push({ title: m[1].replace(/[\s.·…_-]+$/, "").trim(), page: Number(m[2]) }));
      } else if (tocPages.size) break;
    }
    const ordered = toc.every((t, i) => i === 0 || t.page >= toc[i - 1].page);
    const result = [];

    if (toc.length >= 3 && ordered) {
      for (let k = 0; k < toc.length; k++) {
        const e = toc[k];
        const s = toIndex(e.page);
        if (tocPages.has(s)) continue;
        const nextDifferent = toc.slice(k + 1).find((t) => t.page > e.page);
        const end = nextDifferent ? Math.max(s, toIndex(nextDifferent.page) - 1) : s;
        let lines = [];
        for (let i = s; i <= end; i++) lines = lines.concat(clean(pages[i - 1]));
        // Mehrere Einträge auf derselben Seite: an den Überschriften teilen
        const same = toc.filter((t) => t.page === e.page);
        if (same.length > 1) {
          const pos = same.map((t) => lines.findIndex((l) => norm(l.text) === norm(t.title)));
          const my = pos[same.indexOf(e)];
          if (my >= 0) {
            const nextPos = pos.filter((p) => p > my).sort((a, b) => a - b)[0];
            lines = lines.slice(my, nextPos === undefined ? lines.length : nextPos);
          }
        }
        if (lines.length && norm(lines[0].text) === norm(e.title)) lines = lines.slice(1);
        const text = lines.map((l) => l.text).join("\n").trim();
        if (text) result.push({ title: e.title, text });
      }
      if (result.length) return result;
    }

    // 3) Kein Inhaltsverzeichnis: kurze Datei = ein Gebet, sonst ein Gebet pro Seite
    const base = fileName.replace(/\.pdf$/i, "").replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
    const chunk = (ls, fallback) => {
      const c = clean(ls);
      if (!c.length) return null;
      const first = c[0].text;
      const titled = first.length <= 60 && c.length > 1;
      return { title: titled ? first : fallback, text: (titled ? c.slice(1) : c).map((l) => l.text).join("\n").trim() };
    };
    if (n <= 3) {
      let all = [];
      pages.forEach((ls) => { all = all.concat(ls); });
      const one = chunk(all, base);
      return one ? [one] : [];
    }
    return pages.map((ls, i) => chunk(ls, `${base} – Seite ${i + 1}`)).filter(Boolean);
  }

  // Volltextsuche (liefert Treffer mit Seitenzahl und Ausschnitt)
  async function search(doc, query, onProgress, cache) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (!cache[i]) cache[i] = (await pageText(doc, i)).replace(/\n/g, " ");
      const t = cache[i], tl = t.toLowerCase();
      let at = tl.indexOf(q);
      if (at >= 0) hits.push({ page: i, snip: (at > 40 ? "…" : "") + t.slice(Math.max(0, at - 40), at + q.length + 60) + "…" });
      if (onProgress && i % 10 === 0) onProgress(i, doc.numPages);
    }
    return hits;
  }

  window.AAPDF = { lib, open, pageText, extractPrayers, search };
})();

// ======================================================================
// Oberfläche: Gebete, Literatur (Bibliothek) und PDF-Leser
// ======================================================================
(function () {
  "use strict";
  const A = window.AA, P = window.AAPDF;
  const S = () => A.Store.state;
  const U = () => window.AAUI;
  const view = document.getElementById("view");
  const esc = (s) => window.AAUI.esc(s);
  const save = () => A.Store.scheduleSave();
  const fileTitle = (name) => name.normalize("NFC").replace(/(\.pdf)+$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const mb = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace(".", ",") + " MB";
  const backBar = (href, title, sub) => `<div class="datebar"><a class="iconbtn" href="${href}" aria-label="Zurück">‹</a>
    <div class="dateinfo"><strong>${title}</strong>${sub ? `<span>${sub}</span>` : ""}</div><span></span></div>`;
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = accept; i.multiple = !!multiple; i.hidden = true;
      i.onchange = () => { resolve(Array.from(i.files || [])); i.remove(); };
      document.body.appendChild(i); i.click();
    });
  }

  // ---------------- Gebete ----------------
  let pq = "", pFav = false, editing = null;

  function renderPrayers() {
    const list = S().content.prayers;
    const favCount = list.filter((p) => p.fav).length;
    if (pFav && !favCount) pFav = false;
    view.innerHTML = `
      ${backBar("#/mehr", "🙏 Gebete", `${list.length} ${list.length === 1 ? "Gebet" : "Gebete"}`)}
      ${list.length ? `
        <input type="search" id="p-q" placeholder="Gebete durchsuchen …" value="${esc(pq)}" aria-label="Gebete durchsuchen">
        ${favCount ? `<div class="seg"><button type="button" id="p-all" class="${pFav ? "" : "on"}">Alle</button><button type="button" id="p-fav" class="${pFav ? "on" : ""}">★ Favoriten (${favCount})</button></div>` : ""}
        <ul class="prayerlist" id="p-list"></ul>` : `
        <section class="card"><p>Noch keine Gebete gespeichert.</p>
          <p class="hint">Füge deine Gebetesammlung als PDF hinzu. Die App liest das Inhaltsverzeichnis und legt jedes Gebet einzeln an. Einzelne Gebets-PDFs werden als ein Gebet übernommen.</p></section>`}
      <section class="card">
        <h2>Gebete hinzufügen</h2>
        <div class="btnrow">
          <button type="button" class="btn primary" id="p-import">Aus PDF übernehmen</button>
          <button type="button" class="btn" id="p-new">Eigenes Gebet schreiben</button>
        </div>
        <p class="hint">Alles bleibt auf diesem Gerät. Gebete sind im Backup enthalten.</p>
      </section>`;
    const fill = () => {
      const q = pq.trim().toLowerCase();
      const shown = list.filter((p) => (!pFav || p.fav) && (!q || (p.title + " " + p.text).toLowerCase().includes(q)));
      const ul = document.getElementById("p-list");
      if (ul) ul.innerHTML = shown.map((p) => `<li><a href="#/gebet/${p.id}"><span>${esc(p.title)}</span>${p.fav ? `<span class="favmark" aria-label="Favorit">★</span>` : ""}</a></li>`).join("") ||
        `<li class="empty">Nichts gefunden.</li>`;
    };
    fill();
    const qi = document.getElementById("p-q");
    if (qi) qi.oninput = () => { pq = qi.value; fill(); };
    const all = document.getElementById("p-all"), fav = document.getElementById("p-fav");
    if (all) all.onclick = () => { pFav = false; renderPrayers(); };
    if (fav) fav.onclick = () => { pFav = true; renderPrayers(); };
    document.getElementById("p-new").onclick = () => {
      const p = { id: A.uid(), title: "Neues Gebet", text: "", fav: false, source: "eigenes" };
      list.push(p); save(); editing = p.id; location.hash = "#/gebet/" + p.id;
    };
    document.getElementById("p-import").onclick = importPrayers;
  }

  async function importPrayers() {
    const files = await pickFiles("application/pdf,.pdf", true);
    if (!files.length) return;
    const found = [];
    for (const f of files) {
      U().toast(`Lese „${fileTitle(f.name)}“ …`);
      try {
        const doc = await P.open(await f.arrayBuffer());
        const ps = await P.extractPrayers(doc, f.name);
        doc.destroy();
        ps.forEach((p) => found.push(Object.assign(p, { source: fileTitle(f.name) })));
      } catch (e) {
        U().toast(`„${fileTitle(f.name)}“ konnte nicht gelesen werden.`);
      }
    }
    if (!found.length) return U().dialog({ title: "Keine Gebete gefunden", text: "In der Datei wurde kein lesbarer Text gefunden. Eingescannte Seiten (Bilder) lassen sich nicht übernehmen.", cancelLabel: "" });
    const list = S().content.prayers;
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");
    const fresh = found.filter((p) => !list.some((x) => key(x.title) === key(p.title)));
    const dup = found.length - fresh.length;
    const ok = await U().dialog({
      title: `${found.length} ${found.length === 1 ? "Gebet" : "Gebete"} gefunden`,
      text: (fresh.length ? `${fresh.length} ${fresh.length === 1 ? "wird" : "werden"} übernommen.` : "Alle sind schon vorhanden.") + (dup ? ` ${dup} mit gleichem Titel ${dup === 1 ? "ist" : "sind"} schon vorhanden und ${dup === 1 ? "wird" : "werden"} übersprungen.` : "") +
        " Du kannst jedes Gebet danach noch bearbeiten oder löschen.",
      okLabel: fresh.length ? "Übernehmen" : "OK", cancelLabel: fresh.length ? "Abbrechen" : ""
    });
    if (!ok || !fresh.length) return;
    fresh.forEach((p) => list.push({ id: A.uid(), title: p.title, text: p.text, fav: false, source: p.source }));
    await A.Store.saveNow();
    U().toast(`${fresh.length} ${fresh.length === 1 ? "Gebet" : "Gebete"} übernommen.`);
    renderPrayers();
  }

  function renderPrayer(id) {
    const list = S().content.prayers;
    const i = list.findIndex((p) => p.id === id);
    if (i < 0) { location.hash = "#/gebete"; return; }
    const p = list[i], st = S().settings;
    const prev = list[i - 1], next = list[i + 1];
    if (editing === id) {
      view.innerHTML = `
        ${backBar("#/gebete", "Gebet bearbeiten")}
        <section class="card">
          <label class="lbl" for="pe-title">Titel</label>
          <input type="text" id="pe-title" value="${esc(p.title)}">
          <label class="lbl" for="pe-text">Text</label>
          <textarea id="pe-text" rows="16">${esc(p.text)}</textarea>
          <div class="btnrow"><button type="button" class="btn primary" id="pe-save">Fertig</button></div>
        </section>`;
      const t = document.getElementById("pe-title"), x = document.getElementById("pe-text");
      t.oninput = () => { p.title = t.value; save(); };
      x.oninput = () => { p.text = x.value; save(); };
      document.getElementById("pe-save").onclick = () => { if (!p.title.trim()) p.title = "Ohne Titel"; editing = null; A.Store.saveNow(); renderPrayer(id); };
      if (!p.text) x.focus();
      return;
    }
    view.innerHTML = `
      ${backBar("#/gebete", "🙏 Gebete", `${i + 1} von ${list.length}`)}
      <article class="card prayer">
        <h2 class="prayer-title">${esc(p.title)}</h2>
        <div class="prayer-text" style="font-size:${st.prayerFont}px">${esc(p.text) || `<span class="hint">(noch kein Text)</span>`}</div>
      </article>
      <div class="btnrow center-row">
        <button type="button" class="iconbtn" id="pr-smaller" aria-label="Schrift kleiner">A−</button>
        <button type="button" class="iconbtn" id="pr-bigger" aria-label="Schrift größer">A+</button>
        <button type="button" class="iconbtn star ${p.fav ? "on" : ""}" id="pr-fav" aria-label="Favorit">${p.fav ? "★" : "☆"}</button>
        <button type="button" class="btn" id="pr-share">Teilen</button>
        <button type="button" class="btn" id="pr-edit">Bearbeiten</button>
      </div>
      <div class="pager">
        ${prev ? `<a class="btn" href="#/gebet/${prev.id}">‹ ${esc(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a class="btn" href="#/gebet/${next.id}">${esc(next.title)} ›</a>` : "<span></span>"}
      </div>
      <div class="center"><button type="button" class="btn danger-ghost sm" id="pr-del">Gebet löschen</button></div>
      ${p.source && p.source !== "eigenes" ? `<p class="hint center">Aus: ${esc(p.source)}</p>` : ""}`;
    const setFont = (d) => { st.prayerFont = Math.min(32, Math.max(14, st.prayerFont + d)); save(); document.querySelector(".prayer-text").style.fontSize = st.prayerFont + "px"; };
    document.getElementById("pr-smaller").onclick = () => setFont(-2);
    document.getElementById("pr-bigger").onclick = () => setFont(2);
    document.getElementById("pr-fav").onclick = () => { p.fav = !p.fav; save(); U().rerender(); };
    document.getElementById("pr-share").onclick = () => U().shareText(`${p.title}\n\n${p.text}`, p.title);
    document.getElementById("pr-edit").onclick = () => { editing = id; renderPrayer(id); };
    document.getElementById("pr-del").onclick = async () => {
      if (!(await U().dialog({ title: "Gebet löschen?", text: `„${p.title}“ wird entfernt.`, okLabel: "Löschen", danger: true }))) return;
      list.splice(i, 1); await A.Store.saveNow(); location.hash = "#/gebete";
    };
  }

  // ---------------- Literatur ----------------
  async function renderLibrary() {
    const lib = S().library.slice().sort((a, b) => a.title.localeCompare(b.title, "de"));
    view.innerHTML = `
      ${backBar("#/mehr", "📚 Literatur", `${lib.length} ${lib.length === 1 ? "Buch" : "Bücher"}`)}
      ${lib.length ? `<ul class="booklist">${lib.map((b) => `<li>
          <a href="#/lesen/${b.id}" class="book">
            <strong>${esc(b.title)}</strong>
            <small>${b.pages} Seiten · ${mb(b.size)}${b.lastPage > 1 ? ` · weiter bei S. ${b.lastPage}` : ""}</small>
          </a>
          <button type="button" class="iconbtn sm" data-ren="${b.id}" aria-label="Umbenennen">✎</button>
          <button type="button" class="iconbtn sm" data-del="${b.id}" aria-label="Entfernen">×</button>
        </li>`).join("")}</ul>` : `
        <section class="card"><p>Noch keine Bücher hinterlegt.</p>
          <p class="hint">Füge PDFs hinzu, z. B. aus „Downloads“ oder Google Drive. Sie werden in der App gespeichert und lassen sich auch offline lesen – mit Seitensprung und Suche.</p></section>`}
      <section class="card">
        <button type="button" class="btn primary" id="l-add">+ PDF hinzufügen</button>
        <p class="hint">Die Bücher liegen nur auf diesem Handy – nicht online und nicht im Backup. Bei einem neuen Handy einfach wieder hinzufügen.</p>
        <p class="hint" id="l-usage"></p>
      </section>`;
    document.getElementById("l-add").onclick = addBooks;
    view.querySelectorAll("[data-ren]").forEach((b) => b.onclick = async () => {
      const m = S().library.find((x) => x.id === b.dataset.ren);
      const t = await U().dialog({ title: "Umbenennen", input: { label: "Titel", value: m.title }, okLabel: "Speichern" });
      if (t && t.trim()) { m.title = t.trim(); await A.Store.saveNow(); renderLibrary(); }
    });
    view.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      const m = S().library.find((x) => x.id === b.dataset.del);
      if (!(await U().dialog({ title: "Buch entfernen?", text: `„${m.title}“ wird aus der App gelöscht. Die Originaldatei auf dem Handy bleibt erhalten.`, okLabel: "Entfernen", danger: true }))) return;
      S().library = S().library.filter((x) => x.id !== m.id);
      try { await A.Files.del(m.id); } catch (e) { /* ignorieren */ }
      await A.Store.saveNow(); renderLibrary();
    });
    try {
      const est = await navigator.storage.estimate();
      const el = document.getElementById("l-usage");
      if (el && est && est.usage) el.textContent = `Belegter Speicher der App: ${mb(est.usage)}`;
    } catch (e) { /* ignorieren */ }
  }

  async function addBooks() {
    const files = await pickFiles("application/pdf,.pdf", true);
    let added = 0;
    for (const f of files) {
      if (S().library.some((b) => b.name === f.name && b.size === f.size)) { U().toast(`„${fileTitle(f.name)}“ ist schon vorhanden.`); continue; }
      U().toast(`Speichere „${fileTitle(f.name)}“ …`);
      try {
        const doc = await P.open(await f.arrayBuffer());
        const pages = doc.numPages; doc.destroy();
        const id = A.uid();
        await A.Files.put(id, new Blob([f], { type: "application/pdf" }));
        S().library.push({ id, title: fileTitle(f.name), name: f.name, size: f.size, pages, addedAt: new Date().toISOString(), lastPage: 1 });
        added++;
      } catch (e) {
        U().toast(e && e.name === "QuotaExceededError" ? "Kein Speicherplatz mehr frei." : `„${fileTitle(f.name)}“ konnte nicht geöffnet werden.`);
      }
    }
    if (added) { await A.Store.saveNow(); A.Store.requestPersist(); U().toast(`${added} ${added === 1 ? "Buch" : "Bücher"} hinzugefügt.`); }
    if (location.hash === "#/literatur") renderLibrary();
  }

  // ---------------- PDF-Leser ----------------
  const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5];

  async function renderReader(id) {
    const meta = S().library.find((b) => b.id === id);
    if (!meta) { location.hash = "#/literatur"; return; }
    const st = S().settings;
    view.innerHTML = `
      <div class="readbar">
        <a class="iconbtn sm" href="#/literatur" aria-label="Zurück">‹</a>
        <div class="rtitle">${esc(meta.title)}</div>
        <button type="button" class="btn sm" id="r-page" aria-label="Zu Seite springen">– / ${meta.pages}</button>
        <button type="button" class="iconbtn sm" id="r-find" aria-label="Suchen">🔍</button>
        <button type="button" class="iconbtn sm" id="r-out" aria-label="Verkleinern">−</button>
        <button type="button" class="iconbtn sm" id="r-in" aria-label="Vergrößern">+</button>
        <button type="button" class="iconbtn sm ${st.readerNight ? "on" : ""}" id="r-night" aria-label="Nachtmodus">🌙</button>
      </div>
      <div class="searchbox" id="r-sbox" hidden>
        <div class="rowflex"><input type="search" id="r-q" placeholder="Im Buch suchen …" aria-label="Im Buch suchen" enterkeyhint="search">
          <button type="button" class="btn sm" id="r-go">Suchen</button></div>
        <p class="hint" id="r-sinfo"></p>
        <ul class="hits" id="r-hits"></ul>
      </div>
      <div class="pagescroll"><div class="pages ${st.readerNight ? "night" : ""}" id="r-pages"><p class="hint center">Öffne Buch …</p></div></div>`;

    let blob = null;
    try { blob = await A.Files.get(id); } catch (e) { /* unten behandelt */ }
    if (!blob) {
      document.getElementById("r-pages").innerHTML = `<section class="card"><p>Die Datei ist auf diesem Gerät nicht (mehr) vorhanden – z. B. nach einem Backup auf einem neuen Handy.</p>
        <button type="button" class="btn primary" id="r-readd">PDF erneut auswählen</button></section>`;
      document.getElementById("r-readd").onclick = async () => {
        const [f] = await pickFiles("application/pdf,.pdf", false);
        if (!f) return;
        await A.Files.put(id, new Blob([f], { type: "application/pdf" }));
        meta.size = f.size; meta.name = f.name; await A.Store.saveNow(); renderReader(id);
      };
      return;
    }
    let doc;
    try { doc = await P.open(await blob.arrayBuffer()); }
    catch (e) { document.getElementById("r-pages").innerHTML = `<p class="hint center">Das PDF konnte nicht geöffnet werden.</p>`; return; }
    if (U().parseHash().arg !== id) { doc.destroy(); return; } // inzwischen weggeblättert
    meta.pages = doc.numPages;

    const pagesEl = document.getElementById("r-pages");
    const scroller = pagesEl.parentElement;
    const btnPage = document.getElementById("r-page");
    const first = await doc.getPage(1);
    const ratio = first.getViewport({ scale: 1 }).height / first.getViewport({ scale: 1 }).width;
    let zoomIdx = Math.max(0, ZOOMS.indexOf(st.readerZoom)); if (ZOOMS[zoomIdx] !== st.readerZoom) zoomIdx = 1;
    let width = 0, divs = [], current = 1, observer = null;
    const rendered = new Map(); // n -> { canvas, task }
    const textCache = {};
    let alive = true;

    const offsetTop = () => (document.querySelector(".readbar").offsetHeight + 6);
    function layout(keepPage) {
      rendered.forEach((r) => { try { r.task && r.task.cancel(); } catch (e) {} });
      rendered.clear();
      if (observer) observer.disconnect();
      width = Math.floor((Math.min(scroller.clientWidth, 1000) - 8) * ZOOMS[zoomIdx]);
      pagesEl.innerHTML = "";
      pagesEl.style.width = width + "px";
      divs = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const d = document.createElement("div");
        d.className = "pg"; d.dataset.n = n;
        d.style.width = width + "px"; d.style.height = Math.round(width * ratio) + "px";
        d.innerHTML = `<span class="pgnum">${n}</span>`;
        pagesEl.appendChild(d); divs.push(d);
      }
      observer = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) renderPage(Number(en.target.dataset.n)); }), { rootMargin: "1500px 0px" });
      divs.forEach((d) => observer.observe(d));
      if (keepPage) jump(keepPage, true);
    }
    async function renderPage(n) {
      if (!alive || rendered.has(n)) return;
      const entry = { canvas: null, task: null };
      rendered.set(n, entry);
      try {
        const page = await doc.getPage(n);
        if (!rendered.has(n)) return;
        const v1 = page.getViewport({ scale: 1 });
        const scale = width / v1.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: scale * dpr });
        const c = document.createElement("canvas");
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.style.width = width + "px"; c.style.height = Math.round(width * v1.height / v1.width) + "px";
        entry.canvas = c;
        entry.task = page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp });
        await entry.task.promise;
        if (!rendered.has(n)) return;
        const d = divs[n - 1];
        d.style.height = c.style.height;
        d.querySelectorAll("canvas").forEach((x) => x.remove());
        d.appendChild(c);
        prune();
      } catch (e) { rendered.delete(n); }
    }
    function prune() {
      if (rendered.size <= 10) return;
      [...rendered.keys()].sort((a, b) => Math.abs(b - current) - Math.abs(a - current)).slice(0, rendered.size - 10).forEach((n) => {
        const r = rendered.get(n);
        try { r.task && r.task.cancel(); } catch (e) {}
        divs[n - 1].querySelectorAll("canvas").forEach((x) => x.remove());
        rendered.delete(n);
      });
    }
    function pageAtScroll() {
      const y = window.scrollY + offsetTop() + window.innerHeight * 0.25;
      let lo = 0, hi = divs.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const top = divs[mid].getBoundingClientRect().top + window.scrollY;
        if (top <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans + 1;
    }
    let saveT = null, raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!alive || !divs.length) return;
        const n = pageAtScroll();
        if (n !== current) {
          current = n;
          btnPage.textContent = `${n} / ${doc.numPages}`;
          clearTimeout(saveT); saveT = setTimeout(() => { meta.lastPage = current; save(); }, 800);
        }
      });
    }
    function jump(n, instant) {
      n = Math.min(doc.numPages, Math.max(1, n));
      const d = divs[n - 1];
      window.scrollTo({ top: d.getBoundingClientRect().top + window.scrollY - offsetTop(), behavior: instant ? "auto" : "smooth" });
      current = n; btnPage.textContent = `${n} / ${doc.numPages}`;
      meta.lastPage = n; save();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    U().setCleanup(() => {
      alive = false;
      window.removeEventListener("scroll", onScroll);
      if (observer) observer.disconnect();
      meta.lastPage = current; A.Store.saveNow();
      try { doc.destroy(); } catch (e) {}
    });

    layout(meta.lastPage || 1);
    if ((meta.lastPage || 1) > 1) U().toast(`Weiter bei Seite ${meta.lastPage}.`, { action: "Zum Anfang", onAction: () => jump(1) });

    btnPage.onclick = async () => {
      const v = await U().dialog({ title: "Zu Seite springen", input: { label: `Seite (1–${doc.numPages})`, type: "number", value: String(current) }, okLabel: "Springen" });
      if (v && Number(v)) jump(Number(v));
    };
    document.getElementById("r-in").onclick = () => { if (zoomIdx < ZOOMS.length - 1) { zoomIdx++; st.readerZoom = ZOOMS[zoomIdx]; save(); layout(current); } };
    document.getElementById("r-out").onclick = () => { if (zoomIdx > 0) { zoomIdx--; st.readerZoom = ZOOMS[zoomIdx]; save(); layout(current); } };
    document.getElementById("r-night").onclick = (e) => {
      st.readerNight = !st.readerNight; save();
      pagesEl.classList.toggle("night", st.readerNight); e.currentTarget.classList.toggle("on", st.readerNight);
    };
    const sbox = document.getElementById("r-sbox");
    document.getElementById("r-find").onclick = () => { sbox.hidden = !sbox.hidden; if (!sbox.hidden) document.getElementById("r-q").focus(); };
    const runSearch = async () => {
      const q = document.getElementById("r-q").value;
      const info = document.getElementById("r-sinfo"), ul = document.getElementById("r-hits");
      if (q.trim().length < 2) { info.textContent = "Bitte mindestens zwei Zeichen eingeben."; return; }
      ul.innerHTML = ""; info.textContent = "Suche …";
      const hits = await P.search(doc, q, (i, n) => { info.textContent = `Suche … Seite ${i} von ${n}`; }, textCache);
      if (!alive) return;
      const noText = Object.values(textCache).every((t) => !t.trim());
      info.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? "Seite" : "Seiten"} gefunden` : (noText ? "Dieses PDF enthält keinen durchsuchbaren Text (eingescannte Seiten)." : "Nichts gefunden.");
      ul.innerHTML = hits.slice(0, 300).map((h) => `<li><button type="button" data-p="${h.page}"><strong>S. ${h.page}</strong> ${esc(h.snip)}</button></li>`).join("");
      ul.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { sbox.hidden = true; jump(Number(b.dataset.p)); });
    };
    document.getElementById("r-go").onclick = runSearch;
    document.getElementById("r-q").onkeydown = (e) => { if (e.key === "Enter") runSearch(); };
  }

  window.AAREAD = { renderPrayers, renderPrayer, renderLibrary, renderReader };
})();
