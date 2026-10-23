const { withProjectBuildGradle } = require("expo/config-plugins");

const MARKER = "// Wayfarer: permit empty upstream library test tasks on Gradle 9.";

module.exports = function withGradleTestCompatibility(config) {
  return withProjectBuildGradle(config, (next) => {
    if (next.modResults.language !== "groovy" || next.modResults.contents.includes(MARKER)) {
      return next;
    }

    next.modResults.contents += `

${MARKER}
allprojects {
  tasks.withType(org.gradle.api.tasks.testing.Test).configureEach {
    failOnNoDiscoveredTests = false
  }
}
`;
    return next;
  });
};
