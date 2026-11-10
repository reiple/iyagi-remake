import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { _electron } = require("playwright");
const app = await _electron.launch({
  executablePath: "release/win-unpacked/Iyagi Mud.exe",
  args: ["--user-data-dir=" + process.cwd() + "/.test-profile"],
  env: Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE"),
  ),
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector("#command");
  await page.waitForTimeout(1200);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.screenshot({ path: "docs/app-preview.png" });
  await page.click("#settings");
  await page.fill("#fontSize", "18");
  await page.click("#save");
  await page.waitForTimeout(300);
  if (await page.locator("#dialog").evaluate((e) => e.open))
    throw Error("Settings save failed");
  await page.locator("#secret").check();
  if ((await page.locator("#command").getAttribute("type")) !== "password")
    throw Error("Secret input failed");
  await page.locator("#secret").uncheck();
  console.log(
    JSON.stringify({
      title: await page.title(),
      errors,
      settingsSaved: true,
      secretInput: true,
    }),
  );
} finally {
  await app.close();
}
