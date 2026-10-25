// Credentials via $LP_* placeholders -> login-shaped form -> verify session state.
// Run: LP_USER=alice LP_PASS=s3cret lightpanda run template-3-login-lpenv.js
// ~2s, exit 0. Fill values never appear resolved in any return string.
//
// NOTE: --cookie <file> is IGNORED in `run` mode in this build (1.1.0-nightly.11012),
// even though it works in `fetch` and `mcp`. Workarounds, both verified:
//   lightpanda run --http-header "Cookie: lp_session=abc" template-3-login-lpenv.js
//   page.evaluate("document.cookie='lp_session=abc; path=/'") then re-goto
const page = new Page();
await page.goto("https://httpbin.org/forms/post", { timeout: 20000 });

// 1. Fill from the process environment; $LP_* is resolved inside Lightpanda.
const filled = page.fill({ selector: "input[name='custname']", value: "$LP_USER" });
page.fill({ selector: "input[name='custtel']", value: "$LP_PASS" });

// 2. Confirm the page really received the secret (the return string does NOT show it).
const actualValue = page.evaluate("document.querySelector(\"input[name='custname']\").value");

// 3. Submit and check the server echo of the posted body.
page.press({ key: "Enter", selector: "input[name='custname']" });
const url = page.evaluate("location.href");
const body = page.extract({ pre: "pre" }).pre || "";

return {
  placeholderReturnString: filled.split(". Page url:")[0],  // literal "$LP_USER"
  resolvedOnPage: actualValue === "alice",
  landedOn: url.replace(/^https?:\/\/[^/]+/, ""),
  serverSawCredential: body.includes("alice") && body.includes("s3cret"),
  // With --cookie-jar this would be where you read the session back; it too is
  // a no-op under `run`, so capture cookies from the page when you need them:
  //   await page.goto("https://target/"), page.evaluate("document.cookie")
};
