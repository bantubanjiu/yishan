#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "dist");
const zipPath = path.join(outDir, "yishan-release.zip");
const include = ["extension", "src", "scripts", "README.md", "LICENSE", "package.json", "版本记录README.md"];

await mkdir(outDir, { recursive: true });
await rm(zipPath, { force: true });

if (process.platform === "win32") {
  const list = include.map((item) => `'${item.replaceAll("'", "''")}'`).join(",");
  await run("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path ${list} -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`]);
} else {
  await run("zip", ["-r", zipPath, ...include]);
}

console.log(`Release zip written to ${zipPath}`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}`));
      }
    });
  });
}
