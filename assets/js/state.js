/*!
 * Verrow Capital state runtime
 * ---------------------------------------------------------------------
 * The site's durable UI state lives here, in named machines with explicit
 * transitions. Each machine reflects its state onto its element as
 * data-machine / data-state, dispatches a `verrow:state` event, and can be
 * inspected from anywhere with Verrow.snapshot().
 *
 * Boundary: only durable, observable state belongs in a machine (forms,
 * menu, nav, media, reveals, layout readiness). Per-frame render values
 * (chart sweep progress, hover index, scroll ratio) stay local to the code
 * that draws them, because a machine would add cost without adding truth.
 *
 * No dependencies. Loaded synchronously before each page's inline script.
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var LOG_LIMIT = 50;
  var registry = new Map();
  var listeners = [];
  var log = [];

  // Read once at boot, matching the value the pages use for their animation
  // decisions. Mirrored onto <html data-motion> so CSS, scripts and agents
  // all read the same mode.
  var motion = window.matchMedia &&
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
  document.documentElement.setAttribute("data-motion", motion);

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function label(el) {
    if (!el) return null;
    if (el.id) return "#" + el.id;
    var classes = String(el.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return el.tagName.toLowerCase() + (classes.length ? "." + classes.join(".") : "");
  }

  function snapshot() {
    var machines = {};
    registry.forEach(function (record) {
      machines[record.name] = {
        state: record.state,
        transitions: record.transitions,
        target: label(record.el),
        context: Object.assign({}, record.context)
      };
    });
    var revealAll = document.querySelectorAll(".reveal, .reveal-fade, .rv, .rv-fade");
    var revealDone = document.querySelectorAll(
      ".reveal.visible, .reveal-fade.visible, .rv.on, .rv-fade.on"
    );
    var activeLink = document.querySelector(".nav-links a.active");
    return {
      version: VERSION,
      page: location.pathname.split("/").pop() || "index.html",
      motion: motion,
      section: activeLink ? (activeLink.getAttribute("href") || "").replace("#", "") : null,
      reveal: {
        total: revealAll.length,
        done: revealDone.length
      },
      machines: machines
    };
  }

  function announce(entry) {
    log.push(entry);
    if (log.length > LOG_LIMIT) log.shift();
    var current = listeners.length ? snapshot() : null;
    listeners.slice().forEach(function (fn) {
      try {
        fn(entry, current);
      } catch (err) {
        console.error("[Verrow] state listener failed", err);
      }
    });
    var event;
    try {
      event = new CustomEvent("verrow:state", { bubbles: true, detail: entry });
    } catch (err) {
      return;
    }
    if (entry.el) entry.el.dispatchEvent(event);
    else document.dispatchEvent(event);
  }

  /**
   * Create a named machine.
   *
   * Verrow.machine("menu", {
   *   el: nav,
   *   initial: "closed",
   *   states: { closed: { open: "open" }, open: { close: "closed" } },
   *   render: function (state) { ... }
   * })
   *
   * send(event) returns true only when the event is legal in the current
   * state. Illegal events are ignored, which makes double submits and
   * repeated scroll events harmless by construction.
   */
  function machine(name, options) {
    if (!name || typeof name !== "string") {
      throw new TypeError("[Verrow] a machine needs a name");
    }
    if (registry.has(name)) {
      throw new Error('[Verrow] duplicate machine "' + name + '"');
    }
    options = options || {};
    var states = options.states || {};
    var initial = options.initial;
    if (!initial || !states[initial]) {
      throw new Error('[Verrow] machine "' + name + '" needs an initial state in its table');
    }
    // Catch typos at load, not at the moment a user needs the transition.
    Object.keys(states).forEach(function (from) {
      Object.keys(states[from] || {}).forEach(function (event) {
        var to = states[from][event];
        if (!states[to]) {
          throw new Error('[Verrow] machine "' + name + '" routes ' + from + "." + event +
            ' to unknown state "' + to + '"');
        }
      });
    });

    var record = {
      name: name,
      state: initial,
      since: now(),
      el: options.el || null,
      context: Object.assign({}, options.context || {}),
      transitions: 0
    };
    registry.set(name, record);

    function render(state, previous) {
      if (record.el) record.el.setAttribute("data-state", state);
      if (typeof options.render === "function") {
        try {
          options.render(state, record.el, previous);
        } catch (err) {
          console.error('[Verrow] render for "' + name + '" failed', err);
        }
      }
    }

    if (record.el) record.el.setAttribute("data-machine", name);
    render(initial, null);

    return {
      name: name,
      get state() {
        return record.state;
      },
      get context() {
        return Object.assign({}, record.context);
      },
      get el() {
        return record.el;
      },
      is: function (state) {
        return record.state === state;
      },
      send: function (event, detail) {
        var table = states[record.state] || {};
        var next = table[event];
        if (!next) return false;
        var previous = record.state;
        record.state = next;
        record.since = now();
        record.transitions += 1;
        if (detail && typeof detail === "object") {
          Object.assign(record.context, detail);
        }
        render(next, previous);
        announce({
          machine: name,
          from: previous,
          to: next,
          event: event,
          at: Date.now(),
          el: record.el,
          context: Object.assign({}, record.context)
        });
        return true;
      }
    };
  }

  /**
   * Scroll reveal for the inner pages. Marks every matching block with
   * .rv / .rv-fade, staggers the first screen top to bottom, then reveals
   * the rest as it enters the viewport. A scroll sweep backs the observer.
   *
   * Returns the `reveal` machine, which reaches "complete" when every
   * marked block is visible.
   */
  function reveal(selectors, options) {
    if (motion === "reduced") return null;
    options = options || {};

    var items = [];
    var marked = new Set();
    (selectors || []).forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (el) {
        if (marked.has(el)) return;
        marked.add(el);
        el.classList.add(el.matches(".cta, .submit-btn") ? "rv-fade" : "rv");
        items.push(el);
      });
    });

    items.sort(function (a, b) {
      return (a.getBoundingClientRect().top + window.scrollY) -
        (b.getBoundingClientRect().top + window.scrollY);
    });

    var step = options.step == null ? 0.045 : options.step;
    var cap = options.cap == null ? 0.3 : options.cap;
    var run = 0;
    items.forEach(function (el) {
      if (el.getBoundingClientRect().top + window.scrollY > window.innerHeight) return;
      el.style.setProperty("--rv-d", Math.min(run * step, cap) + "s");
      run += 1;
    });

    var root = options.root ? document.querySelector(options.root) : document.querySelector(".page");
    var api = machine("reveal", {
      el: root || document.body,
      initial: items.length ? "revealing" : "complete",
      states: {
        revealing: { complete: "complete" },
        complete: {}
      },
      context: { total: items.length }
    });

    var done = 0;
    function show(el) {
      if (el.classList.contains("on")) return;
      el.classList.add("on");
      done += 1;
      if (done === items.length) api.send("complete");
    }

    if (!items.length) return api;

    if (!("IntersectionObserver" in window)) {
      items.forEach(show);
      return api;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        show(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    items.forEach(function (el) {
      io.observe(el);
    });

    var sweep = function () {
      var vh = window.innerHeight;
      items.forEach(function (el) {
        if (el.classList.contains("on")) return;
        var rect = el.getBoundingClientRect();
        if (rect.top < vh * 0.92 && rect.bottom > 0) show(el);
      });
    };
    window.addEventListener("scroll", sweep, { passive: true });
    window.addEventListener("resize", sweep, { passive: true });
    setTimeout(sweep, 120);
    return api;
  }

  /**
   * Attach the standard async form machine:
   *
   *   idle --submit--> sending --ok--> sent
   *                        \--fail--> error --submit--> sending
   *
   * Owns the double-submit guard, pending/success labels, aria-busy,
   * accessibility message, a 20s timeout, and error recovery. Page-specific
   * success and error UI is supplied through callbacks.
   */
  function form(options) {
    options = options || {};
    var formEl = options.form;
    var button = options.button || (formEl && formEl.querySelector('button[type="submit"]'));
    if (!formEl || !button || !options.name) return null;

    var message = Object.prototype.hasOwnProperty.call(options, "message")
      ? options.message
      : formEl.querySelector("[role='status']");
    var endpoint = options.endpoint || "/api/contact";
    var timeout = options.timeout || 20000;
    var originalLabel = button.textContent;
    var messages = Object.assign({
      error: "Something went wrong. Please try again, or email hello@verrowcapital.com.",
      timeout: "The request took too long. Please try again, or email hello@verrowcapital.com."
    }, options.messages || {});

    var api = machine(options.name, {
      el: formEl,
      initial: "idle",
      states: {
        idle: { submit: "sending" },
        error: { submit: "sending" },
        sending: { ok: "sent", fail: "error" },
        sent: {}
      }
    });

    if (message && !message.hasAttribute("aria-live")) {
      message.setAttribute("aria-live", "polite");
    }

    function showMessage(text, isError) {
      if (!message) return;
      message.textContent = text;
      message.classList.toggle("error", !!isError);
      message.hidden = !text;
    }

    formEl.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (api.state === "sending" || api.state === "sent") return;

      var payload;
      try {
        payload = options.payload ? options.payload() : Object.fromEntries(new FormData(formEl));
      } catch (err) {
        console.error("[Verrow] could not read the form", err);
        return;
      }

      api.send("submit");
      formEl.setAttribute("aria-busy", "true");
      button.disabled = true;
      button.textContent = options.pendingLabel || "Sending…";
      if (message) showMessage("", false);
      if (typeof options.onStart === "function") {
        try {
          options.onStart();
        } catch (err) {
          console.error("[Verrow] form onStart failed", err);
        }
      }

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
      }, timeout);

      var failure = null;
      try {
        var request = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        };
        if (controller) request.signal = controller.signal;
        var response = await fetch(endpoint, request);
        if (!response.ok) throw new Error("Request failed (" + response.status + ")");
      } catch (err) {
        failure = err;
      } finally {
        clearTimeout(timer);
        formEl.removeAttribute("aria-busy");
      }

      if (failure) {
        api.send("fail");
        button.disabled = false;
        button.textContent = originalLabel;
        var timedOut = failure.name === "AbortError";
        if (typeof options.onError === "function") {
          try {
            options.onError(failure, timedOut);
          } catch (err) {
            console.error("[Verrow] form onError failed", err);
          }
        } else {
          showMessage(timedOut ? messages.timeout : messages.error, true);
        }
        return;
      }

      api.send("ok");
      button.disabled = true;
      button.textContent = options.successLabel || "Sent";
      if (typeof options.onSuccess === "function") {
        try {
          options.onSuccess();
        } catch (err) {
          console.error("[Verrow] form onSuccess failed", err);
        }
      }
    });

    return api;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  function waitFor(name, state, timeout) {
    return new Promise(function (resolve, reject) {
      var record = registry.get(name);
      if (!record) {
        reject(new Error('[Verrow] unknown machine "' + name + '"'));
        return;
      }
      if (record.state === state) {
        resolve(snapshot().machines[name]);
        return;
      }
      var stop = null;
      var timer = setTimeout(function () {
        if (stop) stop();
        reject(new Error('[Verrow] timed out waiting for "' + name + '" to reach "' + state + '"'));
      }, timeout || 8000);
      stop = subscribe(function (entry) {
        if (entry.machine !== name || entry.to !== state) return;
        clearTimeout(timer);
        stop();
        resolve(snapshot().machines[name]);
      });
    });
  }

  function history() {
    return log.slice();
  }

  window.Verrow = {
    version: VERSION,
    motion: motion,
    machine: machine,
    reveal: reveal,
    form: form,
    snapshot: snapshot,
    subscribe: subscribe,
    waitFor: waitFor,
    log: history
  };
})();
