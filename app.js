// AA-Reflex V2 – Oberfläche
(function () {
  "use strict";
  const { Store, D, LISTS, uid, newStep10, contentFromDefaults } = window.AA;
  const APP_VERSION = "2.1.0";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const view = $("#view");
  const S = () => Store.state;
  let rangeSel = 30; // Rückblick-Zeitraum
  let historyQuery = "";

  // ---------- Pfad-Helfer für Datenbindung ----------
  const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
  function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; }

  // ---------- Toast & Dialoge ----------
  function toast(msg, opts = {}) {
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML = `<span>${esc(msg)}</span>` + (opts.action ? `<button type="button">${esc(opts.action)}</button>` : "");
    if (opts.action) $("button", el).onclick = () => { el.remove(); opts.onAction && opts.onAction(); };
    box.appendChild(el);
    setTimeout(() => el.remove(), opts.ms || (opts.action ? 9000 : 2600));
  }
  function dialog({ title, text = "", okLabel = "OK", cancelLabel = "Abbrechen", danger = false, input = null }) {
    return new Promise((resolve) => {
      const dlg = $("#dlg");
      dlg.innerHTML = `<form method="dialog" class="dlg">
        <h3>${esc(title)}</h3>
        ${text ? `<p>${esc(text)}</p>` : ""}
        ${input ? `<label class="lbl">${esc(input.label || "")}</label><input type="${input.type || "text"}" id="dlg-in" value="${esc(input.value || "")}" autocomplete="off">` : ""}
        <div class="btnrow end">
          ${cancelLabel ? `<button value="cancel" class="btn">${esc(cancelLabel)}</button>` : ""}
          <button value="ok" class="btn ${danger ? "danger" : "primary"}">${esc(okLabel)}</button>
        </div></form>`;
      dlg.onclose = () => {
        const ok = dlg.returnValue === "ok";
        if (input) resolve(ok ? $("#dlg-in", dlg).value : null); else resolve(ok);
      };
      dlg.returnValue = "";
      dlg.showModal();
      if (input) setTimeout(() => $("#dlg-in", dlg).focus(), 50);
    });
  }

  // ---------- Teilen, Kopieren, Dateien ----------
  async function shareText(text, title = "AA-Reflex") {
    if (navigator.share) {
      try { await navigator.share({ title, text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("In die Zwischenablage kopiert."); }
    catch (e) { toast("Kopieren nicht möglich – bitte über „Teilen“."); }
  }
  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- Kopfzeile ----------
  function renderHeader() {
    const sob = Store.sobriety();
    const streak = Store.streak();
    $("#h-sober").textContent = sob ? `${sob.days.toLocaleString("de-DE")} Tage nüchtern` : "";
    $("#h-sober").hidden = !sob;
    $("#h-streak").textContent = streak > 0 ? `${streak} ${streak === 1 ? "Tag" : "Tage"} in Folge` : "";
    $("#h-streak").hidden = !streak;
  }
  Store.onSaved((ok) => {
    renderHeader();
    const el = $("#savestate");
    el.textContent = ok ? "gespeichert" : "Speichern fehlgeschlagen!";
    el.classList.toggle("err", !ok);
    el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 1200);
  });

  function applyTheme() {
    document.documentElement.dataset.theme = S().settings.theme || "dark";
  }

  // ---------- Router ----------
  const routes = {
    morgen: (arg) => renderMorning(arg),
    abend: (arg) => renderEvening(arg),
    verlauf: () => renderHistory(),
    tag: (arg) => renderDayDetail(arg),
    rueckblick: () => renderReview(),
    mehr: () => renderMore(),
    inhalte: (arg) => renderContentEditor(arg),
    favoriten: () => renderFavorites(),
    gebete: () => window.AAREAD.renderPrayers(),
    gebet: (arg) => window.AAREAD.renderPrayer(arg),
    literatur: () => window.AAREAD.renderLibrary(),
    lesen: (arg) => window.AAREAD.renderReader(arg)
  };
  let cleanup = null; // z. B. PDF-Leser schließen
  function parseHash() {
    const parts = (location.hash || "").replace(/^#\/?/, "").split("/");
    return { name: routes[parts[0]] ? parts[0] : null, arg: parts[1] ? decodeURIComponent(parts[1]) : null };
  }
  function route() {
    let { name, arg } = parseHash();
    if (!name) {
      // Standard: morgens die Morgenroutine, ab 17 Uhr die Abendroutine
      name = new Date().getHours() >= 17 || new Date().getHours() < S().settings.dayStartHour ? "abend" : "morgen";
    }
    const tab = { morgen: "morgen", abend: "abend", verlauf: "verlauf", tag: "verlauf", rueckblick: "rueckblick", mehr: "mehr", inhalte: "mehr", favoriten: "mehr", gebete: "mehr", gebet: "mehr", literatur: "mehr", lesen: "mehr" }[name];
    $$("#tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    if (cleanup) { try { cleanup(); } catch (e) { /* ignorieren */ } cleanup = null; }
    document.body.classList.toggle("reading", name === "lesen");
    routes[name](arg);
    renderHeader();
  }
  function rerender() {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
  window.addEventListener("hashchange", () => { Store.saveNow(); delete view.dataset.affOpen; route(); window.scrollTo(0, 0); });

  // ---------- Generische Bindung an einen Tag ----------
  function bindDay(root, date, day) {
    const commit = () => Store.commitDay(date, day);
    $$("[data-bind]", root).forEach((el) => {
      el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
        setPath(day, el.dataset.bind, el.type === "checkbox" ? el.checked : el.value);
        commit();
      });
    });
    $$("[data-toggle]", root).forEach((el) => {
      el.addEventListener("click", () => {
        const arr = getPath(day, el.dataset.toggle);
        const v = el.dataset.value;
        const i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1); else arr.push(v);
        el.classList.toggle("on", i < 0);
        el.setAttribute("aria-pressed", String(i < 0));
        commit();
      });
    });
    $$("[data-seg]", root).forEach((el) => {
      el.addEventListener("click", () => {
        const p = el.dataset.seg;
        const v = el.dataset.value === "true";
        setPath(day, p, getPath(day, p) === v ? null : v);
        if (p === "evening.step10" && day.evening.step10 === true && !day.evening.s10) day.evening.s10 = newStep10();
        commit();
        rerender();
      });
    });
    $$("[data-add]", root).forEach((el) => {
      el.addEventListener("click", () => {
        const arr = getPath(day, el.dataset.add);
        if (arr.length >= Number(el.dataset.max || 99)) return toast("Maximal " + el.dataset.max + " Einträge.");
        arr.push("");
        commit();
        rerender();
        const inputs = $$(`[data-bind^="${el.dataset.add}."]`);
        inputs.length && inputs[inputs.length - 1].focus();
      });
    });
    $$("[data-remove]", root).forEach((el) => {
      el.addEventListener("click", () => {
        const arr = getPath(day, el.dataset.remove);
        arr.splice(Number(el.dataset.idx), 1);
        if (!arr.length) arr.push("");
        commit();
        rerender();
      });
    });
  }

  // ---------- Bausteine ----------
  function dateBar(kind, date) {
    const today = Store.today();
    const isToday = date === today;
    const label = isToday ? "Heute" : date === D.add(today, -1) ? "Gestern" : "Nachtrag";
    return `<div class="datebar">
      <a class="iconbtn" href="#/${kind}/${D.add(date, -1)}" aria-label="Vorheriger Tag">‹</a>
      <div class="dateinfo"><strong>${label}</strong><span>${D.pretty(date)}</span></div>
      ${isToday ? `<span class="iconbtn disabled" aria-hidden="true">›</span>` : `<a class="iconbtn" href="#/${kind}/${D.add(date, 1)}" aria-label="Nächster Tag">›</a>`}
    </div>
    ${isToday ? "" : `<div class="center"><a class="link" href="#/${kind}">Zu heute springen</a></div>`}`;
  }
  function textRows(path, arr, label, max) {
    return arr.map((v, i) => `<div class="inrow">
        <input type="text" data-bind="${path}.${i}" value="${esc(v)}" placeholder="${esc(label)} ${i + 1}" aria-label="${esc(label)} ${i + 1}" enterkeyhint="done">
        <button type="button" class="iconbtn sm" data-remove="${path}" data-idx="${i}" aria-label="Eintrag entfernen">×</button>
      </div>`).join("") +
      (arr.length < max ? `<button type="button" class="btn ghost sm" data-add="${path}" data-max="${max}">+ hinzufügen</button>` : "");
  }
  function chips(path, options, selected, cls = "") {
    const all = options.slice();
    selected.forEach((s) => { if (!all.includes(s)) all.push(s); }); // gelöschte, aber gewählte Einträge bleiben sichtbar
    return `<div class="chips ${cls}">` + all.map((o) => {
      const on = selected.includes(o);
      return `<button type="button" class="chip ${on ? "on" : ""}" aria-pressed="${on}" data-toggle="${path}" data-value="${esc(o)}">${esc(o)}</button>`;
    }).join("") + `</div>`;
  }
  function seg(path, value, labels = ["Nein", "Ja"]) {
    return `<div class="seg" role="group">
      <button type="button" class="${value === false ? "on" : ""}" aria-pressed="${value === false}" data-seg="${path}" data-value="false">${labels[0]}</button>
      <button type="button" class="${value === true ? "on" : ""}" aria-pressed="${value === true}" data-seg="${path}" data-value="true">${labels[1]}</button>
    </div>`;
  }
  const texts = (list) => S().content[list].map((x) => x.text).filter((t) => t.trim());

  function backupBanner() {
    const st = S();
    const n = st.settings.backupReminderDays;
    if (!n || Object.keys(st.days).length < 2) return "";
    const last = st.meta.lastBackupAt;
    const age = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    if (age !== null && age < n) return "";
    return `<div class="banner"><span>${age === null ? "Noch kein Backup angelegt." : `Letztes Backup vor ${age} Tagen.`}</span>
      <button type="button" class="btn sm primary" id="banner-backup">Jetzt sichern</button></div>`;
  }
  function bindBanner() { const b = $("#banner-backup"); if (b) b.onclick = createBackup; }

  // ---------- Morgen ----------
  function renderMorning(argDate) {
    const today = Store.today();
    const date = D.valid(argDate) && argDate <= today ? argDate : today;
    const day = Store.draftDay(date);
    const m = day.morning;
    // Spruch: heute immer anzeigen; Nachträge nur, wenn gespeichert
    let quote = m.quote;
    if (!quote && date === today) { const q = Store.quoteForDate(date); if (q) quote = { cat: q.cat, text: q.text }; }
    const quoteItem = quote && S().content.quotes.find((q) => q.text === quote.text);

    const affs = S().content.affirmations.filter((a) => a.text.trim());
    const cats = [...new Set(affs.map((a) => a.cat))];
    const favs = affs.filter((a) => a.fav);
    const curCat = view.dataset.affCat && (cats.includes(view.dataset.affCat) || (view.dataset.affCat === "★" && favs.length)) ? view.dataset.affCat
      : (m.affirmation && cats.includes(m.affirmation.cat) ? m.affirmation.cat : (favs.length ? "★" : cats[0]));
    const affList = curCat === "★" ? favs : affs.filter((a) => a.cat === curCat);

    view.innerHTML = `
      ${date === today ? backupBanner() : ""}
      ${dateBar("morgen", date)}
      <h1 class="screen-title">🌅 Morgenroutine ${m.done ? `<span class="badge ok">✓ abgeschlossen</span>` : ""}</h1>

      <section class="card" id="sec-thanks">
        <h2>Dankbarkeit</h2>
        <p class="hint">Mindestens ein Eintrag, bis zu sechs.</p>
        ${textRows("morning.thankful", m.thankful, "Dankbar für", 6)}
      </section>

      <section class="card" id="sec-self">
        <h2>Heute gut für mich sorgen</h2>
        <p class="hint">Antippen oder eigene Einträge schreiben.</p>
        ${chips("morning.selfcareChips", texts("selfcareChips"), m.selfcareChips)}
        ${textRows("morning.selfcare", m.selfcare, "Eigenes", 6)}
      </section>

      <section class="card">
        <h2>Tagesfokus – Nur für heute</h2>
        ${chips("morning.focus", texts("ninePoints"), m.focus, "stack")}
        <label class="lbl" for="focusNote">Mini-Absicht</label>
        <input type="text" id="focusNote" data-bind="morning.focusNote" value="${esc(m.focusNote)}" placeholder="Heute konkret tue ich …">
      </section>

      <section class="card">
        <h2>Kraftsatz</h2>
        ${m.affirmation ? `<blockquote class="picked">„${esc(m.affirmation.text)}“</blockquote>` : `<p class="hint">Wähle einen Satz für heute.</p>`}
        <details class="affpick" ${m.affirmation && !view.dataset.affOpen ? "" : "open"}>
        <summary>${m.affirmation ? "Anderen Kraftsatz wählen" : "Kraftsätze anzeigen"}</summary>
        <div class="rowflex">
          <select id="aff-cat" aria-label="Kategorie">
            ${favs.length ? `<option value="★" ${curCat === "★" ? "selected" : ""}>★ Favoriten</option>` : ""}
            ${cats.map((c) => `<option ${c === curCat ? "selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
          <button type="button" class="btn sm" id="aff-rand" title="Zufällig">🎲</button>
        </div>
        <ul class="picklist">
          ${affList.map((a) => `<li class="${m.affirmation && m.affirmation.text === a.text ? "on" : ""}">
              <button type="button" class="pick" data-aff="${a.id}">${esc(a.text)}</button>
              <button type="button" class="star ${a.fav ? "on" : ""}" data-fav-aff="${a.id}" aria-label="Favorit">${a.fav ? "★" : "☆"}</button>
            </li>`).join("")}
        </ul>
        </details>
      </section>

      <section class="card">
        <h2>Spruch des Tages</h2>
        ${quote ? `<div class="quote"><span class="badge">${esc(quote.cat)}</span><p>„${esc(quote.text)}“</p></div>` : `<p class="hint">Kein Spruch gespeichert.</p>`}
        <div class="btnrow">
          <button type="button" class="btn sm" id="q-new">Anderer Spruch</button>
          ${quoteItem ? `<button type="button" class="btn sm" id="q-fav">${quoteItem.fav ? "★ Favorit" : "☆ Favorit"}</button>` : ""}
        </div>
      </section>

      <section class="card actions">
        <button type="button" class="btn primary wide" id="m-done">${m.done ? "✓ Morgen abgeschlossen" : "Morgen abschließen"}</button>
        <div class="btnrow">
          <button type="button" class="btn" id="m-share">Teilen</button>
          <button type="button" class="btn" id="m-copy">Kopieren</button>
        </div>
        <p class="hint center">Alles wird automatisch gespeichert.</p>
      </section>`;

    bindDay(view, date, day);
    bindBanner();
    const commit = () => Store.commitDay(date, day);

    $("#aff-cat").onchange = (e) => { view.dataset.affCat = e.target.value; view.dataset.affOpen = "1"; rerender(); };
    $("#aff-rand").onclick = () => {
      const pool = affList.length ? affList : affs;
      const a = pool[Math.floor(Math.random() * pool.length)];
      if (a) { m.affirmation = { cat: a.cat, text: a.text }; commit(); rerender(); }
    };
    $$("[data-aff]").forEach((b) => b.onclick = () => {
      const a = affs.find((x) => x.id === b.dataset.aff);
      m.affirmation = m.affirmation && m.affirmation.text === a.text ? null : { cat: a.cat, text: a.text };
      delete view.dataset.affOpen;
      commit(); rerender();
    });
    $$("[data-fav-aff]").forEach((b) => b.onclick = () => {
      const a = affs.find((x) => x.id === b.dataset.favAff);
      a.fav = !a.fav; view.dataset.affOpen = "1"; Store.scheduleSave(); rerender();
    });
    $("#q-new").onclick = () => {
      const q = Store.quoteForDate(date, true);
      if (q) { m.quote = { cat: q.cat, text: q.text }; commit(); rerender(); }
    };
    if ($("#q-fav")) $("#q-fav").onclick = () => { quoteItem.fav = !quoteItem.fav; Store.scheduleSave(); rerender(); };

    $("#m-done").onclick = () => {
      const filled = (a) => a.some((x) => x.trim());
      if (!filled(m.thankful)) return focusMissing("#sec-thanks", "Bitte mindestens einen Eintrag bei Dankbarkeit.");
      if (!filled(m.selfcare) && !m.selfcareChips.length) return focusMissing("#sec-self", "Bitte mindestens einen Eintrag bei Selbstfürsorge.");
      if (!m.done) { m.done = true; m.doneAt = new Date().toISOString(); commit(); Store.saveNow(); toast("Morgenroutine abgeschlossen."); rerender(); }
      else toast("Ist bereits abgeschlossen – Änderungen werden trotzdem gespeichert.");
    };
    $("#m-share").onclick = () => shareText(Store.formatDay(date, day, "morning"));
    $("#m-copy").onclick = () => copyText(Store.formatDay(date, day, "morning"));
  }
  function focusMissing(sel, msg) {
    const el = $(sel);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
    toast(msg);
  }

  // ---------- Abend ----------
  function renderEvening(argDate) {
    const today = Store.today();
    const date = D.valid(argDate) && argDate <= today ? argDate : today;
    const day = Store.draftDay(date);
    const e = day.evening;
    const t = e.s10;

    view.innerHTML = `
      ${dateBar("abend", date)}
      <h1 class="screen-title">🌙 Abendroutine ${e.done ? `<span class="badge ok">✓ abgeschlossen</span>` : ""}</h1>

      <section class="card">
        <h2>Was habe ich heute Gutes für jemanden getan?</h2>
        <textarea data-bind="evening.goodForSomeone" rows="2">${esc(e.goodForSomeone)}</textarea>
      </section>
      <section class="card">
        <h2>Was habe ich heute lernen dürfen?</h2>
        <textarea data-bind="evening.learned" rows="2">${esc(e.learned)}</textarea>
      </section>
      <section class="card" id="sec-good">
        <h2>Tolle Dinge</h2>
        <p class="hint">Mindestens drei – gern mehr.</p>
        ${e.threeGood.map((v, i) => i < 3
          ? `<input type="text" data-bind="evening.threeGood.${i}" value="${esc(v)}" placeholder="${i + 1}." aria-label="Tolles Ding ${i + 1}">`
          : `<div class="inrow"><input type="text" data-bind="evening.threeGood.${i}" value="${esc(v)}" placeholder="${i + 1}." aria-label="Tolles Ding ${i + 1}">
             <button type="button" class="iconbtn sm" data-remove="evening.threeGood" data-idx="${i}" aria-label="Eintrag entfernen">×</button></div>`).join("")}
        <button type="button" class="btn ghost sm" data-add="evening.threeGood" data-max="30">+ weiteres tolles Ding</button>
      </section>
      <section class="card">
        <h2>Programm heute</h2>
        <p class="hint">Abhaken, was ich heute getan habe.</p>
        ${chips("evening.programDone", texts("program"), e.programDone)}
      </section>

      <section class="card" id="sec-s10">
        <h2>Ist heute ein 10. Schritt notwendig?</h2>
        ${seg("evening.step10", e.step10)}
        ${e.step10 === false ? `
          <label class="lbl">Wofür bin ich heute besonders dankbar?</label>
          <input type="text" data-bind="evening.specialThanks" value="${esc(e.specialThanks)}">` : ""}
        ${e.step10 === true && t ? `
          <div class="step10">
            <label class="lbl">Was war los?</label>
            <textarea data-bind="evening.s10.what" rows="3">${esc(t.what)}</textarea>

            <label class="lbl">Gefühle</label>
            ${chips("evening.s10.feelings", texts("feelings"), t.feelings)}
            <input type="text" data-bind="evening.s10.feelingsOther" value="${esc(t.feelingsOther)}" placeholder="Anderes Gefühl">

            <label class="lbl">Charakterfehler</label>
            ${chips("evening.s10.defects", texts("defects"), t.defects)}
            <input type="text" data-bind="evening.s10.defectsOther" value="${esc(t.defectsOther)}" placeholder="Eigenes">

            <label class="lbl">Was habe ich daraus gelernt / was hätte ich anders machen können?</label>
            <textarea data-bind="evening.s10.learn" rows="2">${esc(t.learn)}</textarea>

            <label class="lbl">Was hat mich gehindert?</label>
            <input type="text" data-bind="evening.s10.hinder" value="${esc(t.hinder)}">

            <label class="lbl">Habe ich mit jemandem darüber gesprochen?</label>
            ${seg("evening.s10.talked", t.talked)}
            ${t.talked === true ? `<input type="text" data-bind="evening.s10.talkedWho" value="${esc(t.talkedWho)}" placeholder="Mit wem?">` : ""}
            ${t.talked === false ? `<input type="text" data-bind="evening.s10.talkedWhy" value="${esc(t.talkedWhy)}" placeholder="Warum nicht?">` : ""}

            <label class="lbl">Muss ich Wiedergutmachung leisten oder etwas klären?</label>
            ${seg("evening.s10.amend", t.amend)}
            ${t.amend === true ? `<input type="text" data-bind="evening.s10.amendWhat" value="${esc(t.amendWhat)}" placeholder="Was?">
              <label class="check"><input type="checkbox" data-bind="evening.s10.amendDone" ${t.amendDone ? "checked" : ""}> erledigt</label>` : ""}

            <label class="lbl">Habe ich einen Newcomer oder AA-Freund angerufen?</label>
            ${seg("evening.s10.newcomerCalled", t.newcomerCalled)}
            ${t.newcomerCalled === true ? `<input type="text" data-bind="evening.s10.newcomerName" value="${esc(t.newcomerName)}" placeholder="Name (optional)">` : ""}
          </div>` : ""}
      </section>

      <section class="card actions">
        <button type="button" class="btn primary wide" id="e-done">${e.done ? "✓ Abend abgeschlossen" : "Abend abschließen"}</button>
        <div class="btnrow">
          <button type="button" class="btn" id="e-share">Teilen</button>
          <button type="button" class="btn" id="e-copy">Kopieren</button>
        </div>
        <p class="hint center">Alles wird automatisch gespeichert.</p>
      </section>`;

    bindDay(view, date, day);
    const commit = () => Store.commitDay(date, day);
    $("#e-done").onclick = () => {
      if (e.threeGood.slice(0, 3).some((x) => !x.trim())) return focusMissing("#sec-good", "Bitte mindestens drei tolle Dinge eintragen.");
      if (e.step10 === null) return focusMissing("#sec-s10", "Bitte noch beantworten: Ist ein 10. Schritt notwendig?");
      if (!e.done) { e.done = true; e.doneAt = new Date().toISOString(); commit(); Store.saveNow(); toast("Abendroutine abgeschlossen. Gute Nacht."); rerender(); }
      else toast("Ist bereits abgeschlossen – Änderungen werden trotzdem gespeichert.");
    };
    $("#e-share").onclick = () => shareText(Store.formatDay(date, day, "evening"));
    $("#e-copy").onclick = () => copyText(Store.formatDay(date, day, "evening"));
  }

  // ---------- Verlauf ----------
  function renderHistory() {
    const st = S();
    const keys = Object.keys(st.days).filter((k) => !Store.isDayEmpty(st.days[k])).sort().reverse();
    const q = historyQuery.trim().toLowerCase();
    const shown = q ? keys.filter((k) => Store.formatDay(k, st.days[k]).toLowerCase().includes(q)) : keys;
    const today = Store.today();
    view.innerHTML = `
      <h1 class="screen-title">📖 Verlauf</h1>
      <section class="card">
        <input type="search" id="h-q" placeholder="Einträge durchsuchen …" value="${esc(historyQuery)}" aria-label="Suchen">
        <p class="hint">${keys.length} ${keys.length === 1 ? "Tag" : "Tage"} mit Einträgen${q ? ` · ${shown.length} Treffer` : ""}</p>
      </section>
      <ul class="daylist">
        ${shown.map((k) => {
          const d = st.days[k];
          const first = (d.morning.thankful.find((x) => x.trim()) || d.evening.threeGood.find((x) => x.trim()) || "").slice(0, 70);
          return `<li><a href="#/tag/${k}">
            <span class="dl-date">${D.pretty(k)}</span>
            <span class="dl-badges">
              <span class="pill ${d.morning.done ? "ok" : ""}">M</span>
              <span class="pill ${d.evening.done ? "ok" : ""}">A</span>
              ${d.evening.step10 === true ? `<span class="pill s10">10.</span>` : ""}
            </span>
            ${first ? `<span class="dl-snip">${esc(first)}</span>` : ""}
          </a></li>`;
        }).join("") || `<li class="empty">${q ? "Nichts gefunden." : "Noch keine Einträge."}</li>`}
      </ul>
      <section class="card">
        <h2>Zeitraum exportieren</h2>
        <div class="rowflex">
          <label class="grow"><span class="lbl">von</span><input type="date" id="ex-from" value="${D.add(today, -6)}"></label>
          <label class="grow"><span class="lbl">bis</span><input type="date" id="ex-to" value="${today}"></label>
        </div>
        <div class="btnrow">
          <button type="button" class="btn" id="ex-file">Als Textdatei</button>
          <button type="button" class="btn" id="ex-share">Teilen</button>
        </div>
      </section>`;
    const qi = $("#h-q");
    qi.oninput = () => { historyQuery = qi.value; const pos = qi.selectionStart; renderHistory(); const n = $("#h-q"); n.focus(); n.setSelectionRange(pos, pos); };
    const rangeText = () => {
      const from = $("#ex-from").value, to = $("#ex-to").value;
      const ks = Object.keys(st.days).filter((k) => k >= from && k <= to && !Store.isDayEmpty(st.days[k])).sort();
      if (!ks.length) { toast("Keine Einträge in diesem Zeitraum."); return null; }
      return { text: ks.map((k) => Store.formatDay(k, st.days[k])).join("\n\n────────\n\n"), from, to };
    };
    $("#ex-file").onclick = () => { const r = rangeText(); if (r) downloadFile(`AA-Reflex_${r.from}_bis_${r.to}.txt`, r.text, "text/plain;charset=utf-8"); };
    $("#ex-share").onclick = () => { const r = rangeText(); if (r) shareText(r.text); };
  }

  function renderDayDetail(date) {
    const day = D.valid(date) && Store.getDay(date);
    if (!day) { location.hash = "#/verlauf"; return; }
    const mt = Store.formatMorning(day), et = Store.formatEvening(day);
    view.innerHTML = `
      <div class="datebar"><a class="iconbtn" href="#/verlauf" aria-label="Zurück">‹</a>
        <div class="dateinfo"><strong>${D.pretty(date)}</strong><span>${day.morning.done ? "Morgen ✓" : "Morgen offen"} · ${day.evening.done ? "Abend ✓" : "Abend offen"}</span></div><span></span></div>
      <section class="card"><pre class="daytext">${esc(mt.split("\n").length > 1 ? mt : "🌅 Morgen – keine Einträge")}</pre>
        <a class="btn sm" href="#/morgen/${date}">Morgen bearbeiten</a></section>
      <section class="card"><pre class="daytext">${esc(et || "🌙 Abend – keine Einträge")}</pre>
        <a class="btn sm" href="#/abend/${date}">Abend bearbeiten</a></section>
      <section class="card actions">
        <div class="btnrow">
          <button type="button" class="btn" id="d-share">Teilen</button>
          <button type="button" class="btn" id="d-file">Als Textdatei</button>
          <button type="button" class="btn danger-ghost" id="d-del">Tag löschen</button>
        </div>
      </section>`;
    $("#d-share").onclick = () => shareText(Store.formatDay(date, day));
    $("#d-file").onclick = () => downloadFile(`AA-Reflex_${date}.txt`, Store.formatDay(date, day), "text/plain;charset=utf-8");
    $("#d-del").onclick = async () => {
      if (await dialog({ title: "Tag löschen?", text: `Alle Einträge vom ${D.pretty(date)} werden entfernt.`, okLabel: "Löschen", danger: true })) {
        Store.deleteDay(date); await Store.saveNow(); toast("Tag gelöscht."); location.hash = "#/verlauf";
      }
    };
  }

  // ---------- Rückblick ----------
  function bars(entries, n, unitText) {
    if (!entries.length) return `<p class="hint">Noch keine Angaben in diesem Zeitraum.</p>`;
    const max = entries[0][1];
    const row = ([label, c]) => `<li><span class="b-label">${esc(label)}</span>
      <span class="b-track" aria-hidden="true"><span class="b-fill" style="width:${Math.max(4, Math.round((c / max) * 100))}%"></span></span>
      <span class="b-val">${c}×</span></li>`;
    const top = entries.slice(0, 8), rest = entries.slice(8);
    return `<ul class="bars" aria-label="${esc(unitText)}">${top.map(row).join("")}</ul>` +
      (rest.length ? `<details><summary>${rest.length} weitere</summary><ul class="bars">${rest.map(row).join("")}</ul></details>` : "");
  }
  function sobrietyCard(big) {
    const sob = Store.sobriety();
    if (!sob) return `<section class="card"><h2>Nüchternheit</h2>
        <p class="hint">Trag dein Nüchternheitsdatum ein, dann zählt die App mit.</p>
        <label class="lbl" for="sob-in">Nüchtern seit</label><input type="date" id="sob-in" max="${D.fromDate(new Date())}"></section>`;
    const parts = [];
    if (sob.y) parts.push(`${sob.y} ${sob.y === 1 ? "Jahr" : "Jahre"}`);
    if (sob.m) parts.push(`${sob.m} ${sob.m === 1 ? "Monat" : "Monate"}`);
    parts.push(`${sob.d} ${sob.d === 1 ? "Tag" : "Tage"}`);
    const last = sob.reached[sob.reached.length - 1];
    return `<section class="card sober">
      <h2>Nüchternheit</h2>
      <div class="hero"><span class="hero-num">${sob.days.toLocaleString("de-DE")}</span><span class="hero-unit">Tage</span></div>
      <p class="sub">${parts.join(", ")} · seit ${D.pretty(sob.since)}</p>
      ${sob.next ? `<p>Nächster Meilenstein: <strong>${sob.next.label}</strong> am ${D.pretty(sob.next.date)} – noch ${sob.nextIn} ${sob.nextIn === 1 ? "Tag" : "Tage"}.</p>` : ""}
      ${big && last ? `<p class="hint">Zuletzt erreicht: ${last.label} am ${D.pretty(last.date)}</p>` : ""}
    </section>`;
  }
  function bindSobriety() {
    const i = $("#sob-in");
    if (i) i.onchange = () => { if (D.valid(i.value)) { S().settings.soberDate = i.value; Store.saveNow().then(rerender); } };
  }
  function renderReview() {
    const a = Store.analyze(rangeSel);
    const opts = [[30, "30 Tage"], [90, "90 Tage"], [365, "1 Jahr"], [0, "Alles"]];
    const openAmends = a.amends.filter((x) => !x.done), doneAmends = a.amends.filter((x) => x.done);
    const amendRow = (x) => `<li><label class="check"><input type="checkbox" data-amend="${x.date}" ${x.done ? "checked" : ""}>
        <span><strong>${D.short(x.date)}</strong> ${esc(x.text || "(ohne Beschreibung)")}</span></label></li>`;
    view.innerHTML = `
      <h1 class="screen-title">📊 Rückblick</h1>
      ${sobrietyCard(true)}
      <div class="seg wide" role="group" aria-label="Zeitraum">
        ${opts.map(([v, l]) => `<button type="button" class="${rangeSel === v ? "on" : ""}" data-range="${v}">${l}</button>`).join("")}
      </div>
      <section class="card">
        <h2>Konstanz</h2>
        <div class="tiles">
          <div class="tile"><span class="t-num">${a.active}</span><span class="t-lbl">Tage mit Einträgen${a.span ? ` von ${a.span}` : ""}</span></div>
          <div class="tile"><span class="t-num">${Store.streak()}</span><span class="t-lbl">Tage in Folge</span></div>
          <div class="tile"><span class="t-num">${a.mDone}</span><span class="t-lbl">Morgen abgeschlossen</span></div>
          <div class="tile"><span class="t-num">${a.eDone}</span><span class="t-lbl">Abend abgeschlossen</span></div>
        </div>
      </section>
      <section class="card">
        <h2>10. Schritt</h2>
        <p>An <strong>${a.s10}</strong> ${a.s10 === 1 ? "Tag" : "Tagen"} gemacht.
          ${a.talkedYes + a.talkedNo ? `Darüber gesprochen: ${a.talkedYes} von ${a.talkedYes + a.talkedNo}.` : ""}
          ${a.s10 ? `Newcomer/AA-Freund angerufen: ${a.newcomerYes}×.` : ""}</p>
        <h3>Gefühle</h3>${bars(a.feelings, a.s10, "Gefühle")}
        <h3>Charakterfehler</h3>${bars(a.defects, a.s10, "Charakterfehler")}
      </section>
      <section class="card">
        <h2>Offene Klärungen & Wiedergutmachungen</h2>
        ${openAmends.length ? `<ul class="amends">${openAmends.map(amendRow).join("")}</ul>` : `<p class="hint">Nichts offen.</p>`}
        ${doneAmends.length ? `<details><summary>${doneAmends.length} erledigt</summary><ul class="amends">${doneAmends.map(amendRow).join("")}</ul></details>` : ""}
      </section>
      <section class="card">
        <h2>Programm</h2>${bars(a.program, a.active, "Programm")}
      </section>`;
    bindSobriety();
    $$("[data-range]").forEach((b) => b.onclick = () => { rangeSel = Number(b.dataset.range); rerender(); });
    $$("[data-amend]").forEach((c) => c.onchange = () => {
      const d = Store.getDay(c.dataset.amend);
      if (d && d.evening.s10) { d.evening.s10.amendDone = c.checked; Store.commitDay(c.dataset.amend, d); rerender(); }
    });
  }

  // ---------- Mehr ----------
  async function createBackup() {
    const text = Store.backupPayload();
    const name = `AA-Reflex-Backup_${D.fromDate(new Date())}.json`;
    const done = () => { S().meta.lastBackupAt = new Date().toISOString(); Store.saveNow(); toast("Backup erstellt."); if (parseHash().name === "mehr" || parseHash().name === "morgen" || !parseHash().name) rerender(); };
    try {
      const file = new File([text], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "AA-Reflex Backup" });
        return done();
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    downloadFile(name, text, "application/json");
    done();
  }
  async function importBackup(file) {
    let res;
    try { res = Store.parseImport(await file.text()); }
    catch (e) { return dialog({ title: "Import nicht möglich", text: e.message, cancelLabel: "" }); }
    if (res.kind === "v2") {
      const n = Object.keys(res.state.days).length;
      const ok = await dialog({ title: "Backup einspielen?", text: `Das Backup enthält ${n} Tage. Alle aktuellen Daten auf diesem Gerät werden dadurch ersetzt.`, okLabel: "Ersetzen", danger: true });
      if (!ok) return;
      // Bibliothek: Dateien liegen nur auf diesem Gerät – vorhandene Einträge behalten, fehlende ergänzen
      const here = S().library;
      const lib = here.slice();
      (res.state.library || []).forEach((b) => { if (!lib.some((x) => x.id === b.id)) lib.push(b); });
      res.state.library = lib;
      await Store.replaceState(res.state);
      applyTheme();
      toast("Backup eingespielt.");
    } else {
      const n = Object.keys(res.days).length;
      const ok = await dialog({ title: "Daten aus Version 1 übernehmen?", text: `Gefunden: ${n} ${n === 1 ? "Tag" : "Tage"}. Sie werden ergänzt; Tage, die hier schon Einträge haben, bleiben unverändert.`, okLabel: "Übernehmen" });
      if (!ok) return;
      const r = Store.mergeV1(res.days, res.v1);
      toast(`${r.added} ${r.added === 1 ? "Tag" : "Tage"} übernommen${r.skipped ? `, ${r.skipped} übersprungen` : ""}.`);
    }
    rerender();
  }

  async function renderMore() {
    const st = S();
    const last = st.meta.lastBackupAt;
    view.innerHTML = `
      <h1 class="screen-title">⚙️ Mehr</h1>
      <section class="card">
        <h2>Lesen</h2>
        <div class="bigbtns">
          <a class="bigbtn" href="#/gebete"><span aria-hidden="true">🙏</span><strong>Gebete</strong><small>${st.content.prayers.length} gespeichert</small></a>
          <a class="bigbtn" href="#/literatur"><span aria-hidden="true">📚</span><strong>Literatur</strong><small>${st.library.length} ${st.library.length === 1 ? "Buch" : "Bücher"}</small></a>
        </div>
      </section>
      <section class="card">
        <h2>Nüchternheit</h2>
        <label class="lbl" for="set-sober">Nüchtern seit</label>
        <input type="date" id="set-sober" value="${esc(st.settings.soberDate || "")}" max="${D.fromDate(new Date())}">
      </section>

      <section class="card">
        <h2>Backup</h2>
        <p>${last ? `Letztes Backup: ${D.pretty(D.fromDate(new Date(last)))}` : "Noch kein Backup angelegt."}</p>
        <p class="hint">Das Backup ist eine Datei mit allen Einträgen, Inhalten und Gebeten (die PDF-Bücher der Literatur sind nicht enthalten). Über „Teilen“ kannst du sie z. B. in Google Drive oder per Mail sichern. „Einspielen“ nimmt auch Daten aus Version 1 an.</p>
        <div class="btnrow">
          <button type="button" class="btn primary" id="b-make">Backup erstellen</button>
          <button type="button" class="btn" id="b-load">Backup einspielen</button>
          <input type="file" id="b-file" accept=".json,application/json,text/plain" hidden>
        </div>
        <p class="hint" id="persist-info"></p>
      </section>

      <section class="card">
        <h2>Inhalte pflegen</h2>
        <ul class="linklist">
          ${Object.entries(LISTS).map(([k, v]) => `<li><a href="#/inhalte/${k}">${esc(v.title)} <span class="muted">${st.content[k].length}</span></a></li>`).join("")}
          <li><a href="#/favoriten">★ Favoriten <span class="muted">${st.content.affirmations.filter((a) => a.fav).length + st.content.quotes.filter((a) => a.fav).length}</span></a></li>
        </ul>
      </section>

      <section class="card">
        <h2>Einstellungen</h2>
        <label class="lbl" for="set-name">Name (optional)</label>
        <input type="text" id="set-name" value="${esc(st.settings.name)}">
        <label class="lbl" for="set-daystart">Neuer Tag beginnt um</label>
        <select id="set-daystart">${[0, 1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}" ${st.settings.dayStartHour === h ? "selected" : ""}>${h}:00 Uhr</option>`).join("")}</select>
        <p class="hint">Einträge nach Mitternacht zählen bis zu dieser Uhrzeit noch zum Vortag.</p>
        <label class="lbl" for="set-remind">Backup-Erinnerung</label>
        <select id="set-remind">${[[0, "aus"], [3, "nach 3 Tagen"], [7, "nach 7 Tagen"], [14, "nach 14 Tagen"], [30, "nach 30 Tagen"]].map(([v, l]) => `<option value="${v}" ${st.settings.backupReminderDays === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label class="lbl" for="set-theme">Darstellung</label>
        <select id="set-theme">${[["dark", "Dunkel"], ["light", "Hell"], ["system", "wie das Handy"]].map(([v, l]) => `<option value="${v}" ${st.settings.theme === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      </section>

      <section class="card">
        <h2>Daten</h2>
        <p class="hint">Alle Einträge liegen nur auf diesem Gerät. Nichts wird an einen Server geschickt.</p>
        <button type="button" class="btn danger-ghost" id="wipe">Alle Daten löschen</button>
      </section>
      <p class="hint center">AA-Reflex ${APP_VERSION}</p>`;

    const s = st.settings;
    $("#set-sober").onchange = (e) => { s.soberDate = D.valid(e.target.value) ? e.target.value : null; Store.saveNow(); };
    $("#set-name").oninput = (e) => { s.name = e.target.value; Store.scheduleSave(); };
    $("#set-daystart").onchange = (e) => { s.dayStartHour = Number(e.target.value); Store.saveNow(); };
    $("#set-remind").onchange = (e) => { s.backupReminderDays = Number(e.target.value); Store.saveNow(); };
    $("#set-theme").onchange = (e) => { s.theme = e.target.value; applyTheme(); Store.saveNow(); };
    $("#b-make").onclick = createBackup;
    $("#b-load").onclick = () => $("#b-file").click();
    $("#b-file").onchange = (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ""; };
    $("#wipe").onclick = async () => {
      const a = await dialog({ title: "Wirklich alle Daten löschen?", text: "Alle Einträge, Einstellungen und eigenen Inhalte werden von diesem Gerät entfernt. Lege vorher ein Backup an.", okLabel: "Weiter", danger: true });
      if (!a) return;
      const word = await dialog({ title: "Zur Sicherheit", text: "Tippe LÖSCHEN ein, um zu bestätigen.", input: { label: "" }, okLabel: "Endgültig löschen", danger: true });
      if (word && word.trim().toUpperCase() === "LÖSCHEN") {
        await Store.replaceState(window.AA.initState());
        applyTheme(); toast("Alle Daten gelöscht."); location.hash = "#/morgen";
      } else if (word !== null) toast("Nicht gelöscht.");
    };
    const persisted = await Store.isPersisted();
    const pi = $("#persist-info");
    if (pi) pi.textContent = persisted ? "Speicher ist dauerhaft geschützt (wird vom Browser nicht automatisch geleert)." : "Hinweis: Der Browser hat den Speicher noch nicht als dauerhaft markiert. Als installierte App passiert das meist automatisch – regelmäßige Backups sind trotzdem wichtig.";
  }

  // ---------- Inhalte bearbeiten ----------
  function renderContentEditor(key) {
    const meta = LISTS[key];
    if (!meta) { location.hash = "#/mehr"; return; }
    const list = S().content[key];
    const save = () => Store.scheduleSave();
    let body;
    if (!meta.grouped) {
      body = `<ul class="editlist">${list.map((it, i) => `<li>
          <input type="text" data-edit="${it.id}" value="${esc(it.text)}" aria-label="Eintrag ${i + 1}">
          <button type="button" class="iconbtn sm" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="nach oben">↑</button>
          <button type="button" class="iconbtn sm" data-del="${it.id}" aria-label="löschen">×</button></li>`).join("")}</ul>
        <button type="button" class="btn ghost sm" data-new="">+ Eintrag</button>`;
    } else {
      const cats = [...new Set(list.map((x) => x.cat))];
      body = cats.map((c) => `<div class="catgroup">
          <input type="text" class="catname" data-cat="${esc(c)}" value="${esc(c)}" aria-label="Kategorie umbenennen">
          <ul class="editlist">${list.filter((x) => x.cat === c).map((it) => `<li>
            <input type="text" data-edit="${it.id}" value="${esc(it.text)}">
            <button type="button" class="iconbtn sm star ${it.fav ? "on" : ""}" data-fav="${it.id}" aria-label="Favorit">${it.fav ? "★" : "☆"}</button>
            <button type="button" class="iconbtn sm" data-del="${it.id}" aria-label="löschen">×</button></li>`).join("")}</ul>
          <button type="button" class="btn ghost sm" data-new="${esc(c)}">+ Eintrag</button></div>`).join("") +
        `<button type="button" class="btn sm" id="new-cat">+ Neue Kategorie</button>`;
    }
    view.innerHTML = `
      <div class="datebar"><a class="iconbtn" href="#/mehr" aria-label="Zurück">‹</a><div class="dateinfo"><strong>${esc(meta.title)}</strong><span>${list.length} Einträge</span></div><span></span></div>
      <section class="card">${body}</section>
      <section class="card"><p class="hint">Änderungen wirken sofort. Frühere Tagebuch-Einträge bleiben unverändert.</p>
        <button type="button" class="btn danger-ghost sm" id="reset-list">Auf Standard zurücksetzen</button></section>`;

    $$("[data-edit]").forEach((el) => el.oninput = () => { list.find((x) => x.id === el.dataset.edit).text = el.value; save(); });
    $$("[data-del]").forEach((el) => el.onclick = () => {
      const i = list.findIndex((x) => x.id === el.dataset.del);
      const [removed] = list.splice(i, 1); save(); rerender();
      toast("Eintrag gelöscht.", { action: "Rückgängig", onAction: () => { list.splice(i, 0, removed); save(); rerender(); } });
    });
    $$("[data-up]").forEach((el) => el.onclick = () => { const i = Number(el.dataset.up); [list[i - 1], list[i]] = [list[i], list[i - 1]]; save(); rerender(); });
    $$("[data-fav]").forEach((el) => el.onclick = () => { const it = list.find((x) => x.id === el.dataset.fav); it.fav = !it.fav; save(); rerender(); });
    $$("[data-new]").forEach((el) => el.onclick = () => {
      const item = meta.grouped ? { id: uid(), cat: el.dataset.new, text: "", fav: false } : { id: uid(), text: "" };
      if (meta.grouped) { const last = list.map((x) => x.cat).lastIndexOf(el.dataset.new); list.splice(last + 1, 0, item); } else list.push(item);
      save(); rerender(); const inp = $(`[data-edit="${item.id}"]`); inp && inp.focus();
    });
    $$("[data-cat]").forEach((el) => el.onchange = () => {
      const nv = el.value.trim(); if (!nv) { el.value = el.dataset.cat; return; }
      list.forEach((x) => { if (x.cat === el.dataset.cat) x.cat = nv; }); save(); rerender();
    });
    const nc = $("#new-cat");
    if (nc) nc.onclick = async () => {
      const name = await dialog({ title: "Neue Kategorie", input: { label: "Name" }, okLabel: "Anlegen" });
      if (name && name.trim()) { const item = { id: uid(), cat: name.trim(), text: "", fav: false }; list.push(item); save(); rerender(); const inp = $(`[data-edit="${item.id}"]`); inp && inp.focus(); }
    };
    $("#reset-list").onclick = async () => {
      if (await dialog({ title: "Auf Standard zurücksetzen?", text: `„${meta.title}“ wird durch die ursprüngliche Liste ersetzt. Eigene Einträge dieser Liste gehen verloren.`, okLabel: "Zurücksetzen", danger: true })) {
        S().content[key] = contentFromDefaults(window.AA_DEFAULTS)[key]; Store.saveNow(); rerender();
      }
    };
  }

  function renderFavorites() {
    const c = S().content;
    const block = (arr, kind) => arr.filter((x) => x.fav).map((x) => `<li><span>${esc(x.text)}</span>
      <button type="button" class="iconbtn sm star on" data-unfav="${kind}:${x.id}" aria-label="Favorit entfernen">★</button></li>`).join("") || `<li class="empty">Noch keine Favoriten.</li>`;
    view.innerHTML = `
      <div class="datebar"><a class="iconbtn" href="#/mehr" aria-label="Zurück">‹</a><div class="dateinfo"><strong>★ Favoriten</strong><span>Stern antippen zum Entfernen</span></div><span></span></div>
      <section class="card"><h2>Kraftsätze</h2><ul class="favlist">${block(c.affirmations, "affirmations")}</ul></section>
      <section class="card"><h2>Sprüche</h2><ul class="favlist">${block(c.quotes, "quotes")}</ul></section>`;
    $$("[data-unfav]").forEach((b) => b.onclick = () => {
      const [k, id] = b.dataset.unfav.split(":"); const it = c[k].find((x) => x.id === id); if (it) it.fav = false; Store.scheduleSave(); rerender();
    });
  }

  // ---------- Service Worker / Updates ----------
  function registerSW() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const offer = (w) => toast("Neue Version verfügbar.", { action: "Aktualisieren", ms: 20000, onAction: () => w.postMessage("skipWaiting") });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
      });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  window.AAUI = { $, $$, esc, toast, dialog, shareText, rerender, setCleanup: (fn) => { cleanup = fn; }, parseHash };

  // ---------- Start ----------
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") Store.saveNow(); });
  window.addEventListener("pagehide", () => Store.saveNow());

  Store.load().then(() => {
    applyTheme();
    route();
    Store.requestPersist();
    registerSW();
    // Um Mitternacht / Tageswechsel: bei Rückkehr in die App auf den neuen Tag springen
    let lastToday = Store.today();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Store.today() !== lastToday) { lastToday = Store.today(); if (!parseHash().arg) route(); }
    });
  });
})();
