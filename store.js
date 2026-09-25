// AA-Reflex V2 – Datenmodell, Speicher, Backup, V1-Import, Auswertungen.
// Keine Oberfläche in dieser Datei.
(function () {
  "use strict";
  const SCHEMA = 2;
  const LS_KEY = "aa_reflex_v2";
  const DB_NAME = "aa-reflex";
  const DB_STORE = "kv";

  // ---------- Hilfen ----------
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // Datums-Strings "YYYY-MM-DD" (lokale Kalendertage). Rechnen über UTC,
  // damit Sommer-/Winterzeit keine 23-/25-Stunden-Tage erzeugt.
  const D = {
    fromDate(d) {
      const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
      return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    },
    toUTC(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); },
    add(s, n) {
      const t = new Date(D.toUTC(s) + n * 86400000);
      return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    },
    diff(a, b) { return Math.round((D.toUTC(b) - D.toUTC(a)) / 86400000); }, // b - a in Tagen
    valid(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); },
    // „Logischer" Tag: vor dem Tageswechsel (z. B. 4 Uhr) zählt noch der Vortag.
    logicalToday(dayStartHour, now = new Date()) {
      const shifted = new Date(now.getTime() - (dayStartHour || 0) * 3600000);
      return D.fromDate(shifted);
    },
    weekday(s) { return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(D.toUTC(s)).getUTCDay()]; },
    pretty(s) { const [y, m, d] = s.split("-"); return `${D.weekday(s)}, ${d}.${m}.${y}`; },
    short(s) { const [, m, d] = s.split("-"); return `${d}.${m}.`; }
  };

  // ---------- Inhalte ----------
  function contentFromDefaults(src) {
    const simple = (arr) => arr.map((text) => ({ id: uid(), text }));
    const grouped = (obj) => {
      const out = [];
      for (const [cat, items] of Object.entries(obj)) for (const text of items) out.push({ id: uid(), cat, text, fav: false });
      return out;
    };
    return {
      ninePoints: simple(src.ninePoints),
      selfcareChips: simple(src.selfcareChips),
      feelings: simple(src.feelings),
      defects: simple(src.defects),
      program: simple(src.program),
      affirmations: grouped(src.affirmations),
      quotes: grouped(src.quotes)
    };
  }
  const LISTS = {
    ninePoints: { title: "Tagesfokus – Nur für heute", grouped: false },
    selfcareChips: { title: "Selbstfürsorge – Schnellauswahl", grouped: false },
    affirmations: { title: "Kraftsätze", grouped: true },
    quotes: { title: "Sprüche", grouped: true },
    feelings: { title: "10. Schritt – Gefühle", grouped: false },
    defects: { title: "10. Schritt – Charakterfehler", grouped: false },
    program: { title: "Programm-Check", grouped: false }
  };

  // ---------- Zustand ----------
  function initState() {
    return {
      schema: SCHEMA,
      createdAt: new Date().toISOString(),
      savedAt: null,
      settings: { name: "", soberDate: null, dayStartHour: 4, backupReminderDays: 7, theme: "dark" },
      content: contentFromDefaults(window.AA_DEFAULTS),
      quoteQueue: [],
      quoteOfDay: null, // { date, id }
      days: {},
      meta: { lastBackupAt: null, v1ImportedAt: null }
    };
  }

  function newDay() {
    return {
      morning: { thankful: [""], selfcare: [""], selfcareChips: [], focus: [], focusNote: "", affirmation: null, quote: null, done: false, doneAt: null },
      evening: { goodForSomeone: "", learned: "", threeGood: ["", "", ""], programDone: [], step10: null, specialThanks: "", s10: null, done: false, doneAt: null },
      updatedAt: null
    };
  }
  function newStep10() {
    return { what: "", feelings: [], feelingsOther: "", defects: [], defectsOther: "", learn: "", hinder: "",
      talked: null, talkedWho: "", talkedWhy: "", amend: null, amendWhat: "", amendDone: false,
      newcomerCalled: null, newcomerName: "" };
  }

  // Fehlende Felder ergänzen (z. B. nach Import älterer Backups)
  function normalize(st) {
    const base = initState();
    const out = Object.assign(base, st);
    out.settings = Object.assign(initState().settings, st.settings || {});
    out.meta = Object.assign(initState().meta, st.meta || {});
    out.content = Object.assign(contentFromDefaults(window.AA_DEFAULTS), st.content || {});
    out.days = out.days || {};
    for (const k of Object.keys(out.days)) {
      const t = newDay(), d = out.days[k];
      d.morning = Object.assign(t.morning, d.morning || {});
      d.evening = Object.assign(t.evening, d.evening || {});
      if (d.evening.s10) d.evening.s10 = Object.assign(newStep10(), d.evening.s10);
    }
    out.schema = SCHEMA;
    return out;
  }

  // ---------- Speicher: IndexedDB + Spiegel in localStorage ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no idb"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }

  const Store = {
    state: null,
    _timer: null,
    _listeners: [],
    onSaved(fn) { this._listeners.push(fn); },

    async load() {
      let fromIdb = null, fromLs = null;
      try { fromIdb = await idbGet("state"); } catch (e) { /* ignorieren */ }
      try { const raw = localStorage.getItem(LS_KEY); if (raw) fromLs = JSON.parse(raw); } catch (e) { /* ignorieren */ }
      let st = fromIdb;
      if (fromLs && (!st || (fromLs.savedAt || "") > (st.savedAt || ""))) st = fromLs;
      this.state = st ? normalize(st) : initState();
      return this.state;
    },
    scheduleSave() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.saveNow(), 300);
    },
    async saveNow() {
      clearTimeout(this._timer); this._timer = null;
      const st = this.state;
      st.savedAt = new Date().toISOString();
      let ok = false;
      try { await idbSet("state", st); ok = true; } catch (e) { /* Fallback unten */ }
      try { localStorage.setItem(LS_KEY, JSON.stringify(st)); ok = true; } catch (e) { /* ignorieren */ }
      this._listeners.forEach((fn) => fn(ok));
      return ok;
    },
    async requestPersist() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          if (await navigator.storage.persisted()) return true;
          return await navigator.storage.persist();
        }
      } catch (e) { /* ignorieren */ }
      return false;
    },
    async isPersisted() {
      try { return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); }
      catch (e) { return false; }
    },

    // ---------- Tage ----------
    today() { return D.logicalToday(this.state.settings.dayStartHour); },
    getDay(date) { return this.state.days[date] || null; },
    // Liefert den Tag; legt ihn erst beim ersten Schreiben an (keine leeren Tage).
    draftDay(date) { return this.state.days[date] || newDay(); },
    commitDay(date, day) {
      if (!this.state.days[date]) {
        this.state.days[date] = day;
        if (!day.morning.quote) {
          const q = this.quoteForDate(date, false);
          if (q) day.morning.quote = { cat: q.cat, text: q.text };
        }
      }
      day.updatedAt = new Date().toISOString();
      this.scheduleSave();
    },
    isDayEmpty(day) {
      if (!day) return true;
      const m = day.morning, e = day.evening;
      const any = (a) => (a || []).some((x) => String(x).trim());
      return !(any(m.thankful) || any(m.selfcare) || m.selfcareChips.length || m.focus.length || m.focusNote.trim() || m.affirmation ||
        e.goodForSomeone.trim() || e.learned.trim() || any(e.threeGood) || e.programDone.length || e.step10 !== null || m.done || e.done);
    },
    deleteDay(date) { delete this.state.days[date]; this.scheduleSave(); },

    // ---------- Spruch des Tages (ohne Wiederholung, bis alle durch sind) ----------
    _nextQuoteId() {
      const ids = new Set(this.state.content.quotes.map((q) => q.id));
      this.state.quoteQueue = this.state.quoteQueue.filter((id) => ids.has(id));
      if (!this.state.quoteQueue.length) {
        const arr = [...ids];
        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
        this.state.quoteQueue = arr;
      }
      return this.state.quoteQueue.shift() || null;
    },
    quoteForDate(date, forceNew) {
      const qd = this.state.quoteOfDay;
      const find = (id) => this.state.content.quotes.find((q) => q.id === id);
      if (!forceNew && qd && qd.date === date && find(qd.id)) return find(qd.id);
      const id = this._nextQuoteId();
      if (!id) return null;
      this.state.quoteOfDay = { date, id };
      this.scheduleSave();
      return find(id);
    },

    // ---------- Serie ----------
    isDayDone(day) { return !!(day && (day.morning.done || day.evening.done)); },
    streak() {
      const today = this.today();
      let d = this.isDayDone(this.getDay(today)) ? today : D.add(today, -1);
      let n = 0;
      while (this.isDayDone(this.getDay(d))) { n++; d = D.add(d, -1); }
      return n;
    },

    // ---------- Nüchternheit ----------
    sobriety() {
      const s = this.state.settings.soberDate;
      if (!D.valid(s)) return null;
      const today = D.fromDate(new Date());
      const days = D.diff(s, today);
      if (days < 0) return null;
      // Jahre/Monate/Tage
      const [sy, sm, sd] = s.split("-").map(Number);
      const [ty, tm, td] = today.split("-").map(Number);
      let y = ty - sy, m = tm - sm, dd = td - sd;
      if (dd < 0) { m--; dd += new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate(); }
      if (m < 0) { y--; m += 12; }
      const addMonths = (n) => {
        const t = new Date(Date.UTC(sy, sm - 1 + n, sd));
        return D.fromDate(new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
      };
      const ms = [
        { label: "24 Stunden", date: D.add(s, 1) }, { label: "30 Tage", date: D.add(s, 30) },
        { label: "60 Tage", date: D.add(s, 60) }, { label: "90 Tage", date: D.add(s, 90) },
        { label: "6 Monate", date: addMonths(6) }, { label: "9 Monate", date: addMonths(9) },
        { label: "1 Jahr", date: addMonths(12) }, { label: "18 Monate", date: addMonths(18) }
      ];
      for (let i = 2; i <= Math.max(y + 2, 2); i++) ms.push({ label: `${i} Jahre`, date: addMonths(12 * i) });
      const reached = ms.filter((x) => x.date <= today);
      const next = ms.find((x) => x.date > today) || null;
      return { since: s, days, y, m, d: dd, reached, next, nextIn: next ? D.diff(today, next.date) : null };
    },

    // ---------- Auswertung ----------
    daysInRange(fromDate) {
      return Object.keys(this.state.days).filter((k) => !fromDate || k >= fromDate).sort();
    },
    analyze(rangeDays) {
      const today = this.today();
      const from = rangeDays ? D.add(today, -(rangeDays - 1)) : null;
      const keys = this.daysInRange(from).filter((k) => k <= today);
      const count = (map, k) => { map[k] = (map[k] || 0) + 1; };
      const feelings = {}, defects = {}, program = {};
      let s10 = 0, talkedYes = 0, talkedNo = 0, newcomerYes = 0, mDone = 0, eDone = 0, active = 0;
      const amends = [];
      for (const k of keys) {
        const day = this.state.days[k];
        if (this.isDayEmpty(day)) continue;
        active++;
        if (day.morning.done) mDone++;
        if (day.evening.done) eDone++;
        day.evening.programDone.forEach((p) => count(program, p));
        if (day.evening.step10 === true && day.evening.s10) {
          const t = day.evening.s10; s10++;
          t.feelings.forEach((f) => count(feelings, f));
          t.defects.forEach((f) => count(defects, f));
          if (t.talked === true) talkedYes++; else if (t.talked === false) talkedNo++;
          if (t.newcomerCalled === true) newcomerYes++;
          if (t.amend === true) amends.push({ date: k, text: t.amendWhat, done: !!t.amendDone });
        }
      }
      const sorted = (m) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return { from, to: today, span: from ? D.diff(from, today) + 1 : null, active, mDone, eDone, s10, talkedYes, talkedNo, newcomerYes,
        feelings: sorted(feelings), defects: sorted(defects), program: sorted(program), amends: amends.reverse() };
    },

    // ---------- Texte für Teilen/Export ----------
    formatMorning(day) {
      const m = day.morning;
      const clean = (a) => (a || []).map((x) => String(x).trim()).filter(Boolean);
      const self = clean(m.selfcare).concat(m.selfcareChips);
      return [
        "🌅 Morgen",
        clean(m.thankful).length ? `Dankbar: ${clean(m.thankful).join(" / ")}` : "",
        self.length ? `Für einen guten Tag: ${self.join(" / ")}` : "",
        m.focus.length ? `Tagesfokus: ${m.focus.join(" | ")}` : "",
        m.focusNote.trim() ? `Mini-Absicht: ${m.focusNote.trim()}` : "",
        m.affirmation ? `Kraftsatz: „${m.affirmation.text}“` : "",
        m.quote ? `Spruch des Tages: „${m.quote.text}“` : ""
      ].filter(Boolean).join("\n");
    },
    formatEvening(day) {
      const e = day.evening;
      const out = ["🌙 Abend"];
      if (e.goodForSomeone.trim()) out.push(`Gutes getan: ${e.goodForSomeone.trim()}`);
      if (e.learned.trim()) out.push(`Heute gelernt: ${e.learned.trim()}`);
      const g = e.threeGood.map((x) => x.trim()).filter(Boolean);
      if (g.length) out.push(`Drei tolle Dinge: ${g.join(" / ")}`);
      if (e.programDone.length) out.push(`Programm heute: ${e.programDone.join(", ")}`);
      if (e.step10 === true && e.s10) {
        const d = e.s10;
        out.push("— 10. Schritt —");
        if (d.what.trim()) out.push(`Was war los: ${d.what.trim()}`);
        const f = d.feelings.concat(d.feelingsOther.trim() ? [d.feelingsOther.trim()] : []);
        if (f.length) out.push(`Gefühle: ${f.join(", ")}`);
        const c = d.defects.concat(d.defectsOther.trim() ? [d.defectsOther.trim()] : []);
        if (c.length) out.push(`Charakterfehler: ${c.join(", ")}`);
        if (d.learn.trim()) out.push(`Gelernt / anders machen: ${d.learn.trim()}`);
        if (d.hinder.trim()) out.push(`Was hat mich gehindert: ${d.hinder.trim()}`);
        if (d.talked !== null) out.push(`Darüber gesprochen: ${d.talked ? "Ja" + (d.talkedWho ? " – " + d.talkedWho : "") : "Nein" + (d.talkedWhy ? " – " + d.talkedWhy : "")}`);
        if (d.amend !== null) out.push(`Wiedergutmachung/Klärung: ${d.amend ? "Ja" + (d.amendWhat ? " – " + d.amendWhat : "") + (d.amendDone ? " (erledigt)" : "") : "Nein"}`);
        if (d.newcomerCalled !== null) out.push(`Newcomer/AA-Freund angerufen: ${d.newcomerCalled ? "Ja" + (d.newcomerName ? " – " + d.newcomerName : "") : "Nein"}`);
      } else if (e.step10 === false && e.specialThanks.trim()) {
        out.push(`Besonders dankbar: ${e.specialThanks.trim()}`);
      }
      return out.length > 1 ? out.join("\n") : "";
    },
    formatDay(date, day, which) {
      const parts = [`AA-Reflex · ${D.pretty(date)}`];
      if (which !== "evening") { const t = this.formatMorning(day); if (t.split("\n").length > 1) parts.push(t); }
      if (which !== "morning") { const t = this.formatEvening(day); if (t) parts.push(t); }
      return parts.join("\n\n");
    },

    // ---------- Backup ----------
    backupPayload() {
      return JSON.stringify({ app: "AA-Reflex", schema: SCHEMA, exportedAt: new Date().toISOString(), state: this.state }, null, 1);
    },
    // Erkennt V2-Backup oder V1-Daten. Rückgabe: { kind, state?, days? }
    parseImport(text) {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { throw new Error("Die Datei ist kein gültiges Backup (kein JSON)."); }
      if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch (e) { /* bleibt */ } }
      if (obj && obj.app === "AA-Reflex" && obj.state && obj.state.days) {
        const st = normalize(obj.state);
        st.meta.lastBackupAt = obj.exportedAt || st.meta.lastBackupAt; // Daten entsprechen genau diesem Backup
        return { kind: "v2", state: st };
      }
      const v1 = obj && obj.aa_reflex_store_v1 ? (typeof obj.aa_reflex_store_v1 === "string" ? JSON.parse(obj.aa_reflex_store_v1) : obj.aa_reflex_store_v1) : obj;
      if (v1 && v1.history && typeof v1.history === "object") return { kind: "v1", days: migrateV1(v1), v1 };
      throw new Error("Unbekanntes Format – weder AA-Reflex-Backup noch Daten aus Version 1.");
    },
    replaceState(st) { this.state = normalize(st); return this.saveNow(); },
    mergeV1(days, v1) {
      let added = 0, skipped = 0;
      for (const [k, d] of Object.entries(days)) {
        if (this.state.days[k] && !this.isDayEmpty(this.state.days[k])) { skipped++; continue; }
        this.state.days[k] = d; added++;
      }
      // Favoriten übernehmen
      const favA = new Set((v1.favorites && v1.favorites.affirmations) || []);
      const favQ = new Set((v1.favorites && v1.favorites.quotes) || []);
      this.state.content.affirmations.forEach((a) => { if (favA.has(a.text)) a.fav = true; });
      this.state.content.quotes.forEach((q) => { if (favQ.has(q.text)) q.fav = true; });
      if (v1.user && v1.user.name && !this.state.settings.name) this.state.settings.name = v1.user.name;
      this.state.meta.v1ImportedAt = new Date().toISOString();
      this.saveNow();
      return { added, skipped };
    }
  };

  function migrateV1(v1) {
    const out = {};
    for (const [date, d] of Object.entries(v1.history || {})) {
      if (!D.valid(date) || !d) continue;
      const n = newDay();
      const m = d.morning || {}, e = d.evening || {};
      const chips = new Set(window.AA_DEFAULTS.selfcareChips);
      const self = (m.selfcare || []).filter((x) => x && String(x).trim());
      n.morning.thankful = (m.thankful || []).filter((x) => x && String(x).trim());
      if (!n.morning.thankful.length) n.morning.thankful = [""];
      n.morning.selfcareChips = [...new Set(self.filter((x) => chips.has(x)))];
      n.morning.selfcare = self.filter((x) => !chips.has(x));
      if (!n.morning.selfcare.length) n.morning.selfcare = [""];
      n.morning.focus = m.focus || [];
      n.morning.focusNote = m.focusNote || "";
      if (m.affirmation) {
        let cat = "";
        for (const [c, arr] of Object.entries(window.AA_DEFAULTS.affirmations)) if (arr.includes(m.affirmation)) cat = c;
        n.morning.affirmation = { cat, text: m.affirmation };
      }
      if (m.quote && m.quote.text) n.morning.quote = { cat: m.quote.cat || "", text: m.quote.text };
      n.morning.done = !!d.completedMorning;
      n.evening.goodForSomeone = e.goodForSomeone || "";
      n.evening.learned = e.learned || "";
      n.evening.threeGood = [0, 1, 2].map((i) => (e.threeGood || [])[i] || "");
      n.evening.specialThanks = e.specialThanks || "";
      n.evening.step10 = e.step10 === true ? true : e.step10 === false ? false : null;
      if (e.step10data) {
        const s = Object.assign(newStep10(), e.step10data);
        n.evening.programDone = (e.step10data.programDone || []).slice();
        delete s.programDone; delete s.remind;
        n.evening.s10 = s;
      }
      n.evening.done = !!d.completedEvening;
      n.updatedAt = new Date().toISOString();
      if (!Store.isDayEmpty(n)) out[date] = n;
    }
    return out;
  }

  window.AA = { Store, D, LISTS, uid, clone, newDay, newStep10, contentFromDefaults, initState, SCHEMA };
})();
