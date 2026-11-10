// Apple Silicon Macs refuse to start apps whose code signature is broken or missing.
// Without a paid Apple developer certificate, an "ad-hoc" signature makes the app start normally.
const { execSync } = require("child_process");
const path = require("path");
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const appPath = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  console.log("Ad-hoc signing", appPath);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
  execSync(`codesign --verify --deep --verbose=2 "${appPath}"`, { stdio: "inherit" });
};
