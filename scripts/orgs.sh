#!/usr/bin/env bash
# orgs.sh — thin CLI over bundle/*/hooks/lib/org-store.js.
# Per-org Contacts/Orders/Products (Manage nav names). Partition key is the
# Organization slug (--org, `default` when GWS is unlinked).
# Human output by default; --json for machine. Exit non-zero on error.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"

if [ "${PCORE_PLATFORM:-}" = "opencode" ]; then
  LIB_PATH="$REPO_ROOT/bundle/opencode/hooks/lib/org-store.js"
else
  LIB_PATH="$REPO_ROOT/bundle/hooks/lib/org-store.js"
fi
GWS_JS="$REPO_ROOT/scripts/google-workspace/gws.js"

# Windows Git Bash: a native win32 node cannot require() a POSIX /d/... path.
# Convert lib paths to mixed form (D:/...) when node is win32 and cygpath
# exists; POSIX stays a byte-identical passthrough.
if node -e 'process.exit(process.platform === "win32" ? 0 : 1)' 2>/dev/null; then
  if command -v cygpath >/dev/null 2>&1; then
    LIB_PATH="$(cygpath -m "$LIB_PATH")"
    GWS_JS="$(cygpath -m "$GWS_JS")"
  fi
fi

if [ ! -f "$LIB_PATH" ]; then
  echo "orgs.sh: lib not found: $LIB_PATH" >&2
  exit 1
fi

CMD="${1:-}"
[ $# -gt 0 ] && shift

unset PCORE_ORG PCORE_JSON PCORE_ACTION PCORE_NAME PCORE_EMAIL PCORE_PHONE PCORE_SKU \
      PCORE_PRICE PCORE_STOCK PCORE_ACTIVE PCORE_ID PCORE_CONTACT \
      PCORE_PRODUCT PCORE_QTY PCORE_TO PCORE_SYNC_DIR PCORE_STATE_OVERRIDE 2>/dev/null || true

case "$CMD" in
  contacts|products|orders)
    ;;
  -h|--help|help)
    cat <<'EOF'
Usage: bash scripts/orgs.sh <entity> <action> [--org SLUG] [--json]

Manage nav names — partition key is the Organization slug
(`default` when GWS is unlinked):

  contacts add --name N [--email E] [--phone P] [--org SLUG]
  contacts list [--org SLUG]
  contacts sync --direction pull|push [--org SLUG]
      pull: People connections -> local contacts (SKIP when GWS unlinked)
      push: local contacts -> People (SKIP when GWS unlinked)

  products add --name N [--sku S] [--price P] [--stock N] [--inactive] [--org SLUG]
  products list [--org SLUG]            shows active/stock (sell from this)
  products stock --id ID --stock N [--org SLUG]
  products deactivate|activate --id ID [--org SLUG]

  orders create --contact ID --product ID --qty N [--product ID2 --qty N2 ...] [--org SLUG]
      prints computed total + line validation (caller totals ignored)
  orders list [--org SLUG]
  orders show --id ID [--org SLUG]
  orders status --id ID --to confirmed|fulfilled|cancelled [--org SLUG]

  --json adds machine-readable JSON. Mutations print what changed.
  Orders only reference ACTIVE products of the SAME org (cross-org refused).
EOF
    exit 0
    ;;
  *)
    echo "orgs.sh: unknown entity: $CMD (contacts|products|orders)" >&2
    exit 1
    ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --json) PCORE_JSON=1; shift ;;
    --org) PCORE_ORG="${2:-}"; shift 2 ;;
    --name) PCORE_NAME="${2:-}"; shift 2 ;;
    --email) PCORE_EMAIL="${2:-}"; shift 2 ;;
    --phone) PCORE_PHONE="${2:-}"; shift 2 ;;
    --sku) PCORE_SKU="${2:-}"; shift 2 ;;
    --price) PCORE_PRICE="${2:-}"; shift 2 ;;
    --stock) PCORE_STOCK="${2:-}"; shift 2 ;;
    --inactive) PCORE_ACTIVE=0; shift ;;
    --id) PCORE_ID="${2:-}"; shift 2 ;;
    --contact) PCORE_CONTACT="${2:-}"; shift 2 ;;
    --product) PCORE_PRODUCT="${PCORE_PRODUCT:+$PCORE_PRODUCT
}$2"; shift 2 ;;
    --qty) PCORE_QTY="${PCORE_QTY:+$PCORE_QTY
}$2"; shift 2 ;;
    --to) PCORE_TO="${2:-}"; shift 2 ;;
    --direction) PCORE_SYNC_DIR="${2:-}"; shift 2 ;;
    --state-dir) PCORE_STATE_OVERRIDE="${2:-}"; shift 2 ;;
    --) shift; break ;;
    --*) echo "orgs.sh: unknown flag: $1" >&2; exit 1 ;;
    *) PCORE_ACTION="${PCORE_ACTION:-}$1"; shift ;;
  esac
