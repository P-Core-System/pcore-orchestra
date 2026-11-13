#!/usr/bin/env node
"use strict";

/**
 * Self-check for per-org Contacts/Orders/Products (slice 2, sell-side):
 *  1. CRUD: contacts add/list, products add/list/stock, orders create/list/show
 *  2. per-org isolation: orgA invisible to orgB (and `default` fallback)
 *  3. order guards: same-org buyer required, ACTIVE same-org products only
 *     (cross-org/inactive refused), qty>0, stock checked at create
 *  4. lifecycle: draft->confirmed->fulfilled; illegal edges refused
 *     (INVALID_TRANSITION, row untouched); fulfil decrements stock;
 *     fulfil with drained stock refused INSUFFICIENT_STOCK (stays confirmed);
 *     cancel from draft/confirmed moves no stock
 *  5. total computed from product prices (caller totals ignored)
 *  6. CLI smoke: add/list/create/status/show/exit codes (incl. --json)
 *  7. sanitizeOrgSlug: unsafe/blank -> default, basename-confined
 *
 * All state redirected to temp dirs (PCORE_STATE_DIR); the real home
 * config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "orgs-state-"));

process.env.PCORE_STATE_DIR = stateDir;
delete process.env.PCORE_ORG;

const store = require("../bundle/hooks/lib/org-store.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function runCli(args, extraEnv) {
  try {
    const out = cp.execSync(`bash scripts/orgs.sh ${args}`, {
      cwd: ROOT,
      encoding: "utf8",
      env: Object.assign({}, process.env, extraEnv),
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String((err.stdout || "") + (err.stderr || "")) };
  }
}

// --- 7. slug sanitize ---
check("blank slug -> default", store.sanitizeOrgSlug("") === "default" && store.sanitizeOrgSlug() === "default");
check("slug lowercases + confines", store.sanitizeOrgSlug("Acme Corp/../x") === "acme-corp-x");
check("org files basename-confined", (() => {
  const f = store.orgFiles(undefined, "../../etc");
  return !f.contacts.includes("..") && f.contacts.endsWith(path.join("orgs", store.sanitizeOrgSlug("../../etc"), "contacts.json"));
})());

// --- 1. CRUD orgA ---
const c1 = store.addContact(undefined, "orgA", { name: "Buyer One", email: "b1@example.com", phone: "111" });
check("contact add ok", c1.ok && c1.contact.orgSlug === "orga" && c1.contact.id.startsWith("ct_"));
const badContact = store.addContact(undefined, "orgA", { name: "  " });
check("contact without name refused", badContact.ok === false && badContact.code === "CONTACT_NO_NAME");

const p1 = store.addProduct(undefined, "orgA", { name: "Widget", sku: "W-1", price: 25, stock: 10 });
check("product add ok active", p1.ok && p1.product.active === true && p1.product.orgSlug === "orga");
const badPrice = store.addProduct(undefined, "orgA", { name: "X", price: -1 });
check("product bad price refused", badPrice.ok === false && badPrice.code === "PRODUCT_BAD_PRICE");

const o1 = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 2 }] });
check("order create draft total computed", o1.ok && o1.order.status === "draft" && o1.order.total === 50);
check("order line snapshots unit price", o1.ok && o1.order.lines[0].unitPrice === 25);

// --- 2. per-org isolation ---
check("orgB contacts empty", store.listContacts(undefined, "orgB").length === 0);
check("orgB products empty", store.listProducts(undefined, "orgB").length === 0);
check("orgB orders empty", store.listOrders(undefined, "orgB").length === 0);
const crossContact = store.createOrder(undefined, "orgB", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 1 }] });
check("cross-org buyer refused", crossContact.ok === false && crossContact.code === "ORDER_UNKNOWN_CONTACT");
const cb = store.addContact(undefined, "orgB", { name: "Buyer B" });
const crossProduct = store.createOrder(undefined, "orgB", { contactId: cb.contact.id, lines: [{ productId: p1.product.id, qty: 1 }] });
check("cross-org product refused", crossProduct.ok === false && crossProduct.code === "ORDER_UNKNOWN_PRODUCT");

// --- 3. order guards ---
const noLines = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [] });
check("empty lines refused", noLines.ok === false && noLines.code === "ORDER_NO_LINES");
const badQty = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 0 }] });
check("zero qty refused", badQty.ok === false && badQty.code === "ORDER_BAD_QTY");
const overStock = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 999 }] });
check("create over stock refused", overStock.ok === false && overStock.code === "INSUFFICIENT_STOCK");
store.setProductActive(undefined, "orgA", p1.product.id, false);
const inactive = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 1 }] });
check("inactive product refused", inactive.ok === false && inactive.code === "ORDER_INACTIVE_PRODUCT");
store.setProductActive(undefined, "orgA", p1.product.id, true);

// --- 4. lifecycle ---
const badEdge = store.setOrderStatus(undefined, "orgA", o1.order.id, "fulfilled");
check("draft->fulfilled illegal refused", badEdge.ok === false && badEdge.code === "INVALID_TRANSITION");
check("refused transition keeps draft", store.getOrder(undefined, "orgA", o1.order.id).status === "draft");
const conf = store.setOrderStatus(undefined, "orgA", o1.order.id, "confirmed");
check("draft->confirmed ok", conf.ok && conf.order.status === "confirmed");
const ful = store.setOrderStatus(undefined, "orgA", o1.order.id, "fulfilled");
check("confirmed->fulfilled ok", ful.ok && ful.order.status === "fulfilled");
check("fulfil decrements stock 10->8", store.getProduct(undefined, "orgA", p1.product.id).stock === 8);

// fulfil with drained stock: big order created while stock sufficed, then drained
const big = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 8 }] });
check("big order created at stock 8", big.ok === true);
store.setOrderStatus(undefined, "orgA", big.order.id, "confirmed");
const drain = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 5 }] });
store.setOrderStatus(undefined, "orgA", drain.order.id, "confirmed");
store.setOrderStatus(undefined, "orgA", drain.order.id, "fulfilled");
const stuck = store.setOrderStatus(undefined, "orgA", big.order.id, "fulfilled");
check("fulfil over drained stock refused", stuck.ok === false && stuck.code === "INSUFFICIENT_STOCK");
check("refused fulfil stays confirmed", store.getOrder(undefined, "orgA", big.order.id).status === "confirmed");

// cancel moves no stock
const stockBefore = store.getProduct(undefined, "orgA", p1.product.id).stock;
const c2 = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 1 }] });
store.setOrderStatus(undefined, "orgA", c2.order.id, "cancelled");
check("cancel from draft ok", store.getOrder(undefined, "orgA", c2.order.id).status === "cancelled");
check("cancel moves no stock", store.getProduct(undefined, "orgA", p1.product.id).stock === stockBefore);
const c3 = store.createOrder(undefined, "orgA", { contactId: c1.contact.id, lines: [{ productId: p1.product.id, qty: 1 }] });
store.setOrderStatus(undefined, "orgA", c3.order.id, "confirmed");
store.setOrderStatus(undefined, "orgA", c3.order.id, "cancelled");
check("cancel from confirmed ok", store.getOrder(undefined, "orgA", c3.order.id).status === "cancelled");
const termEdge = store.setOrderStatus(undefined, "orgA", c3.order.id, "fulfilled");
check("cancelled terminal refused", termEdge.ok === false && termEdge.code === "INVALID_TRANSITION");

// stock setter guards
check("setStock negative refused", store.setStock(undefined, "orgA", p1.product.id, -1).code === "PRODUCT_BAD_STOCK");
check("setStock unknown refused", store.setStock(undefined, "orgA", "pr_missing", 3).code === "PRODUCT_NOT_FOUND");

// --- 6. CLI smoke (fresh org cliA) ---
const cliContact = runCli("contacts add --name CliBuyer --org cliA --json");
check("cli contacts add exit 0", cliContact.code === 0, cliContact.out.slice(0, 200));
const cliBuyerId = (() => { try { return JSON.parse(cliContact.out).id; } catch { return null; } })();
check("cli contact id", typeof cliBuyerId === "string" && cliBuyerId.startsWith("ct_"));
const cliProduct = runCli("products add --name CliGadget --price 12.5 --stock 20 --org cliA --json");
const cliProdId = (() => { try { return JSON.parse(cliProduct.out).id; } catch { return null; } })();
check("cli product add exit 0", cliProduct.code === 0 && typeof cliProdId === "string");
const cliList = runCli("products list --org cliA");
check("cli products list shows stock", cliList.code === 0 && cliList.out.includes("stock=20"));
const cliOrder = runCli(`orders create --contact ${cliBuyerId} --product ${cliProdId} --qty 3 --org cliA`);
check("cli order prints computed total", cliOrder.code === 0 && cliOrder.out.includes("total=37.5"), cliOrder.out.slice(0, 200));
const cliOrderId = (() => { const m = cliOrder.out.match(/OK order (\S+)/); return m && m[1]; })();
const cliStatus = runCli(`orders status --id ${cliOrderId} --to confirmed --org cliA --json`);
check("cli status transition exit 0", cliStatus.code === 0);
const cliBad = runCli(`orders status --id ${cliOrderId} --to draft --org cliA --json`);
check("cli illegal transition exit 2", cliBad.code === 2 && cliBad.out.includes("INVALID_TRANSITION"));
const cliShow = runCli(`orders show --id ${cliOrderId} --org cliA --json`);
check("cli show order", cliShow.code === 0 && cliShow.out.includes(cliOrderId));
const cliSync = runCli("contacts sync --direction pull --org cliA --json");
check("cli sync SKIP when unlinked", cliSync.code === 2 && cliSync.out.includes("GWS_NOT_LINKED"));

console.log(failed === 0 ? "Orgs suite: all checks passed" : `Orgs suite: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
