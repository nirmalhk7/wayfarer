const { copyFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const RULES_NAME = "wayfarer_data_extraction_rules";

module.exports = function withAndroidDataExtractionRules(config) {
  // Some Android versions still allow device transfers when allowBackup is false.
  config = withAndroidManifest(config, (next) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults);
    application.$["android:dataExtractionRules"] = `@xml/${RULES_NAME}`;
    return next;
  });

  return withDangerousMod(config, ["android", async (next) => {
    const resourceDirectory = path.join(next.modRequest.platformProjectRoot, "app/src/main/res/xml");
    await mkdir(resourceDirectory, { recursive: true });
    await copyFile(
      path.join(__dirname, `${RULES_NAME}.xml`),
      path.join(resourceDirectory, `${RULES_NAME}.xml`),
    );
    return next;
  }]);
};
