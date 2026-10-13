// Run after `cap add ios` (npm run ios:add does this) and again after every `cap sync`. Idempotent.
// Applies the App Store settings Capacitor's template doesn't have: permission texts, iPhone-only portrait,
// iOS 15 minimum (StoreKit 2), privacy manifest, app icon and launch image.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), ios = path.join(root, "ios", "App");
if (!fs.existsSync(ios)) { console.error("ios/App not found. Run: npm run ios:add"); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const read = f => fs.readFileSync(f, "utf8"), exists = fs.existsSync;
let did = [];

// ---- Info.plist
const plistPath = path.join(ios, "App", "Info.plist");
let plist = read(plistPath);
const orig = plist;
const setKey = (key, xml) => {
  const re = new RegExp("<key>" + key.replace(/[~]/g, "\\~") + "</key>\\s*(?:<string>[\\s\\S]*?</string>|<true/>|<false/>|<array>[\\s\\S]*?</array>)");
  if (re.test(plist)) plist = plist.replace(re, "<key>" + key + "</key>\n\t" + xml);
  else plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, "\t<key>" + key + "</key>\n\t" + xml + "\n</dict>\n</plist>\n");
};
setKey("NSCameraUsageDescription", "<string>EduVerse uses the camera so you can take a photo of a homework question. The photo is only used to explain that question.</string>");
setKey("NSMicrophoneUsageDescription", "<string>EduVerse listens for your voice commands, like an answer or the word next, only while voice control is on.</string>");
setKey("NSSpeechRecognitionUsageDescription", "<string>EduVerse uses Apple speech recognition to understand your voice commands. Nothing is recorded or kept.</string>");
setKey("NSPhotoLibraryUsageDescription", "<string>EduVerse lets you choose a photo of a homework question. The photo is only used to explain that question.</string>");
setKey("ITSAppUsesNonExemptEncryption", "<false/>");
setKey("UISupportedInterfaceOrientations", "<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>");
plist = plist.replace(/<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>[\s\S]*?<\/array>\s*/, "");
// UIScene life cycle: required by the iOS 26+/Xcode 26+ SDK, or the app crashes on launch. UIKit builds the window from the Main storyboard.
if (!plist.includes("UIApplicationSceneManifest")) {
  plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, "\t<key>UIApplicationSceneManifest</key>\n\t<dict>\n\t\t<key>UIApplicationSupportsMultipleScenes</key>\n\t\t<false/>\n\t\t<key>UISceneConfigurations</key>\n\t\t<dict>\n\t\t\t<key>UIWindowSceneSessionRoleApplication</key>\n\t\t\t<array>\n\t\t\t\t<dict>\n\t\t\t\t\t<key>UISceneConfigurationName</key>\n\t\t\t\t\t<string>Default Configuration</string>\n\t\t\t\t\t<key>UISceneDelegateClassName</key>\n\t\t\t\t\t<string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>\n\t\t\t\t\t<key>UISceneStoryboardFile</key>\n\t\t\t\t\t<string>Main</string>\n\t\t\t\t</dict>\n\t\t\t</array>\n\t\t</dict>\n\t</dict>\n</dict>\n</plist>\n");
}
const appDelegatePath = path.join(ios, "App", "AppDelegate.swift");
if (exists(appDelegatePath) && !read(appDelegatePath).includes("class SceneDelegate")) {
  fs.appendFileSync(appDelegatePath, `
// UIScene life cycle (required by the current iOS SDK). UIKit builds the window from the Main storyboard.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:]) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
`);
  did.push("SceneDelegate");
}
if (plist !== orig) { fs.writeFileSync(plistPath, plist); did.push("Info.plist"); }

// ---- Xcode project + Podfile
const proj = path.join(ios, "App.xcodeproj", "project.pbxproj");
if (exists(proj)) {
  let p = read(proj), o = p;
  p = p.replace(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g, "IPHONEOS_DEPLOYMENT_TARGET = 15.0;")
       .replace(/TARGETED_DEVICE_FAMILY = "?[\d,]+"?;/g, "TARGETED_DEVICE_FAMILY = 1;")
       .replace(/MARKETING_VERSION = [^;]+;/g, "MARKETING_VERSION = " + (cfg.version || "1.0.0") + ";")
       .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, "CURRENT_PROJECT_VERSION = " + (cfg.build || "1") + ";");
  if (p !== o) { fs.writeFileSync(proj, p); did.push("project.pbxproj"); }
}
// ---- entitlements: iCloud (CloudKit, for syncing progress) and Game Center (friends, weekly leaderboard)
const entPath = path.join(ios, "App", "App.entitlements");
const container = "iCloud." + cfg.bundleId;
fs.writeFileSync(entPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.icloud-container-identifiers</key>
	<array>
		<string>${container}</string>
	</array>
	<key>com.apple.developer.icloud-services</key>
	<array>
		<string>CloudKit</string>
	</array>
	<key>com.apple.developer.game-center</key>
	<true/>
</dict>
</plist>
`); did.push("App.entitlements (iCloud " + container + ", Game Center)");
if (exists(proj)) {
  let p = read(proj), o = p;
  // add CODE_SIGN_ENTITLEMENTS next to every PRODUCT_BUNDLE_IDENTIFIER of the app target (Debug + Release)
  p = p.replace(/(\n(\s*)PRODUCT_BUNDLE_IDENTIFIER = [^;]+;)/g, (m, line, ind) => p.includes("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;") ? m : "\n" + ind + "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;" + line);
  if (p !== o) { fs.writeFileSync(proj, p); did.push("entitlements linked in project.pbxproj"); }
}
const pod = path.join(ios, "Podfile");
if (exists(pod)) { let p = read(pod), o = p; p = p.replace(/platform :ios, '[\d.]+'/, "platform :ios, '15.0'"); if (p !== o) { fs.writeFileSync(pod, p); did.push("Podfile"); } }

// ---- privacy manifest
const priv = path.join(ios, "App", "PrivacyInfo.xcprivacy");
fs.copyFileSync(path.join(root, "ios-overlay", "PrivacyInfo.xcprivacy"), priv); did.push("PrivacyInfo.xcprivacy");

// ---- icon and launch image
const assets = path.join(ios, "App", "Assets.xcassets");
const iconDir = path.join(assets, "AppIcon.appiconset");
if (exists(iconDir)) {
  let name = "AppIcon-512@2x.png";
  const cj = path.join(iconDir, "Contents.json");
  if (exists(cj)) { const m = /"filename"\s*:\s*"([^"]+\.png)"/.exec(read(cj)); if (m) name = m[1]; }
  fs.copyFileSync(path.join(root, "assets", "icon-1024.png"), path.join(iconDir, name)); did.push("app icon");
}
const splashDir = path.join(assets, "Splash.imageset");
if (exists(splashDir)) {
  for (const f of fs.readdirSync(splashDir)) if (/\.png$/i.test(f)) fs.copyFileSync(path.join(root, "assets", "splash-2732.png"), path.join(splashDir, f));
  did.push("launch image");
}
console.log("Applied:", did.join(", "));
console.log("\nManual steps left in Xcode (once): see README.md section 'Xcode steps'.");
