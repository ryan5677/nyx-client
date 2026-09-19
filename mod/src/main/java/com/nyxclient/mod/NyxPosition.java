package com.nyxclient.mod;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Where the HUD block sits, as fractions of the screen (0.0-1.0 on each
 * axis) so it lands in the same relative spot regardless of window size or
 * GUI scale. Lives in this mod's own config file, written only by this mod
 * (see NyxCompanion's drag handling) - kept separate from the launcher's
 * config specifically so a drag can never race against the launcher saving
 * an unrelated settings change.
 */
final class NyxPosition {
	private static final Path FILE = FabricLoader.getInstance()
			.getConfigDir().resolve("nyx-companion-position.txt");

	private static double x = 0.02; // just inside the top-left corner by default
	private static double y = 0.02;
	private static boolean loaded = false;

	private NyxPosition() {}

	private static void loadOnce() {
		if (loaded) return;
		loaded = true;
		try {
			if (!Files.exists(FILE)) return;
			String[] parts = Files.readString(FILE, StandardCharsets.UTF_8).trim().split(",");
			if (parts.length == 2) {
				x = clamp01(Double.parseDouble(parts[0].trim()));
				y = clamp01(Double.parseDouble(parts[1].trim()));
			}
		} catch (Exception e) {
			// Corrupt or unreadable file - fall back to the default position
			// rather than crashing HUD rendering over a saved coordinate.
		}
	}

	private static double clamp01(double v) {
		return Math.max(0.0, Math.min(1.0, v));
	}

	static double x() { loadOnce(); return x; }
	static double y() { loadOnce(); return y; }

	static void set(double newX, double newY) {
		loadOnce();
		x = clamp01(newX);
		y = clamp01(newY);
	}

	/** Called once a drag ends - not on every tick, so this never writes mid-drag. */
	static void save() {
		try {
			Files.writeString(FILE, x + "," + y, StandardCharsets.UTF_8);
		} catch (IOException e) {
			// Best-effort - losing a saved HUD position isn't worth crashing over.
		}
	}
}
