import assert from "node:assert/strict";
import { decode, encode } from "fast-png";

// Browser-only tile fixtures make the two UTC dates distinguishable even if
// NASA is offline or a real site looks identical on both dates.
export function compareFixture() {
  const colors = [
    [34, 128, 174],
    [209, 120, 69],
  ];
  const tiles = colors.map((color) => {
    const data = new Uint8Array(256 * 256 * 3);
    for (let i = 0; i < data.length; i += 3) data.set(color, i);
    return Buffer.from(encode({ width: 256, height: 256, channels: 3, data }));
  });
  const dates = new Map();
  let requests = 0;
  return {
    count: () => requests,
    respond(route, date) {
      requests++;
      if (!dates.has(date)) dates.set(date, dates.size % 2);
      return route.fulfill({
        contentType: "image/png",
        body: tiles[dates.get(date)],
      });
    },
    color(date) {
      return colors[dates.get(date)];
    },
  };
}

export async function checkCompare(page, fixture) {
  const main = page.locator("main");
  const divider = page.getByRole("slider", { name: "Comparison divider" });
  const dates = await page
    .locator('.compare-dates input[type="date"]')
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  assert.notEqual(dates[0], dates[1]);
  const hazards = page.getByRole("checkbox", { name: "Hazard indicators" });
  assert.ok(await hazards.isChecked());
  const leafletMap = await page.locator(".regional-map").count();
  if (leafletMap) {
    await page.locator(".cluster-symbol").first().waitFor();
    await hazards.uncheck();
    assert.equal(await page.locator(".cluster-symbol").count(), 0);
    await hazards.check();
    await page.locator(".cluster-symbol").first().waitFor();
  }
  await hazards.uncheck();
  let frame = await main.boundingBox();
  const x = (fraction) => Math.round(frame.x + fraction * frame.width);
  const y = Math.round(frame.y + frame.height * 0.59);
  async function colorAt(fraction, date) {
    const clip = { x: x(fraction) - 12, y, width: 24, height: 24 };
    const image = decode(await page.screenshot({ clip }));
    const color = fixture.color(date);
    if (!color) return false;
    let matches = 0;
    for (let i = 0; i < image.data.length; i += image.channels) {
      if (color.every((v, c) => Math.abs(image.data[i + c] - v) < 4)) matches++;
    }
    return matches > 0.55 * image.width * image.height;
  }
  async function waitForColor(position, date) {
    const until = Date.now() + 8000;
    do {
      if (await colorAt(position, date)) return;
      await new Promise((resolve) => setTimeout(resolve, 120));
    } while (Date.now() < until);
    assert.fail(
      `Expected visible pixels from ${date} at ${position * 100}% of viewport`,
    );
  }
  await waitForColor(0.4, dates[0]);
  await waitForColor(0.62, dates[1]);
  const count = fixture.count();
  const leaflet = page.locator(".leaflet-map-pane");
  const startCamera = (await leaflet.count())
    ? await leaflet.getAttribute("style")
    : undefined;
  // Grab the visible line away from its grip, then cross the original seam.
  await page.mouse.move(x(0.5), y);
  await page.mouse.down();
  await page.mouse.move(x(0.76), y, { steps: 16 });
  await page.mouse.up();
  await waitForColor(0.62, dates[0]);
  await page.mouse.move(x(0.76), y);
  await page.mouse.down();
  await page.mouse.move(x(0.24), y, { steps: 18 });
  await page.mouse.up();
  await waitForColor(0.4, dates[1]);
  if (startCamera !== undefined)
    assert.equal(
      await leaflet.getAttribute("style"),
      startCamera,
      "dragging the seam must not pan",
    );
  assert.equal(fixture.count(), count, "dragging must reuse both loaded dates");
  await divider.focus();
  await page.keyboard.press("End");
  await waitForColor(0.62, dates[0]);
  await page.keyboard.press("Home");
  await waitForColor(0.4, dates[1]);
  // A date change must not discard the other (possibly slow) source.
  const originalCount = fixture.count();
  const missing = "2011-03-10";
  await page.route("**/api/modis/" + missing + "/**", (r) =>
    r.fulfill({ status: 503, body: "Temporarily unavailable" }),
  );
  const rightDate = page.locator('.compare-dates input[type="date"]').nth(1);
  await rightDate.fill(missing);
  await page.getByText("Imagery unavailable", { exact: true }).waitFor();
  assert.equal(fixture.count(), originalCount);
  await divider.focus();
  await page.keyboard.press("End");
  await waitForColor(0.62, dates[0]);
  await rightDate.fill(dates[0]);
  await page.getByText("Same date on both sides").waitFor();
  await divider.focus();
  await page.keyboard.press("Home");
  await waitForColor(0.4, dates[0]);
  await rightDate.fill(dates[1]);
  await waitForColor(0.4, dates[1]);
  await page.getByRole("button", { name: "English / العربية" }).click();
  const arabicDivider = page.getByRole("slider", { name: "فاصل المقارنة" });
  await arabicDivider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("PageUp");
  await waitForColor(0.4, dates[0]);
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: x(0.5), y }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x(0.75), y }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await waitForColor(0.62, dates[0]);
  } finally {
    await client.detach();
  }
  await page.getByRole("button", { name: "English / العربية" }).click();
  const originalSize = page.viewportSize();
  await page.setViewportSize({
    width: originalSize.width - 210,
    height: originalSize.height,
  });
  frame = await main.boundingBox();
  await page.mouse.move(x(0.36), y);
  await page.mouse.down();
  await page.mouse.move(x(0.48), y + 20, { steps: 12 });
  await page.mouse.up();
  await waitForColor(0.62, dates[0]);
  await waitForColor(0.85, dates[1]);
  await page.setViewportSize(originalSize);
  const leftSource = page.getByLabel("Left · Satellite");
  const rightSource = page.getByLabel("Right · Satellite");
  assert.equal(await leftSource.inputValue(), "daily");
  const aquaRequested = page.waitForRequest(
    (r) => new URL(r.url()).searchParams.get("view") === "aqua",
  );
  await rightSource.selectOption("aqua");
  await aquaRequested;
  assert.equal(await leftSource.inputValue(), "daily");
  await page.route("**/api/scene?**", (r) =>
    r.fulfill({ status: 404, json: { code: "no_scene" } }),
  );
  await rightSource.selectOption("landsat");
  await page
    .getByText("No acquisition covers the map centre in this window.")
    .waitFor();
  if (leafletMap)
    assert.equal(await page.locator(".leaflet-imageryB-pane img").count(), 0);
  await rightSource.selectOption("daily");
  await hazards.check();
}
