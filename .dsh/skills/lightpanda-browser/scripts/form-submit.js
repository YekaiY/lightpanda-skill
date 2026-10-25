// Form fill + submit + post-submit assertion, clean JSON on stdout.
// Run: lightpanda run template-2-form-submit.js
// ~2s, exit 0. Exits 1 (with a stderr message) if the assertion fails.
const page = new Page();
await page.goto("https://httpbin.org/forms/post", { timeout: 20000 });

// 1. Fill the fields the form expects (dump them first if unsure:
//    page.extract({ f: [{ selector: "form input", fields: { n: { attr: "name" } } }] })).
page.fill({ selector: "input[name='custname']", value: "Ada Lovelace" });
page.fill({ selector: "input[name='custtel']", value: "555-0100" });

// 2. Submit with Enter on a text input (implicit form submission).
const submitted = page.press({ key: "Enter", selector: "input[name='custname']" });

// 3. Assert on where we landed; the primitive's return string carries url/status/title.
const url = page.evaluate("location.href");
const landed = page.extract({ title: "title", pre: "pre" });
if (!url.includes("/post")) {
  throw new Error(`expected to land on /post, got ${url}`);
}

// 4. Report - including whether the posted body really contains our value.
const body = landed.pre || "";
return {
  submittedText: submitted.split(". Page url:")[0],
  url,
  landedOn: url.replace(/^https?:\/\/[^/]+/, ""),
  postBodyHasName: body.includes("Ada Lovelace"),
  postedBody: body.slice(0, 400)
};
