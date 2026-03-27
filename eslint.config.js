// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  {
    rules: {
      // Permit `any` in areas that interface with external libraries or legacy code
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars are errors except for underscore-prefixed names
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      // Require `await` on async functions that are called without it
      "@typescript-eslint/no-floating-promises": "error",
      // Consistent use of `type` imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" }
      ]
    }
  }
);
