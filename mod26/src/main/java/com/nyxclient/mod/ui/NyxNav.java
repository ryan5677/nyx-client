package com.nyxclient.mod.ui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.options.OptionsScreen;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * Calls whose shape changed between 26.1, 26.2 and 26.3 (opening a screen,
 * the vanilla options constructor, refreshing the video settings). Minecraft
 * 26.x is unobfuscated, so the real names exist at runtime and can be looked
 * up reflectively - one jar per version still, but no per-version source
 * trees for these few calls.
 */
public final class NyxNav {
	private NyxNav() {}

	public static void open(Minecraft mc, Screen screen) {
		try {
			Method direct = find(Minecraft.class, "setScreen", Screen.class);
			if (direct != null) {
				direct.invoke(mc, screen);
				return;
			}
			Field guiField = Minecraft.class.getField("gui");
			Object gui = guiField.get(mc);
			Method viaGui = find(gui.getClass(), "setScreen", Screen.class);
			if (viaGui != null) viaGui.invoke(gui, screen);
		} catch (Throwable t) {
			System.err.println("[nyx-companion] could not open screen: " + t);
		}
	}

	/** Builds the vanilla options screen whatever its constructor looks like in this version. */
	public static Screen vanillaOptions(Minecraft mc, Screen parent) {
		try {
			for (Constructor<?> c : OptionsScreen.class.getConstructors()) {
				Class<?>[] types = c.getParameterTypes();
				Object[] args = new Object[types.length];
				boolean ok = true;
				for (int i = 0; i < types.length; i++) {
					if (Screen.class.isAssignableFrom(types[i])) args[i] = parent;
					else if (types[i].isInstance(mc.options)) args[i] = mc.options;
					else if (types[i] == boolean.class) args[i] = false;
					else { ok = false; break; }
				}
				if (ok) return (Screen) c.newInstance(args);
			}
		} catch (Throwable t) {
			System.err.println("[nyx-companion] could not build vanilla options: " + t);
		}
		return parent;
	}

	/** Best-effort refresh after video settings changed; skipped quietly if this version has no such call. */
	public static void refreshVideo(Minecraft mc) {
		try {
			if (mc.level != null && mc.levelRenderer != null) call(mc.levelRenderer, "allChanged");
			call(mc, "resizeDisplay");
		} catch (Throwable ignored) {
			// Settings are already saved; a missed visual refresh just means they apply on the next screen.
		}
	}

	private static void call(Object target, String name) throws Exception {
		Method m = find(target.getClass(), name);
		if (m != null) m.invoke(target);
	}

	private static Method find(Class<?> type, String name, Class<?>... params) {
		try {
			return type.getMethod(name, params);
		} catch (NoSuchMethodException e) {
			return null;
		}
	}
}
