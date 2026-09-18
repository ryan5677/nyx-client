package com.nyxclient.mod;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Reads the config file the Nyx Client launcher writes (see lib/ingame.js in
 * the launcher). The launcher owns the UI for these options; this mod just
 * applies whatever it finds.
 *
 * The file lives in the launcher's own userData directory, which on Windows
 * is %APPDATA%/nyx-client. If it isn't there - someone running this mod
 * without the launcher, say - every option falls back to a sane default and
 * the mod simply does nothing visible.
 *
 * Re-read on a timer rather than cached forever, so toggling something in the
 * launcher shows up in a running game within a few seconds instead of needing
 * a restart.
 */
public final class NyxConfig {
	private static final long RELOAD_INTERVAL_MS = 3000L;

	private static long lastLoad = 0L;
	private static JsonObject options = new JsonObject();

	private NyxConfig() {}

	private static Path configPath() {
		String appData = System.getenv("APPDATA");
		if (appData != null && !appData.isEmpty()) {
			return Paths.get(appData, "nyx-client", "nyx-ingame-config.json");
		}
		// Fall back to the Linux/macOS equivalents so this isn't Windows-only.
		String home = System.getProperty("user.home", ".");
		Path linux = Paths.get(home, ".config", "nyx-client", "nyx-ingame-config.json");
		if (Files.exists(linux)) return linux;
		return Paths.get(home, "Library", "Application Support", "nyx-client", "nyx-ingame-config.json");
	}

	private static void reloadIfStale() {
		long now = System.currentTimeMillis();
		if (now - lastLoad < RELOAD_INTERVAL_MS) return;
		lastLoad = now;
		try {
			Path path = configPath();
			if (!Files.exists(path)) return;
			try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
				JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
				if (root.has("options") && root.get("options").isJsonObject()) {
					options = root.getAsJsonObject("options");
				}
			}
		} catch (Exception e) {
			// A half-written file (the launcher saving at the same moment) or
			// malformed JSON shouldn't crash the game - keep the last good copy.
		}
	}

	public static boolean getBool(String key, boolean fallback) {
		reloadIfStale();
		try {
			return options.has(key) ? options.get(key).getAsBoolean() : fallback;
		} catch (Exception e) {
			return fallback;
		}
	}

	public static String getString(String key, String fallback) {
		reloadIfStale();
		try {
			return options.has(key) ? options.get(key).getAsString() : fallback;
		} catch (Exception e) {
			return fallback;
		}
	}

	/** Accent colour as 0xRRGGBB, parsed from the launcher's "#rrggbb" string. */
	public static int accentColor() {
		String hex = getString("accentColor", "#8b5cf6");
		try {
			return Integer.parseInt(hex.replace("#", ""), 16);
		} catch (Exception e) {
			return 0x8b5cf6;
		}
	}
}
