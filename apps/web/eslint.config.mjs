import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ['**/*.tsx'],
    plugins: { '@next/next': nextPlugin },
    rules: nextPlugin.configs.recommended.rules,
  },
  { ignores: ['.next/**', 'out/**', 'node_modules/**'] },
);
