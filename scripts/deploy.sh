#!/usr/bin/env bash
# Deploys rememberdonnie.com: tests and publishes the API code, uploads the site,
# and invalidates CloudFront.
#
#   scripts/deploy.sh            API + site
#   scripts/deploy.sh --infra    update the CloudFormation stack first
#
# Bucket, distribution and function names come from the stack outputs unless
# SITE_BUCKET / DISTRIBUTION_ID / API_FUNCTION are already set (CI sets them).
# To get an email for each new memory, run once with NOTIFICATION_EMAIL=you@example.com
# and --infra; the stack remembers it after that.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK=${STACK:-rememberdonnie}
export AWS_REGION=${AWS_REGION:-us-east-1}
export AWS_DEFAULT_REGION=$AWS_REGION

if [[ "${1:-}" == "--infra" ]]; then
  echo "==> CloudFormation stack: $STACK"
  overrides=()
  if [[ -n "${NOTIFICATION_EMAIL:-}" ]]; then overrides=(--parameter-overrides "NotificationEmail=$NOTIFICATION_EMAIL"); fi
  aws cloudformation deploy \
    --stack-name "$STACK" \
    --template-file infrastructure/rememberdonnie-cloudformation.yaml \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --tags project=rememberdonnie \
    "${overrides[@]}"
fi

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
SITE_BUCKET=${SITE_BUCKET:-$(output SiteBucketName)}
DISTRIBUTION_ID=${DISTRIBUTION_ID:-$(output DistributionId)}
API_FUNCTION=${API_FUNCTION:-$(output ApiFunctionName)}

echo "==> API: test, bundle, publish to $API_FUNCTION"
(cd api && npm ci --no-audit --no-fund && npm test && npm run package)
aws lambda update-function-code --function-name "$API_FUNCTION" --zip-file fileb://api/dist/api.zip \
  --query 'LastUpdateStatus' --output text
aws lambda wait function-updated-v2 --function-name "$API_FUNCTION"

echo "==> Site: s3://$SITE_BUCKET"
node scripts/check-site.mjs
VERSION=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
cp -R site/. "$BUILD/"
for page in "$BUILD"/*.html; do
  sed -i.bak "s/?v=dev/?v=$VERSION/g" "$page" && rm -f "$page.bak"
done

# Explicit content types: the CLI's guesses vary by platform (.webp especially).
upload() { # <glob> <content-type> <cache-control>
  aws s3 sync "$BUILD" "s3://$SITE_BUCKET" --only-show-errors \
    --exclude "*" --include "$1" --content-type "$2" --cache-control "$3"
}
upload "*.html" "text/html; charset=utf-8" "public, max-age=300"
upload "*.css"  "text/css; charset=utf-8" "public, max-age=86400"
upload "*.js"   "text/javascript; charset=utf-8" "public, max-age=86400"
upload "*.webp" "image/webp" "public, max-age=86400"
upload "*.jpg"  "image/jpeg" "public, max-age=86400"
upload "*.png"  "image/png" "public, max-age=86400"
upload "*.svg"  "image/svg+xml" "public, max-age=86400"
upload "*.txt"  "text/plain; charset=utf-8" "public, max-age=3600"
# Remove anything no longer in site/ (size-only so nothing above is re-uploaded).
aws s3 sync "$BUILD" "s3://$SITE_BUCKET" --delete --size-only --only-show-errors

echo "==> CloudFront invalidation"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text

echo "Deployed $VERSION to https://rememberdonnie.com"
