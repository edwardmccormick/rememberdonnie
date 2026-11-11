# Remember Donnie

**[rememberdonnie.com](https://rememberdonnie.com)** — a memorial for Donnie Edward McNeal Jr., "DJ"
(January 17, 1981 – October 13, 2026). *Great Engineer. Better person.*

The page is paper, ink and one blue. Donnie's own words carry it.

- **In his own words**: messages, commit messages and code comments that Donnie wrote, in date
  order. Every entry is a quotation. Nobody rewrites one.
- **Memory wall**: anyone can share a story, with an optional photo.
- **Light a candle**: a shared counter.
- **A Celebration of Life**: the service details, the program and the Rest in Power mural.

No framework and no front-end build step. It's plain HTML, CSS and JavaScript, so it keeps working for years without upkeep.

## How it fits together

```
browser ── rememberdonnie.com (CloudFront, ACM cert, security headers + CSP)
             ├── /*         → S3 site bucket (private, Origin Access Control)
             ├── /photos/*  → S3 media bucket, photos/ prefix only (approved photos)
             └── /api/*     → HTTP API → Lambda (Node 22) → DynamoDB
                                             ├── S3 media bucket (presigned uploads to pending/)
                                             ├── Secrets Manager (admin key)
                                             └── SNS (optional email per new memory)
```

Everything is in [`infrastructure/rememberdonnie-cloudformation.yaml`](infrastructure/rememberdonnie-cloudformation.yaml),
stack `rememberdonnie` in us-east-1. Buckets and the table are retained if the stack is deleted, and the
table has point-in-time recovery: these memories matter.

| Path | What |
| --- | --- |
| `site/` | The site: `index.html`, `admin.html`, `404.html`, `assets/` |
| `api/` | The API. `src/app.js` is the logic, `src/aws.js` the AWS adapters, `src/rules.js` validation and moderation |
| `scripts/dev-server.mjs` | Local preview that runs the real API logic against in-memory storage |
| `scripts/deploy.sh` | Test, bundle and publish the API; upload the site; invalidate CloudFront |
| `words/words.json` | The quotations for *In his own words*. `scripts/build-words.mjs` renders them into `site/index.html` |
| `scripts/build-images.py` | Generates the portrait, mural, program, social card and icon from `source-images/` |

## Moderation

Plain-text memories go on the wall immediately. Some memories wait for review first:

- memories with a **photo**
- memories with a **link**
- submissions that didn't come through the form

Bots that trip the honeypot field, or submit faster than a person could type, get a fake success and nothing is stored.
Each visitor can share up to 8 memories, 16 photos and 12 candles a day. Rate limits use a salted
hash of the visitor's IP, so raw IPs are never stored.

Review queue: **https://rememberdonnie.com/admin**. Approve, hide (reversible) or delete. The admin key:

```bash
aws secretsmanager get-secret-value --secret-id rememberdonnie/admin-key --query SecretString --output text
```

To get an email whenever a memory is shared, set the address once. The stack remembers it, and AWS
sends a confirmation email first:

```bash
NOTIFICATION_EMAIL=you@example.com scripts/deploy.sh --infra
```

To review *everything* before it appears, or nothing, redeploy the stack with the `ModerationMode`
parameter set to `all` or `none`.

Photos are resized in the browser to 1800px and re-encoded as JPEG before upload. Re-encoding also
strips location metadata from phone photos.

## Local development

```bash
cd api && npm ci && cd ..
node scripts/dev-server.mjs --seed     # http://localhost:8787, admin key: dev-admin-key
```

`--seed` fills the wall with obvious placeholders so you can see the layout. The dev server sends
the same Content-Security-Policy as production, so a change that would break under CSP breaks
locally too.

```bash
cd api && npm test                     # API tests
node scripts/check-site.mjs            # asset references + CSP-safe markup
```

## Deploying

```bash
scripts/deploy.sh            # API + site (what you usually want)
scripts/deploy.sh --infra    # CloudFormation stack first
```

**Leave the Lambda's inline placeholder code in the template unchanged.** The real code is published
by `deploy.sh`, so editing the placeholder would overwrite the live API on the next stack update.

### Deploying from GitHub

`.github/workflows/pipeline.yaml` tests every push and PR. Every push to `main` then runs
`scripts/deploy.sh` as the `rememberdonnie-website-deploy` role, through GitHub OIDC with no
long-lived keys. Only `main` of this repo can assume the role. It can read the site stack's outputs,
publish to the site bucket, update the API function's code and invalidate the distribution, and
nothing else. Infrastructure changes (`--infra`) still need to be run by hand.

The role lives in stack `rememberdonnie-github-deploy`, and its ARN is the repository secret
`AWS_DEPLOY_ROLE_ARN`. To recreate it:

```bash
aws cloudformation deploy --stack-name rememberdonnie-github-deploy \
  --template-file infrastructure/github-deploy-role-cloudformation.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides DistributionId=<DistributionId output of the rememberdonnie stack>
aws cloudformation describe-stacks --stack-name rememberdonnie-github-deploy \
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text \
  | gh secret set AWS_DEPLOY_ROLE_ARN
```

This repo emits GitHub's *immutable* OIDC subject (`repo:owner@id/repo@id:…`), so the role trusts
that format as well as the classic `repo:owner/repo:…` one.

## Changing the content

- **His story**: the `#story` section of `site/index.html`. If the family shares an obituary or more
  about his life, this is where it goes.
- **His words**: add an entry to `words/words.json` (`date`, `by`, `where`, `text`), run
  `node scripts/build-words.mjs`, and commit both files. Copy the text exactly, typos included. Get
  consent before you publish another person's words, a child's name or a customer's name. Set
  `"hold": true` to keep an entry off the page.
- **Images**: put new originals in `source-images/`, adjust `scripts/build-images.py`, run it, and commit the output.

## Cost

About a dollar a month: the Route 53 zone ($0.50) and the admin-key secret ($0.40). CloudFront, S3,
Lambda and DynamoDB stay inside the free tier or close to $0 at memorial-site traffic.
