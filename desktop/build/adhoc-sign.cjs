// Apple Silicon Macs refuse to start apps whose code signature is broken or missing.
// Without a paid Apple developer certificate, an "ad-hoc" signature makes the app start normally.
const { execSync } = require("child_process");
const path = require("path");
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const appPath = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  console.log("Ad-hoc signing", appPath);
  // the bundled media extractor is its own program: make it runnable and sign it first
  const yt = path.join(appPath, "Contents", "Resources", "app", "bin", "yt-dlp");
  if (require("fs").existsSync(yt)) { execSync(`chmod +x "${yt}"`); try { execSync(`codesign --force --sign - "${yt}"`, { stdio: "inherit" }); } catch (e) { console.log("yt-dlp signing skipped:", e.message); } }
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
  execSync(`codesign --verify --deep --verbose=2 "${appPath}"`, { stdio: "inherit" });
};
