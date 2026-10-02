package com.nyxclient.mod.ui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;

/** Opening a screen. This call moved between Minecraft versions, so it lives in one place. */
public final class NyxNav {
	private NyxNav() {}

	public static void open(Minecraft mc, Screen screen) {
		mc.setScreen(screen);
	}
}
