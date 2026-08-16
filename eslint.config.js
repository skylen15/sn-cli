import tseslint from "typescript-eslint";

// ponytail: curly-only ruleset — parser just lets ESLint read .ts; no type-aware rules.
export default tseslint.config({
  files: ["src/**/*.ts", "tests/**/*.ts"],
  languageOptions: { parser: tseslint.parser },
  rules: {
    curly: ["error", "all"],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "^\\.\\./",
            message:
              "Parent-relative imports are banned; use #src/… or #package.json.",
          },
        ],
      },
    ],
  },
});
