"use strict";

/**
 * org-store.js — per-org Contacts/Orders/Products (local domain model).
 *
 * Partition key = Organization slug (Platform operations > Organizations);
 * `default` when GWS is unlinked. One JSON file per collection:
 * `<state>/orgs/<orgSlug>/{contacts,orders,products}.json`.
 * orgSlug is sanitized + basename-confined (invariants 15/38); no /tmp —
 * PCORE_STATE_DIR wins via resolveStateDir, same default as team claims.
 *
 * Sell-side (marketplace) rules — the org lists Products, the assistant
 * sells them and receives Orders:
 *  - Product: { id, orgSlug, name, sku, price, stock, active=true }.
 *    Orders may only reference ACTIVE products of the SAME org
 *    (cross-org lines refused: ORDER_UNKNOWN_PRODUCT).
 *  - Order create (assistant receiving an order): contactId is the buyer
 *    and must exist in the SAME org; lines are [{ productId, qty }];
 *    the total is COMPUTED from product prices (caller totals ignored).
 *    Stock is CHECKED at create but only DECREMENTED at fulfil.
 *  - Lifecycle (additive-only): draft -> confirmed -> fulfilled;
 *    cancelled from draft/confirmed. Fulfil refuses with
 *    INSUFFICIENT_STOCK (order stays confirmed); cancel moves no stock.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withLock, readJsonSafe, writeJson, resolveStateDir } = require("./safe-write.js");

const ORG_ROOT = "orgs";
const CONTACTS_FILE = "contacts.json";
const PRODUCTS_FILE = "products.json";
const ORDERS_FILE = "orders.json";
const STORE_CAP = 500;

/** Additive-only order transitions (extension point, never edits). */
const ORDER_TRANSITIONS = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

let seq = 0;

function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

/**
 * Organization slug: lowercase alnum + dash; blank/unsafe -> "default"
 * (the unlinked fallback). Basename-confined — never a path.
 */
function sanitizeOrgSlug(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "default";
  const clean = s.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!clean || clean === "." || clean === "..") return "default";
  return path.basename(clean).slice(0, 64) || "default";
}

function orgDir(stateDir, org) {
  const base = resolveStateDir(stateDir || defaultStateDir());
  return path.join(String(base), ORG_ROOT, sanitizeOrgSlug(org));
}

function orgFiles(stateDir, org) {
  const dir = orgDir(stateDir, org);
  return {
    dir,
    contacts: path.join(dir, CONTACTS_FILE),
    products: path.join(dir, PRODUCTS_FILE),
    orders: path.join(dir, ORDERS_FILE),
  };
}

function defaults(kind) {
  return { version: 1, org: null, updated_at: null, [kind]: [] };
}

function loadCollection(file, kind) {
  const parsed = readJsonSafe(file, defaults(kind));
  if (!parsed || typeof parsed !== "object") return defaults(kind);
  if (!Array.isArray(parsed[kind])) parsed[kind] = [];
  return parsed;
}

function mutateCollection(file, kind, org, fn) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* best effort */ }
  let result = null;
  withLock(file, () => {
    const cur = loadCollection(file, kind);
    result = fn(cur[kind]) || cur[kind];
    cur[kind] = result.slice(-STORE_CAP);
    cur.org = org;
    cur.updated_at = new Date().toISOString();
    writeJson(file, cur);
    return cur;
  });
  return result;
}

function newId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function toNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ---------------- Contacts (Manage > Contacts) ---------------- */

function addContact(stateDir, org, fields) {
  const f = fields || {};
  const slug = sanitizeOrgSlug(org);
  if (!isNonEmptyString(f.name)) return { ok: false, code: "CONTACT_NO_NAME" };
  const files = orgFiles(stateDir, slug);
  const row = {
    id: newId("ct"),
    orgSlug: slug,
    name: String(f.name).trim(),
    email: String(f.email || "").trim(),
    phone: String(f.phone || "").trim(),
    googleResourceName: String(f.googleResourceName || "").trim(),
    createdAt: new Date().toISOString(),
  };
  mutateCollection(files.contacts, "contacts", slug, (rows) => rows.concat([row]));
  return { ok: true, contact: row };
}

function listContacts(stateDir, org) {
  const files = orgFiles(stateDir, org);
  return loadCollection(files.contacts, "contacts").contacts;
}

function getContact(stateDir, org, id) {
  return listContacts(stateDir, org).find((c) => c && c.id === id) || null;
}

/* ---------------- Products (Manage > Products, sell-side) ---------------- */

function addProduct(stateDir, org, fields) {
  const f = fields || {};
  const slug = sanitizeOrgSlug(org);
  if (!isNonEmptyString(f.name)) return { ok: false, code: "PRODUCT_NO_NAME" };
  const price = toNumber(f.price, NaN);
  if (!Number.isFinite(price) || price < 0) return { ok: false, code: "PRODUCT_BAD_PRICE" };
  const stock = f.stock === undefined ? 0 : toNumber(f.stock, NaN);
  if (!Number.isInteger(stock) || stock < 0) return { ok: false, code: "PRODUCT_BAD_STOCK" };
  const files = orgFiles(stateDir, slug);
  const row = {
    id: newId("pr"),
    orgSlug: slug,
    name: String(f.name).trim(),
    sku: String(f.sku || "").trim(),
    price,
    stock,
    active: f.active === undefined ? true : Boolean(f.active),
    createdAt: new Date().toISOString(),
  };
  mutateCollection(files.products, "products", slug, (rows) => rows.concat([row]));
  return { ok: true, product: row };
}

function listProducts(stateDir, org) {
  const files = orgFiles(stateDir, org);
  return loadCollection(files.products, "products").products;
}

function getProduct(stateDir, org, id) {
  return listProducts(stateDir, org).find((p) => p && p.id === id) || null;
}

