// Repeats "open an app link logged out -> log in -> redirected back" in a fresh Chrome Incognito profile and
// records whether the tab crashed ("Aw, Snap"). Saves a screenshot of every run plus results.csv / summary.txt.
//
// Works on Windows and macOS. Usage:
//   npm install                               # once
//   node crash-test.cjs                       # 10 runs, asks for email and password
//   node crash-test.cjs --runs 20
//   node crash-test.cjs --url https://papaya.morfius.ai/app/MVS26KC65KOUS51Q/
// Email: --email or MORFIUS_EMAIL, otherwise asked. Password: MORFIUS_PASSWORD, otherwise asked (hidden).
// Neither is written to disk.

const { chromium } = require("playwright-core");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const RUNS = Number(arg("runs", "10"));
const URL = arg("url", "https://papaya.morfius.ai/app/MVPBUPR55SHJAPUX/");
let EMAIL = arg("email", process.env.MORFIUS_EMAIL || "");
const WAIT_AFTER_LOGIN_MS = Number(arg("wait", "20000"));
const DEFAULT_CHROME = {
  win32: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/usr/bin/google-chrome",
}[process.platform];
const CHROME = arg("chrome", DEFAULT_CHROME);
if (!CHROME || !fs.existsSync(CHROME)) {
  console.error(`Chrome not found at "${CHROME}". Pass its path with --chrome "<path to chrome>".`);
  process.exit(1);
}
const PORT = 9400;

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join(__dirname, "runs", stamp);
fs.mkdirSync(OUT, { recursive: true });

// One reader for both prompts, reading from a line queue so input typed or pasted ahead isn't lost.
let rl;
let lines;
let muted = false;
async function ask(question, { hidden = false } = {}) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
    };
    lines = rl[Symbol.asyncIterator]();
  }
  process.stdout.write(question);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write("\n");
  if (done) {
    console.error("\nNo input.");
    process.exit(1);
  }
  return value.trim();
}

// A crashed tab can't be screenshotted through the browser, so grab the whole screen instead.
const CAPTURE_PS = `
param($out)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type 'using System; using System.Runtime.InteropServices; public class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[D]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($out)
`;
const capturePs = path.join(OUT, "capture.ps1");
if (process.platform === "win32") fs.writeFileSync(capturePs, CAPTURE_PS);
function screenshotScreen(file) {
  try {
    if (process.platform === "win32")
      execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", capturePs, file], { stdio: "ignore" });
    // macOS asks once for Screen Recording permission for the terminal app.
    else if (process.platform === "darwin") execFileSync("screencapture", ["-x", file], { stdio: "ignore" });
    else execFileSync("import", ["-window", "root", file], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oneRun(n, password) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "crash-test-"));
  const chrome = spawn(
    CHROME,
    [
      "--incognito",
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const t0 = Date.now();
  const T = () => ((Date.now() - t0) / 1000).toFixed(1);
  const result = { run: n, status: "", crashed: false, crashAt: "", landed: "", revision: "", screenshot: "", error: "" };
  let browser;
  try {
    for (let i = 0; i < 20 && !browser; i++) {
      await sleep(500);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
    }
    if (!browser) throw new Error("could not connect to Chrome");
    const page = browser.contexts()[0].pages()[0];
    page.on("crash", () => {
      result.crashed = true;
      result.crashAt = T();
    });
    page.on("console", (m) => {
      const r = m.text().match(/APP REVISION (\S+)/);
      if (r) result.revision = r[1];
    });

    await page.goto(URL);
    await page.waitForURL(/\/login/, { timeout: 30000 });
    await page.getByText("Email", { exact: true }).click().catch(() => {});
    await page.locator("input[type=email], input[name=email]").first().fill(EMAIL);
    await page.locator("input[type=password]").first().fill(password);
    await page.locator("button[type=submit]").first().click();

    for (let waited = 0; waited < WAIT_AFTER_LOGIN_MS && !result.crashed; waited += 500) await sleep(500);

    if (result.crashed) result.status = "CRASH";
    else {
      const title = await page.title().catch(() => "?");
      result.landed = `${title} | ${page.url()}`;
      // The org shell loads from /assets/, an app (Skills etc.) from /app/<type>-assets/.
      const appBundle = await page
        .evaluate(() => [...document.scripts].some((s) => /\/app\/[^/]+-assets\//.test(s.src)))
        .catch(() => false);
      if (/\/login/.test(page.url())) {
        result.status = "ERROR";
        result.error = "still on login (wrong password?)";
      } else if (appBundle) result.status = "OK";
      else result.status = "STUCK";
    }
    await page.bringToFront().catch(() => {});
    await sleep(1500);
    result.screenshot = `run-${String(n).padStart(2, "0")}-${result.status}.png`;
    if (!screenshotScreen(path.join(OUT, result.screenshot))) result.screenshot = "(screenshot failed)";
  } catch (e) {
    result.status = "ERROR";
    result.error = String(e.message || e).split("\n")[0];
  } finally {
    await browser?.close().catch(() => {});
    chrome.kill();
    await sleep(1500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  return result;
}

(async () => {
  while (!EMAIL) EMAIL = await ask("Email: ");
  let password = process.env.MORFIUS_PASSWORD || "";
  while (!password) password = await ask(`Password for ${EMAIL}: `, { hidden: true });
  rl?.close();
  console.log(`\n${RUNS} runs against ${URL}\nScreenshots and results: ${OUT}\n`);
  const results = [];
  for (let n = 1; n <= RUNS; n++) {
    const r = await oneRun(n, password);
    results.push(r);
    const bad = results.filter((x) => x.status === "CRASH" || x.status === "STUCK").length;
    const label = { CRASH: `CRASH at ${r.crashAt}s`, STUCK: "STUCK (blank org page, app never loaded)", OK: "OK", ERROR: `ERROR ${r.error}` }[r.status];
    console.log(
      `Run ${String(n).padStart(2)}: ${label}${r.landed && r.status !== "OK" ? `  -> ${r.landed}` : ""}` +
        `${r.revision ? `  [rev ${r.revision}]` : ""}   (failures so far: ${bad}/${n})`,
    );
  }
  const count = (st) => results.filter((x) => x.status === st);
  const revs = [...new Set(results.map((x) => x.revision).filter(Boolean))].join(", ") || "unknown";
  const runsOf = (st) => count(st).map((x) => x.run).join(", ") || "none";
  const summary = [
    `URL: ${URL}`,
    `User: ${EMAIL}`,
    `Machine: ${os.platform()} ${os.release()}`,
    `Org build revision: ${revs}`,
    `Runs: ${RUNS}`,
    `Crashed (Aw, Snap): ${count("CRASH").length}   runs: ${runsOf("CRASH")}`,
    `Stuck (blank org page): ${count("STUCK").length}   runs: ${runsOf("STUCK")}`,
    `OK (app loaded): ${count("OK").length}`,
    `Errors (script/login problem, not the bug): ${count("ERROR").length}   runs: ${runsOf("ERROR")}`,
  ].join("\n");
  const csv = ["run,status,crash_at_s,landed,revision,screenshot,error"]
    .concat(results.map((r) => [r.run, r.status, r.crashAt, r.landed, r.revision, r.screenshot, r.error].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")))
    .join("\n");
  fs.writeFileSync(path.join(OUT, "results.csv"), csv);
  fs.writeFileSync(path.join(OUT, "summary.txt"), summary);
  fs.rmSync(capturePs, { force: true });
  console.log(`\n${summary}\nSaved to ${OUT}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
