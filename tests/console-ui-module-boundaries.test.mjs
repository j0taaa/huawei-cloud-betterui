import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const facade = readFileSync(join(root, "src/components/console-ui.tsx"), "utf8");

const moduleResponsibilities = {
  "code-display": ["ConsoleCodeBlock", "ConsoleLogEntry"],
  "form-controls": [
    "ConsoleCheckbox",
    "ConsoleCheckboxOption",
    "ConsoleField",
    "ConsoleInput",
    "ConsoleSelect",
    "ConsoleTextarea",
  ],
  interactions: [
    "ConsoleActionButton",
    "ConsoleButton",
    "ConsoleChoiceButton",
    "ConsoleFloatingMenuPanel",
    "ConsoleIconButton",
    "ConsoleLinkButton",
    "ConsoleListOptionButton",
    "ConsoleMenuItem",
    "ConsoleMenuLink",
    "ConsoleRemovablePill",
    "ConsoleSplitActionChip",
    "ConsoleToolbarButton",
  ],
  loading: [
    "ConsoleLoadingChip",
    "ConsoleSkeletonBlock",
    "ConsoleSkeletonButton",
    "ConsoleSkeletonRow",
  ],
};

test("console UI responsibilities live in focused modules behind the facade", () => {
  for (const [moduleName, exports] of Object.entries(moduleResponsibilities)) {
    const relativePath = `src/components/console-ui/${moduleName}.tsx`;
    assert.equal(existsSync(join(root, relativePath)), true, `${relativePath} should exist`);
    assert.match(
      facade,
      new RegExp(`export \\* from "@/components/console-ui/${moduleName}"`),
      `${moduleName} should be exported by the console UI facade`,
    );

    const implementation = readFileSync(join(root, relativePath), "utf8");
    for (const exportName of exports) {
      assert.match(
        implementation,
        new RegExp(`export (?:const|function) ${exportName}\\b`),
        `${exportName} should be owned by ${moduleName}`,
      );
      assert.doesNotMatch(
        facade,
        new RegExp(`export (?:const|function) ${exportName}\\b`),
        `${exportName} should not drift back into the facade`,
      );
    }
  }
});
