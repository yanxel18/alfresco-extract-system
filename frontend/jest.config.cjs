/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transform: {
    "^.+\\.[mc]?[tj]sx?$": "babel-jest",
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(\\@mantine|\\@floating-ui|\\@tanstack|react-router|react-router-dom|i18next|react-i18next|i18next-browser-languagedetector|lucide-react)/)",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
    "\\.(jpg|jpeg|png|gif|svg|ico)$": "<rootDir>/src/__tests__/__mocks__/fileMock.js",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "mjs", "cjs"],
  collectCoverage: false,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/main.tsx",
    "!src/**/*.d.ts",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/__tests__/**",
    "!src/pages/**/*.{ts,tsx}",
    "!src/components/AppLayout.tsx",
    "!src/components/FileTree.tsx",
  ],
  coverageThreshold: {
    global: { lines: 95, functions: 95, branches: 95, statements: 95 },
  },
  testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
};
