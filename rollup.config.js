import typescript from '@rollup/plugin-typescript';

const external = ['react'];

/** @type {import('rollup').RollupOptions[]} */
export default [
  // ESM build
  {
    input: {
      'index': 'src/index.ts',
      'react/index': 'src/react/index.ts',
    },
    output: {
      dir: 'dist/esm',
      format: 'esm',
      sourcemap: true,
      preserveModules: false,
    },
    external,
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        outDir: 'dist/esm',
      }),
    ],
  },
  // CJS build
  {
    input: {
      'index': 'src/index.ts',
      'react/index': 'src/react/index.ts',
    },
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      sourcemap: true,
      preserveModules: false,
      exports: 'named',
    },
    external,
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        outDir: 'dist/cjs',
      }),
    ],
  },
];
