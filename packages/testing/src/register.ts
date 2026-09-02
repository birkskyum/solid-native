import * as nodeModule from "node:module";

import { loadSync } from "./loader.js";

const registerHooks = (
  nodeModule as typeof nodeModule & {
    readonly registerHooks?: (hooks: {
      readonly load: typeof loadSync;
    }) => void;
  }
).registerHooks;

if (registerHooks === undefined) {
  nodeModule.register(new URL("./loader.js", import.meta.url));
} else {
  registerHooks({ load: loadSync });
}
