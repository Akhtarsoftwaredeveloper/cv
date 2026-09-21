/* =========================================================
   Admin Panel
   Everything here talks to ../api.php (login, save, upload,
   messages) and reads/writes ../data/site.json through it.
   ========================================================= */
(function () {
  "use strict";

  var API = "../api.php";
  var ICONS = window.CMS_ICONS || {};
  var DEFAULTS = window.SITE_DEFAULTS || {};

  var PAGES = [
    { id: "home", file: "index.html", name: "Home", icon: "web", url: "../index.html" },
    { id: "about", file: "about.html", name: "About", icon: "user", url: "../about.html" },
    { id: "services", file: "services.html", name: "Services", icon: "apps", url: "../services.html" },
    { id: "portfolio", file: "portfolio.html", name: "Portfolio", icon: "image", url: "../portfolio.html" },
    { id: "contact", file: "contact.html", name: "Contact", icon: "mail", url: "../contact.html" }
  ];

  var THEMES = [
    { id: "charcoal-orange", name: "Charcoal Orange", note: "Dark charcoal with orange and electric blue", c: ["#15171b", "#ff6b1a", "#22a6ff"] },
    { id: "midnight-blue", name: "Midnight Blue", note: "Deep navy with bright blue and cyan", c: ["#0c1322", "#3d8bff", "#22d3ee"] },
    { id: "slate-purple", name: "Slate Purple", note: "Dark slate with violet and pink", c: ["#16141f", "#a56bff", "#ff6bb0"] },
    { id: "emerald-dark", name: "Emerald Dark", note: "Dark green-black with emerald and gold", c: ["#0e1616", "#14c88a", "#f2b544"] }
  ];

  var S = {
    csrf: "", user: "", mustChange: false,
    data: null, savedStr: "", fields: null,
    view: "dashboard", unread: 0, messages: null, health: null, entered: false
  };

  /* ---------- small helpers ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  function append(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(e, x); }); return; }
    if (typeof c === "string" || typeof c === "number") { e.appendChild(document.createTextNode(String(c))); return; }
    e.appendChild(c);
  }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function svg(name) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name] || "";
    return s;
  }
  function uid(p) { return p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function slug(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function toast(msg, type) {
    var t = h("div", { class: "toast " + (type || "ok"), text: msg });
    $("#toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, type === "err" ? 7000 : 4200);
  }

  /* ---------- talking to the server ---------- */
  function api(action, opts) {
    opts = opts || {};
    var init = { method: opts.body || opts.form ? "POST" : "GET", credentials: "same-origin", headers: {} };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    if (opts.form) init.body = opts.form;
    if (S.csrf) init.headers["X-CSRF-Token"] = S.csrf;
    return fetch(API + "?action=" + action + "&_=" + Date.now(), init).then(function (r) {
      return r.json().catch(function () {
        return { ok: false, error: "The server did not answer correctly. Is api.php uploaded and is PHP enabled on your hosting?" };
      }).then(function (j) { j.status = r.status; return j; });
    }).catch(function () {
      return { ok: false, error: "Could not reach the server. Please check your internet connection.", status: 0 };
    });
  }

  function normalize(d) {
    d = d || {};
    var o = {
      version: 1,
      theme: d.theme || "charcoal-orange",
      text: (d.text && !Array.isArray(d.text)) ? d.text : {},
      images: Object.assign({ logo: "", profile: "", about: "" }, d.images),
      contact: Object.assign({ email: "", whatsapp: "" }, d.contact),
      social: Object.assign({ github: "", linkedin: "", facebook: "", youtube: "", instagram: "" }, d.social),
      updated: d.updated || 0
    };
    ["services", "categories", "projects", "awards", "testimonials", "tools"].forEach(function (k) {
      o[k] = Array.isArray(d[k]) ? d[k] : [];
    });
    return o;
  }

  function loadData() {
    return fetch("../data/site.json?_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("none"); return r.json(); })
      .catch(function () { return DEFAULTS; })
      .then(function (d) { S.data = normalize(d); S.savedStr = JSON.stringify(S.data); });
  }

  /* Reads each public page to find every editable piece of text. */
  function parsePage(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var out = [];
    $$("[data-cms]", doc).forEach(function (e) {
      var g = e.closest("[data-cms-group]");
      var def;
      if (e.hasAttribute("data-odo")) def = String(Math.max(0, $$(".odo-col i", e).length - 1));
      else def = e.textContent.replace(/\s+/g, " ").trim();
      out.push({
        key: e.getAttribute("data-cms"),
        label: e.getAttribute("data-cms-label") || e.getAttribute("data-cms"),
        area: e.getAttribute("data-cms-type") === "textarea",
        num: e.hasAttribute("data-odo"),
        def: def,
        group: g ? g.getAttribute("data-cms-group") : "Other"
      });
    });
    return out;
  }

  function loadFields() {
    S.fields = { site: [] };
    var seen = {};
    var chain = Promise.resolve();
    PAGES.forEach(function (p) {
      S.fields[p.id] = [];
      chain = chain.then(function () {
        return fetch("../" + p.file + "?_=" + Date.now(), { cache: "no-store" })
          .then(function (r) { return r.ok ? r.text() : ""; })
          .catch(function () { return ""; })
          .then(function (html) {
            parsePage(html).forEach(function (f) {
              if (seen[f.key]) return;
              seen[f.key] = true;
              if (f.key.indexOf("site.") === 0) S.fields.site.push(f); else S.fields[p.id].push(f);
            });
          });
      });
    });
    return chain;
  }

  /* ---------- unsaved-changes tracking ---------- */
  function isDirty() { return S.data && JSON.stringify(S.data) !== S.savedStr; }
  function markDirty() { $("#savebar").hidden = !isDirty(); }
  window.addEventListener("beforeunload", function (e) {
    if (S.entered && isDirty()) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- form building blocks ---------- */
  function bindText(obj, key, opts) {
    opts = opts || {};
    var isArea = opts.area;
    var input = h(isArea ? "textarea" : "input", {
      type: isArea ? null : (opts.type || "text"),
      maxlength: opts.max || (isArea ? 3000 : 200),
      placeholder: opts.placeholder || "",
      rows: isArea ? (opts.rows || 3) : null,
      "data-title": opts.title ? "1" : null
    });
    input.value = obj[key] == null ? "" : obj[key];
    input.addEventListener("input", function () {
      obj[key] = input.value;
      if (opts.onInput) opts.onInput(input.value);
      markDirty();
    });
    return input;
  }
  function field(label, control, hint, cls) {
    return h("label", { class: "field" + (cls ? " " + cls : "") }, h("span", { text: label }), control, hint ? h("span", { class: "hint", text: hint }) : null);
  }
  function checkbox(obj, key, label) {
    var c = h("input", { type: "checkbox" });
    c.checked = !!obj[key];
    c.addEventListener("change", function () { obj[key] = c.checked; markDirty(); });
    return h("label", { class: "check full" }, c, label);
  }

  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("That file could not be read as a picture. Please use a JPG, PNG or WebP image.")); };
      img.src = url;
    });
  }
  /* Shrinks big photos in the browser first, so uploads are fast and fit any hosting limit. */
  function prepareImage(file, maxDim) {
    if (file.type === "image/gif") {
      if (file.size > 3 * 1024 * 1024) return Promise.reject(new Error("This GIF is larger than 3 MB. Please choose a smaller one."));
      return Promise.resolve(file);
    }
    return loadImage(file).then(function (img) {
      var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      var ctx = c.getContext("2d");
      var png = file.type === "image/png";
      if (!png) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (res, rej) {
        c.toBlob(function (b) { b ? res(b) : rej(new Error("The picture could not be prepared.")); }, png ? "image/png" : "image/jpeg", 0.88);
      });
    });
  }

  function imageField(obj, key, opts) {
    opts = opts || {};
    var prev = h("div", { class: "imgprev" });
    var status = h("span", { class: "hint" });
    var input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true });
    var up = h("button", { class: "btn btn-ghost small", type: "button" });
    var rm = h("button", { class: "btn btn-danger small", type: "button", text: "Remove image" });

    function draw() {
      prev.textContent = "";
      if (obj[key]) prev.appendChild(h("img", { src: "../" + obj[key], alt: "" }));
      else prev.appendChild(document.createTextNode(opts.emptyText || "No image yet"));
      up.textContent = obj[key] ? "Change image" : "Upload image";
      rm.hidden = !obj[key];
    }
    up.addEventListener("click", function () { input.click(); });
    rm.addEventListener("click", function () { obj[key] = ""; draw(); markDirty(); });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      up.disabled = true;
      status.textContent = "Uploading…";
      prepareImage(file, opts.maxDim || 1600).then(function (blob) {
        var fd = new FormData();
        fd.append("file", blob, file.type === "image/png" ? "picture.png" : (file.type === "image/gif" ? "picture.gif" : "picture.jpg"));
        return api("upload", { form: fd });
      }).then(function (r) {
        if (!r.ok) throw Object.assign(new Error(r.error || "Upload failed."), { resp: r });
        obj[key] = r.path;
        status.textContent = "Uploaded. Press Save changes to publish it.";
        draw(); markDirty();
      }).catch(function (err) {
        status.textContent = "";
        if (err.resp && (err.resp.status === 401 || err.resp.status === 403)) return sessionLost();
        toast(err.message || "Upload failed.", "err");
      }).then(function () { up.disabled = false; });
    });
    draw();
    return h("div", { class: "imgfield" },
      opts.label ? h("span", { class: "lbl", text: opts.label }) : null,
      prev,
      h("div", null, h("div", { class: "imgbtns" }, up, rm, input), status, opts.hint ? h("p", { class: "hint", text: opts.hint }) : null)
    );
  }

  /* A reusable "list of cards" editor with add, remove and reorder. */
  function listEditor(cfg) {
    var list = cfg.list;
    var wrap = h("div");
    var box = h("div", { class: "list" });
    var addBtn = h("button", { class: "btn btn-primary add-row", type: "button", text: cfg.addLabel });
    wrap.appendChild(box);
    wrap.appendChild(addBtn);

    function draw(focusLast) {
      box.textContent = "";
      if (!list.length) box.appendChild(h("div", { class: "empty", text: cfg.emptyText }));
      list.forEach(function (item, i) {
        var titleEl = h("strong", { text: cfg.label(item, i) });
        var up = h("button", { class: "icon-btn", type: "button", title: "Move up", "aria-label": "Move up", text: "↑", disabled: i === 0 });
        var down = h("button", { class: "icon-btn", type: "button", title: "Move down", "aria-label": "Move down", text: "↓", disabled: i === list.length - 1 });
        var del = h("button", { class: "icon-btn danger", type: "button", title: "Remove", "aria-label": "Remove", text: "✕" });
        up.addEventListener("click", function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); markDirty(); });
        down.addEventListener("click", function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); draw(); markDirty(); });
        del.addEventListener("click", function () {
          if (!window.confirm('Remove "' + cfg.label(item, i) + '"? It will disappear from your website when you press Save changes.')) return;
          list.splice(i, 1);
          if (cfg.onRemove) cfg.onRemove(item);
          draw(); markDirty();
        });
        var body = h("div", { class: "item-body" }, cfg.fields(item, i));
        body.addEventListener("input", function (e) {
          if (e.target && e.target.getAttribute && e.target.getAttribute("data-title")) titleEl.textContent = cfg.label(item, i);
        });
        box.appendChild(h("div", { class: "item" }, h("div", { class: "item-head" }, titleEl, up, down, del), body));
      });
      if (focusLast) {
        var last = box.lastElementChild;
        if (last) { last.scrollIntoView({ behavior: "smooth", block: "center" }); var f = $("input,textarea", last); if (f) f.focus({ preventScroll: true }); }
      }
    }
    addBtn.addEventListener("click", function () { list.push(cfg.make()); draw(true); markDirty(); });
    draw();
    return wrap;
  }

  function intro(title, text) { return h("div", { class: "page-intro" }, h("h3", { text: title }), text ? h("p", { text: text }) : null); }

  /* ---------- views ---------- */
  var VIEWS = {};

  VIEWS.dashboard = function () {
    var d = S.data, root = h("div");
    root.appendChild(intro("Welcome back", "Choose what you would like to edit. Every change goes live on your website as soon as you press Save changes."));

    var stats = h("div", { class: "stats" });
    [["Services", d.services.length, "services"], ["Portfolio projects", d.projects.length, "projects"], ["Awards", d.awards.length, "awards"],
     ["Testimonials", d.testimonials.length, "testimonials"], ["New messages", S.unread, "messages"]].forEach(function (s) {
      stats.appendChild(h("button", { class: "stat", type: "button", onclick: function () { go(s[2]); } }, h("b", { text: s[1] }), h("span", { text: s[0] })));
    });
    root.appendChild(stats);

    root.appendChild(h("h4", { class: "section-title", text: "PAGES: change the wording on each page" }));
    var g1 = h("div", { class: "grid" });
    PAGES.concat([{ id: "site", name: "Header and footer", icon: "chart", note: "Your name, footer text" }]).forEach(function (p) {
      g1.appendChild(tileLink(p.icon, p.name, p.note || "Edit the text on this page", function () { go("page:" + p.id); }));
    });
    root.appendChild(g1);

    root.appendChild(h("h4", { class: "section-title", text: "FEATURES: lists, prices, pictures and colours" }));
    var g2 = h("div", { class: "grid" });
    [["apps", "Services and Prices", "Add, remove and price your services", "services"],
     ["folder", "Portfolio Projects", "Projects, categories and thumbnails", "projects"],
     ["trophy", "Awards and Achievements", "Add or remove awards", "awards"],
     ["chat", "Testimonials", "Real words from students and clients", "testimonials"],
     ["chip", "Tools", "Names in the scrolling tools row", "tools"],
     ["mail", "Contact and Social Links", "Email, WhatsApp and social media", "contact"],
     ["image", "Images", "Profile photo, logo and every thumbnail", "images"],
     ["design", "Color Theme", "Switch the colours of the whole site", "theme"]].forEach(function (t) {
      g2.appendChild(tileLink(t[0], t[1], t[2], function () { go(t[3]); }, true));
    });
    root.appendChild(g2);

    var setup = h("div", { class: "card", style: "margin-top:28px" }, h("h3", { text: "Setup check" }), h("p", { text: "Checking that your hosting is ready…" }));
    root.appendChild(setup);
    api("health").then(function (r) {
      setup.textContent = "";
      setup.appendChild(h("h3", { text: "Setup check" }));
      if (!r.ok) { setup.appendChild(h("p", { text: r.error || "Could not run the check." })); return; }
      var rows = [
        [true, "PHP is running (version " + r.php + ")."],
        [r.dataWritable, r.dataWritable ? "Saving is possible (the data folder can be written to)." : 'The "data" folder is not writable. Ask your host, or set the folder permission to 755 or 775 (see the hosting guide).'],
        [r.uploadsWritable, r.uploadsWritable ? "Image uploads are possible (the uploads folder can be written to)." : 'The "uploads" folder is not writable. Set its permission to 755 or 775 (see the hosting guide).'],
        [r.privateWritable, r.privateWritable ? "Login and messages can be stored safely." : 'The "private" folder is not writable. Set its permission to 755 or 775 (see the hosting guide).']
      ];
      var box = h("div", { class: "checks" });
      rows.forEach(function (x) { box.appendChild(h("div", { class: "check-row " + (x[0] ? "good" : "bad") }, h("i", { text: x[0] ? "✓" : "✕" }), h("span", { text: x[1] }))); });
      setup.appendChild(box);
    });
    return root;
  };

  function tileLink(icon, title, note, fn, blue) {
    return h("button", { class: "tile-link", type: "button", onclick: fn },
      h("span", { class: "ico" + (blue ? " blue" : "") }, svg(icon)),
      h("span", null, h("strong", { text: title }), h("small", { text: note })));
  }

  /* Page text editor (built from the real pages, so it always matches them) */
  function viewText(pid) {
    var fields = S.fields[pid] || [];
    var page = PAGES.filter(function (p) { return p.id === pid; })[0];
    var title = page ? page.name + " page" : "Header and footer";
    var root = h("div");
    root.appendChild(intro("Edit the " + title.toLowerCase() + " text",
      pid === "site" ? "These appear on every page: your name in the header and the wording in the footer."
        : "Change any wording below, then press Save changes. Leave a box as it is to keep the original wording. Use Reset to go back to the original."));
    if (page) root.appendChild(h("p", null, h("a", { class: "btn btn-ghost small", href: page.url, target: "_blank", rel: "noopener", text: "Open this page in a new tab" })));

    if (!fields.length) { root.appendChild(h("div", { class: "empty", text: "No editable text was found. Make sure the page file is uploaded." })); return root; }

    var search = h("input", { class: "search", type: "search", placeholder: "Search this page's text…", "aria-label": "Search text" });
    var searchWrap = h("label", { class: "field search" }, h("span", { text: "Find a text box" }), search);
    if (fields.length > 12) root.appendChild(searchWrap);

    var groups = [], byName = {};
    fields.forEach(function (f) {
      if (!byName[f.group]) { byName[f.group] = { name: f.group, items: [] }; groups.push(byName[f.group]); }
      byName[f.group].items.push(f);
    });

    var rendered = [];
    groups.forEach(function (g, gi) {
      var det = h("details", { class: "group", open: groups.length < 3 || gi === 0 });
      det.appendChild(h("summary", null, h("span", { text: g.name }), h("small", { text: g.items.length + (g.items.length === 1 ? " item" : " items") })));
      var body = h("div", { class: "group-body" });
      g.items.forEach(function (f) {
        var cur = Object.prototype.hasOwnProperty.call(S.data.text, f.key) ? S.data.text[f.key] : f.def;
        var ctl = h(f.area ? "textarea" : "input", { type: f.area ? null : (f.num ? "number" : "text"), rows: f.area ? 3 : null, min: f.num ? "0" : null, max: f.num ? "60" : null, maxlength: 2000, placeholder: f.def });
        ctl.value = cur;
        var reset = h("button", { class: "reset", type: "button", text: "Reset" });
        function sync() { reset.hidden = !Object.prototype.hasOwnProperty.call(S.data.text, f.key); }
        ctl.addEventListener("input", function () {
          var v = ctl.value;
          if (v.trim() === "" || v === f.def) delete S.data.text[f.key]; else S.data.text[f.key] = v;
          sync(); markDirty();
        });
        reset.addEventListener("click", function () { delete S.data.text[f.key]; ctl.value = f.def; sync(); markDirty(); });
        sync();
        var cid = uid("txt");
        ctl.id = cid;
        var wrap = h("div", { class: "field textfield", "data-search": (f.label + " " + f.def).toLowerCase() }, h("label", { class: "lbl", for: cid, text: f.label }), reset, ctl);
        body.appendChild(wrap);
        rendered.push({ el: wrap, group: det });
      });
      det.appendChild(body);
      root.appendChild(det);
    });

    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      var shown = {};
      rendered.forEach(function (r) {
        var ok = !q || r.el.getAttribute("data-search").indexOf(q) !== -1;
        r.el.hidden = !ok;
        if (ok) shown[rendered.indexOf(r)] = r.group;
      });
      $$("details.group", root).forEach(function (d) {
        var any = rendered.some(function (r) { return r.group === d && !r.el.hidden; });
        d.hidden = !any;
        if (q && any) d.open = true;
      });
    });
    return root;
  }

  VIEWS.services = function () {
    var root = h("div");
    root.appendChild(intro("Services and Prices", "Add or remove services and set a price for each one. They appear on the Services page, and the names appear in the Home page preview. Leave the price empty to show \"Contact for a quote\"."));
    root.appendChild(listEditor({
      list: S.data.services, addLabel: "+ Add a service", emptyText: "You have no services yet. Click \"Add a service\".",
      label: function (s) { return s.title || "New service"; },
      make: function () { return { id: uid("svc"), title: "", description: "", icon: "web", price: "" }; },
      fields: function (s) {
        var picker = h("div", { class: "icon-picker" });
        (window.CMS_SERVICE_ICONS || []).forEach(function (n) {
          var b = h("button", { type: "button", title: n, "aria-label": "Icon " + n, "aria-pressed": String(s.icon === n) }, svg(n));
          b.addEventListener("click", function () { s.icon = n; $$("button", picker).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); markDirty(); });
          picker.appendChild(b);
        });
        return [
          field("Service name", bindText(s, "title", { title: true, max: 120, placeholder: "For example: Website Development" })),
          field("Price", bindText(s, "price", { max: 60, placeholder: "For example: From $100  or  Rs. 5,000" }), "Type it exactly as you want visitors to see it."),
          field("Short description", bindText(s, "description", { area: true, max: 400 }), null, "full"),
          h("div", { class: "field full" }, h("span", { class: "lbl", text: "Icon" }), picker)
        ];
      }
    }));
    return root;
  };

  VIEWS.projects = function () {
    var d = S.data, root = h("div");
    root.appendChild(intro("Portfolio Projects", "Add, remove and edit the projects shown on the Portfolio page. Projects with \"Show on the Home page\" ticked also appear in the Home page's featured work."));

    root.appendChild(h("h4", { class: "section-title", text: "Categories (the filter tabs on the Portfolio page)" }));
    var catBox = h("div", { class: "card" });
    var rows = h("div", { class: "rows" });
    function drawCats() {
      rows.textContent = "";
      d.categories.forEach(function (c, i) {
        var inp = bindText(c, "name", { max: 60, placeholder: "Category name" });
        var del = h("button", { class: "icon-btn danger", type: "button", "aria-label": "Remove category", text: "✕" });
        del.addEventListener("click", function () {
          var used = d.projects.filter(function (p) { return p.category === c.id; }).length;
          if (!window.confirm('Remove the category "' + (c.name || "") + '"?' + (used ? " Its " + used + " project(s) will be moved to another category." : ""))) return;
          d.categories.splice(i, 1);
          var fallback = d.categories.length ? d.categories[0].id : "";
          d.projects.forEach(function (p) { if (p.category === c.id) p.category = fallback; });
          drawCats(); markDirty();
        });
        rows.appendChild(h("div", { class: "row" }, inp, del));
      });
      if (!d.categories.length) rows.appendChild(h("div", { class: "empty", text: "No categories yet." }));
    }
    drawCats();
    var addCat = h("button", { class: "btn btn-ghost small add-row", type: "button", text: "+ Add a category" });
    addCat.addEventListener("click", function () { d.categories.push({ id: uid("cat"), name: "" }); drawCats(); markDirty(); var l = $$("input", rows); if (l.length) l[l.length - 1].focus(); });
    catBox.appendChild(rows); catBox.appendChild(addCat);
    root.appendChild(catBox);

    root.appendChild(h("h4", { class: "section-title", text: "Projects" }));
    var projectsHost = h("div");
    function catSelect(p) {
      var sel = h("select");
      sel.appendChild(h("option", { value: "", text: "No category" }));
      d.categories.forEach(function (c) { sel.appendChild(h("option", { value: c.id, text: c.name || "(unnamed category)" })); });
      sel.value = p.category || "";
      sel.addEventListener("change", function () { p.category = sel.value; markDirty(); });
      return sel;
    }
    projectsHost.appendChild(listEditor({
      list: d.projects, addLabel: "+ Add a project", emptyText: "You have no projects yet. Click \"Add a project\".",
      label: function (p) { return p.title || "New project"; },
      make: function () { return { id: uid("project"), title: "", description: "", details: "", category: d.categories.length ? d.categories[0].id : "", image: "", featured: false, art: 0 }; },
      fields: function (p) {
        return [
          field("Project title", bindText(p, "title", { title: true, max: 150 })),
          field("Category", catSelect(p)),
          field("One-line description (what you did)", bindText(p, "description", { max: 300 }), null, "full"),
          field("Longer description (shown when a visitor opens the project)", bindText(p, "details", { area: true, rows: 4, max: 3000 }), null, "full"),
          h("div", { class: "full" }, imageField(p, "image", { label: "Thumbnail image", hint: "Shown on the Portfolio page and, if ticked below, on the Home page. Any picture works; wide pictures look best.", emptyText: "Using the default artwork", maxDim: 1600 })),
          checkbox(p, "featured", "Show on the Home page (featured work)")
        ];
      }
    }));
    root.appendChild(projectsHost);
    return root;
  };

  VIEWS.awards = function () {
    var root = h("div");
    root.appendChild(intro("Awards and Achievements", "Add awards, certificates and milestones. They appear in an \"Awards and achievements\" section on the About page. The section stays hidden while the list is empty."));
    root.appendChild(listEditor({
      list: S.data.awards, addLabel: "+ Add an award or achievement", emptyText: "No awards yet. Click \"Add an award or achievement\".",
      label: function (a) { return a.title || "New award"; },
      make: function () { return { id: uid("award"), title: "", issuer: "", year: "", description: "", image: "" }; },
      fields: function (a) {
        return [
          field("Title", bindText(a, "title", { title: true, max: 150 })),
          field("Given by (optional)", bindText(a, "issuer", { max: 150 })),
          field("Year (optional)", bindText(a, "year", { max: 20, placeholder: "For example: 2025" })),
          field("Short description (optional)", bindText(a, "description", { area: true, max: 600 }), null, "full"),
          h("div", { class: "full" }, imageField(a, "image", { label: "Picture or certificate (optional)", emptyText: "Shows a trophy icon", maxDim: 900 }))
        ];
      }
    }));
    return root;
  };

  VIEWS.testimonials = function () {
    var root = h("div");
    root.appendChild(intro("Testimonials", "Add real words from your students and clients. The testimonials section on the Home page appears once you add the first one."));
    root.appendChild(listEditor({
      list: S.data.testimonials, addLabel: "+ Add a testimonial", emptyText: "No testimonials yet. Add real ones when you have them.",
      label: function (t) { return t.name || "New testimonial"; },
      make: function () { return { id: uid("testimonial"), text: "", name: "", role: "" }; },
      fields: function (t) {
        return [
          field("Their words", bindText(t, "text", { area: true, rows: 4, max: 800 }), null, "full"),
          field("Name", bindText(t, "name", { title: true, max: 100 })),
          field("Role (for example Student or Client)", bindText(t, "role", { max: 120 }))
        ];
      }
    }));
    return root;
  };

  VIEWS.tools = function () {
    var root = h("div"), tools = S.data.tools;
    root.appendChild(intro("Tools", "The names in the scrolling row on the Home page."));
    var card = h("div", { class: "card" }), rows = h("div", { class: "rows" });
    function draw() {
      rows.textContent = "";
      tools.forEach(function (t, i) {
        var inp = h("input", { type: "text", maxlength: 40, "aria-label": "Tool name" });
        inp.value = t;
        inp.addEventListener("input", function () { tools[i] = inp.value; markDirty(); });
        var del = h("button", { class: "icon-btn danger", type: "button", "aria-label": "Remove", text: "✕" });
        del.addEventListener("click", function () { tools.splice(i, 1); draw(); markDirty(); });
        rows.appendChild(h("div", { class: "row" }, inp, del));
      });
      if (!tools.length) rows.appendChild(h("div", { class: "empty", text: "No tools yet. The tools row is hidden while empty." }));
    }
    draw();
    var add = h("button", { class: "btn btn-primary add-row", type: "button", text: "+ Add a tool" });
    add.addEventListener("click", function () { tools.push(""); draw(); markDirty(); var l = $$("input", rows); if (l.length) l[l.length - 1].focus(); });
    card.appendChild(rows); card.appendChild(add);
    root.appendChild(card);
    return root;
  };

  VIEWS.contact = function () {
    var d = S.data, root = h("div");
    root.appendChild(intro("Contact and Social Links", "These appear on the Contact page and as icons in the footer of every page. Leave a box empty to hide that link."));
    var c1 = h("div", { class: "card" }, h("h3", { text: "Contact details" }),
      field("Email address", bindText(d.contact, "email", { type: "email", max: 150, placeholder: "you@example.com" }), "Visitors can click it to write to you. New messages from the Contact form are also emailed here when your hosting allows it."),
      field("WhatsApp number", bindText(d.contact, "whatsapp", { max: 25, placeholder: "+92 300 1234567" }), "Include the country code. Visitors tap it to open a WhatsApp chat with you."));
    var c2 = h("div", { class: "card" }, h("h3", { text: "Social media links" }),
      field("GitHub", bindText(d.social, "github", { max: 300, placeholder: "https://github.com/yourname" })),
      field("LinkedIn", bindText(d.social, "linkedin", { max: 300, placeholder: "https://www.linkedin.com/in/yourname" })),
      field("Facebook", bindText(d.social, "facebook", { max: 300, placeholder: "https://www.facebook.com/yourpage" })),
      field("YouTube", bindText(d.social, "youtube", { max: 300, placeholder: "https://www.youtube.com/@yourchannel" })),
      field("Instagram", bindText(d.social, "instagram", { max: 300, placeholder: "https://www.instagram.com/yourname" })));
    root.appendChild(c1); root.appendChild(c2);
    return root;
  };

  VIEWS.images = function () {
    var d = S.data, root = h("div");
    root.appendChild(intro("Images", "Every picture on your website in one place. Upload or change any of them, then press Save changes."));
    root.appendChild(h("h4", { class: "section-title", text: "Your photo and logo" }));
    var g = h("div", { class: "img-grid" });
    g.appendChild(h("div", { class: "card" }, h("h3", { text: "Profile photo (Home page)" }), imageField(d.images, "profile", { hint: "A portrait works best (about 4 wide by 5 tall).", emptyText: "Using the placeholder photo", maxDim: 1400 })));
    g.appendChild(h("div", { class: "card" }, h("h3", { text: "Photo on the About page" }), imageField(d.images, "about", { hint: "Optional. If you leave this empty, the profile photo is used here too.", emptyText: "Same as the profile photo", maxDim: 1400 })));
    g.appendChild(h("div", { class: "card" }, h("h3", { text: "Logo (top left of every page)" }), imageField(d.images, "logo", { hint: "Optional. A square image works best. Without it, the letters \"AM\" are shown.", emptyText: "Using the letters", maxDim: 512 })));
    root.appendChild(g);

    root.appendChild(h("h4", { class: "section-title", text: "Project thumbnails (Home page featured work and the Portfolio page)" }));
    if (!d.projects.length) root.appendChild(h("div", { class: "empty", text: "No projects yet. Add them under Portfolio Projects." }));
    var g2 = h("div", { class: "img-grid" });
    d.projects.forEach(function (p) {
      g2.appendChild(h("div", { class: "card" }, h("h3", { text: p.title || "Untitled project" }), imageField(p, "image", { emptyText: "Using the default artwork", maxDim: 1600 })));
    });
    root.appendChild(g2);

    if (d.awards.length) {
      root.appendChild(h("h4", { class: "section-title", text: "Award pictures" }));
      var g3 = h("div", { class: "img-grid" });
      d.awards.forEach(function (a) {
        g3.appendChild(h("div", { class: "card" }, h("h3", { text: a.title || "Untitled award" }), imageField(a, "image", { emptyText: "Shows a trophy icon", maxDim: 900 })));
      });
      root.appendChild(g3);
    }
    return root;
  };

  VIEWS.theme = function () {
    var root = h("div");
    root.appendChild(intro("Color Theme", "Pick a colour theme. It changes instantly across every page of your live website, and nothing else needs saving."));
    var grid = h("div", { class: "themes" });
    THEMES.forEach(function (t) {
      var sw = h("div", { class: "swatch", style: "background:" + t.c[0] }, h("i", { style: "background:" + t.c[1] }), h("i", { style: "background:" + t.c[2] }));
      var btn = h("button", { class: "theme-card", type: "button", "aria-pressed": String(S.data.theme === t.id) },
        sw, h("strong", null, t.name, S.data.theme === t.id ? h("span", { class: "on", text: "Active" }) : null), h("small", { text: t.note }));
      btn.addEventListener("click", function () {
        if (S.data.theme === t.id) return;
        btn.disabled = true;
        api("set_theme", { body: { theme: t.id } }).then(function (r) {
          if (!r.ok) { btn.disabled = false; if (r.status === 401 || r.status === 403) return sessionLost(); return toast(r.error || "Could not change the theme.", "err"); }
          var saved = JSON.parse(S.savedStr); saved.theme = t.id; S.savedStr = JSON.stringify(saved);
          S.data.theme = t.id;
          document.documentElement.setAttribute("data-theme", t.id);
          try { localStorage.setItem("cms-theme", t.id); } catch (e) { /* ignore */ }
          toast("Theme changed to " + t.name + ". Your website now uses it.");
          markDirty(); render();
        });
      });
      grid.appendChild(btn);
    });
    root.appendChild(grid);
    return root;
  };

  VIEWS.messages = function () {
    var root = h("div");
    root.appendChild(intro("Messages", "Messages sent from the form on your Contact page."));
    var host = h("div", null, h("p", { class: "muted", text: "Loading…" }));
    root.appendChild(host);
    api("messages").then(function (r) {
      host.textContent = "";
      if (!r.ok) { if (r.status === 401) return sessionLost(); host.appendChild(h("div", { class: "empty", text: r.error || "Could not load messages." })); return; }
      S.messages = r.messages; S.unread = r.messages.filter(function (m) { return !m.read; }).length; drawNav();
      if (!r.messages.length) { host.appendChild(h("div", { class: "empty", text: "No messages yet." })); return; }
      r.messages.forEach(function (m) {
        var card = h("article", { class: "msg" + (m.read ? "" : " unread") });
        var when = new Date((m.time || 0) * 1000).toLocaleString();
        card.appendChild(h("header", null, h("h4", { text: m.name }), h("time", { text: when })));
        card.appendChild(h("a", { href: "mailto:" + m.email, text: m.email }));
        if (m.service) card.appendChild(h("div", null, h("span", { class: "tag", text: "About: " + m.service })));
        card.appendChild(h("p", { text: m.message }));
        function act(kind) {
          return api("message_update", { body: { id: m.id, do: kind } }).then(function (x) { if (!x.ok) return toast(x.error || "Failed", "err"); render(); });
        }
        card.appendChild(h("div", { class: "btns" },
          h("a", { class: "btn btn-primary small", href: "mailto:" + m.email + "?subject=" + encodeURIComponent("Re: your message"), text: "Reply by email" }),
          h("button", { class: "btn btn-ghost small", type: "button", text: m.read ? "Mark as unread" : "Mark as read", onclick: function () { act(m.read ? "unread" : "read"); } }),
          h("button", { class: "btn btn-danger small", type: "button", text: "Delete", onclick: function () { if (window.confirm("Delete this message?")) act("delete"); } })));
        host.appendChild(card);
      });
    });
    return root;
  };

  function passwordForm(onDone, forced) {
    var cur = h("input", { type: "password", autocomplete: "current-password", required: true });
    var usr = h("input", { type: "text", autocomplete: "username", required: true, maxlength: 40 });
    usr.value = S.user || "admin";
    var pw1 = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 });
    var pw2 = h("input", { type: "password", autocomplete: "new-password", required: true });
    var err = h("p", { class: "form-error", role: "alert", hidden: true });
    var btn = h("button", { class: "btn btn-primary", type: "submit", text: "Save new login" });
    var form = h("form", null,
      h("label", { class: "field" }, h("span", { text: "Current password" }), cur),
      h("label", { class: "field" }, h("span", { text: "New username" }), usr),
      h("label", { class: "field" }, h("span", { text: "New password (at least 8 characters)" }), pw1),
      h("label", { class: "field" }, h("span", { text: "Repeat the new password" }), pw2),
      err, h("div", { class: "modal-actions" }, btn));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true;
      if (pw1.value !== pw2.value) { err.textContent = "The two new passwords do not match."; err.hidden = false; return; }
      btn.disabled = true;
      api("change_password", { body: { current: cur.value, username: usr.value, password: pw1.value } }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { err.textContent = r.error || "Could not change the password."; err.hidden = false; return; }
        S.csrf = r.csrf; S.user = r.user; S.mustChange = false;
        $("#side-user").textContent = "Signed in as " + S.user;
        drawBanner();
        toast("Your login has been changed. Please remember the new password.");
        onDone();
      });
    });
    return form;
  }

  VIEWS.account = function () {
    var root = h("div");
    root.appendChild(intro("Password and Security", "Change your Admin Panel username and password. Do this before your website goes live."));
    root.appendChild(h("div", { class: "card" }, h("h3", { text: "Change username and password" }), passwordForm(function () { render(); }), 
      h("p", { class: "hint", style: "margin-top:16px", text: "Forgot your password later? See \"Forgot your password\" in the HOW-TO-UPLOAD guide: deleting one file resets it to the starting login." })));
    return root;
  };

  /* ---------- navigation and layout ---------- */
  var NAV = [
    { title: null, items: [["dashboard", "Dashboard", "chart"]] },
    { title: "PAGES", items: [["page:home", "Home page", "web"], ["page:about", "About page", "user"], ["page:services", "Services page", "apps"], ["page:portfolio", "Portfolio page", "image"], ["page:contact", "Contact page", "mail"], ["page:site", "Header and footer", "chip"]] },
    { title: "FEATURES", items: [["services", "Services and Prices", "apps"], ["projects", "Portfolio Projects", "folder"], ["awards", "Awards and Achievements", "trophy"], ["testimonials", "Testimonials", "chat"], ["tools", "Tools", "chip"], ["contact", "Contact and Social Links", "mail"], ["images", "Images", "image"], ["theme", "Color Theme", "design"]] },
    { title: "INBOX", items: [["messages", "Messages", "mail"]] },
    { title: "ACCOUNT", items: [["account", "Password and Security", "shield"]] }
  ];
  var TITLES = {};
  NAV.forEach(function (g) { g.items.forEach(function (i) { TITLES[i[0]] = i[1]; }); });

  function drawNav() {
    var nav = $("#nav");
    nav.textContent = "";
    NAV.forEach(function (g) {
      var box = h("div", { class: "nav-group" }, g.title ? h("h4", { text: g.title }) : null);
      g.items.forEach(function (i) {
        var b = h("button", { class: "nav-item" + (S.view === i[0] ? " active" : ""), type: "button", "aria-current": S.view === i[0] ? "page" : null }, svg(i[2]), h("span", { text: i[1] }));
        if (i[0] === "messages" && S.unread) b.appendChild(h("span", { class: "badge", text: S.unread }));
        b.addEventListener("click", function () { go(i[0]); });
        box.appendChild(b);
      });
      nav.appendChild(box);
    });
  }

  function drawBanner() {
    var b = $("#banner");
    b.textContent = "";
    if (!S.mustChange) return;
    b.appendChild(h("div", { class: "banner" }, h("p", null, h("strong", { text: "You are still using the default login. " }), "Change the username and password before your website goes live, so no one else can edit your site."),
      h("button", { class: "btn btn-primary small", type: "button", text: "Change it now", onclick: function () { go("account"); } })));
  }

  function go(view) {
    S.view = view;
    $("#side").classList.remove("open"); $("#scrim").classList.remove("show");
    render();
    window.scrollTo(0, 0);
    $("#view").focus({ preventScroll: true });
  }

  function render() {
    var y = window.scrollY;
    var v = S.view, node;
    if (v.indexOf("page:") === 0) node = viewText(v.slice(5));
    else node = (VIEWS[v] || VIEWS.dashboard)();
    var host = $("#view");
    host.textContent = "";
    host.appendChild(node);
    $("#top-title").textContent = TITLES[v] || "Dashboard";
    drawNav();
    markDirty();
    window.scrollTo(0, y);
  }

  /* ---------- saving ---------- */
  function validate() {
    var d = S.data, m;
    if (d.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.contact.email.trim())) return { msg: "Please enter a valid email address.", view: "contact" };
    if (d.contact.whatsapp && d.contact.whatsapp.replace(/\D/g, "").length < 6) return { msg: "The WhatsApp number looks too short. Please include the country code.", view: "contact" };
    var soc = Object.keys(d.social);
    for (var i = 0; i < soc.length; i++) { m = d.social[soc[i]]; if (m && /\s/.test(m.trim())) return { msg: "A social media link contains spaces. Please paste the full link.", view: "contact" }; }
    for (i = 0; i < d.services.length; i++) if (!String(d.services[i].title).trim()) return { msg: "One of your services has no name. Please name it or remove it.", view: "services" };
    for (i = 0; i < d.projects.length; i++) if (!String(d.projects[i].title).trim()) return { msg: "One of your projects has no title. Please name it or remove it.", view: "projects" };
    for (i = 0; i < d.categories.length; i++) if (!String(d.categories[i].name).trim()) return { msg: "One of your categories has no name. Please name it or remove it.", view: "projects" };
    for (i = 0; i < d.awards.length; i++) if (!String(d.awards[i].title).trim()) return { msg: "One of your awards has no title. Please fill it in or remove it.", view: "awards" };
    for (i = 0; i < d.testimonials.length; i++) if (!String(d.testimonials[i].text).trim() || !String(d.testimonials[i].name).trim()) return { msg: "Each testimonial needs the words and a name. Please complete or remove it.", view: "testimonials" };
    return null;
  }

  function save() {
    var problem = validate();
    if (problem) { toast(problem.msg, "err"); if (S.view !== problem.view) go(problem.view); return; }
    var payload = clone(S.data);
    Object.keys(payload.social).forEach(function (k) {
      var v = (payload.social[k] || "").trim();
      if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
      payload.social[k] = v;
    });
    payload.tools = payload.tools.map(function (t) { return String(t).trim(); }).filter(Boolean);
    var btn = $("#save-btn");
    btn.disabled = true; btn.textContent = "Saving…";
    api("save", { body: { data: payload } }).then(function (r) {
      btn.disabled = false; btn.textContent = "Save changes";
      if (!r.ok) { if (r.status === 401 || r.status === 403) return sessionLost(); return toast(r.error || "Could not save.", "err"); }
      S.data = normalize(r.data);
      S.savedStr = JSON.stringify(S.data);
      render();
      toast("Saved! Your website has been updated.");
    });
  }

  function discard() {
    if (!window.confirm("Discard all unsaved changes?")) return;
    S.data = normalize(JSON.parse(S.savedStr));
    render();
  }

  /* ---------- login / session ---------- */
  function showLogin(msg) {
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#login-msg").textContent = msg || "Log in to manage your website.";
    $("#login-error").hidden = true;
    $("#login-pass").value = "";
    setTimeout(function () { (S.entered ? $("#login-pass") : $("#login-user")).focus(); }, 30);
  }
  function sessionLost() {
    S.csrf = "";
    showLogin(S.entered && isDirty() ? "Your session ended. Log in again: your unsaved changes are kept." : "Your session ended. Please log in again.");
  }

  function enter() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#side-user").textContent = "Signed in as " + S.user;
    S.user = S.user || "admin";
    if (S.entered) { drawBanner(); render(); return Promise.resolve(); }
    return Promise.all([loadData(), loadFields()]).then(function () {
      S.entered = true;
      document.documentElement.setAttribute("data-theme", S.data.theme);
      try { localStorage.setItem("cms-theme", S.data.theme); } catch (e) { /* ignore */ }
      drawBanner(); render();
      api("messages").then(function (r) { if (r.ok) { S.unread = r.messages.filter(function (m) { return !m.read; }).length; drawNav(); if (S.view === "dashboard") render(); } });
      if (S.mustChange) openPasswordModal();
    });
  }

  function openPasswordModal() {
    $("#modal-title").textContent = "Change your default login";
    var body = $("#modal-body");
    body.textContent = "";
    body.appendChild(h("p", { class: "muted", text: "You are using the starting username and password. Please choose your own now, so only you can edit your website." }));
    body.appendChild(passwordForm(closeModal, true));
    var later = h("button", { class: "btn btn-ghost small", type: "button", style: "margin-top:12px", text: "Remind me later", onclick: closeModal });
    body.appendChild(later);
    $("#modal").hidden = false;
    setTimeout(function () { var f = $("input", body); if (f) f.focus(); }, 50);
  }
  function closeModal() { $("#modal").hidden = true; }

  function init() {
    $("#login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("#login-btn"), err = $("#login-error");
      err.hidden = true; btn.disabled = true; btn.textContent = "Checking…";
      api("login", { body: { username: $("#login-user").value.trim(), password: $("#login-pass").value } }).then(function (r) {
        btn.disabled = false; btn.textContent = "Log in";
        if (!r.ok) { err.textContent = r.error || "Login failed."; err.hidden = false; return; }
        S.csrf = r.csrf; S.user = r.user; S.mustChange = !!r.mustChange;
        enter();
      });
    });
    $("#logout-btn").addEventListener("click", function () {
      if (isDirty() && !window.confirm("You have unsaved changes. Log out anyway?")) return;
      S.entered = false; S.data = null;
      api("logout", { body: {} }).then(function () { location.reload(); });
    });
    $("#save-btn").addEventListener("click", save);
    $("#discard-btn").addEventListener("click", discard);
    $("#menu-btn").addEventListener("click", function () { $("#side").classList.toggle("open"); $("#scrim").classList.toggle("show"); });
    $("#scrim").addEventListener("click", function () { $("#side").classList.remove("open"); $("#scrim").classList.remove("show"); });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && S.entered && !$("#app").hidden) { e.preventDefault(); if (isDirty()) save(); }
      if (e.key === "Escape" && !$("#modal").hidden) closeModal();
    });

    if (location.protocol === "file:") {
      showLogin();
      var e = $("#login-error");
      e.textContent = "This page was opened directly from your computer (double-click). The Admin Panel cannot work that way: it needs your website to be uploaded to hosting that supports PHP. Please follow HOW-TO-UPLOAD.txt, then open yourdomain.com/admin.";
      e.hidden = false;
      return;
    }
    api("session").then(function (r) {
      if (r.ok && r.loggedIn) { S.csrf = r.csrf; S.user = r.user; S.mustChange = !!r.mustChange; enter(); }
      else {
        showLogin(r.ok ? "" : r.error);
        if (!r.ok) { $("#login-error").textContent = r.error || ""; $("#login-error").hidden = !r.error; }
      }
    });
  }

  init();
})();
