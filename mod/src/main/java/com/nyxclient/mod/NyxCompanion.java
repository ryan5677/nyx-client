package com.nyxclient.mod;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.text.Text;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Draws the Nyx HUD overlays (FPS, coordinates, CPS). Everything it shows is
 * driven by NyxConfig, which reads the launcher's config file - nothing here
 * has its own settings screen, the launcher is the UI.
 */
public class NyxCompanion implements ClientModInitializer {
	private static final int MARGIN = 6;
	private static final int LINE_HEIGHT = 11;

	/** Click timestamps from the last second, for the CPS readout. */
	private static final Deque<Long> CLICKS = new ArrayDeque<>();
	private static boolean wasAttacking = false;

	/** Called from the click mixin/hook whenever the attack button goes down. */
	public static void recordClick() {
		CLICKS.addLast(System.currentTimeMillis());
	}

	private static int currentCps() {
		long cutoff = System.currentTimeMillis() - 1000L;
		while (!CLICKS.isEmpty() && CLICKS.peekFirst() < cutoff) {
			CLICKS.removeFirst();
		}
		return CLICKS.size();
	}

	@Override
	public void onInitializeClient() {
		// Let the lambda infer its parameter types - Fabric's HudRenderCallback
		// signature changes between Minecraft versions, so naming the types
		// explicitly here would break the build on every bump.
		HudRenderCallback.EVENT.register((context, tickDelta) -> render(context));
	}

	private void render(net.minecraft.client.gui.DrawContext context) {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.player == null) return;
		if (client.options.hudHidden) return;

		// Poll the attack button here rather than mixing into input handling -
		// fewer moving parts, and accurate enough for a CPS readout.
		boolean attacking = client.options.attackKey.isPressed();
		if (attacking && !wasAttacking) recordClick();
		wasAttacking = attacking;

		boolean showFps = NyxConfig.getBool("fpsCounter", false);
		boolean showCoords = NyxConfig.getBool("coords", false);
		boolean showCps = NyxConfig.getBool("cpsCounter", false);
		if (!showFps && !showCoords && !showCps) return;

		TextRenderer font = client.textRenderer;
		int color = NyxConfig.accentColor();
		String position = NyxConfig.getString("fpsPosition", "top-left");

		int screenW = client.getWindow().getScaledWidth();
		int screenH = client.getWindow().getScaledHeight();

		boolean right = position.endsWith("right");
		boolean bottom = position.startsWith("bottom");

		// Build the lines first so the block can be positioned as a unit.
		java.util.List<String> lines = new java.util.ArrayList<>();
		if (showFps) lines.add(client.getCurrentFps() + " FPS");
		if (showCoords) {
			lines.add(String.format("%.1f, %.1f, %.1f",
					client.player.getX(), client.player.getY(), client.player.getZ()));
		}
		if (showCps) lines.add(currentCps() + " CPS");

		int blockHeight = lines.size() * LINE_HEIGHT;
		int y = bottom ? screenH - MARGIN - blockHeight : MARGIN;

		for (String line : lines) {
			int x = right ? screenW - MARGIN - font.getWidth(line) : MARGIN;
			context.drawTextWithShadow(font, Text.literal(line), x, y, color);
			y += LINE_HEIGHT;
		}
	}
}
