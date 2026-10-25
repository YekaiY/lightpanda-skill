// List -> detail pagination, clean JSON on stdout.
// Run: lightpanda run template-1-list-to-detail.js
// ~14s, exit 0, one JSON line on stdout, nothing on stderr.
const BASE = "https://books.toscrape.com";
const OPTS = { timeout: 30000 };            // this site needs ~9s per load under Lightpanda
const page = new Page();
const rows = [];

// 1. Collect one record per book card from the first two catalogue pages.
for (const n of [1, 2]) {
  await page.goto(`${BASE}/catalogue/page-${n}.html`, OPTS);
  const { items } = page.extract({
    items: [{
      selector: "article.product_pod",
      fields: {
        title: "h3 a",
        url:   { selector: "h3 a", attr: "href" },
        price: ".price_color"              // "\u00a351.77" - parse in JS below
      }
    }]
  });
  for (const it of items) rows.push(it);
}

// 2. Visit a few detail pages and merge their fields into the list records.
const books = [];
for (const row of rows.slice(0, 3)) {
  await page.goto(row.url, OPTS);
  const d = page.extract({ title: "h1", availability: ".availability" });
  books.push({
    title: d.title,
    url: row.url,
    price: Number(row.price.replace(/[^0-9.]/g, "")),   // every extract leaf is a string
    currency: row.price.replace(/[0-9.\s]/g, ""),
    inStock: d.availability.startsWith("In stock")
  });
}

// 3. `return` is the only machine-readable channel: printed as JSON on stdout.
return { listed: rows.length, books };
