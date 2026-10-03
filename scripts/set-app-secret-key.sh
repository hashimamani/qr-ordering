#!/usr/bin/env bash
#
# Sets ONE key in the shared AppSecret without touching the others.
#
# `aws secretsmanager update-secret`/`put-secret-value` replaces the WHOLE
# JSON document, so passing a partial object silently destroys everything
# else in there -- including jwtSecret and platformAdminJwtSecret, which
# would invalidate every staff session and lock the platform admin out.
# This reads the current document, merges one key, checks nothing was
# lost, and writes it back.
#
# Secret material never appears in argv (visible to any `ps` on the box):
# the value comes from a silent prompt, the document moves through stdin,
# and the write goes via a 0600 temp file passed as file://, not as
# --secret-string on the command line.
#
# Usage:  ./scripts/set-app-secret-key.sh whatsappAccessToken
set -euo pipefail

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  echo "usage: $0 <keyName>   (e.g. whatsappAccessToken)" >&2
  exit 1
fi

REGION="${AWS_REGION:-eu-west-1}"
SECRET_ID="${APP_SECRET_ID:-arn:aws:secretsmanager:eu-west-1:304442552123:secret:AppSecretFAB5164C-D817UbOYNHd2-AP740U}"

WORK="$(mktemp -d)"
chmod 700 "$WORK"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

read -r -s -p "Value for ${KEY} (input hidden): " VALUE
echo
if [[ -z "$VALUE" ]]; then
  echo "empty value; aborting" >&2
  exit 1
fi

OUT="$WORK/secret.json"
(umask 077; : >"$OUT")

# Merge inside one node process: current document in on stdin, updated
# document out to a file we already created with restrictive perms, and a
# human-readable key summary on stderr. node refuses to write if the key
# count fell, which is the specific accident that would take auth down.
aws secretsmanager get-secret-value \
  --region "$REGION" --secret-id "$SECRET_ID" \
  --query SecretString --output text \
| KEY="$KEY" VALUE="$VALUE" OUT="$OUT" node -e '
  const fs = require("fs");
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    const secret = JSON.parse(raw.trim());
    const before = Object.keys(secret);
    const isNew = !(process.env.KEY in secret);
    secret[process.env.KEY] = process.env.VALUE;
    const after = Object.keys(secret);
    const dropped = before.filter((k) => !after.includes(k));
    if (dropped.length) {
      console.error("refusing to write; would drop: " + dropped.join(", "));
      process.exit(1);
    }
    fs.writeFileSync(process.env.OUT, JSON.stringify(secret), { mode: 0o600 });
    console.error((isNew ? "adding" : "replacing") + " " + process.env.KEY +
      " (" + before.length + " keys before, " + after.length + " after)");
    console.error("keys: " + after.sort().join(", "));
  });
'

aws secretsmanager put-secret-value \
  --region "$REGION" --secret-id "$SECRET_ID" \
  --secret-string "file://$OUT" >/dev/null

echo "ok — ${KEY} written to the AppSecret."
echo
echo "Lambdas cache the secret per container, so this takes effect on the"
echo "next cold start. Redeploy (or wait a few minutes) to roll it through."
