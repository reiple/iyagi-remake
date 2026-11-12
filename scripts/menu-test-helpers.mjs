export async function clickMenu(app, id) {
  await app.evaluate(({ Menu, BrowserWindow }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) throw Error(`Menu item unavailable: ${id}`);
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    item.click({}, win);
  }, id);
}

export async function connectLocal(app, page, port) {
  await page.locator("#app-version").filter({ hasText: "버전 v" }).waitFor();
  await clickMenu(app, "manage-profiles");
  await page.fill("#profile-label", "모의 서버");
  await page.fill("#host", "127.0.0.1");
  await page.fill("#port", String(port));
  await page.click("#profiles-save");
  await page.locator("#profiles-dialog").waitFor({ state: "hidden" });
  await clickMenu(app, "connect-profile-0");
}
