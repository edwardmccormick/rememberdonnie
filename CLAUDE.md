# rememberdonnie.com

A memorial for Donnie Edward McNeal Jr. Pushing to `main` deploys straight to production.

## The copy is human territory

Models change code, layout and styling. People write the copy.

**Copy** is any text a visitor can read or hear: page text and headings, button labels, placeholders,
alt text, captions, `aria-label`s, error and confirmation messages (in `site/assets/js/` and
`api/src/`), notification emails, the page title and meta/OG descriptions, and text drawn into images
by `scripts/build-images.py`.

- Apply copy you are given verbatim: wording, punctuation and capitalization exactly as written.
  Invisible typography (a non-breaking space so a line never starts with a hyphen) is fine; say what
  you did.
- When a change needs copy that does not exist yet, reuse words already on the site or ask a person
  for them. If you build before you have them, mark the spot `[COPY NEEDED: what it is for]` and raise
  it before anything ships.
- Small fixes are copy changes too (typos, grammar, tone, tightening): point them out and let a person
  decide.
