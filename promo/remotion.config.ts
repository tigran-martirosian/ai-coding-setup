import { Config } from "@remotion/cli/config";

Config.setEntryPoint("./src/index.ts");
Config.setOverwriteOutput(true);

// Frames are captured as PNG so the text stays sharp. The mp4's quality is set in package.json,
// because the gif render reads this file too and takes no --crf.
Config.setVideoImageFormat("png");
