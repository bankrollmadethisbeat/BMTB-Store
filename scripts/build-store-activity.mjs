import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const customersPath =
  process.argv[2] ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'customers-1ef83fdd0c013c279e671410b30bee86.csv');
const salesPath =
  process.argv[3] ||
  path.join(process.env.USERPROFILE || '', 'Downloads', '7d9b3a4bbd97fb27efc690754b40778d.csv');
const outPath = path.join(root, 'data', 'store-activity.json');

function parseCSV(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x !== '') || rows.length) rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function privacyName(first, last, username) {
  first = (first || '').trim();
  last = (last || '').trim();
  username = (username || '').trim();
  if (first && last) return `${first} ${last.charAt(0)}.`;
  if (first) return first;
  if (username) return username;
  return 'Customer';
}

function beatCount(title) {
  return title.split(',').filter((t) => t.trim()).length || 1;
}

function licenseUnitPrice(licenseFragment) {
  const ll = (licenseFragment || '').toLowerCase();
  if (ll.includes('exclusive')) return 300;
  if (ll.includes('premium')) return 100;
  if (ll.includes('sound kit')) return 20;
  return 50;
}

function estimateSpend(licenseName, productType, title) {
  const pt = (productType || '').toLowerCase();
  const titles = beatCount(title);
  const licenses = licenseName.split(',').map((s) => s.trim()).filter(Boolean);
  const unitPrices = licenses.map(licenseUnitPrice);
  const maxUnit = unitPrices.length ? Math.max(...unitPrices) : 50;
  const kitOnly = pt.includes('sound kit') && !licenses.length;

  if (kitOnly) return 20 * titles;
  if (titles > 1) return maxUnit * titles;

  return licenseUnitPrice(licenseName || productType);
}

function readCustomerPurchases(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(text);
  const headers = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, idx) => [h, r[idx] || ''])));
}

function readSalesSummary(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const summaryLine = lines.find((l) => /^\d/.test(l.replace(/^"/, '')) && l.includes(','));
  if (!summaryLine) return null;
  const parts = parseCSV(summaryLine)[0];
  return {
    itemsSold: Number(parts[0]) || 0,
    gross: Number(parts[1]) || 0,
    net: Number(parts[5]) || 0,
  };
}

const customers = readCustomerPurchases(customersPath);
const purchases = customers.filter((r) => (r['Product Title'] || '').trim());
const salesSummary = readSalesSummary(salesPath);

const spend = new Map();
for (const r of purchases) {
  const email = r.Email || r['First Name'];
  const amount = estimateSpend(r['License Name'], r['Product Type'], r['Product Title']);
  const cur = spend.get(email) || {
    name: privacyName(r['First Name'], r['Last Name'], r['User username']),
    total: 0,
    beats: 0,
  };
  cur.total += amount;
  cur.beats += beatCount(r['Product Title']);
  spend.set(email, cur);
}

const top = [...spend.values()].sort((a, b) => b.total - a.total)[0];
const now = new Date();
const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

const recentRows = purchases.slice(-12).reverse();

const recentPurchases = recentRows.map((r) => ({
  customer: privacyName(r['First Name'], r['Last Name'], r['User username']),
}));

const activity = {
  monthLabel,
  updatedAt: now.toISOString().slice(0, 10),
  salesSummary: salesSummary
    ? {
        itemsSold: salesSummary.itemsSold,
        gross: `$${salesSummary.gross.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
        net: `$${Math.round(salesSummary.net).toLocaleString('en-US')}`,
      }
    : undefined,
  topSupporter: {
    name: top?.name || '—',
    detail: top ? `${top.beats} beats licensed · BeatStars customer` : 'Most active this month',
  },
  recentPurchases,
};

fs.writeFileSync(outPath, `${JSON.stringify(activity, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`Top supporter: ${activity.topSupporter.name}`);
console.log(`Recent purchases: ${recentPurchases.length}`);
