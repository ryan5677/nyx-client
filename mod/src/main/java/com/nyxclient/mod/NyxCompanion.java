package com.nyxclient.mod;

import com.nyxclient.mod.hud.NyxHudManager;
import com.nyxclient.mod.hud.StatsHudElement;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

/**
 * Entry point. Registers the built-in HUD elements with NyxHudManager (the
 * small "rendering engine" everything else here goes through - see the hud
 * package) and wires up the edit-mode keybind plus the per-tick/per-frame
 * hooks it needs. Adding a new HUD element later means implementing
 * NyxHudElement and adding one register() call here - dragging,
 * hit-testing, and position persistence all come from the manager for
 * free.
 */
public class NyxCompanion implements ClientModInitializer {
	private static KeyBinding editModeKey;

	@Override
	public void onInitializeClient() {
		NyxHudManager.register(new StatsHudElement());

		editModeKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.nyx-companion.edit_hud",
				InputUtil.Type.KEYSYM,
				GLFW.GLFW_KEY_UNKNOWN, // unbound by default - the player picks a key in Controls
				"category.nyx-companion"
		));

		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			if (editModeKey.wasPressed()) NyxHudManager.toggleEditMode();
			NyxHudManager.tick(client);
		});

		// Let the lambda infer its parameter types - Fabric's HudRenderCallback
		// signature changes between Minecraft versions, so naming the types
		// explicitly here would break the build on every bump.
		HudRenderCallback.EVENT.register((context, tickDelta) -> {
			MinecraftClient client = MinecraftClient.getInstance();
			if (client != null) NyxHudManager.renderAll(context, client);
		});
	}
}
