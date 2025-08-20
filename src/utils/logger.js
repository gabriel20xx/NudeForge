// Robust shared logger loader with multiple fallback search paths.
// Tries to locate NudeShared/logger.js relative to this file or via env var NUDESHARED_DIR.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadSharedLogger() {
	const candidates = new Set();
	if (process.env.NUDESHARED_DIR) {
		candidates.add(path.join(process.env.NUDESHARED_DIR, 'logger.js'));
	}
	// Typical monorepo (../../.. from src/utils). e.g., NudeCollection/NudeForge/src/utils -> NudeCollection/NudeShared
	candidates.add(path.join(__dirname, '..', '..', '..', 'NudeShared', 'logger.js'));
	// If project root copied to /app (no parent folder for project name) -> /app/src/utils -> /app/NudeShared
	candidates.add(path.join(__dirname, '..', '..', 'NudeShared', 'logger.js'));
	// Alternate shallow copy: /app/src/utils -> /app/src/NudeShared
	candidates.add(path.join(__dirname, '..', 'NudeShared', 'logger.js'));
	// CWD-based lookups
	candidates.add(path.join(process.cwd(), 'NudeShared', 'logger.js'));
	// Docker image path possibility if mounted at /NudeShared
	candidates.add(path.join(path.sep, 'NudeShared', 'logger.js'));

	for (const filePath of candidates) {
		try {
			if (fs.existsSync(filePath)) {
				const mod = await import(pathToFileURL(filePath).href);
				if (mod && mod.default) return mod.default;
				return mod; // fallback if module exports directly
			}
		} catch { /* ignore - expected when probing candidate paths */ }
	}
	// Fallback minimal logger
	return {
		debug: () => {},
		info: (...a) => console.log('[INFO][SharedLoggerFallback]', ...a),
		warn: (...a) => console.warn('[WARN][SharedLoggerFallback]', ...a),
		error: (...a) => console.error('[ERROR][SharedLoggerFallback]', ...a),
		success: (...a) => console.log('[SUCCESS][SharedLoggerFallback]', ...a)
	};
}

// Top-level await is supported (ESM). Export the resolved logger.
const Logger = await loadSharedLogger();
export default Logger;

