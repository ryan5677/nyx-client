package com.nyxclient.mod.hud;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/**
 * Per-element HUD positions, as fractions of the screen (0.0-1.0 on each
 * axis) so a saved position lands in the same relative spot regardless of
 * window size or GUI scale. One line per element ("id=x,y") in a single
 * small file this mod owns - kept deliberately separate from the
 * launcher's config so a drag can never race against the launcher saving
 * an unrelated settings change at the same moment.
 */
final class NyxPositionStore {
	private static final Path FILE = FabricLoader.getInstance()
			.getConfigDir().resolve("nyx-companion-positions.txt");

	private static final Map<String, double[]> POSITIONS = new HashMap<>();
	private static boolean loaded = false;

	private NyxPositionStore() {}

	private static void loadOnce() {
		if (loaded) return;
		loaded = true;
		try {
			if (!Files.exists(FILE)) return;
			for (String line : Files.readAllLines(FILE, StandardCharsets.UTF_8)) {
				int eq = line.indexOf('=');
				if (eq < 0) continue;
				String id = line.substring(0, eq).trim();
				String[] parts = line.substring(eq + 1).trim().split(",");
				if (parts.length == 2) {
					POSITIONS.put(id, new double[] {
							clamp01(Double.parseDouble(parts[0].trim())),
							clamp01(Double.parseDouble(parts[1].trim())),
					});
				}
			}
		} catch (Exception e) {
			// Corrupt or unreadable file - elements just fall back to their
			// own defaults rather than crashing HUD rendering over it.
		}
	}

	private static double clamp01(double v) {
		return Math.max(0.0, Math.min(1.0, v));
	}

	static double x(NyxHudElement element) {
		loadOnce();
		double[] p = POSITIONS.get(element.id());
		return p != null ? p[0] : element.defaultX();
	}

	static double y(NyxHudElement element) {
		loadOnce();
		double[] p = POSITIONS.get(element.id());
		return p != null ? p[1] : element.defaultY();
	}

	static void set(NyxHudElement element, double x, double y) {
		loadOnce();
		POSITIONS.put(element.id(), new double[] { clamp01(x), clamp01(y) });
	}

	/** Called once a drag ends - not on every tick, so this never writes mid-drag. */
	static void save() {
		loadOnce();
		StringBuilder sb = new StringBuilder();
		for (Map.Entry<String, double[]> entry : POSITIONS.entrySet()) {
			sb.append(entry.getKey()).append('=')
					.append(entry.getValue()[0]).append(',').append(entry.getValue()[1]).append('\n');
		}
		try {
			Files.writeString(FILE, sb.toString(), StandardCharsets.UTF_8);
		} catch (IOException e) {
			// Best-effort - losing a saved HUD position isn't worth crashing over.
		}
	}
}
