# Project instructions — Verrow Capital

## Deploy workflow (important)

When a task is finished, **stop and ask the user how to ship it**. Never
commit or push on your own. Offer these three options:

1. **Deploy now** — commit the changes and push to `origin main`.
   Vercel auto-deploys from `main`, so the live site updates in ~1 minute.
2. **Deploy later** — save the work as a local commit but do **not** push.
   The user reviews it (e.g. on the local preview) and can ask to deploy
   whenever they want — pushing is then the only remaining step.
3. **Revert** — undo everything from this task and restore the code to the
   last pushed state, as if the work never happened.

With the question, include a one or two line summary of what changed so the
user can decide. Record the current commit SHA before starting, so "revert"
is exact. If the user dislikes something that is already deployed, revert it
with a new commit and push that.

If the user's request already spells out the choice (e.g. "fix it and
deploy"), just do that — no need to ask again. Never run `git push` without
an explicit deploy instruction from the user.

## Local preview

Serve the site from the repo root with:

```
python -m http.server 8123
```

then open http://localhost:8123/index.html. Use this to review changes
before deploying.

## Project context

- Static site (`index.html`, `wealth.html`, `private-capital.html`,
  `advisory.html`, `consultation.html`, `privacy.html`, `terms.html`,
  `disclosures.html`) deployed on Vercel.
- `api/contact.js` is a Vercel serverless function — the forms POST to it.
  Email sending is a mockup until `RESEND_API_KEY` and `CONTACT_EMAIL`
  (optional `CONTACT_FROM`) are configured in Vercel.
- Styling is inlined per page; the shared palette uses `--teal-bright`
  (#7ef0e0) and `--teal-mid` (#2aa5c9).
