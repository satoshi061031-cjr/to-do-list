#!/usr/bin/env node
// Native colors use the same DESIGN.md roles as the web UI.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const front = fs.readFileSync(path.join(root, "DESIGN.md"), "utf8").split("---")[1];
const colors = Object.fromEntries([...front.matchAll(/^  ([\w-]+): "(#[0-9a-f]{6})"$/gmi)].map(match => [match[1], match[2]]));
const assets = path.join(root, "ios/App/DailySpaceWidget/Assets.xcassets");
const info = { author: "xcode", version: 1 };
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
write(path.join(assets, "Contents.json"), { info });
for (const [name, light, dark] of [
  ["WidgetBackground", "panel", "panel-dark"], ["WidgetText", "text", "text-dark"], ["WidgetMuted", "text-muted", "muted-dark"],
]) {
  function color(key) {
    const hex = colors[key];
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected an opaque design color: ${key}`);
    const component = offset => (parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(6);
    return { "color-space": "srgb", components: { red: component(1), green: component(3), blue: component(5), alpha: "1.000" } };
  }
  write(path.join(assets, `${name}.colorset/Contents.json`), { info, colors: [
    { idiom: "universal", color: color(light) },
    { idiom: "universal", appearances: [{ appearance: "luminosity", value: "dark" }], color: color(dark) },
  ] });
}
write(path.join(assets, "Ghost.imageset/Contents.json"), { info, images: [{ filename: "welcome-sticker.png", idiom: "universal" }] });
fs.copyFileSync(path.join(root, "welcome-sticker.png"), path.join(assets, "Ghost.imageset/welcome-sticker.png"));
console.log("[widget] Generated light/dark design colors and original ghost asset.");
