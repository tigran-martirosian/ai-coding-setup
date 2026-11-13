// Installs the built extension into Nimbalyst's user extensions folder
// (%APPDATA%\@nimbalyst\electron\extensions\usageplan). Does not touch the app install.
import { installBuilt } from "../../shared/build-lib.mjs";

await installBuilt("usageplan");
