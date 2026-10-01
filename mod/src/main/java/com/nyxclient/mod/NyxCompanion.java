package com.nyxclient.mod;

import com.nyxclient.mod.ui.NyxButtonStyler;
import com.nyxclient.mod.ui.NyxSettingsScreen;
import com.nyxclient.mod.ui.NyxTitleScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;

/**
 * Nyx Companion: swaps in Nyx-styled menus. No mixins - screens are replaced
 * from a tick hook, and button restyling is a paint-over after render (see
 * NyxButtonStyler), so there is very little here that can break between
 * Minecraft versions.
 *
 * Each feature can be switched off from the launcher (customMenu /
 * customSettings in nyx-ingame-config.json). With no launcher config at all,
 * everything defaults to on.
 */
public class NyxCompanion implements ClientModInitializer {
	/** The screen that was open on the previous tick - becomes the parent of a replaced screen. */
	private Screen previous = null;

	@Override
	public void onInitializeClient() {
		NyxButtonStyler.register();

		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			Screen current = client.currentScreen;

			if (current != previous) {
				if (current != null && NyxConfig.getBool("customMenu", true)
						&& current.getClass() == TitleScreen.class) {
					client.setScreen(new NyxTitleScreen());
					current = client.currentScreen;
				} else if (current != null && NyxConfig.getBool("customSettings", true)
						&& current.getClass() == OptionsScreen.class) {
					if (NyxSettingsScreen.allowVanilla) {
						// The player asked for the vanilla menu from ours - let it open once.
					} else {
						client.setScreen(new NyxSettingsScreen(previous));
						current = client.currentScreen;
					}
				}
				if (!(current instanceof OptionsScreen)) NyxSettingsScreen.allowVanilla = false;
			}
			previous = current;
		});
	}
}
