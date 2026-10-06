// Load .env into process.env. Import this module first, for its side effect.
// Node reads .env files itself (process.loadEnvFile), with dotenv's default
// rules:
//
//   - The file is `.env` in the working directory.
//   - A variable already set, even to "", is never replaced. The test setups
//     rely on this: they blank the AI keys so a developer's own keys cannot
//     reach a live provider.
//   - A missing file is not an error.
//
// A file that exists but cannot be read gets one warning, so a key that never
// loaded does not look like a key that was never set.

try {
  process.loadEnvFile();
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") {
    console.warn(
      `[Config] .env could not be read (${code ?? String(err)}). Its variables are not set.`,
    );
  }
}
