import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        // The bot's whole state is module-level, and several modules are only
        // ever reached through one another's imports, so a rule that treats an
        // unused import as a build failure would be noise rather than signal.
        noUnusedLocals: "off",
      },
    },
    rules: {
      // Grammy's ctx.match is a string for a command and an array for a callback
      // query, so the codebase narrows it with typeof. That is deliberate and
      // correct, not a loose comparison.
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // The suites build partial Telegram updates and partial contexts on
      // purpose; a real Context cannot be constructed without a live bot.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
    },
  },
);
