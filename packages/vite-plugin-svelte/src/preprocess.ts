import path from 'path';
import * as vite from 'vite';
import type { ESBuildOptions, ResolvedConfig } from 'vite';
// eslint-disable-next-line node/no-missing-import
import type { Preprocessor, PreprocessorGroup } from 'svelte/types/compiler/preprocess';

const supportedStyleLangs = ['css', 'less', 'sass', 'scss', 'styl', 'stylus', 'postcss', 'sss'];
const supportedScriptLangs = ['ts'];

export function vitePreprocess(opts?: {
	script?: boolean;
	style?: boolean | Parameters<typeof viteStyle>[0];
}) {
	const preprocessor: PreprocessorGroup = {};
	if (opts?.script !== false) {
		preprocessor.script = viteScript().script;
	}
	if (opts?.style !== false) {
		const styleOpts = typeof opts?.style == 'object' ? opts?.style : undefined;
		preprocessor.style = viteStyle(styleOpts).style;
	}
	return preprocessor;
}

export function viteScript(): { script: Preprocessor } {
	return {
		async script({ attributes, content, filename = '' }) {
			const lang = attributes.lang as string;
			if (!supportedScriptLangs.includes(lang)) return;
			const transformResult = await vite.transformWithEsbuild(content, filename, {
				loader: lang as ESBuildOptions['loader'],
				target: 'esnext',
				tsconfigRaw: {
					compilerOptions: {
						// svelte typescript needs this flag to work with type imports
						importsNotUsedAsValues: 'preserve',
						preserveValueImports: true
					}
				}
			});
			return {
				code: transformResult.code,
				map: transformResult.map
			};
		}
	};
}

export function viteStyle(config: vite.InlineConfig | vite.ResolvedConfig = {}): {
	style: Preprocessor;
} {
	let transform: CssTransform;
	return {
		async style({ attributes, content, filename = '' }) {
			if (!transform) {
				const resolvedConfig = isResolvedConfig(config)
					? config
					: await vite.resolveConfig(config, 'build');
				transform = getCssTransformFn(resolvedConfig);
			}
			const lang = attributes.lang as string;
			if (!supportedStyleLangs.includes(lang)) return;
			const moduleId = `${filename}.${lang}`;
			const result = await transform(content, moduleId);
			// patch sourcemap source to point back to original filename
			if (result.map?.sources?.[0] === moduleId) {
				result.map.sources[0] = path.basename(filename);
			}
			return {
				code: result.code,
				map: result.map ?? undefined
			};
		}
	};
}

// eslint-disable-next-line no-unused-vars
type CssTransform = (code: string, filename: string) => Promise<{ code: string; map?: any }>;

function getCssTransformFn(config: ResolvedConfig): CssTransform {
	// API is only available in Vite 3.2 and above
	// TODO: Remove Vite plugin hack when bump peer dep to Vite 3.2
	if (vite.preprocessCSS) {
		return async (code, filename) => {
			return vite.preprocessCSS(code, filename, config);
		};
	} else {
		const pluginName = 'vite:css';
		const plugin = config.plugins.find((p) => p.name === pluginName);
		if (!plugin) {
			throw new Error(`failed to find plugin ${pluginName}`);
		}
		if (!plugin.transform) {
			throw new Error(`plugin ${pluginName} has no transform`);
		}
		// @ts-expect-error
		return plugin.transform.bind(null);
	}
}

function isResolvedConfig(config: any): config is vite.ResolvedConfig {
	return !!config.inlineConfig;
}