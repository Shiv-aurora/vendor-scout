import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultDataPath = process.env.VERCEL
  ? join(tmpdir(), "vendor-scout-runtime.json")
  : join(root, "data", "runtime.json");

export class FileDemoStore {
  constructor(path = process.env.VENDOR_SCOUT_DATA_PATH || defaultDataPath) {
    this.path = path;
    this.kind = "local-file";
  }

  async init(initialState) {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      await readFile(this.path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.write(initialState);
    }
    return this;
  }

  async snapshot() {
    return JSON.parse(await readFile(this.path, "utf8"));
  }

  async write(value) {
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporaryPath, this.path);
    return value;
  }
}

export async function createDemoStore(initialState) {
  return new FileDemoStore().init(initialState);
}
