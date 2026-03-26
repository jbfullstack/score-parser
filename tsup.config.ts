import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: {
			index: "src/index.ts",
		},
		format: ["esm", "cjs"],
		dts: true,
		splitting: false,
		sourcemap: false,
		clean: true,
		outDir: "dist",
		target: "es2020",
	},

	{
		entry: {
			"cli/index": "cli/index.ts",
		},
		format: ["esm", "cjs"],
		dts: false,
		splitting: false,
		sourcemap: false,
		clean: false,
		outDir: "dist",
		target: "es2020",
	},
]);