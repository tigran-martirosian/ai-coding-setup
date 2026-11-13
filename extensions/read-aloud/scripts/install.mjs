// Installs the built extension into Nimbalyst's user extensions folder
// (%APPDATA%\@nimbalyst\electron\extensions\readaloud). Does not touch the app install.
import { installBuilt } from "../../shared/build-lib.mjs";

await installBuilt("readaloud", [
  "manifest.json",
  "dist",
  "claude-plugin",
  "README.md",
]);
