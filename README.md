# Verrow Capital

The public website for **Verrow Capital**, an independent investment advisory
firm. A fast, dependency-free marketing site with an explicitly modelled UI
state layer and a small serverless endpoint for enquiries.

**Live:** [verrowcapital.vercel.app](https://verrowcapital.vercel.app)

---

## Overview

The site is deliberately built as static HTML, per-page CSS and vanilla
JavaScript. There is no build step, no framework and no runtime dependency, so
any file can be opened, deployed or audited on its own. Two things give it
structure beyond that baseline:

- **A shared state runtime** (`assets/js/state.js`) that owns every durable,
  observable UI state as a named machine with a validated transition table.
- **A single serverless function** (`api/contact.js`) that receives both forms
  and forwards them through [Resend](https://resend.com).

## Pages

| Path | Purpose |
| --- | --- |
| `/` | Home: positioning, services, portfolio analytics, resilience, process, contact |
| `/wealth` | Wealth Management service page |
| `/private-capital` | Private Capital service page |
| `/advisory` | Strategic Advisory service page |
| `/consultation` | Consultation request form |
| `/privacy` | Privacy Policy |
| `/terms` | Terms of Use |
| `/disclosures` | Regulatory Disclosures |

Clean URLs are enabled in `vercel.json`, so pages are served without the
`.html` extension.

## Architecture

```
.
├── index.html                  # Home page (markup + page-scoped CSS + inline script)
├── wealth.html                 # Service pages share the same pattern
├── private-capital.html
├── advisory.html
├── consultation.html
├── privacy.html                # Legal pages
├── terms.html
├── disclosures.html
├── api/
│   └── contact.js              # Vercel serverless function (POST /api/contact)
├── assets/
│   ├── js/state.js             # State runtime, reveal helper, form helper
│   ├── favicon/                # Full icon set (SVG, ICO, PNG, apple-touch)
│   ├── logos/                  # Partner logos, white monochrome SVG
│   ├── hero-loop.webm          # Hero video (VP9), with MP4 fallback and poster
│   ├── hero-loop.mp4
│   └── hero-loop-poster.jpg
├── site.webmanifest            # PWA metadata and icons
├── vercel.json                 # Clean URLs and asset caching
├── STATE.md                    # Contract for the state layer
└── AGENTS.md                   # Working notes for contributors and agents
```

Design notes:

- **Styling is scoped per page.** Each page carries its own `<style>` block so a
  page's CSS ships only where it is used. The palette is shared by convention:
  `--teal-bright` (`#7ef0e0`), `--teal-mid` (`#2aa5c9`), paper (`#f4f3ef`) on
  ink (`#030a12`).
- **Type** is Instrument Serif for display and Inter for body copy, loaded from
  Google Fonts.
- **Motion** is gated on `prefers-reduced-motion`. The boot-time mode is exposed
  as `<html data-motion="full|reduced">`.

## State layer

Most UI bugs in a site like this come from state that lives in a class name, a
disabled flag and a label inside three different functions. `assets/js/state.js`
gives that state one owner:

```js
const menu = Verrow.machine("mobile-menu", {
  el: document.querySelector("#primary-nav"),
  initial: "closed",
  states: {
    closed: { open: "open", toggle: "open" },
    open: { close: "closed", toggle: "closed" }
  },
  render: (state) => {
    // classes and ARIA are derived from state, never toggled elsewhere
  }
});

menu.send("toggle");
```

Every machine:

1. Declares an initial state and a transition table, validated at load so a typo
   fails immediately rather than at the moment a user needs it.
2. Reflects its state onto its element as `data-machine` / `data-state`.
3. Emits a bubbling `verrow:state` event with
   `{ machine, from, to, event, at, el, context }`.
4. Rejects illegal transitions, which makes double submits and repeated scroll
   events harmless by construction.

| Machine | Element | States |
| --- | --- | --- |
| `nav` | `.nav` | `top`, `scrolled` |
| `mobile-menu` | `#primary-nav` | `closed`, `open` |
| `hero-video` | `.hero-media` | `idle`, `playing`, `paused`, `blocked`, `still` |
| `wordmark` | `.watermark` | `fitting`, `fitted` |
| `newsletter-form` | `#newsletterForm` | `idle`, `sending`, `sent`, `error` |
| `consultation-form` | `#consultForm` | `idle`, `sending`, `sent`, `error` |
| `reveal` | `.page` | `revealing`, `complete` |
| `chart-performance` | `#chartWrap` | `waiting`, `drawing`, `drawn` |
| `chart-allocation` | `#ringRow` | `waiting`, `drawing`, `drawn` |
| `chart-scatter` | `#scatterWrap` | `waiting`, `drawing`, `drawn` |
| `chart-resilience` | `#uwWrap` | `waiting`, `drawing`, `drawn` |

### Inspection API

Every state is readable at runtime, which makes the site testable without
reading its source:

```js
Verrow.snapshot();           // every machine, plus reveal progress
Verrow.waitFor(name, state); // Promise that resolves on the transition
Verrow.subscribe(fn);        // fn(entry, snapshot) on every transition
Verrow.log();                // last 50 transitions
```

In the browser console:

```js
Verrow.snapshot();
Verrow.waitFor("consultation-form", "sent").then(console.log);
document.addEventListener("verrow:state", (e) => console.log(e.detail));
```

The full contract, including the state that is deliberately left local to
per-frame rendering, is in [STATE.md](STATE.md).

## Forms and email

Both forms post JSON to `POST /api/contact`:

```jsonc
// Newsletter
{ "type": "newsletter", "email": "reader@example.com" }

// Consultation
{
  "type": "consultation",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1 (555) 000-0000",
  "service": "Wealth Management",
  "message": "…"
}
```

The endpoint validates input, forwards the enquiry to the configured inbox via
Resend, and returns `200` on success. The client form machine owns the
double-submit guard, `aria-busy`, pending and success labels, a 20 second
timeout, error recovery and an accessible status message.

### Environment variables

Set these in the Vercel project settings (or a local `.env.local`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes | API key from [resend.com/api-keys](https://resend.com/api-keys) |
| `CONTACT_EMAIL` | Yes | Inbox that receives submissions |
| `CONTACT_FROM` | No | Verified sender, e.g. `Verrow Capital <site@verrowcapital.com>` |

When `RESEND_API_KEY` or `CONTACT_EMAIL` is missing, the endpoint answers
`501 Not Configured` so the interface shows an honest error instead of a fake
success.

## Local development

Requirements: Python 3 (for a static server) and, if you want to exercise the
forms, the Vercel CLI.

```bash
python -m http.server 8123
```

Open <http://localhost:8123/index.html>. The forms will fail locally because
`/api/contact` is not running; that is expected and exercises the error path.

To run the function and the site together:

```bash
vercel dev
```

## Deployment

The repository is connected to the Vercel project `verrowcapital`
(team `portfolio-f1f8`). Pushing to `main` deploys to production automatically.

Manual deploy:

```bash
vercel deploy --prod --yes
```

`vercel.json` enables clean URLs and caches `/assets/*` for 24 hours with a
stale-while-revalidate window.

## Browser support

Current versions of Chrome, Edge, Safari and Firefox, on desktop and mobile.
The site degrades safely: without `IntersectionObserver`, reveals and charts
resolve to their final frame; with reduced motion requested, animation is
skipped entirely and the hero holds its poster.

## Contributing

- Keep the no-build-step rule. Any new behaviour should work when the file is
  served as-is.
- Put durable state in a machine and derive classes and ARIA in its `render`,
  so the two cannot drift apart.
- Never ship an em dash in site copy.
- Update [STATE.md](STATE.md) when you add or change a machine.

## License

Proprietary. All rights reserved. This repository is not licensed for reuse
outside Verrow Capital.
