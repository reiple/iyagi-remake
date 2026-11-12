import { _electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clickMenu } from "./menu-test-helpers.mjs";

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-profile-ui-"));
const launch = () => _electron.launch({
  executablePath: process.env.APP_EXECUTABLE || "node_modules/electron/dist/electron.exe",
  args: [...(process.env.APP_EXECUTABLE ? [] : ["."]), "--user-data-dir=" + profile],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")),
});

let app;
async function openProfiles() {
  const page = await app.firstWindow();
  await page.locator("#app-version").filter({ hasText: "버전 v" }).waitFor();
  await clickMenu(app, "manage-profiles");
  await page.locator("#profiles-dialog").waitFor();
  return page;
}

try {
  app = await launch();
  let page = await app.firstWindow();
  const { settings } = await page.evaluate(() => window.mud.request("load"));
  await app.close();
  app = undefined;
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ ...settings, host: "legacy.example", port: 6777, encoding: "utf8" }));

  app = await launch();
  page = await openProfiles();
  assert.equal(await page.inputValue("#host"), "legacy.example");
  assert.equal(await page.inputValue("#port"), "6777");
  assert.equal(await page.inputValue("#encoding"), "utf8");
  await page.click("#profile-add");
  await page.fill("#profile-label", "다른 서버");
  await page.fill("#host", "other.example");
  await page.click("#profiles-save");
  await page.locator("#profiles-dialog").waitFor({ state: "hidden" });
  await app.close();
  app = undefined;

  app = await launch();
  page = await openProfiles();
  await page.selectOption("#profile-select", "1");
  assert.equal(await page.inputValue("#profile-label"), "다른 서버");
  assert.equal(await page.inputValue("#host"), "other.example");
  await page.click("#profile-remove");
  await page.click("#profiles-save");
  await page.locator("#profiles-dialog").waitFor({ state: "hidden" });
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("connect-profiles").submenu.items.map((item) => item.label));
  assert.deepEqual(labels, ["legacy.example"]);
  if (process.env.DESKTOP_SCREENSHOT) await page.screenshot({ path: process.env.DESKTOP_SCREENSHOT });
  console.log("Profile UI passed: legacy settings, add, restart, delete, and native menu refresh");
} finally {
  await app?.close();
}
