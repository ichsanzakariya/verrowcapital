# State map

The site is static HTML plus vanilla JS, so its state used to live in whichever
class, flag or label the nearest function happened to touch. This document is
the contract for the state that is now explicit, and the inventory of the state
that is deliberately left local.

The runtime is `assets/js/state.js`. It is loaded synchronously before each
page's inline script and has no dependencies.

## Why a state layer

Three audiences read the same behaviour:

- **UX** needs every async action to have a visible, recoverable outcome.
- **DX** needs one implementation per pattern, so fixes do not have to be made
  in eight files.
- **AX** needs to know what the page is doing without reverse-engineering it.

A named machine gives all three the same truth: the state is in the registry,
mirrored onto the element, and emitted as an event.

## The contract

Every machine:

1. Has a unique name.
2. Declares an initial state and a transition table.
3. Reflects its state onto its element:

   ```html
   <form id="newsletterForm" data-machine="newsletter-form" data-state="idle">
   ```

4. Emits `verrow:state` on the element (bubbling) with
   `{ machine, from, to, event, at, el, context }`.
5. Rejects illegal events. A double submit, a duplicate scroll event, or a
   second `close` while already closed is a no-op by construction.

The runtime exposes:

```js
Verrow.snapshot();          // every machine, plus reveal progress
Verrow.waitFor(name, state) // Promise that resolves on the transition
Verrow.subscribe(fn);       // fn(entry, snapshot) on every transition
Verrow.log();               // last 50 transitions
```

Console examples:

```js
Verrow.snapshot();
Verrow.waitFor("consultation-form", "sent").then(console.log);
document.addEventListener("verrow:state", (e) => console.log(e.detail));
```

`<html data-motion="full|reduced">` exposes the motion mode the page booted
with. `snapshot().motion` is the same value. It is read once at load, matching
the `prefersReduced` constant the page scripts use.

## Machines in the runtime

| Machine | Element | States | Events |
| --- | --- | --- | --- |
| `nav` | `.nav` | `top`, `scrolled` | `enter`, `leave` |
| `mobile-menu` | `#primary-nav` | `closed`, `open` | `open`, `close`, `toggle` |
| `hero-video` | `.hero-media` | `idle`, `playing`, `paused`, `blocked`, `still` | `play`, `pause`, `blocked`, `still` |
| `wordmark` | `.watermark` | `fitting`, `fitted` | `fitted` |
| `newsletter-form` | `#newsletterForm` | `idle`, `sending`, `sent`, `error` | `submit`, `ok`, `fail` |
| `consultation-form` | `#consultForm` | `idle`, `sending`, `sent`, `error` | `submit`, `ok`, `fail` |
| `reveal` | `.page` | `revealing`, `complete` | `complete` |
| `chart-performance` | `#chartWrap` | `waiting`, `drawing`, `drawn` | `draw`, `done` |
| `chart-allocation` | `#ringRow` | `waiting`, `drawing`, `drawn` | `draw`, `done` |
| `chart-scatter` | `#scatterWrap` | `waiting`, `drawing`, `drawn` | `draw`, `done` |
| `chart-resilience` | `#uwWrap` | `waiting`, `drawing`, `drawn` | `draw`, `done` |

`reveal` exists on the seven inner pages. The homepage keeps its original
`.reveal` / `.visible` choreography; `snapshot().reveal` reports `total` and
`done` for both systems.

### Form transitions

```
idle --submit--> sending --ok----> sent
                     \--fail--> error --submit--> sending
```

The shared form helper owns the guard, `aria-busy`, the pending and success
labels, the 20 second timeout, error recovery, and the accessible status
message. Page-specific UI is supplied with `onStart`, `onSuccess` and
`onError`.

### Hero transitions

```
idle --play--> playing --pause--> paused --play--> playing
  \--blocked--> blocked --play--> playing
  \--still--> still            (reduced motion, no playback)
```

`blocked` is a real state: if autoplay is refused, the poster stays up and the
first pointer interaction retries. Playback is paused when the hero leaves the
viewport or the tab is hidden, through one `syncHero()` decision rather than
two listeners fighting.

## Deliberately local state

These are per-frame or pointer values. Putting them in the registry would add
cost without adding truth, so they stay next to the code that draws them:

| Behaviour | Where | Read it from |
| --- | --- | --- |
| Section spy | `index.html` | `.nav-links a.active`, `.nav[data-section]` |
| Scroll progress | `index.html` | `.scroll-progress` transform |
| Stat count-up | `index.html` | final value in the DOM |
| Chart hover / tooltip index | `index.html` | `:hover` UI, no persistent state |
| Process line draw | `index.html` | `--p` on `.process-list` |
| Testimonial word lighting | `index.html` | `.qw.lit` count |

The rule: if a value survives a render, changes because of a user decision, or
can fail, it belongs in a machine. If it is derived from scroll position or a
pointer in the same frame, it stays local.

## Server endpoint

`api/contact.js` is stateless per request:

```
method check -> configuration check -> parse -> validate -> provider -> 200 | 4xx | 502
```

It returns `501` when `RESEND_API_KEY` or `CONTACT_EMAIL` is missing, so the
client shows an honest error instead of a fake success. The client machine
treats any non-2xx as `fail`.

## Adding a machine

```js
const example = Verrow.machine("example", {
  el: document.querySelector("#example"),
  initial: "idle",
  states: {
    idle: { start: "running" },
    running: { done: "finished", fail: "error" },
    finished: {},
    error: { start: "running" }
  },
  render: (state) => {
    // derive classes / aria from state here, never toggle them elsewhere
  }
});

example.send("start");
```

Rules:

- One machine per element. Do not put two `data-machine` attributes on the
  same node.
- Apply classes and ARIA in `render`, so they cannot drift from the state.
- Use explicit event names. `send()` returns `false` for illegal transitions.
- Add the machine to the table above and cover its transitions in the state
  harness.

## Verification

- `dbg_state_index.py` checks boot state, nav, menu, hero, charts, wordmark and
  reveal on the homepage, at desktop and mobile.
- `dbg_state_forms.py` checks success, error, recovery, double-submit and the
  20 second timeout on both forms, with `fetch` stubbed in the page.
- `dbg_state_pages.py` checks the reveal machine on all seven inner pages and
  the reduced-motion path.
- `foot_check8.py` and `full_check.py` guard the footer and contact layout.
