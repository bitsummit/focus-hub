// Cross-platform entry point: works in PowerShell as well as the Codespaces shell.
process.env.FOCUS_DEV='true';
await import('./index.ts');
export {};
