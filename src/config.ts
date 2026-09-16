import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Schema } from "effect";

export const SnConfigSchema = Schema.Struct({
  blockedInstances: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

export type SnConfig = {
  readonly blockedInstances: ReadonlyArray<string>;
};

const DEFAULT_CONFIG: SnConfig = {
  blockedInstances: [],
};

export const loadConfig = (cwd: string = process.cwd()): SnConfig => {
  const configPath = join(cwd, "sn.config.json");
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const isConfig = Schema.is(SnConfigSchema);
    if (isConfig(parsed)) {
      const isString = Schema.is(Schema.String);
      const list = (parsed.blockedInstances ?? []).filter(isString);
      const blocked = list.map((host: string) => host.toLowerCase().replace(/\.+$/, ""));
      return {
        blockedInstances: blocked,
      };
    }
    return DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
};

export const getBlockedInstances = (cwd: string = process.cwd()): ReadonlySet<string> =>
  new Set(loadConfig(cwd).blockedInstances);