done

export PCORE_ORG PCORE_JSON PCORE_ACTION PCORE_NAME PCORE_EMAIL PCORE_PHONE PCORE_SKU \
       PCORE_PRICE PCORE_STOCK PCORE_ACTIVE PCORE_ID PCORE_CONTACT \
       PCORE_PRODUCT PCORE_QTY PCORE_TO PCORE_SYNC_DIR PCORE_STATE_OVERRIDE
export PCORE_CMD="$CMD"

NODE_PROGRAM=$(cat <<'NODEOF'
"use strict";
const store = require("LIB_PATH_PLACEHOLDER");
const env = process.env;

function stateDir() {
  return env.PCORE_STATE_DIR || env.PCORE_STATE_OVERRIDE || undefined;
}

function org() {
  return store.sanitizeOrgSlug(env.PCORE_ORG);
}

function out(obj, text) {
  if (env.PCORE_JSON === "1") { console.log(JSON.stringify(obj.json !== undefined ? obj.json : obj)); return; }
  console.log(obj.text !== undefined ? obj.text : text);
}

function die(msg) {
  console.error("orgs.sh: " + msg);
  process.exit(1);
}

function deny(res) {
  out({ json: res, text: `REFUSED ${res.code}${res.detail ? ` (${res.detail})` : ""}` });
  process.exitCode = 2;
}

function run() {
  const cmd = env.PCORE_CMD;
  const action = env.PCORE_ACTION;
  const dir = stateDir();
  const slug = org();

  if (cmd === "contacts") {
    if (action === "add") {
      const res = store.addContact(dir, slug, { name: env.PCORE_NAME, email: env.PCORE_EMAIL, phone: env.PCORE_PHONE });
      if (!res.ok) { deny(res); return; }
      out({ json: res.contact, text: `OK contact ${res.contact.id} ${res.contact.name} [${slug}]` });
    } else if (action === "list") {
      const rows = store.listContacts(dir, slug);
      out({ json: { org: slug, contacts: rows }, text: rows.map((c) => `${c.id} ${c.name}${c.email ? ` <${c.email}>` : ""}${c.phone ? ` ${c.phone}` : ""}`).join("\n") || `no contacts [${slug}]` });
    } else if (action === "sync") {
      const direction = env.PCORE_SYNC_DIR || "pull";
      let gws = null;
      try { gws = require("GWS_PATH_PLACEHOLDER"); } catch { gws = null; }
      if (!gws || !gws.isLinked || !gws.isLinked()) {
        out({ json: { ok: false, code: "GWS_NOT_LINKED" }, text: "SKIP sync: GWS unlinked (run gws auth login first)" });
        process.exitCode = 2;
        return;
      }
      if (direction === "pull") {
        gws.peopleConnections().then((res) => {
          if (!res.ok) { deny(res); return; }
          let added = 0;
          for (const c of res.connections) {
            const name = c && c.names && c.names[0] && c.names[0].displayName;
            if (!name) continue;
            const email = c.emailAddresses && c.emailAddresses[0] && c.emailAddresses[0].value;
            const phone = c.phoneNumbers && c.phoneNumbers[0] && c.phoneNumbers[0].value;
            const r = store.addContact(dir, slug, { name, email, phone, googleResourceName: c.resourceName });
            if (r.ok) added += 1;
          }
          out({ json: { ok: true, pulled: res.connections.length, added }, text: `OK sync pull: ${added}/${res.connections.length} contacts [${slug}]` });
        });
      } else if (direction === "push") {
        const rows = store.listContacts(dir, slug);
        (async () => {
          let pushed = 0;
          for (const c of rows) {
            const r = await gws.peopleCreateContact({ name: c.name, email: c.email, phone: c.phone });
            if (r.ok) pushed += 1;
          }
          out({ json: { ok: true, pushed, of: rows.length }, text: `OK sync push: ${pushed}/${rows.length} contacts [${slug}]` });
        })();
      } else { die("contacts sync needs --direction pull|push"); }
    } else { die("contacts needs an action: add|list|sync"); }
    return;
  }

  if (cmd === "products") {
    if (action === "add") {
      const res = store.addProduct(dir, slug, { name: env.PCORE_NAME, sku: env.PCORE_SKU, price: env.PCORE_PRICE, stock: env.PCORE_STOCK, active: env.PCORE_ACTIVE === "0" ? false : undefined });
      if (!res.ok) { deny(res); return; }
      out({ json: res.product, text: `OK product ${res.product.id} ${res.product.name} price=${res.product.price} stock=${res.product.stock}${res.product.active ? "" : " INACTIVE"} [${slug}]` });
    } else if (action === "list") {
      const rows = store.listProducts(dir, slug);
      out({ json: { org: slug, products: rows }, text: rows.map((p) => `${p.id} ${p.name} price=${p.price} stock=${p.stock}${p.active ? "" : " INACTIVE"}`).join("\n") || `no products [${slug}]` });
    } else if (action === "stock") {
      if (!env.PCORE_ID) die("products stock needs --id <product-id> --stock <n>");
      const res = store.setStock(dir, slug, env.PCORE_ID, env.PCORE_STOCK);
      if (!res.ok) { deny(res); return; }
      out({ json: res.product, text: `OK stock ${res.product.id} -> ${res.product.stock} [${slug}]` });
    } else if (action === "deactivate" || action === "activate") {
      if (!env.PCORE_ID) die("products " + action + " needs --id <product-id>");
      const res = store.setProductActive(dir, slug, env.PCORE_ID, action === "activate");
      if (!res.ok) { deny(res); return; }
      out({ json: res.product, text: `OK ${action}d ${res.product.id} active=${res.product.active} [${slug}]` });
    } else { die("products needs an action: add|list|stock|activate|deactivate"); }
    return;
  }

  if (cmd === "orders") {
    if (action === "create") {
      if (!env.PCORE_CONTACT) die("orders create needs --contact <contact-id>");
      const ids = String(env.PCORE_PRODUCT || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const qtys = String(env.PCORE_QTY || "").split("\n").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) die("orders create needs --product <id> --qty <n> (repeatable)");
      const lines = ids.map((id, i) => ({ productId: id, qty: qtys[i] !== undefined ? qtys[i] : 1 }));
      const res = store.createOrder(dir, slug, { contactId: env.PCORE_CONTACT, lines });
      if (!res.ok) { deny(res); return; }
      const detail = res.order.lines.map((l) => `  - ${l.productId} x${l.qty} @${l.unitPrice}`).join("\n");
      out({ json: res.order, text: `OK order ${res.order.id} total=${res.order.total} status=${res.order.status} [${slug}]\n${detail}` });
    } else if (action === "list") {
      const rows = store.listOrders(dir, slug);
      out({ json: { org: slug, orders: rows }, text: rows.map((o) => `${o.id} contact=${o.contactId} total=${o.total} status=${o.status}`).join("\n") || `no orders [${slug}]` });
    } else if (action === "show") {
      if (!env.PCORE_ID) die("orders show needs --id <order-id>");
      const o = store.getOrder(dir, slug, env.PCORE_ID);
      if (!o) { deny({ ok: false, code: "ORDER_NOT_FOUND" }); return; }
      out({ json: o, text: `${o.id} contact=${o.contactId} total=${o.total} status=${o.status}\n` + o.lines.map((l) => `  - ${l.productId} x${l.qty} @${l.unitPrice}`).join("\n") });
    } else if (action === "status") {
      if (!env.PCORE_ID || !env.PCORE_TO) die("orders status needs --id <order-id> --to <status>");
      const res = store.setOrderStatus(dir, slug, env.PCORE_ID, env.PCORE_TO);
      if (!res.ok) { deny(res); return; }
      out({ json: res.order, text: `OK order ${res.order.id} -> ${res.order.status} total=${res.order.total} [${slug}]` });
    } else { die("orders needs an action: create|list|show|status"); }
    return;
  }

  die("unknown entity " + cmd);
}

run();
NODEOF
)

NODE_PROGRAM="${NODE_PROGRAM//LIB_PATH_PLACEHOLDER/"$LIB_PATH"}"
NODE_PROGRAM="${NODE_PROGRAM//GWS_PATH_PLACEHOLDER/"$GWS_JS"}"

node -e "$NODE_PROGRAM"
