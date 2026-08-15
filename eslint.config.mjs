import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// SPEC §3.2 — the layer dependency rule, enforced here:
//   src/sim    imports nothing from the other layers, no React, no Node I/O
//   src/game   imports only src/sim
//   src/server imports only src/sim
const simForbidden = [
  { group: ["@/server/*", "@/game/*", "@/app/*"], message: "src/sim is the pure core — it imports nothing from other layers (SPEC §3.2)." },
  { group: ["react", "react-dom", "react-dom/*", "next", "next/*"], message: "src/sim is framework-free (SPEC §3.2)." },
  { group: ["node:*", "fs", "path", "os", "crypto", "http", "https", "net", "child_process"], message: "src/sim performs no I/O (SPEC §3.1)." },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: simForbidden }],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Time enters src/sim only as an explicit tick parameter (SPEC §4.4)." },
        { name: "fetch", message: "src/sim performs no I/O (SPEC §3.1)." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Randomness comes from rng(seed, tick, purpose) (SPEC §4.4)." },
      ],
    },
  },
  {
    files: ["src/game/**/*.ts", "src/game/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/server/*", "@/app/*"], message: "src/game imports only src/sim (SPEC §3.2)." }] },
      ],
    },
  },
  {
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/game/*", "@/app/*", "react", "react-dom", "react-dom/*"], message: "src/server imports only src/sim (SPEC §3.2)." }] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
