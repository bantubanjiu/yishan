#!/usr/bin/env node
import { saveConfig } from "./config.ts";

const [vaultPath, inboxDir = "Inbox", attachmentsDir = "Inbox/attachments"] = process.argv.slice(2);

if (!vaultPath) {
  console.error("Usage: node src/host/configure.ts <vaultPath> [inboxDir] [attachmentsDir]");
  process.exit(1);
}

await saveConfig({ vaultPath, inboxDir, attachmentsDir });
console.log("Saved Obsidian Web Clipper config.");