function setStock(stateDir, org, id, stock) {
  const slug = sanitizeOrgSlug(org);
  const n = toNumber(stock, NaN);
  if (!Number.isInteger(n) || n < 0) return { ok: false, code: "PRODUCT_BAD_STOCK" };
  const files = orgFiles(stateDir, slug);
  let updated = null;
  mutateCollection(files.products, "products", slug, (rows) => rows.map((p) => {
    if (!p || p.id !== id) return p;
    updated = Object.assign({}, p, { stock: n });
    return updated;
  }));
  if (!updated) return { ok: false, code: "PRODUCT_NOT_FOUND" };
  return { ok: true, product: updated };
}

function setProductActive(stateDir, org, id, active) {
  const slug = sanitizeOrgSlug(org);
  const files = orgFiles(stateDir, slug);
  let updated = null;
  mutateCollection(files.products, "products", slug, (rows) => rows.map((p) => {
    if (!p || p.id !== id) return p;
    updated = Object.assign({}, p, { active: Boolean(active) });
    return updated;
  }));
  if (!updated) return { ok: false, code: "PRODUCT_NOT_FOUND" };
  return { ok: true, product: updated };
}

/* ---------------- Orders (Manage > Orders, assistant receives) ---------------- */

function validateLines(stateDir, slug, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, code: "ORDER_NO_LINES" };
  const products = listProducts(stateDir, slug);
  const byId = {};
  for (const p of products) if (p && p.id) byId[p.id] = p;
  const priced = [];
  for (const line of lines) {
    const qty = toNumber(line && line.qty, NaN);
    if (!line || !isNonEmptyString(line.productId)) return { ok: false, code: "ORDER_UNKNOWN_PRODUCT" };
    const product = byId[line.productId];
    if (!product) return { ok: false, code: "ORDER_UNKNOWN_PRODUCT", detail: String(line.productId) };
    if (!product.active) return { ok: false, code: "ORDER_INACTIVE_PRODUCT", detail: String(line.productId) };
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, code: "ORDER_BAD_QTY", detail: String(line.productId) };
    if (product.stock < qty) return { ok: false, code: "INSUFFICIENT_STOCK", detail: String(line.productId) };
    priced.push({ productId: product.id, qty, unitPrice: product.price });
  }
  return { ok: true, lines: priced };
}

function orderTotal(lines) {
  return lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
}

function createOrder(stateDir, org, fields) {
  const f = fields || {};
  const slug = sanitizeOrgSlug(org);
  const buyer = getContact(stateDir, slug, f.contactId);
  if (!buyer) return { ok: false, code: "ORDER_UNKNOWN_CONTACT" };
  const checked = validateLines(stateDir, slug, f.lines);
  if (!checked.ok) return checked;
  const files = orgFiles(stateDir, slug);
  const row = {
    id: newId("or"),
    orgSlug: slug,
    contactId: buyer.id,
    lines: checked.lines,
    total: orderTotal(checked.lines),
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  mutateCollection(files.orders, "orders", slug, (rows) => rows.concat([row]));
  return { ok: true, order: row };
}

function listOrders(stateDir, org) {
  const files = orgFiles(stateDir, org);
  return loadCollection(files.orders, "orders").orders;
}

function getOrder(stateDir, org, id) {
  return listOrders(stateDir, org).find((o) => o && o.id === id) || null;
}

function canTransition(from, to) {
  return Boolean(ORDER_TRANSITIONS[from] && ORDER_TRANSITIONS[from].includes(to));
}

/**
 * Move an order. Fulfil decrements product stock (refuses INSUFFICIENT_STOCK,
 * order stays confirmed); cancel moves no stock. Invalid edges are refused
 * with INVALID_TRANSITION — the stored row is never rewritten on refusal.
 */
function setOrderStatus(stateDir, org, id, to) {
  const slug = sanitizeOrgSlug(org);
  const next = String(to || "").trim();
  const files = orgFiles(stateDir, slug);
  const cur = getOrder(stateDir, slug, id);
  if (!cur) return { ok: false, code: "ORDER_NOT_FOUND" };
  if (cur.status === next) return { ok: true, order: cur };
  if (!canTransition(cur.status, next)) return { ok: false, code: "INVALID_TRANSITION", detail: `${cur.status} -> ${next}` };
  if (next === "fulfilled") {
    const products = listProducts(stateDir, slug);
    const byId = {};
    for (const p of products) if (p && p.id) byId[p.id] = p;
    for (const line of cur.lines) {
      const p = byId[line.productId];
      if (!p || !p.active) return { ok: false, code: "ORDER_INACTIVE_PRODUCT", detail: String(line.productId) };
      if (p.stock < line.qty) return { ok: false, code: "INSUFFICIENT_STOCK", detail: String(line.productId) };
    }
    for (const line of cur.lines) {
      const p = byId[line.productId];
      setStock(stateDir, slug, line.productId, p.stock - line.qty);
    }
  }
  let updated = null;
  mutateCollection(files.orders, "orders", slug, (rows) => rows.map((o) => {
    if (!o || o.id !== id) return o;
    updated = Object.assign({}, o, { status: next, updatedAt: new Date().toISOString() });
    return updated;
  }));
  return { ok: true, order: updated };
}

module.exports = {
  ORG_ROOT,
  ORDER_TRANSITIONS,
  STORE_CAP,
  defaultStateDir,
  sanitizeOrgSlug,
  orgDir,
  orgFiles,
  addContact,
  listContacts,
  getContact,
  addProduct,
  listProducts,
  getProduct,
  setStock,
  setProductActive,
  createOrder,
  listOrders,
  getOrder,
  canTransition,
  setOrderStatus,
  orderTotal,
};
