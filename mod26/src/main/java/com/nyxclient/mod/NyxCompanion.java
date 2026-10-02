package com.nyxclient.mod;

import com.nyxclient.mod.ui.NyxButtonStyler;
import com.nyxclient.mod.ui.NyxNav;
import com.nyxclient.mod.ui.NyxSettingsScreen;
import com.nyxclient.mod.ui.NyxTitleScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;

/**
 * Nyx Companion for the unobfuscated (26.x) Minecraft versions. Same idea as
 * the older builds: no mixins, screens are swapped as they open and buttons
 * are restyled after they draw.
 */
public class NyxCompanion implements ClientModInitializer {
	/** The last ordinary screen that opened - becomes the parent of a replaced options screen. */
	private static Screen lastScreen = null;

	@Override
	public void onInitializeClient() {
		NyxButtonStyler.register();

		ScreenEvents.BEFORE_INIT.register((client, screen, w, h) -> {
			Class<?> type = screen.getClass();
			if (type == TitleScreen.class && NyxConfig.getBool("customMenu", true)) {
				client.execute(() -> NyxNav.open(client, new NyxTitleScreen()));
			} else if (type == OptionsScreen.class && NyxConfig.getBool("customSettings", true)) {
				if (NyxSettingsScreen.allowVanilla) {
					// The player asked for the vanilla menu from ours - let it open once.
				} else {
					Screen parent = lastScreen;
					client.execute(() -> NyxNav.open(client, new NyxSettingsScreen(parent)));
				}
			} else if (!(screen instanceof NyxSettingsScreen) && !(screen instanceof NyxTitleScreen)) {
				lastScreen = screen;
			}
			if (!(screen instanceof OptionsScreen)) NyxSettingsScreen.allowVanilla = false;
		});
	}
}
